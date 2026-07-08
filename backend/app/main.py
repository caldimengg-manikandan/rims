import os
import sys
from pathlib import Path

# ── Passlib / bcrypt compatibility patch ──────────────────────────────────────
import importlib
import bcrypt as _bcrypt_mod
if not hasattr(_bcrypt_mod, "__about__"):
    _bcrypt_mod.__about__ = type("_about", (), {"__version__": _bcrypt_mod.__version__})()

_ph = importlib.import_module("passlib.handlers.bcrypt")
_ph.detect_wrap_bug = lambda ident: False
try:
    _ph.bcrypt.set_backend("default")
except Exception:
    pass
# ──────────────────────────────────────────────────────────────────────────────

if os.getenv("BACKEND_START_MODE") not in ["script", "docker"]:
    print("Use start.ps1 to run the backend")
    sys.exit(1)

from fastapi import FastAPI, HTTPException, status, Request as FastAPIRequest
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import SQLAlchemyError
import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from app.core.auth import hash_password
from app.core.config import get_settings
from app.infrastructure.database import Base, engine
from app.api import auth, jobs, applications, interviews, decisions, notifications, analytics, tickets, support, hr_tickets, ops_email, settings as hr_settings, onboarding, repository, websocket
from app.domain.models import (
    User, Job, Application, ResumeExtraction, 
    Interview, InterviewQuestion, InterviewAnswer,
    HiringDecision, Notification,
    ApplicationStage, AuditLog, InterviewReport
)


from app.core.logging_config import setup_logging

settings = get_settings()

if os.environ.get("RIMS_LOGGING_DONE", "0") != "1":
    # Enable file logging in the 'logs' directory or a temp dir if not writable
    import os
    import tempfile
    base_dir = Path(__file__).parent.parent
    if os.access(base_dir, os.W_OK):
        logs_dir = base_dir / "logs"
    else:
        logs_dir = Path(tempfile.gettempdir()) / "rims_logs"
    setup_logging(logs_dir, settings.debug)
    os.environ["RIMS_LOGGING_DONE"] = "1"
logger = logging.getLogger(__name__)

settings.validate_config()

# Schema creation: guarded to primary worker only in multi-process deployments.
# BUG-038 Fix: create_all() is disabled in production to prevent accidental schema
# mutations. Production deployments must use 'alembic upgrade head' instead.
if os.environ.get("WORKER_ID", "0") == "0":
    if settings.env != "production":
        Base.metadata.create_all(bind=engine)
    else:
        logger.info(
            "Production mode: Skipping Base.metadata.create_all(). "
            "Run 'alembic upgrade head' to apply schema changes."
        )

# Startup schema validation is now managed strictly via supabase/migrations/ SQL files.

from app.infrastructure.database import SessionLocal

def bootstrap_super_admin():
    """Idempotently create the super_admin account defined in env config.
    
    BUG-016 Fix: Uses SELECT FOR UPDATE to prevent race conditions in multi-worker
    deployments, and only promotes an existing email user if their email exactly
    matches SUPER_ADMIN_EMAIL (never auto-promotes arbitrary accounts).
    """
    if not settings.super_admin_email or not settings.super_admin_password:
        return
    configured_email = settings.super_admin_email.lower().strip()
    try:
        with SessionLocal() as db:
            from sqlalchemy import text as _text
            # BUG-016 Fix: Lock the row to prevent concurrent promotion races.
            if "postgresql" in str(db.get_bind().url).lower():
                db.execute(_text("SELECT pg_advisory_xact_lock(1919191919)"))

            existing_admin = db.query(User).filter(User.role == "super_admin").first()
            if existing_admin:
                return
            existing_email_user = db.query(User).filter(User.email == configured_email).first()
            if existing_email_user:
                # BUG-016 Fix: Only promote accounts that match the configured email exactly.
                # Never promote untrusted/unverified accounts that were registered normally.
                if existing_email_user.email != configured_email:
                    logger.error(
                        f"BUG-016: Refusing super_admin promotion for mismatched email: {existing_email_user.email}"
                    )
                    return
                existing_email_user.role = "super_admin"
                existing_email_user.is_verified = True
                existing_email_user.is_active = True
                existing_email_user.approval_status = "approved"
                db.commit()
                return
            super_admin = User(
                email=configured_email,
                full_name=settings.super_admin_full_name.strip() or "Super Admin",
                password_hash=hash_password(settings.super_admin_password),
                role="super_admin",
                is_verified=True,
                is_active=True,
                approval_status="approved"
            )
            db.add(super_admin)
            db.commit()
    except Exception as e:
        logger.error(f"Super Admin bootstrap failed: {str(e)}")

