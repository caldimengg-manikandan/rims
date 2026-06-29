from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import HTTPException, Depends, status, Request
from sqlalchemy.orm import Session
import logging
from app.core.config import get_settings
from app.domain.models import User
from app.infrastructure.database import get_db, set_db_identity
from app.core.timezone import get_ist_now

settings = get_settings()
logger = logging.getLogger(__name__)

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
APPROVALID_INTERVIEW_STATUSES = {"not_started", "in_progress", "completed", "cancelled", "terminated", "expired"}
APPROVED_STAFF_ROLES = {"super_admin", "hr"}
PENDING_STAFF_ROLE = "pending_hr"

def _pre_hash_password(password: str) -> bytes:
    """BUG-009 Fix: Pre-hash long passwords with SHA-256 before bcrypt to prevent
    BCrypt's silent 72-byte truncation from creating a security vulnerability.
    
    Passwords longer than 72 bytes are SHA-256 hashed to a 64-character hex
    string, then bcrypt hashes that. Short passwords (<= 64 bytes) are passed
    through unchanged to maintain backward compatibility with existing hashes.
    
    Security: This means two passwords with the same first 72 bytes but different
    suffixes will now correctly produce DIFFERENT hashes.
    """
    import hashlib
    encoded = password.encode("utf-8")
    if len(encoded) > 64:
        return hashlib.sha256(encoded).hexdigest().encode("ascii")  # 64 ASCII bytes — safe for bcrypt
    return encoded  # Short passwords: pass through unchanged for backward compat


