from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session, joinedload
import logging
import time
from collections import deque
from typing import Optional

from app.infrastructure.database import get_db
from app.domain.models import InterviewIssue, Interview, Application
from app.core.auth import verify_password, pwd_context
from app.core.observability import get_request_id, log_json, safe_hash
from app.core.idempotency import is_duplicate_request
from app.core.config import get_settings
from app.domain.schemas import SupportTicketCreate

logger = logging.getLogger(__name__)
settings = get_settings()

# Constant-time dummy hash for timing side-channel mitigation
DUMMY_HASH = pwd_context.hash("__dummy__")

router = APIRouter(prefix="/api/support", tags=["Support"])
from app.core.rate_limiter import limiter

_SUPPORT_SUBMISSION_WINDOW_SECONDS = 5 * 60
_SUPPORT_SUBMISSION_THRESHOLD = 3
_SUPPORT_SUBMISSION_BUCKETS: dict[str, deque[float]] = {}


def _check_support_rate_limit(key: str) -> Optional[int]:
    """Returns retry-after seconds if limited, else None."""
    redis_client = None
    if settings.redis_url:
        try:
            from app.core.redis_store import get_redis_client
            redis_client = get_redis_client()
        except Exception:
            pass
    
    if redis_client:
        try:
            redis_key = f"rate_limit:support:{key}"
            current_count = redis_client.get(redis_key)
            if current_count is None:
                redis_client.setex(redis_key, _SUPPORT_SUBMISSION_WINDOW_SECONDS, 1)
                return None
            count = int(current_count)
            if count >= _SUPPORT_SUBMISSION_THRESHOLD:
                ttl = redis_client.ttl(redis_key)
                return max(1, ttl)
            redis_client.incr(redis_key)
            return None
        except Exception:
            pass
    
    now = time.time()
    dq = _SUPPORT_SUBMISSION_BUCKETS.setdefault(key, deque())
    while dq and dq[0] < now - _SUPPORT_SUBMISSION_WINDOW_SECONDS:
        dq.popleft()
    dq.append(now)
    if len(dq) > _SUPPORT_SUBMISSION_THRESHOLD:
        retry_after = int(max(1, (_SUPPORT_SUBMISSION_WINDOW_SECONDS - (now - dq[0]))))
        return retry_after
    return None