bootstrap_super_admin()


from app.core.standardized_route import StandardizedAPIRoute

# ── IMAP Email Polling Background Task ─────────────────────────────────────
from app.services.email_ingestion_service import fetch_resume_attachments
from app.core.encryption import decrypt_field

async def _sweep_stuck_applications(db):
    """Scan for applications stuck in 'parsing' or 'pending' for > 15 minutes,
    increment retry count and trigger background re-parse, or mark as permanent failure.
    """
    try:
        from datetime import datetime, timedelta
        from app.domain.models import Application
        from app.api.applications import process_application_background
        from app.services.state_machine import CandidateState
        from sqlalchemy import or_, and_

        from app.core.timezone import get_ist_now

        cutoff = get_ist_now() - timedelta(minutes=15)
        stuck_apps = db.query(Application).filter(
            Application.resume_status.in_(["parsing", "pending"]),
            or_(
                Application.parsing_started_at < cutoff,
                and_(Application.parsing_started_at == None, Application.applied_at < cutoff)
            )
        ).all()

        if not stuck_apps:
            return

        logger.info(f"[SWEEPER] Found {len(stuck_apps)} stuck applications. Attempting self-healing/retry.")

        for app in stuck_apps:
            retries = app.retry_count or 0
            if retries < 3:
                logger.warning(f"[SWEEPER] Application #{app.id} is stuck. Resetting and retrying background parsing (attempt {retries + 1}).")
                app.resume_status = "parsing"
                app.parsing_started_at = get_ist_now()
                app.retry_count = retries + 1
                db.commit()

                # Trigger parsing asynchronously in the background
                asyncio.create_task(
                    process_application_background(
                        app.id,
                        app.job_id,
                        app.resume_file_path,
                        app.candidate_email,
                        app.candidate_name
                    )
                )
            else:
                logger.error(f"[SWEEPER] Application #{app.id} has exceeded maximum retries. Marking as permanent failure.")
                app.resume_status = "failed"
                app.status = CandidateState.REJECTED.value
                app.failure_reason = "[PERMANENT_FAILURE]: Ingestion/Parsing timed out repeatedly."
                db.commit()
    except Exception as e:
        logger.error(f"[SWEEPER] Error during stuck applications recovery sweep: {e}", exc_info=True)