def hash_password(password: str) -> str:
    """Hash password using bcrypt with SHA-256 pre-hashing for long passwords."""
    pre_hashed = _pre_hash_password(password)
    return pwd_context.hash(pre_hashed)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against hash.
    
    BUG-009 Fix: Uses SHA-256 pre-hashing for passwords > 64 bytes to prevent
    BCrypt 72-byte truncation from silently accepting truncated passwords.
    Backward compatible: short passwords are passed through unchanged.
    """
    if not plain_password:
        return False
    pre_hashed = _pre_hash_password(plain_password)
    return pwd_context.verify(pre_hashed, hashed_password)

import secrets

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None, secret: Optional[str] = None) -> str:
    """Create JWT access token"""
    to_encode = data.copy()
    
    if expires_delta:
        expire = get_ist_now() + expires_delta
    else:
        expire = get_ist_now() + timedelta(minutes=settings.jwt_expiration_minutes)
    
    to_encode.update({
        "exp": expire,
        "iat": get_ist_now(),
        "jti": secrets.token_hex(16)
    })
    
    # Use specified secret or fall back to global staff secret
    sign_secret = secret or settings.jwt_secret
    encoded_jwt = jwt.encode(to_encode, sign_secret, algorithm=settings.jwt_algorithm)
    return encoded_jwt

def verify_token(token: str, secret: Optional[str] = None) -> dict:
    """Verify JWT token and return payload"""
    try:
        # Use specified secret or fall back to global staff secret
        verify_secret = secret or settings.jwt_secret
        payload = jwt.decode(
            token,
            verify_secret,
            algorithms=[settings.jwt_algorithm],
            # Explicitly validate expiration and algorithm.
            options={"verify_exp": True, "verify_alg": True, "require_exp": True},
        )
        return payload
    except JWTError as e:
        # Avoid logging the full token (may contain sensitive material); log only a short preview.
        preview = token[:10] + "..." if token else "<empty>"
        logger.warning(f"[SECURITY] JWT decode failed (manipulation or expiration): {str(e)} token_preview={preview}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


def ensure_user_has_roles(user: User, allowed_roles: Iterable[str]) -> User:
    allowed_roles = set(allowed_roles)
    if user.role not in allowed_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Role-based access restriction.",
        )
    return user


def ensure_approved_staff(user: User, allowed_roles: Optional[Iterable[str]] = None) -> User:
    normalized_roles = set(allowed_roles or APPROVED_STAFF_ROLES)
    if user.role not in normalized_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Role-based access restriction.",
        )

    if user.approval_status != "approved" or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is not approved for dashboard access.",
        )

    return user

def get_current_user(
    request: Request,
    db: Session = Depends(get_db)
) -> User:
    """Dependency to get current authenticated user"""
    used_cookie = False
    token = request.cookies.get("access_token") or request.cookies.get("hr_token")
    if token:
        used_cookie = True
    else:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Enforce CSRF protection on mutating cookie-based calls (HIGH-01)
    if used_cookie and request.method in ("POST", "PUT", "DELETE", "PATCH"):
        csrf_passed = False
        requested_with = request.headers.get("X-Requested-With")
        if requested_with:
            csrf_passed = True
        else:
            origin = request.headers.get("Origin") or request.headers.get("Referer")
            if origin:
                allowed = settings.get_allowed_origins()
                from urllib.parse import urlparse
                try:
                    parsed_origin = urlparse(origin)
                    origin_str = f"{parsed_origin.scheme}://{parsed_origin.netloc}"
                    if "*" in allowed or origin_str in allowed or any(o.startswith(origin_str) for o in allowed):
                        csrf_passed = True
                except Exception:
                    pass
        if not csrf_passed:
            logger.warning("CSRF check failed: state-mutating request using cookie without X-Requested-With or valid Origin.")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Action forbidden: CSRF validation failed."
            )
    try:
        # Staff tokens always use the primary JWT secret
        payload = verify_token(token, secret=settings.jwt_secret)

        # Enforce JTI revocation check with fail-closed policy (HIGH-05)
        if settings.redis_url:
            from app.core.redis_store import get_redis_client
            r = get_redis_client()
            if not r:
                logger.error("Redis is configured but client is unavailable. Failing closed.")
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Authentication service temporarily offline.",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            jti = payload.get("jti")
            if jti:
                try:
                    if r.exists(f"token_blocklist:{jti}"):
                        logger.warning(f"Rejected revoked token JTI: {jti}")
                        raise HTTPException(
                            status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="This session has been logged out. Please log in again.",
                            headers={"WWW-Authenticate": "Bearer"},
                        )
                except Exception as e:
                    if isinstance(e, HTTPException):
                        raise e
                    logger.error(f"Redis error during blocklist check (failing closed): {e}")
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="Authentication service temporarily offline.",
                        headers={"WWW-Authenticate": "Bearer"},
                    )

        # Enforce database-backed token revocation check
        jti = payload.get("jti")
        if jti:
            from app.domain.models import RevokedToken
            try:
                revoked = db.query(RevokedToken).filter(RevokedToken.jti == jti).first()
                if revoked:
                    logger.warning(f"Rejected revoked token JTI (DB): {jti}")
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="This session has been logged out. Please log in again.",
                        headers={"WWW-Authenticate": "Bearer"},
                    )
            except Exception as e:
                if isinstance(e, HTTPException):
                    raise e
                logger.error(f"Database error during token blocklist check (failing closed): {e}")
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Authentication service temporarily offline.",
                    headers={"WWW-Authenticate": "Bearer"},
                )

        sub = payload.get("sub")
        role = payload.get("role")
        
        if sub is None or role is None:
            logger.error(f"JWT Payload missing sub or role: {payload}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        user_id = int(sub)
        logger.debug(f"[Auth] Validating user_id={user_id} with role '{role}'")  # BUG-035: downgraded INFO→DEBUG
        user = db.query(User).filter(User.id == user_id).first()
        if user is None:
            logger.warning(f"[Auth] User not found (id redacted for PII safety)")  # BUG-035: no user_id in logs
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Enforce password changed session revocation check (MED-03)
        iat = payload.get("iat")
        if iat and user.password_changed_at:
            token_iat_dt = datetime.fromtimestamp(iat, tz=timezone.utc).replace(tzinfo=None)
            if token_iat_dt < user.password_changed_at:
                logger.warning(f"Rejected token for user (id redacted) issued at {token_iat_dt} before password_changed_at {user.password_changed_at}")
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Password has been changed. Please log in again.",
                    headers={"WWW-Authenticate": "Bearer"},
                )

        # ── Phase 2 Fix: Row Level Security Identity ──
        set_db_identity(db, user.id)

        if user.role != role:
            logger.warning(f"[Auth] Role mismatch for user (id redacted): token={role}, db={user.role}")  # BUG-035
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token role no longer matches this account",
                headers={"WWW-Authenticate": "Bearer"},
            )

        logger.debug(f"[Auth] User authenticated successfully as '{user.role}'")  # BUG-035: downgraded INFO→DEBUG

        if user.role in APPROVED_STAFF_ROLES:
            ensure_approved_staff(user)
        elif user.role == PENDING_STAFF_ROLE:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your account is pending Super Admin approval.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        elif user.approval_status == "rejected" or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is inactive",
                headers={"WWW-Authenticate": "Bearer"},
            )

        if hasattr(request, "state"):
            request.state.user_id = user.id
        return user
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user ID in token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        import traceback
        logger.error(f"[Auth] CRITICAL: Unexpected error in get_current_user: {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal auth error"
        )


def get_current_hr(current_user: User = Depends(get_current_user)) -> User:
    """Dependency to ensure an approved HR or Super Admin session."""
    return ensure_approved_staff(current_user, APPROVED_STAFF_ROLES)

def get_current_admin(current_user: User = Depends(get_current_user)) -> User:
    """Dependency to ensure user is an approved Super Admin."""
    return ensure_approved_staff(current_user, {"super_admin"})



def get_current_interview(
    request: Request,
    db: Session = Depends(get_db)
):
    """Dependency to get current authenticated interview session"""
    from app.domain.models import Interview
    try:
        # Prefer Authorization header over cookie to avoid HR/dashboard `access_token`
        # overriding the interview token.
        auth_header = request.headers.get("Authorization")
        cookie_token = request.cookies.get("access_token")
        token = None
        auth_header_present = bool(auth_header and auth_header.startswith("Bearer "))
        if auth_header_present:
            token = auth_header.split(" ")[1]
        else:
            token = cookie_token
                
        if not token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid interview credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Use interview-specific isolated secret for candidate sessions (HIGH-02)
        if not settings.interview_jwt_secret:
            if settings.env != "production":
                interview_secret = settings.jwt_secret + "_interview"
            else:
                logger.error("INTERVIEW_JWT_SECRET is missing in production. Failing token verification.")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Server configuration error: missing token validation key."
                )
        else:
            interview_secret = settings.interview_jwt_secret

        payload = verify_token(token, secret=interview_secret)

        # Enforce database-backed token revocation check for interviews
        jti = payload.get("jti")
        if jti:
            from app.domain.models import RevokedToken
            try:
                revoked = db.query(RevokedToken).filter(RevokedToken.jti == jti).first()
                if revoked:
                    logger.warning(f"Rejected revoked interview JTI: {jti}")
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="This interview session is no longer valid.",
                        headers={"WWW-Authenticate": "Bearer"},
                    )
            except Exception as e:
                if isinstance(e, HTTPException):
                    raise e
                logger.error(f"Database error during interview JTI check (failing closed): {e}")
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Authentication service temporarily offline.",
                    headers={"WWW-Authenticate": "Bearer"},
                )

        # Debug info to validate we decoded what the frontend is sending.
        logger.info(
            "Interview auth token source "
            f"authorization_header_present={auth_header_present} cookie_present={bool(cookie_token)}"
        )
        logger.info(
            "Interview JWT decoded "
            f"role={payload.get('role')} sub={payload.get('sub')} exp={payload.get('exp')}"
        )
        
        if payload.get("role") != "interview":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: interview JWT required",
                headers={"WWW-Authenticate": "Bearer"},
            )
            
        sub = payload.get("sub")
        if sub is None:
             raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: interview JWT missing sub",
                headers={"WWW-Authenticate": "Bearer"},
            )
            
        interview_id = int(sub)
        
        interview = db.query(Interview).filter(Interview.id == interview_id).first()
        
        # Check basic existence and active status
        if not interview:
            logger.warning(f"Interview auth failed: Record {interview_id} not found.")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Interview session not found. Please contact support.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Single Session Enforcement: Validate that JTI matches the active one
        if jti and interview.active_session_jti != jti:
            logger.warning(f"Interview auth failed: JTI mismatch for interview {interview.id}. Token JTI={jti}, active_session_jti={interview.active_session_jti}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="This session has been invalidated because the interview was started or resumed on another device.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Check allowed interview duration limit
        if interview.status == "in_progress" and interview.started_at:
            from app.core.timezone import to_naive_ist
            started_at_naive = to_naive_ist(interview.started_at)
            elapsed = get_ist_now() - started_at_naive
            duration_limit = timedelta(minutes=interview.duration_minutes or 60)
            if elapsed > duration_limit:
                logger.warning(f"Interview auth failed: Session {interview.id} has exceeded its duration limit. Marking as expired.")
                try:
                    interview.status = "expired"
                    interview.active_session_jti = None
                    db.commit()
                    
                    from app.domain.models import AuditLog
                    import json
                    log = AuditLog(
                        action="INTERVIEW_EXPIRED",
                        resource_type="Interview",
                        resource_id=interview.id,
                        details=json.dumps({"application_id": interview.application_id, "reason": "duration_exceeded"})
                    )
                    db.add(log)
                    db.commit()
                except Exception as e:
                    db.rollback()
                    logger.warning(f"Failed to auto-expire interview {interview.id}: {e}")
                
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Your interview session has expired. Allowed duration exceeded.",
                    headers={"WWW-Authenticate": "Bearer"},
                )

        if interview.status != "in_progress":
            logger.warning(f"Interview auth failed: interview {interview_id} is {interview.status}")
            detail = "This interview session is no longer active."
            if interview.status == "completed":
                detail = "This interview has already been completed."
            elif interview.status == "terminated":
                detail = "This interview has been terminated due to a proctoring violation."
                
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=detail,
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Check for hard expiration timestamp
        if interview.expires_at:
            exp_at = interview.expires_at
            if exp_at < get_ist_now():
                if interview.status != "expired":
                    logger.warning(f"Interview auth failed: Session {interview_id} expired at {exp_at}. Marking as expired.")
                    try:
                        interview.status = "expired"
                        interview.active_session_jti = None
                        db.commit()
                        
                        # Lightweight audit log
                        from app.domain.models import AuditLog
                        import json
                        log = AuditLog(
                            action="INTERVIEW_EXPIRED",
                            resource_type="Interview",
                            resource_id=interview.id,
                            details=json.dumps({"application_id": interview.application_id, "expired_at_timestamp": exp_at.isoformat()})
                        )
                        db.add(log)
                        db.commit()
                    except Exception as e:
                        db.rollback()
                        logger.warning(f"Failed to mark interview {interview_id} as expired: {e}")
                
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Your interview session has expired. Please contact HR to re-issue your access key.",
                    headers={"WWW-Authenticate": "Bearer"},
                )
        
        if hasattr(request, "state"):
            request.state.user_id = f"interview_{interview.id}"
        return interview
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: invalid interview ID in token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        logger.error(f"Internal auth error in get_current_interview: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal auth error"
        )


def get_current_interview_any_status(
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Candidate interview dependency that validates the interview session from the JWT,
    but allows access even after the interview is no longer in_progress.
    Useful for read-only endpoints like fetching final stage/report.
    """
    from app.domain.models import Interview
    try:
        # Prefer Authorization header over cookie to avoid HR/dashboard `access_token`
        # overriding the interview token.
        auth_header = request.headers.get("Authorization")
        cookie_token = request.cookies.get("access_token")
        token = None
        auth_header_present = bool(auth_header and auth_header.startswith("Bearer "))
        if auth_header_present:
            token = auth_header.split(" ")[1]
        else:
            token = cookie_token

        if not token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid interview credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Use interview-specific isolated secret for candidate sessions (HIGH-02)
        if not settings.interview_jwt_secret:
            if settings.env != "production":
                interview_secret = settings.jwt_secret + "_interview"
            else:
                logger.error("INTERVIEW_JWT_SECRET is missing in production. Failing token verification.")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Server configuration error: missing token validation key."
                )
        else:
            interview_secret = settings.interview_jwt_secret

        payload = verify_token(token, secret=interview_secret)

        # Enforce database-backed token revocation check for interviews
        jti = payload.get("jti")
        if jti:
            from app.domain.models import RevokedToken
            try:
                revoked = db.query(RevokedToken).filter(RevokedToken.jti == jti).first()
                if revoked:
                    logger.warning(f"Rejected revoked interview JTI (any status): {jti}")
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="This interview session is no longer valid.",
                        headers={"WWW-Authenticate": "Bearer"},
                    )
            except Exception as e:
                if isinstance(e, HTTPException):
                    raise e
                logger.error(f"Database error during interview JTI check (failing closed): {e}")
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Authentication service temporarily offline.",
                    headers={"WWW-Authenticate": "Bearer"},
                )

        logger.info(
            "Interview auth token source (any status) "
            f"authorization_header_present={auth_header_present} cookie_present={bool(cookie_token)}"
        )
        logger.info(
            "Interview JWT decoded (any status) "
            f"role={payload.get('role')} sub={payload.get('sub')} exp={payload.get('exp')}"
        )

        if payload.get("role") != "interview":
            logger.warning(
                "Interview auth failed (any status): role mismatch "
                f"role={payload.get('role')} sub={payload.get('sub')}"
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: interview JWT required",
                headers={"WWW-Authenticate": "Bearer"},
            )

        sub = payload.get("sub")
        if sub is None:
            logger.warning(
                "Interview auth failed (any status): missing sub "
                f"role={payload.get('role')}"
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: interview JWT missing sub",
                headers={"WWW-Authenticate": "Bearer"},
            )

        interview_id = int(sub)
        interview = db.query(Interview).filter(Interview.id == interview_id).first()
        if not interview:
            logger.warning(
                "Interview auth failed (any status): interview not found "
                f"interview_id={interview_id}"
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Interview session not found.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Single Session Enforcement: Validate that JTI matches the active one
        if jti and interview.active_session_jti != jti:
            logger.warning(f"Interview auth failed (any status): JTI mismatch for interview {interview.id}. Token JTI={jti}, active_session_jti={interview.active_session_jti}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="This session has been invalidated because the interview was started or resumed on another device.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Check allowed interview duration limit
        if interview.status == "in_progress" and interview.started_at:
            from app.core.timezone import to_naive_ist
            started_at_naive = to_naive_ist(interview.started_at)
            elapsed = get_ist_now() - started_at_naive
            duration_limit = timedelta(minutes=interview.duration_minutes or 60)
            if elapsed > duration_limit:
                logger.warning(f"Interview auth failed (any status): Session {interview.id} has exceeded its duration limit. Marking as expired.")
                try:
                    interview.status = "expired"
                    interview.active_session_jti = None
                    db.commit()
                except Exception as e:
                    db.rollback()
                
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Your interview session has expired. Allowed duration exceeded.",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            
        # Check for hard expiration timestamp even for "any status" (read-only)
        if interview.expires_at:
            exp_at = interview.expires_at
            if exp_at < get_ist_now() and interview.status not in ["completed", "terminated", "cancelled", "expired"]:
                # If completed/terminated/cancelled/expired, we allow viewing the report/thank you/violation page
                logger.warning(f"Interview auth failed (any status): Session {interview_id} expired at {exp_at}. Marking as expired.")
                try:
                    interview.status = "expired"
                    db.commit()
                except Exception as e:
                    db.rollback()
                
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Your interview link has expired.",
                    headers={"WWW-Authenticate": "Bearer"},
                )

        if hasattr(request, "state"):
            request.state.user_id = f"interview_{interview.id}"
        return interview
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: invalid interview ID in token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        logger.error(f"Internal auth error in get_current_interview_any_status: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal auth error",
        )