@router.post("/ticket")
@limiter.limit("60/minute")
def create_support_ticket(payload: SupportTicketCreate, request: Request, db: Session = Depends(get_db)):
    """
    Candidate support portal ticket endpoint (non-breaking add).

    Expected body (per frontend spec):
    {
      email,
      access_key,
      grievance_type,
      description
    }
    """
    email = payload.email.lower().strip()
    access_key = payload.access_key.strip()
    grievance_type = payload.grievance_type.strip()
    description = payload.description.strip()

    if len(description) < 10:
        raise HTTPException(status_code=400, detail="Please provide a short description (minimum 10 characters).")
    if len(description) > 5000:
        raise HTTPException(status_code=400, detail="Description is too long.")
    if "[system context]" in description.lower():
        raise HTTPException(status_code=400, detail="Invalid characters or system tags in description.")

    request_id_header = request.headers.get("X-Request-ID")
    if settings.enable_request_id_idempotency and is_duplicate_request(
        request_id=request_id_header,
        scope="support.ticket",
        key=f"{email}:{grievance_type.lower()}",
        ttl_seconds=60,
    ):
        raise HTTPException(status_code=409, detail="Duplicate support ticket submission detected. Please wait before retrying.")

    # Lightweight anti-abuse throttling by email+IP without changing persistence schema.
    ip = request.client.host if request and request.client else "unknown"
    throttle_key = f"{email}|{ip}"
    retry_after = _check_support_rate_limit(throttle_key)
    if retry_after is not None:
        log_json(
            logger,
            "support_ticket_rate_limited",
            request_id=get_request_id(request),
            endpoint="/api/support/ticket",
            status=429,
            level="warning",
            extra={"email_hash": safe_hash(email), "ip": ip, "retry_after_s": retry_after},
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many support requests in a short period. Please try again shortly.",
        )

    interview = None
    application = None

    # Try finding by offer_token first (standard onboarding flow)
    # Candidates in the onboarding stage use their plain offer_token as their access key.
    # Checking this first avoids executing slow bcrypt checks for historical interviews.
    from app.domain.models import Offer
    application = db.query(Application).join(Offer).filter(
        Application.candidate_email == email,
        Offer.offer_token == access_key  # Candidates use their offer token as key
    ).first()

    # Fallback: if access_key is "onboarding_error", only allow onboarding-scoped
    # grievances from /offer/respond for candidates who actually have an offer-stage application.
    # This prevents arbitrary users from filing general tickets using only a candidate's email.
    if (
        not application
        and access_key == "onboarding_error"
        and grievance_type in {"Onboarding Issue", "Onboarding Issue (Link Error)"}
    ):
        application = (
            db.query(Application)
            .join(Offer)
            .options(joinedload(Application.job))
            .filter(
                Application.candidate_email == email,
                (Offer.offer_sent.is_(True))
                | (Application.status.in_(["offer_sent", "offer_accepted", "offer_rejected", "onboarded", "hired"])),
            )
            .order_by(Application.id.desc())
            .first()
        )


    # Find all interviews for this email to verify if the access key belongs to one
    interviews = (
        db.query(Interview)
        .join(Application)
        .filter(Application.candidate_email == email)
        .options(
            joinedload(Interview.application).joinedload(Application.job),
            joinedload(Interview.report),
        )
        .order_by(Interview.created_at.desc())
        .all()
    )
    
    # Cap the slow bcrypt verification loop to at most top 5 most recent interviews to prevent high latency.
    # To mitigate timing side channels, we always perform exactly 5 password verification attempts using DUMMY_HASH.
    match_found = False
    num_checks = 0
    
    # If we already found the application (via offer_token), we still run the bcrypt checks on dummy to remain constant-time.
    for inv in interviews[:5]:
        try:
            num_checks += 1
            # If application is already found or we matched, verify using the dummy hash to prevent timing difference
            hash_to_verify = inv.access_key_hash if (not application and not match_found) else DUMMY_HASH
            if hash_to_verify and verify_password(access_key, hash_to_verify):
                if not application and not match_found:
                    interview = inv
                    application = inv.application
                    match_found = True
        except Exception:
            continue
            
    # Pad the remaining checks up to 5
    for _ in range(num_checks, 5):
        try:
            verify_password(access_key, DUMMY_HASH)
        except Exception:
            pass
        
    if not application and not interview:
        log_json(
            logger,
            "support_ticket_rejected",
            request_id=get_request_id(request),
            endpoint="/api/support/ticket",
            status=401,
            level="warning",
            extra={"reason": "invalid_credentials", "email_hash": safe_hash(email)},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials. Use the access key from your email.",
        )

    # Prevent duplicate active tickets.
    if interview:
        existing_pending = (
            db.query(InterviewIssue)
            .filter(
                InterviewIssue.interview_id == interview.id,
                InterviewIssue.status == "pending",
            )
            .order_by(InterviewIssue.created_at.desc())
            .first()
        )
        if existing_pending:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An active support request for this interview is already under review.",
            )
    else:
        existing_pending = (
            db.query(InterviewIssue)
            .filter(
                InterviewIssue.application_id == application.id,
                InterviewIssue.status == "pending",
            )
            .order_by(InterviewIssue.created_at.desc())
            .first()
        )
        if existing_pending:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An active support request for this application is already under review.",
            )

    # Attach metadata (clean, structured, separable from candidate message)
    if interview:
        application = getattr(interview, "application", None)

    candidate_name = getattr(application, "candidate_name", None) if application else None
    job_role = getattr(getattr(application, "job", None), "title", None) if application else None

    # Map grievance types into existing issue_type values used by HR dashboard.
    # Keep exact values stable for existing UI filters.
    issue_type_map = {
        "Technical Glitch": "technical",
        "Unexpected Termination": "interruption",
        "Misconduct Appeal": "misconduct",
        "Other": "other",
        # Also accept ids from existing /support page radios
        "technical": "technical",
        "interruption": "interruption",
        "misconduct": "misconduct",
        "misconduct_appeal": "misconduct",
        "other": "other",
    }
    issue_type = issue_type_map.get(grievance_type, grievance_type.lower() or "other")

    termination_reason = getattr(getattr(interview, "report", None), "termination_reason", None) if interview else None

    # Keep candidate input separate from system context.
    # Avoid dumping all internals while preserving consistent metadata.
    structured_context = [
        "[System Context]",
        f"interview_id={interview.id if interview else 'N/A'}",
        f"candidate_name={candidate_name or ''}",
        f"job_role={job_role or ''}",
        f"interview_status={interview.status if interview else 'N/A'}",
        f"termination_reason={termination_reason or ''}",
    ]
    composed_description = f"{description.strip()}\n\n" + "\n".join(structured_context)

    interview_id = interview.id if interview else None
    app_id = application.id if application else None

    ticket = InterviewIssue(
        interview_id=interview_id,
        application_id=app_id,
        candidate_name=candidate_name,
        candidate_email=email,
        issue_type=issue_type,
        description=composed_description,
        status="pending",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    log_json(
        logger,
        "support_ticket_created",
        request_id=get_request_id(request),
        endpoint="/api/support/ticket",
        status=200,
        level="info",
        extra={
            "ticket_id": ticket.id,
            "interview_id": interview.id if interview else None,
            "issue_type": issue_type,
            "email_hash": safe_hash(email),
        },
    )

    # Return existing ticket response shape (compatible with HR tickets list expectations)
    return {
        "id": ticket.id,
        "interview_id": ticket.interview_id,
        "candidate_name": ticket.candidate_name,
        "candidate_email": ticket.candidate_email,
        "issue_type": ticket.issue_type,
        "description": ticket.description,
        "status": ticket.status,
        "hr_response": ticket.hr_response,
        "is_reissue_granted": ticket.is_reissue_granted,
        "created_at": ticket.created_at,
        "resolved_at": ticket.resolved_at,
        "application_id": getattr(application, "id", None) if application else None,
        "test_id": getattr(interview, "test_id", None),
        "job_id": getattr(application, "job_id", None) if application else None,
        "job_identifier": getattr(getattr(application, "job", None), "job_id", None) if application else None,
    }