async def _imap_polling_loop():
    """Background coroutine that polls the IMAP inbox for resume attachments.

    Uses a database-backed distributed lock to ensure only one worker runs
    the ingestion loop at any given time, eliminating the worker age check
    which causes stalls on worker crashes.
    
    BUG-007 Fix: Exponential backoff circuit breaker — after 3 consecutive
    failures, sleep is increased up to 30 minutes to avoid hammering a broken
    IMAP server. On success, the backoff counter resets to zero.
    """
    import uuid
    _consecutive_failures = 0
    _max_backoff_seconds = 1800  # 30 minutes cap
    _base_sleep_seconds = 60     # Normal poll interval
    
    polling_instance_id = str(uuid.uuid4())
    
    while True:
        db = None
        lock_acquired = False
        lock_token = None
        sleep_seconds = _base_sleep_seconds
        try:
            db = SessionLocal()

            # Ensure lock key exists in global_settings
            from app.domain.models import GlobalSettings
            lock_record = db.query(GlobalSettings).filter(GlobalSettings.key == "imap_polling_lock").first()
            if not lock_record:
                try:
                    lock_record = GlobalSettings(key="imap_polling_lock", value="")
                    db.add(lock_record)
                    db.commit()
                except Exception:
                    db.rollback()

            # Acquire lock via SELECT FOR UPDATE inside the session's transaction block
            lock_record = db.query(GlobalSettings).filter(GlobalSettings.key == "imap_polling_lock").with_for_update().first()
            
            now_epoch = time.time()
            is_locked = False
            
            if lock_record and lock_record.value:
                try:
                    val_parts = lock_record.value.split(":")
                    if len(val_parts) == 2:
                        val_instance, val_time_str = val_parts
                        locked_time = float(val_time_str)
                        # Lock expires after 5 minutes
                        if now_epoch - locked_time < 300:
                            is_locked = True
                except ValueError:
                    pass

            if is_locked:
                db.rollback()
                db.close()
                await asyncio.sleep(sleep_seconds)
                continue

            # Acquire the lock
            lock_token = f"{polling_instance_id}:{now_epoch}"
            if lock_record:
                lock_record.value = lock_token
                db.commit()
                lock_acquired = True
            else:
                db.rollback()
                db.close()
                await asyncio.sleep(sleep_seconds)
                continue

            # Run stuck applications sweep
            try:
                await _sweep_stuck_applications(db)
            except Exception as sweep_err:
                logger.error(f"Failed to run stuck applications recovery sweep: {sweep_err}")

            # Fetch all users with auto_sync_enabled == True
            from app.domain.models import User
            users_with_sync = db.query(User).filter(User.auto_sync_enabled == True).all()
            
            # Keep list of sync parameters to process after closing primary db session
            sync_targets = []
            for u in users_with_sync:
                if u.imap_email and u.imap_password:
                    sync_targets.append({
                        "id": u.id,
                        "email": u.imap_email,
                        "password_enc": u.imap_password
                    })

            # Close the primary DB session to release its connection back to the pool
            db.close()
            db = None

            if sync_targets:
                from app.services.email_ingestion_service import run_batch_resume_processing
                for target in sync_targets:
                    try:
                        imap_password = decrypt_field(target["password_enc"]).strip()
                        logger.info(f"Running auto-sync for user ID {target['id']} ({target['email']})")
                        await asyncio.to_thread(fetch_resume_attachments, None, target["email"], imap_password, target["id"])
                        await run_batch_resume_processing(None, hr_id=target["id"])
                    except Exception as sync_err:
                        logger.error(f"Auto-sync failed for user {target['id']}: {sync_err}")
            else:
                logger.debug("No users have auto-sync enabled.")
            
            # Record success timestamp and reset circuit breaker
            app.state.imap_last_success = time.time()
            app.state.imap_last_error = None
            _consecutive_failures = 0
            sleep_seconds = _base_sleep_seconds
        except asyncio.CancelledError:
            # Propagate cancellation so the lifespan shutdown handler works correctly.
            raise
        except Exception as e:
            _consecutive_failures += 1
            logger.error(f"IMAP Polling Error (failure #{_consecutive_failures}): {e}")
            # Record error
            app.state.imap_last_error = str(e)
            app.state.imap_last_error_time = time.time()
            # BUG-007: Exponential backoff after repeated failures
            sleep_seconds = min(
                _base_sleep_seconds * (2 ** (_consecutive_failures - 1)),
                _max_backoff_seconds
            )
            if _consecutive_failures >= 3:
                logger.warning(
                    f"[IMAP CIRCUIT BREAKER] {_consecutive_failures} consecutive failures. "
                    f"Backing off for {sleep_seconds}s before next attempt."
                )
        finally:
            if lock_acquired:
                # Open a new short-lived session to release the lock safely
                release_db = SessionLocal()
                try:
                    # Release lock: verify token matches before clearing to prevent overwrites
                    lock_record = release_db.query(GlobalSettings).filter(GlobalSettings.key == "imap_polling_lock").with_for_update().first()
                    if lock_record and lock_record.value == lock_token:
                        lock_record.value = ""
                        release_db.commit()
                    else:
                        release_db.rollback()
                except Exception as rel_err:
                    logger.error(f"Failed to release IMAP polling lock: {rel_err}")
                    try:
                        release_db.rollback()
                    except Exception:
                        pass
                finally:
                    release_db.close()
            
            if db is not None:
                try:
                    db.close()
                except Exception:
                    pass

        # Sleep in 1-second chunks to allow rapid wake-up on settings update
        slept = 0
        while slept < sleep_seconds:
            if hasattr(app, "state") and getattr(app.state, "reset_imap_backoff", False):
                app.state.reset_imap_backoff = False
                _consecutive_failures = 0
                sleep_seconds = _base_sleep_seconds
                logger.info("[IMAP] Resetting circuit breaker backoff due to settings update.")
                break
            await asyncio.sleep(1)
            slept += 1


@asynccontextmanager
async def lifespan(app):
    """Application lifespan: manages background tasks on startup/shutdown."""
    # Startup — start IMAP polling loop on all workers; database lock handles concurrency.
    polling_task = asyncio.create_task(_imap_polling_loop())
    logger.info("IMAP polling loop task spawned on this worker.")

    yield  # ── Application runs here ──

    # Shutdown — cleanly cancel the polling task.
    if polling_task is not None:
        polling_task.cancel()
        try:
            await polling_task
        except asyncio.CancelledError:
            pass
        logger.info("IMAP polling loop stopped.")


app = FastAPI(
    title="HR Recruitment System API",
    description="AI-powered automated recruitment platform",
    version="1.0.0",
    redirect_slashes=True,
    lifespan=lifespan,
    docs_url="/docs" if settings.env != "production" else None,
    redoc_url="/redoc" if settings.env != "production" else None,
    openapi_url="/openapi.json" if settings.env != "production" else None,
)

if settings.sentry_dsn:
    import sentry_sdk
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.env,
        traces_sample_rate=0.1
    )

app.router.route_class = StandardizedAPIRoute

# Force https scheme for request scope when behind an SSL-terminating reverse proxy
@app.middleware("http")
async def override_proxy_scheme(request: FastAPIRequest, call_next):
    if request.headers.get("x-forwarded-proto") == "https":
        request.scope["scheme"] = "https"
    return await call_next(request)




import time
app.state.start_time = time.time()

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.core.rate_limiter import limiter

def cors_aware_rate_limit_handler(request: FastAPIRequest, exc: RateLimitExceeded):
    response = _rate_limit_exceeded_handler(request, exc)
    origin = request.headers.get("origin")
    if not origin and settings.env == "development":
        origin = settings.frontend_base_url
    allowed_origins = settings.get_allowed_origins()
    if origin and (origin in allowed_origins or "*" in allowed_origins or settings.env == "development"):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
    return response

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, cors_aware_rate_limit_handler)


from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
# BUG-028 Fix: Restrict trusted_hosts to the actual reverse proxy IP/host.
# Using "*" or broad CIDR ranges allows X-Forwarded-For spoofing from arbitrary clients.
# We fetch this dynamically from environment variables for production security.
_trusted_proxies_env = os.environ.get("TRUSTED_PROXY_HOST")
if _trusted_proxies_env:
    trusted_proxy_hosts = [ip.strip() for ip in _trusted_proxies_env.split(",") if ip.strip()]
else:
    # Safe default: loopback only
    trusted_proxy_hosts = ["127.0.0.1"]
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=trusted_proxy_hosts)

from app.core.middleware import PerformanceLoggingMiddleware, SecurityHeadersMiddleware
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(PerformanceLoggingMiddleware)

allowed_origins = list(set(settings.get_allowed_origins()))
if settings.env == "development":
    allowed_origins = list(set(allowed_origins + ["http://localhost:3000", "http://127.0.0.1:3000"]))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Content-Type", "Authorization", "X-Request-ID", "X-Requested-With", "TEST_ADMIN_SECRET", "X-Request-Source"],
)

def check_tcp_connection(host: str, port: int, timeout: float = 2.0) -> str:
    """Helper to check TCP connection to a host and port.
    Returns 'ok', 'error', or 'not_configured'.
    """
    if not host:
        return "not_configured"
    import socket
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return "ok"
    except Exception:
        return "error"

@app.get("/health", tags=["System"])
def health_check():
    uptime_seconds = round(time.time() - app.state.start_time, 2)
    db_status = "ok"
    linkedin_status = "disabled"
    linkedin_warning = None
    try:
        from sqlalchemy import text
        from app.infrastructure.database import SessionLocal
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        if settings.enable_linkedin_posting:
            from app.domain.models import GlobalSettings
            linkedin_status = "ok"
            try:
                expires_record = db.query(GlobalSettings).filter(GlobalSettings.key == "linkedin_token_expires_at").first()
                if expires_record and expires_record.value:
                    from datetime import timezone, timedelta
                    expires_at = datetime.fromisoformat(expires_record.value)
                    now = datetime.now(timezone.utc) if expires_at.tzinfo else datetime.now(timezone.utc).replace(tzinfo=None)
                    if expires_at < now + timedelta(days=7):
                        diff = expires_at - now
                        days_left = diff.days
                        linkedin_status = "warning"
                        if days_left < 0:
                            linkedin_warning = f"LinkedIn access token expired {abs(days_left)} days ago."
                        else:
                            linkedin_warning = f"LinkedIn access token expires in {days_left} days."
            except Exception as e:
                logger.error(f"Error checking LinkedIn token expiry: {e}")
        db.close()
    except Exception:
        db_status = "error"
    
    redis_status = "not_configured"
    if settings.redis_url:
        try:
            from app.core.redis_store import get_redis_client
            redis_client = get_redis_client()
            if redis_client:
                redis_client.ping()
                redis_status = "ok"
            else:
                redis_status = "unavailable"
        except Exception:
            redis_status = "error"
    
    supabase_status = "not_configured"
    if settings.supabase_url:
        try:
            from app.core.storage import get_supabase_client
            client = get_supabase_client()
            if client:
                # Use storage bucket listing — avoids RLS-protected tables.
                # If the service role key is valid, this always succeeds regardless of RLS policies.
                client.storage.list_buckets()
                supabase_status = "ok"
            else:
                supabase_status = "unavailable"
        except Exception as _supa_err:
            logger.warning(f"Supabase health probe failed: {_supa_err}")
            supabase_status = "error"

    rate_limiter_status = "active" if getattr(app.state, "limiter", None) else "inactive"

    imap_status = "not_running"
    if os.environ.get("WORKER_ID", "0") == "0":
        last_success = getattr(app.state, "imap_last_success", 0)
        last_error_time = getattr(app.state, "imap_last_error_time", 0)

        # Check if any user actually has IMAP auto-sync enabled before reporting stuck.
        try:
            from app.infrastructure.database import SessionLocal as _SL
            from app.domain.models import User as _User
            _chk_db = _SL()
            _has_imap_users = _chk_db.query(_User.id).filter(_User.auto_sync_enabled == True).first() is not None
            _chk_db.close()
        except Exception:
            _has_imap_users = True  # Assume configured if we can't check

        if not _has_imap_users:
            imap_status = "not_configured"
        elif last_error_time > last_success:
            imap_status = f"error: {getattr(app.state, 'imap_last_error', 'unknown')}"
        elif time.time() - last_success > 300 and last_success > 0:
            imap_status = "stuck_or_delayed"
        else:
            imap_status = "ok"

    smtp_status = "not_configured"
    if settings.smtp_host:
        smtp_status = check_tcp_connection(settings.smtp_host, settings.smtp_port)

    ai_provider_status = "not_configured"
    has_groq = bool((getattr(settings, "groq_api_key", None) or "").strip() or (getattr(settings, "groq_keys", []) != []))
    if has_groq:
        ai_provider_status = check_tcp_connection("api.groq.com", 443)

    is_healthy = (
        db_status == "ok" and
        smtp_status not in ["error", "unavailable"] and
        supabase_status not in ["error", "unavailable"]
    )

    response_data = {
        "status": "healthy" if is_healthy else "unhealthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "uptime_seconds": uptime_seconds,
        "services": {
            "database": db_status,
            "redis": redis_status,
            "supabase": supabase_status,
            "rate_limit": rate_limiter_status,
            "imap_polling": imap_status,
            "smtp": smtp_status,
            "ai_provider": ai_provider_status
        }
    }
    if settings.enable_linkedin_posting:
        response_data["services"]["linkedin"] = linkedin_status
        response_data["warnings"] = [linkedin_warning] if linkedin_warning else []
    return response_data

@app.get("/live", tags=["System"])
def liveness_check():
    return {"status": "healthy"}

@app.get("/ready", tags=["System"])
def readiness_check():
    db_status = "ok"
    try:
        from sqlalchemy import text
        from app.infrastructure.database import SessionLocal
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
    except Exception:
        db_status = "error"

    supabase_status = "not_configured"
    if settings.supabase_url:
        try:
            from app.core.storage import get_supabase_client
            client = get_supabase_client()
            if client:
                # Use storage bucket listing — avoids RLS-protected tables.
                client.storage.list_buckets()
                supabase_status = "ok"
            else:
                supabase_status = "unavailable"
        except Exception as _supa_err:
            logger.warning(f"Supabase readiness probe failed: {_supa_err}")
            supabase_status = "error"

    smtp_status = "not_configured"
    if settings.smtp_host:
        smtp_status = check_tcp_connection(settings.smtp_host, settings.smtp_port)

    ai_provider_status = "not_configured"
    has_groq = bool((getattr(settings, "groq_api_key", None) or "").strip() or (getattr(settings, "groq_keys", []) != []))
    if has_groq:
        ai_provider_status = check_tcp_connection("api.groq.com", 443)

    is_ready = (
        db_status == "ok" and
        supabase_status not in ["error", "unavailable"] and
        smtp_status not in ["error", "unavailable"]
    )

    if not is_ready:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "status": "unhealthy",
                "services": {
                    "database": db_status,
                    "supabase": supabase_status,
                    "smtp": smtp_status,
                    "ai_provider": ai_provider_status
                }
            }
        )

    return {"status": "healthy"}

@app.get("/", tags=["System"])
def root():
    return {
        "success": True,
        "data": {
            "message": "HR Recruitment System API",
            "version": "1.0.0",
            "docs": "/docs"
        },
        "error": None
    }

app.include_router(auth.router)
app.include_router(jobs.router)
app.include_router(applications.router)
app.include_router(interviews.router)
app.include_router(decisions.router)
app.include_router(notifications.router)
app.include_router(tickets.router)
app.include_router(support.router)
app.include_router(hr_tickets.router)
app.include_router(analytics.router, prefix="/api/analytics", tags=["Analytics"])
app.include_router(ops_email.router)
app.include_router(hr_settings.router)
app.include_router(onboarding.router)
app.include_router(repository.router)
app.include_router(websocket.router)


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(request: FastAPIRequest, exc: RequestValidationError):
    errs = exc.errors()
    errors_list = []
    for e in errs:
        loc = e.get('loc', [])
        field_name = loc[-1] if loc else "payload"
        errors_list.append(f"{field_name}: {e['msg']}")
    response = JSONResponse(
        status_code=422,
        content={
            "success": False,
            "data": None,
            "error": "Validation failed: " + "; ".join(errors_list)
        }
    )
    origin = request.headers.get("origin")
    allowed_origins = settings.get_allowed_origins()
    if origin and (origin in allowed_origins or "*" in allowed_origins or settings.env == "development"):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
    return response

@app.exception_handler(HTTPException)
async def http_exception_handler(request: FastAPIRequest, exc: HTTPException):
    from app.core.observability import get_request_id
    request_id = get_request_id(request)
    user_id = getattr(request.state, "user_id", None)
    
    if exc.status_code >= 500:
        import traceback
        error_trace = traceback.format_exc()
        logger.exception(
            f"HTTP exception on {request.method} {request.url.path} (request_id={request_id}, user_id={user_id}): {exc.detail}",
            extra={
                "request_id": request_id,
                "user_id": user_id,
                "endpoint": request.url.path,
                "method": request.method,
                "error": str(exc.detail),
                "stack_trace": error_trace
            }
        )
    else:
        logger.warning(
            f"HTTP {exc.status_code} on {request.method} {request.url.path} (request_id={request_id}, user_id={user_id}): {exc.detail}"
        )

    response = JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "data": None,
            "error": exc.detail
        }
    )
    origin = request.headers.get("origin")
    allowed_origins = settings.get_allowed_origins()
    if origin and (origin in allowed_origins or "*" in allowed_origins or settings.env == "development"):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
    return response

@app.exception_handler(SQLAlchemyError)
async def database_exception_handler(request: FastAPIRequest, exc: SQLAlchemyError):
    import traceback
    error_trace = traceback.format_exc()
    from app.core.observability import get_request_id
    request_id = get_request_id(request)
    user_id = getattr(request.state, "user_id", None)
    
    logger.exception(
        f"Database exception on {request.method} {request.url.path} (request_id={request_id}, user_id={user_id}): {exc}",
        extra={
            "request_id": request_id,
            "user_id": user_id,
            "endpoint": request.url.path,
            "method": request.method,
            "error": str(exc),
            "stack_trace": error_trace
        }
    )

    response = JSONResponse(
        status_code=500,
        content={
            "success": False,
            "data": None,
            "error": "Database error occurred"
        }
    )
    origin = request.headers.get("origin")
    allowed_origins = settings.get_allowed_origins()
    if origin and (origin in allowed_origins or "*" in allowed_origins or settings.env == "development"):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
    return response

@app.exception_handler(Exception)
async def general_exception_handler(request: FastAPIRequest, exc: Exception):
    import traceback
    error_trace = traceback.format_exc()
    from app.core.observability import get_request_id
    request_id = get_request_id(request)
    user_id = getattr(request.state, "user_id", None)
    
    logger.exception(
        f"Unhandled exception on {request.method} {request.url.path} (request_id={request_id}, user_id={user_id}): {exc}",
        extra={
            "request_id": request_id,
            "user_id": user_id,
            "endpoint": request.url.path,
            "method": request.method,
            "error": str(exc),
            "stack_trace": error_trace
        }
    )
    
    detail = str(exc) if settings.debug else "An unexpected internal server error occurred."
    response = JSONResponse(
        status_code=500,
        content={
            "success": False,
            "data": None,
            "error": detail
        }
    )
    origin = request.headers.get("origin")
    allowed_origins = settings.get_allowed_origins()
    if origin and (origin in allowed_origins or "*" in allowed_origins or settings.env == "development"):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
    return response


#
# Note:
# This module must NOT start a server itself.
# Entrypoint is enforced via `start.ps1` and `BACKEND_START_MODE=script`.
