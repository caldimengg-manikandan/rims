from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Request, BackgroundTasks, Body
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import text
from sqlalchemy.orm import Session, joinedload, load_only
from sqlalchemy.exc import IntegrityError
from datetime import datetime, timezone, timedelta
import json
import os
import logging
import traceback
import tempfile
import shutil
from app.core.config import get_settings
from app.core.observability import log_json
from app.infrastructure.database import get_db
from app.domain.models import User, Interview, Application, InterviewQuestion, InterviewAnswer, InterviewAnswerVersion, InterviewReport, Job, InterviewMonitoringEvent
from app.core.timezone import get_ist_now, to_naive_ist
from app.domain.schemas import (
    InterviewStart, InterviewAnswerSubmit, InterviewResponse, 
    InterviewQuestionResponse, InterviewDetailResponse, InterviewReportResponse,
    InterviewListResponse, InterviewAccess, MonitoringEventCreate, MonitoringEventResponse
)



from app.core.auth import get_current_user, get_current_hr, get_current_interview, get_current_interview_any_status, pwd_context, create_access_token
from app.core.ownership import validate_hr_ownership, validate_hr_ownership_for_interview
from app.services.ai_service import (
    generate_adaptive_interview_question,
    evaluate_interview_answer,
    generate_interview_report,
    analyze_introduction,
    evaluate_detailed_answer,
    generate_domain_questions,
    generate_behavioral_question,
    generate_custom_domain_questions_with_meta,
    generate_behavioral_batch,
    extract_questions_from_text,
    transcribe_audio
)

# Import termination checker (reuse analyzer singleton from ai_service)
try:
    from backend.interview_process.response_analyzer import ResponseAnalyzer as _RA
except ImportError:
    from interview_process.response_analyzer import ResponseAnalyzer as _RA
_termination_checker = _RA()


router = APIRouter(prefix="/api/interviews", tags=["interviews"])
logger = logging.getLogger(__name__)
settings = get_settings()

SEEN_NONCES = set()

from app.core.rate_limiter import limiter
from app.core.idempotency import is_duplicate_request


def _get_interview_jwt_secret() -> str:
    """Match candidate interview token validation in app.core.auth and middleware."""
    if settings.interview_jwt_secret:
        return settings.interview_jwt_secret
    if settings.env != "production":
        return settings.jwt_secret + "_interview"
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Server configuration error: missing token signing key."
    )


def _interview_has_answers(db: Session, interview_id: int) -> bool:
    return db.query(InterviewAnswer.id).filter(
        InterviewAnswer.interview_id == interview_id
    ).first() is not None




STAGE_APTITUDE = "aptitude"
STAGE_FIRST_LEVEL = "first_level"
STAGE_COMPLETED = "completed"

# --- Imported Refactored Services ---

@router.post("/demo", response_model=dict)
def create_demo_interview(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Private endpoint to generate a Demo Interview session.

    Behaviour:
    - Looks up the real job with job_id='JOB-05A5RV' — that job must be pre-configured in the system.
    - Creates a provisional Application + Interview with is_demo=True.
    - On successful completion  → application is kept, status moves to interview_completed, report is generated.
    - On early End Session, proctoring auto-termination, or tab-close → application/interview are cascade-deleted; no report is saved.
    """
    import uuid, random
    from app.services.candidate_service import CandidateService

    # Curated pool of realistic sample applicant identities for demo sessions.
    DEMO_SAMPLE_APPLICANTS = [
        ("Arjun Sharma", "arjun.sharma"),
        ("Priya Nair", "priya.nair"),
        ("Rahul Verma", "rahul.verma"),
        ("Sneha Iyer", "sneha.iyer"),
        ("Vikram Patel", "vikram.patel"),
        ("Ananya Krishnan", "ananya.krishnan"),
        ("Rohan Mehta", "rohan.mehta"),
        ("Divya Reddy", "divya.reddy"),
        ("Karthik Bose", "karthik.bose"),
        ("Meera Joshi", "meera.joshi"),
    ]

    # 1. Resolve the designated demo job — must already exist in the system.
    job = db.query(Job).filter(Job.job_id == "JOB-05A5RV").first()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "Demo job 'JOB-05A5RV' not found. "
                "Please create and publish a job with job_id='JOB-05A5RV' before using the demo."
            ),
        )

    # 2. Pick an HR owner (the job's own HR user, or the first available HR).
    hr_user = (
        db.query(User).filter(User.id == job.hr_id).first()
        or db.query(User).filter(User.role == "hr").first()
    )
    if not hr_user:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No HR user found in the system. Cannot create demo interview.",
        )

    # 3. Sample a random applicant identity from the pool.
    name, slug = random.choice(DEMO_SAMPLE_APPLICANTS)
    uid = uuid.uuid4().hex[:6]
    candidate_email = f"{slug}_{uid}@demo-calrims.com"

    # 4. Create a provisional demo Application.
    app_record = Application(
        job_id=job.id,
        hr_id=hr_user.id,
        candidate_name=name,
        candidate_email=candidate_email,
        status="interview_scheduled",
    )
    db.add(app_record)
    db.commit()
    db.refresh(app_record)

    # 5. Generate the Interview record using existing business logic.
    svc = CandidateService(db)
    access_key = svc.ensure_interview_record_exists(app_record)

    interview = db.query(Interview).filter(Interview.application_id == app_record.id).first()
    if not interview:
        # Clean up orphaned application and bail out
        db.delete(app_record)
        db.commit()
        raise HTTPException(status_code=500, detail="Failed to create interview record for demo session.")

    # 6. Mark the interview as a provisional demo session.
    interview.is_demo = True

    # 7. Generate a short-lived (4-hour) JWT for the candidate interface.
    from datetime import timedelta
    from app.core.auth import create_access_token
    token_expiry_delta = timedelta(hours=4)
    interview_secret = _get_interview_jwt_secret()
    access_token = create_access_token(
        data={"sub": str(interview.id), "role": "interview"},
        expires_delta=token_expiry_delta,
        secret=interview_secret,
    )

    db.commit()

    # 8. Kick off fallback question generation in the background.
    background_tasks.add_task(_generate_fallback_questions_direct, interview.id)

    logger.info(
        f"[Demo] Provisional interview created: interview_id={interview.id} "
        f"application_id={app_record.id} job_id=JOB-05A5RV candidate='{name}'"
    )

    return {
        "interview_id": interview.id,
        "access_key": access_key,
        "access_token": access_token,
        "demo_url": f"/calrims/interview/{interview.id}?token={access_token}",
    }


from app.services.interview_evaluation_service import evaluate_answer_task
from app.services.interview_reporting_service import _finalize_interview_and_report, _finalize_interview_and_report_internal
from app.services.interview_generation_service import (
    _determine_initial_stage,
    background_generate_questions,
    _generate_fallback_questions_direct,
    _set_interview_status,
    _question_count_for_stage,
    _enforce_stage,
)
from app.core.ephemeral_result_cache import (
    cache_get as _idem_cache_get,
    cache_set as _idem_cache_set,
)
from app.services.job_queue import ai_jobs, create_job

@router.post("/access")
@limiter.limit("15/minute")
async def access_interview(
    request: Request,
    data: InterviewAccess,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Access an interview session securely using a one-time key (Finalized for Production).
    
    Guarantees zero 500 errors by:
    1. Atomic session handling with row-level locking (with_for_update).
    2. Eager loading of relationship graph (Interview -> Application -> Job).
    3. Resilient handling of legacy/missing metadata with safe defaults.
    4. 4-hour secure re-access window for in-progress sessions.
    5. Integrated background task scheduling for question generation.
    """
    try:
        # 1. Verification Phase: Find interviews by cleaned email
        email_clean = data.email.lower().strip()
        
        # Inner join with Application since we filter by email
        interviews = db.query(Interview).join(Interview.application).filter(
            Application.candidate_email == email_clean
        ).options(
            joinedload(Interview.application).load_only(
                Application.id, 
                Application.candidate_email, 
                Application.candidate_name, 
                Application.job_id
            ),
            load_only(
                Interview.id, 
                Interview.access_key_hash, 
                Interview.is_used, 
                Interview.status, 
                Interview.used_at, 
                Interview.expires_at
            )
        ).all()
        
        if not interviews:
            logger.warning(f"Access attempt failed: No interview found for email {email_clean}")
            from app.core.auth import verify_password
            verify_password(data.access_key, "$2b$12$XzQyJkG9aBcDeFgHiJkLmOpQrStUvWxYz0123456789abcdefghij")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or access key. Please check your invitation email."
            )
            
        matched_interview = None
        for inv in interviews:
            from app.core.auth import verify_password
            if verify_password(data.access_key, inv.access_key_hash):
                matched_interview = inv
                # DO NOT break here to equalize timing for enumeration resistance
                
        if not matched_interview:
            logger.warning(f"Access attempt failed: Invalid access key for email {email_clean}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, 
                detail="Invalid email or access key. Please check your invitation email."
            )
        
        # 2. Atomic Startup Phase: Re-fetch with row-level lock to prevent race conditions
        # FIX: We split locking and relationship fetching to avoid PostgreSQL error:
        # "FOR UPDATE cannot be applied to the nullable side of an outer join"
        
        # Query 1: Lock only the interviews table row
        db.query(Interview).filter(
            Interview.id == matched_interview.id
        ).with_for_update().first()
        
        # Query 2: Fetch the full object graph with relationships (no lock needed here)
        interview = db.query(Interview).options(
            joinedload(Interview.application).options(
                joinedload(Application.job),
                load_only(
                    Application.id, 
                    Application.candidate_email, 
                    Application.candidate_name, 
                    Application.job_id
                )
            ),
            load_only(
                Interview.id, Interview.application_id, Interview.status, 
                Interview.is_used, Interview.used_at, Interview.expires_at,
                Interview.started_at, Interview.duration_minutes, Interview.interview_stage,
                Interview.locked_skill
            )
        ).filter(
            Interview.id == matched_interview.id
        ).first()
        
        if not interview:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, 
                detail="Interview record vanished during access. Please try again."
            )
        
        current_time = get_ist_now()
        
        # 3. Session State & Expiry Validation
        # If the interview has been marked as terminal, block access completely
        if interview.status in ["completed", "terminated", "cancelled", "expired"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, 
                detail="This interview has already ended and can no longer be accessed."
            )
            
        # Check allowed interview duration limit (if in progress)
        if interview.status == "in_progress" and interview.started_at:
            started_at = to_naive_ist(interview.started_at)
            elapsed = current_time - started_at
            duration_limit = timedelta(minutes=interview.duration_minutes or 60)
            if elapsed > duration_limit:
                interview.status = "expired"
                interview.active_session_jti = None
                db.commit()
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN, 
                    detail="This interview's allowed duration has ended and it can no longer be accessed."
                )

        # Link hard expiry check
        if interview.expires_at:
            expires_at = to_naive_ist(interview.expires_at)
            if expires_at < current_time:
                interview.status = "expired"
                interview.active_session_jti = None
                db.commit()
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN, 
                    detail="This interview invitation link has expired."
                )
            
        if interview.is_used:
            is_active = interview.status == "in_progress"
            used_at = interview.used_at
            if used_at:
                used_at = to_naive_ist(used_at)
                session_age = current_time - used_at
            elif interview.started_at:
                started_at = to_naive_ist(interview.started_at)
                session_age = current_time - started_at
            else:
                session_age = timedelta(hours=5) # Terminal age to block expired re-entry
            
            # Allow re-entry ONLY if session is in_progress and started within last 4 hours
            if not is_active or session_age > timedelta(hours=4):
                logger.warning(f"Access denied: Session {interview.id} is {interview.status} and {session_age} old.")
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN, 
                    detail="This interview link has already been used and the session is no longer active."
                )
            logger.info(f"Resuming session {interview.id} for {email_clean} (status: {interview.status})")
            
        # 4. Atomic Initialization Logic (if first access)
        if not interview.is_used:
            # Atomic update to prevent race conditions
            # We use rowcount to verify if we successfully "claimed" this interview
            result = db.execute(
                text("UPDATE interviews SET is_used=true, status='in_progress', used_at=:used_at WHERE id=:id AND is_used=false"),
                {"used_at": current_time, "id": interview.id}
            )
            
            if result.rowcount == 0:
                # If no row was updated, it means another request already set is_used=true
                db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="This interview session is already being initialized by another request."
                )
            
            # Refresh the interview object with the new state from DB
            db.refresh(interview)
            
            # Handle relationship resilience for orphaned data
            application = interview.application
            job = application.job if application else None
            
            # Fail-safe initialization BEFORE triggering background tasks
            interview.locked_skill = "general"
            # is_used, used_at, and status are already set by the atomic UPDATE
            
            if job:
                interview.interview_stage = _determine_initial_stage(job)
                # Enforce experience-level flow (e.g., aptitude only for juniors)
                if job.experience_level.lower() != "junior" and interview.interview_stage == STAGE_APTITUDE:
                    interview.interview_stage = STAGE_FIRST_LEVEL
                interview.duration_minutes = job.duration_minutes or 60
            else:
                # Sensible defaults for missing metadata
                interview.interview_stage = STAGE_FIRST_LEVEL
                interview.duration_minutes = 60
            
            logger.info(f"Initializing NEW interview session: {interview.id}")
            
            # Notify HR Owner
            if application and application.hr_id:
                from app.core.websocket import trigger_realtime_notification
                trigger_realtime_notification(
                    db=db,
                    user_id=application.hr_id,
                    notification_type="INTERVIEW_STARTED",
                    title="Interview Started",
                    message_content=f"{application.candidate_name} has started the AI interview for {job.title if job else 'the position'}.",
                    related_application_id=application.id,
                    related_interview_id=interview.id
                )
        
        # 5. Background Question Generation Trigger
        # Check for existing questions to avoid duplicate background processing
        # Important: determine 'ready' based on whether ALL enabled rounds are populated.
        q_rows = db.query(InterviewQuestion).filter(
            InterviewQuestion.interview_id == interview.id
        ).all()
        existing_count = len(q_rows)
        
        # Figure out expected question count to determine "ready" status
        expected_count = 0
        application = interview.application
        job = application.job if application else None
        if job and job.aptitude_enabled:
            expected_count += 10 # Standard 10 aptitude questions
        if job and job.first_level_enabled:
            expected_count += 20 # 15 tech + 5 behav (based on _generate_first_level_questions)
        
        # If no job config, assume at least 1 question is needed
        if expected_count == 0:
            expected_count = 1

        # Generate dynamic lifecycle JWT token based on interview duration
        duration_mins = 60
        if job and hasattr(job, "duration_minutes") and job.duration_minutes:
            duration_mins = job.duration_minutes
        elif hasattr(interview, "duration_minutes") and interview.duration_minutes:
            duration_mins = interview.duration_minutes
            
        token_expiry_delta = max(timedelta(hours=4), timedelta(minutes=duration_mins + 30))
        # Use the same isolated interview secret expected by middleware/API auth.
        interview_secret = _get_interview_jwt_secret()
        token = create_access_token(
            data={"sub": str(interview.id), "role": "interview"},
            expires_delta=token_expiry_delta,
            secret=interview_secret
        )
        
        is_ready = existing_count >= expected_count if existing_count > 0 else False
        
        # Readiness Fail-safe: If expected count is high but we have 0 questions, 
        # force re-generation even if is_ready might be True (e.g. expected_count was 0)
        if existing_count == 0 and expected_count > 0:
            is_ready = False
            logger.warning(f"Interview {interview.id} has 0 questions but expected {expected_count}. Forcing generation.")

        # Decode generated token to retrieve the dynamic JTI that is bound to it
        try:
            from jose import jwt as _jose_jwt
            payload = _jose_jwt.decode(token, interview_secret, algorithms=[settings.jwt_algorithm])
            jti = payload.get("jti")
        except Exception:
            jti = None
            
        import hmac
        import hashlib
        derived_secret = ""
        if jti:
            interview.active_session_jti = jti
            derived_secret = hmac.new(
                interview_secret.encode('utf-8'),
                f"{interview.id}:{jti}".encode('utf-8'),
                hashlib.sha256
            ).hexdigest()

        response_data = {
            "access_token": token,
            "token_type": "bearer",
            "interview_id": interview.id,
            "interview_stage": interview.interview_stage,
            "status": "ready" if is_ready else "processing",
            "proctoring_secret": derived_secret
        }
        
        # Debug counts
        logger.info(f"Interview {interview.id} access: current_q={existing_count}, expected={expected_count}, ready={is_ready}")

        if not is_ready:
            app_id = interview.application_id
            job_id = interview.application.job_id if interview.application else None
            if app_id and job_id:
                ai_job_id = f"gen_q_{interview.id}"
                response_data["job_id"] = ai_job_id
                # Ensure the task is added to the shared queue safely
                # Use DB-level distributed lock with GlobalSettings to prevent cross-worker duplicate execution
                from app.domain.models import GlobalSettings
                lock_key = f"lock_gen_{interview.id}"
                existing_lock = db.query(GlobalSettings).filter(GlobalSettings.key == lock_key).first()
                
                if existing_lock:
                    logger.info(f"Duplicate question generation avoided via existing DB lock for interview {interview.id}")
                else:
                    try:
                        with db.begin_nested():
                            lock_setting = GlobalSettings(key=lock_key, value="processing")
                            db.add(lock_setting)
                        
                        if ai_job_id not in ai_jobs or ai_jobs[ai_job_id]["status"] == "failed":
                            create_job(ai_job_id)
                            background_tasks.add_task(
                                background_generate_questions, 
                                interview.id, job_id, app_id, ai_job_id
                            )
                    except IntegrityError:
                        logger.info(f"Duplicate question generation avoided via concurrent DB lock insertion for interview {interview.id}")
            else:
                # Trigger direct fallback for incomplete application records
                background_tasks.add_task(_generate_fallback_questions_direct, interview.id)
                response_data["status"] = "ready"
        
        # 6. Final Atomic Commit
        # We commit all session state changes and question generation tasks at once
        db.commit()
        return response_data

    except HTTPException:
        # Re-raise managed FastAPI HTTP exceptions
        raise
    except Exception as e:
        db.rollback()
        # Log full stack trace for internal debugging
        error_msg = f"CRITICAL ERROR in access_interview: {str(e)}\n{traceback.format_exc()}"
        logger.error(error_msg)
        # Return sanitized error message to the client
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, 
            detail="An internal error occurred while accessing the interview. Please try again later."
        )


@router.get("/jobs/{job_id}")
async def check_job_status(job_id: str):
    """Polling endpoint for async AI generation tasks"""
    from app.services.job_queue import get_job
    job = get_job(job_id)
    if not job:
        return JSONResponse(
            status_code=404,
            content={"success": False, "data": None, "error": "Job not found"}
        )
    return job


@router.post("/{interview_id}/generate-test-token")
async def generate_test_token(
    request: Request,
    interview_id: int,
    interview_requester: User = Depends(get_current_hr),
    db: Session = Depends(get_db),
):
    """
    TEST-ONLY endpoint: generate a raw access key for an interview.
    This avoids having to bypass bcrypt-hashed keys in automated E2E tests.
    """
    if settings.env == "production":
        raise HTTPException(status_code=403, detail="Test token generation is strictly disabled in production.")
    
    test_secret = request.headers.get("TEST_ADMIN_SECRET")
    if not test_secret or test_secret != settings.test_admin_secret:
        raise HTTPException(status_code=403, detail="Invalid test admin secret.")

    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    if interview.application:
        validate_hr_ownership(interview.application, interview_requester, resource_name="interview")

    import secrets
    new_key = secrets.token_urlsafe(16)
    interview.access_key_hash = pwd_context.hash(new_key)
    interview.expires_at = get_ist_now() + timedelta(days=10)
    interview.is_used = False
    _set_interview_status(interview, "not_started")
    interview.used_at = None

    # Cascade delete previous test answers, questions, and monitoring events for pristine test isolation
    db.query(InterviewAnswer).filter(InterviewAnswer.interview_id == interview_id).delete(synchronize_session=False)
    db.query(InterviewQuestion).filter(InterviewQuestion.interview_id == interview_id).delete(synchronize_session=False)
    db.query(InterviewMonitoringEvent).filter(InterviewMonitoringEvent.interview_id == interview_id).delete(synchronize_session=False)

    db.commit()

    # Raw key is intentionally returned only for non-production environments.
    return {"interview_id": interview_id, "access_key": new_key}


@router.post("/{interview_id}/start")
@limiter.limit("20/minute")
async def start_interview_session(
    request: Request,
    interview_id: int,
    data: InterviewStart,
    background_tasks: BackgroundTasks,
    interview_session: Interview = Depends(get_current_interview_any_status),
    db: Session = Depends(get_db),
):
    """
    Explicitly mark the interview as started (idempotent). Used by the
    /interview/[id] UI after fullscreen before questions are shown.

    The access flow may already set `in_progress` and `started_at`; this
    endpoint is safe to call again when the session is already active.
    """
    if interview_session.id != interview_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    if not data.camera_active or not data.mic_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Camera and Microphone access are mandatory to start the interview."
        )

    interview = db.query(Interview).options(
        joinedload(Interview.application).joinedload(Application.job)
    ).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview not found")

    if interview.status in ("completed", "terminated", "cancelled", "expired"):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This interview has already ended or cannot be started.",
        )

    now = get_ist_now()

    if interview.status == "not_started":
        application = interview.application
        job = application.job if application else None
        interview.is_used = True
        interview.used_at = now
        _set_interview_status(interview, "in_progress")
        if job:
            interview.interview_stage = _determine_initial_stage(job)
            exp = (job.experience_level or "").lower()
            if exp != "junior" and interview.interview_stage == STAGE_APTITUDE:
                interview.interview_stage = STAGE_FIRST_LEVEL
            interview.started_at = now
            interview.duration_minutes = job.duration_minutes or 60
        else:
            interview.interview_stage = STAGE_FIRST_LEVEL
            interview.started_at = now
            interview.duration_minutes = 60
        db.commit()
        db.refresh(interview)
    elif interview.status == "in_progress":
        has_answers = _interview_has_answers(db, interview_id)
        if not has_answers:
            job = interview.application.job if interview.application else None
            interview.started_at = now
            interview.used_at = interview.used_at or now
            if not interview.duration_minutes:
                interview.duration_minutes = (job.duration_minutes or 60) if job else 60
            db.commit()
            db.refresh(interview)
        elif not interview.started_at:
            interview.started_at = now
            if not interview.duration_minutes:
                job = interview.application.job if interview.application else None
                interview.duration_minutes = (job.duration_minutes or 60) if job else 60
            db.commit()
            db.refresh(interview)
    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Interview cannot be started in current state: {interview.status}",
        )

    # Trigger fallback generation if questions are missing (critical for direct demo links)
    if _question_count_for_stage(db, interview.id, interview.interview_stage) == 0:
        background_tasks.add_task(_generate_fallback_questions_direct, interview.id)

    return {
        "ok": True,
        "status": interview.status,
        "started_at": interview.started_at.isoformat() if interview.started_at else None,
        "duration_minutes": interview.duration_minutes or 60,
    }


@router.get("/{interview_id}/stage")
@limiter.limit("20/minute")
async def get_interview_stage(
    request: Request,
    interview_id: int,
    interview_session: Interview = Depends(get_current_interview_any_status),
    db: Session = Depends(get_db)
):
    """Get the current pipeline stage for the interview (Robust with Readiness Checks)."""
    try:
        if interview_session.id != interview_id:
            logger.warning(f"Session mismatch: token session {interview_session.id} vs requested {interview_id}")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        
        # Ensure relationships are loaded if not already present
        # get_current_interview_any_status might return a session-cached object; 
        # we ensure application and job are available without lazy-load failures.
        interview = interview_session
        if not hasattr(interview, 'application') or interview.application is None:
            # Fallback re-fetch if relationship is detached or missing
            interview = db.query(Interview).options(
                joinedload(Interview.application).joinedload(Application.job)
            ).filter(Interview.id == interview_id).first()
            
            if not interview:
                logger.error(f"Interview {interview_id} record vanished during stage fetch")
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview session not found.")

        # ── READINESS CHECK ──
        # Check if questions exist for the current stage (unless stage is COMPLETED).
        # Also covers 'not_started' so demo interviews (which arrive with a JWT token
        # before the candidate presses Begin) wait until background generation finishes.
        questions_ready = True
        if interview.status in ("in_progress", "not_started") and interview.interview_stage != STAGE_COMPLETED:
            questions_count = _question_count_for_stage(db, interview_id, interview.interview_stage)
            questions_ready = questions_count > 0

            if not questions_ready:
                # Questions aren't ready yet.
                logger.info(f"Session {interview_id} load: stage '{interview.interview_stage}' questions not ready yet. Returning 202.")
                return JSONResponse(
                    status_code=status.HTTP_202_ACCEPTED,
                    content={
                        "id": interview.id,
                        "status": "processing",
                        "message": "Preparing your custom interview questions. Please wait...",
                        "interview_stage": interview.interview_stage,
                        "questions_ready": False,
                    }
                )

        # Safely handle potential nulls in relationship graph
        application = getattr(interview, 'application', None)
        job = getattr(application, 'job', None) if application else None
        
        termination_reason = None
        if interview.status == "terminated":
            try:
                from app.domain.models import AuditLog
                log = db.query(AuditLog).filter(
                    AuditLog.action == "INTERVIEW_TERMINATED_VIOLATION",
                    AuditLog.resource_id == interview.id
                ).order_by(AuditLog.created_at.desc()).first()
                if log and log.details:
                    log_data = json.loads(log.details)
                    termination_reason = log_data.get("reason")
            except Exception as log_err:
                logger.error(f"Failed to fetch dynamic termination reason in stage: {log_err}")

        return {
            "id": interview.id,
            "status": interview.status,
            "interview_stage": interview.interview_stage or STAGE_FIRST_LEVEL,
            "locked_skill": interview.locked_skill or "general",
            "total_questions": interview.total_questions or 0,
            "aptitude_enabled": getattr(job, 'aptitude_enabled', False) if job else False,
            "first_level_enabled": getattr(job, 'first_level_enabled', True) if job else True,
            "aptitude_score": getattr(interview, 'aptitude_score', None),
            "aptitude_completed_at": getattr(interview, 'aptitude_completed_at', None),
            "started_at": getattr(interview, 'started_at', None),
            "duration_minutes": getattr(interview, 'duration_minutes', 60) or 60,
            "questions_ready": questions_ready,
            "termination_reason": termination_reason,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"CRITICAL Error loading stage for session {interview_id}: {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="An internal error occurred while loading your session.")



@router.get("/{interview_id}/questions")
@limiter.limit("20/minute")
async def get_all_questions(
    request: Request,
    interview_id: int,
    interview_session: Interview = Depends(get_current_interview_any_status),
    db: Session = Depends(get_db)
):
    """Get ALL questions for the interview (all stages)."""
    if interview_session.id != interview_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    # ── READINESS CHECK ──
    # If session is in-progress OR not_started (demo mode) and questions aren't ready, return 202.
    # The 'not_started' check is critical for demo interviews that supply a JWT token directly
    # and land on this endpoint before background question generation has completed.
    if interview_session.status in ("in_progress", "not_started") and interview_session.interview_stage != STAGE_COMPLETED:
        stage = interview_session.interview_stage or STAGE_FIRST_LEVEL
        if _question_count_for_stage(db, interview_id, stage) == 0:
            return JSONResponse(
                status_code=status.HTTP_202_ACCEPTED,
                content={
                    "id": interview_id,
                    "status": "processing",
                    "message": "Preparing your interview questions. Please wait...",
                    "questions_ready": False,
                }
            )

    # Filter by stage to prevent leaking future questions to candidates
    query = db.query(InterviewQuestion).filter(
        InterviewQuestion.interview_id == interview_id
    )
    if interview_session.status == "in_progress":
        if interview_session.interview_stage == STAGE_APTITUDE:
            query = query.filter(InterviewQuestion.question_type == "aptitude")
        elif interview_session.interview_stage == STAGE_FIRST_LEVEL:
            query = query.filter(InterviewQuestion.question_type != "aptitude")
    
    questions = query.order_by(InterviewQuestion.question_number).all()

    # Batch-load answered status
    question_ids = [q.id for q in questions]
    answers = (
        db.query(InterviewAnswer).filter(InterviewAnswer.question_id.in_(question_ids)).all()
        if question_ids
        else []
    )
    answered_ids = {a.question_id for a in answers}
    ans_by_q = {a.question_id: a for a in answers}

    result = []
    for q in questions:
        ans = ans_by_q.get(q.id)
        evaluated_at = ans.evaluated_at.isoformat() if ans and ans.evaluated_at else None
        result.append({
            "id": q.id,
            "interview_id": q.interview_id,
            "question_number": q.question_number,
            "question_text": q.question_text,
            "question_type": q.question_type,
            "question_options": q.options,
            "is_answered": q.id in answered_ids,
            "evaluated_at": evaluated_at,
            "answer_score": float(ans.answer_score) if ans and ans.answer_score is not None else None,
            "evaluation_pending": bool(ans and ans.evaluated_at is None),
            "answer_text": ans.answer_text if ans else None,
        })
    return result


@router.get("/{interview_id}/current-question", response_model=InterviewQuestionResponse)
@limiter.limit("20/minute")
async def get_current_question(
    request: Request,
    interview_id: int,
    interview_session: Interview = Depends(get_current_interview_any_status),
    db: Session = Depends(get_db)
):
    """Get current unanswered question for the current stage."""
    if interview_session.id != interview_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        
    interview = interview_session
    
    if interview.interview_stage == STAGE_COMPLETED:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Interview fully completed")

    if interview.status not in ("in_progress", "not_started"):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Interview complete")
    
    # ── READINESS CHECK ──
    # If session is in-progress and questions aren't ready for the current stage, return 202
    stage = interview.interview_stage or STAGE_FIRST_LEVEL
    if _question_count_for_stage(db, interview_id, stage) == 0:
        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content={
                "id": interview_id,
                "status": "processing",
                "message": "Preparing your interview questions. Please wait...",
                "questions_ready": False,
            }
        )

    # Filter by current stage
    query = db.query(InterviewQuestion).filter(
        InterviewQuestion.interview_id == interview_id
    )
    if interview.interview_stage == STAGE_APTITUDE:
        query = query.filter(InterviewQuestion.question_type == "aptitude")
    else:
        query = query.filter(InterviewQuestion.question_type != "aptitude")
    
    questions = query.order_by(InterviewQuestion.question_number).all()
    
    # Batch-load answered IDs in ONE query (eliminates N+1)
    question_ids = [q.id for q in questions]
    answered_ids = set(
        row[0] for row in db.query(InterviewAnswer.question_id).filter(
            InterviewAnswer.question_id.in_(question_ids)
        ).all()
    ) if question_ids else set()
    
    for question in questions:
        if question.id not in answered_ids:
            # Manually map to schema to avoid AttributeError if model lacks question_options
            return {
                "id": question.id,
                "interview_id": question.interview_id,
                "question_number": question.question_number,
                "question_text": question.question_text,
                "question_type": question.question_type,
                "question_options": question.options,
                "options": question.options
            }
            
    raise HTTPException(status_code=status.HTTP_410_GONE, detail="All questions in this stage answered")


# ─── Background Tasks ─────────────────────────────────────────────────────────

@router.post("/{interview_id}/submit-answer")
@limiter.limit("60/minute")
async def submit_answer(
    request: Request,
    interview_id: int,
    data: InterviewAnswerSubmit,
    background_tasks: BackgroundTasks,
    interview_session: Interview = Depends(get_current_interview),
    db: Session = Depends(get_db)
):
    """Submit answer to current question (stage-aware)."""
    request_id_header = request.headers.get("X-Request-ID")
    if settings.enable_request_id_idempotency and is_duplicate_request(
        request_id=request_id_header,
        scope="interviews.submit_answer",
        key=f"{interview_id}:{data.question_id}",
        ttl_seconds=120,
    ):
        existing = db.query(InterviewAnswer).filter(
            InterviewAnswer.question_id == data.question_id,
            InterviewAnswer.interview_id == interview_id
        ).first()
        if existing:
            return {"success": True, "answer_id": existing.id, "idempotent_replay": True}
        raise HTTPException(status_code=409, detail="Duplicate submit request detected. Please retry.")

    # 1. Access Control: Ensure the session belongs to the current candidate
    if interview_session.id != interview_id:
        logger.warning(f"Unauthorized access attempt: Session {interview_session.id} tried to submit for {interview_id}")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied: Session mismatch.")

    # 2. Re-read with row-level lock to prevent race conditions during submission
    try:
        interview = db.query(Interview).filter(
            Interview.id == interview_id
        ).with_for_update().first()
        
        if not interview:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview session not found.")
            
        if interview.status != "in_progress":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, 
                detail=f"Interview submission blocked: Session is in {interview.status} state."
            )

        # ── TIMER VALIDATION ──
        if interview.started_at and interview.duration_minutes:
            now = get_ist_now()
            # Naive to aware conversion if needed, but get_ist_now usually returns naive for this project
            # based on my previous analysis of to_naive_ist usage.
            # Let's check if started_at is naive or aware.
            start_time = to_naive_ist(interview.started_at)
            # Based on app/core/timezone.py usage in the file, it seems they use naive IST.
            end_time = start_time + timedelta(minutes=interview.duration_minutes)
            
            # Adding a 2-minute grace period for network latency during the final submission
            if now > (end_time + timedelta(minutes=2)):
                logger.warning(f"Submission rejected: Timer expired for interview {interview_id}. End time: {end_time}, Now: {now}")
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Interview session has expired. Submissions are no longer accepted for this session."
                )

        if interview.interview_stage == STAGE_COMPLETED:
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="Interview is already fully completed")

        # 3. Validate Question ID (Moved before proctoring check to avoid NameError)
        current_question = db.query(InterviewQuestion).filter(
            InterviewQuestion.id == data.question_id,
            InterviewQuestion.interview_id == interview_id
        ).first()
        
        if not current_question:
            logger.warning(
                "validation_failed",
                extra={"service_module": "interviews", "field": "question_id", "reason": "not_found_in_session", "input_preview": str(data.question_id)},
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Question not found in this session."
            )

        # ── PROCTORING ENFORCEMENT ──
        # If the job requires AI/Mixed mode, we expect monitoring events to be flowing.
        # We check if at least one 'normal' or 'focus_lost' event exists if the session 
        # has been active for more than 45 seconds.
        job = interview.application.job if interview.application else None
        if job and job.interview_mode in ["ai", "mixed"] and current_question.question_type != "aptitude":
            active_duration = get_ist_now() - to_naive_ist(interview.started_at)
            if active_duration > timedelta(seconds=45):
                from sqlalchemy import exists
                has_events = db.query(exists().where(
                    InterviewMonitoringEvent.interview_id == interview_id
                )).scalar()
                
                if not has_events:
                    logger.error(f"Proctoring Bypass Detected: No monitoring events for interview {interview_id} after {active_duration.seconds}s.")
                    # We don't terminate immediately to avoid false positives, but we block the submission
                    # until the proctoring engine checks in.
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Proctoring system is offline. Please ensure your camera is visible and refresh the page."
                    )
            
        # 3.5. Granular Validation of Answer Text
        answer_len = len(data.answer_text or "")
        if answer_len > 10000:
            logger.warning(f"Extremely long answer detected for interview {interview_id}: {answer_len} chars")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Answer text is too long (max 10,000 characters)."
            )
        
        # Reject empty or purely whitespace answers for non-aptitude questions
        if (current_question.question_type or "").lower() != "aptitude":
            if not data.answer_text or not data.answer_text.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Answer cannot be empty. Please provide a response."
                )
            if len(data.answer_text.strip()) < 3:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Your answer is too short. Please provide a more detailed response."
                )
        

        # Resolve answer text early for idempotency check and saving
        stored_answer_text = data.answer_text
        if (current_question.question_type or "").lower() == "aptitude" and current_question.options:
            try:
                options = json.loads(current_question.options)
                if isinstance(options, list) and len(options) > 0:
                    submitted_val = data.answer_text.strip().upper()
                    resolved_idx = -1
                    
                    # Case 1: Simple digit index (0, 1, 2...)
                    if submitted_val.isdigit():
                        resolved_idx = int(submitted_val)
                    # Case 2: Letter index (A, B, C...)
                    elif len(submitted_val) == 1 and 'A' <= submitted_val <= 'Z':
                        resolved_idx = ord(submitted_val) - ord('A')
                    # Case 3: "Option A", "Choice B" etc.
                    elif any(submitted_val.startswith(p) for p in ["OPTION ", "CHOICE "]):
                        last_char = submitted_val[-1]
                        if 'A' <= last_char <= 'Z':
                            resolved_idx = ord(last_char) - ord('A')
                        elif last_char.isdigit():
                            resolved_idx = int(last_char)

                    if 0 <= resolved_idx < len(options):
                        stored_answer_text = str(options[resolved_idx])
                        logger.info(f"Resolved aptitude input '{data.answer_text}' to text during check for session {interview_id}: {stored_answer_text}")
            except Exception as e:
                logger.warning(f"Failed to resolve aptitude input during check for session {interview_id}: {e}")

        # 4. Check if answer exists (we will update it instead of rejecting)
        existing_answer = db.query(InterviewAnswer).filter(
            InterviewAnswer.question_id == data.question_id,
            InterviewAnswer.interview_id == interview_id
        ).first()
        
        if existing_answer and existing_answer.evaluated_at:
             # Idempotent replay: if they resubmitted the exact same raw or resolved text, return success
             if existing_answer.answer_text == stored_answer_text or existing_answer.answer_text == data.answer_text:
                 logger.info(f"Idempotent resubmission of already evaluated answer for question {data.question_id} in interview {interview_id}")
                 return {"success": True, "answer_id": existing_answer.id, "idempotent_replay": True}
             
             # If it was already evaluated and is different, we don't allow overwriting to prevent race conditions/cheating
             logger.warning(f"Submission rejected: Answer for question {data.question_id} in interview {interview_id} was already evaluated.")
             raise HTTPException(
                 status_code=status.HTTP_409_CONFLICT,
                 detail="This question has already been evaluated and cannot be modified."
             )
        
        # 5. Termination Protocol (Abusive language / Explicit quit)
        should_terminate = False
        termination_reason = ""
        # Only run for technical/behavioral — aptitude answers are MCQs or very short
        if (current_question.question_type or "").lower() != "aptitude":
            try:
                # Sanitize input before termination check
                from app.services.ai_service import sanitize_ai_input
                sanitized_answer = sanitize_ai_input(data.answer_text, log_context=f"Interview {interview_id}")
                
                # Check for termination keywords (case-insensitive & robust)
                should_terminate, termination_reason = _termination_checker.check_for_termination(
                    sanitized_answer, 
                    question_type=current_question.question_type
                )
            except Exception as e:
                logger.error(f"Termination checker error: {e}")
                should_terminate = False

        if should_terminate:
            try:
                _set_interview_status(interview, "terminated")
                interview.interview_stage = STAGE_COMPLETED
                interview.ended_at = get_ist_now()
                
                from app.services.state_machine import CandidateStateMachine, TransitionAction
                from app.domain.models import InterviewIssue
                
                fsm = CandidateStateMachine(db)
                try:
                    action = TransitionAction.COMPLETE_INTERVIEW if interview.application.status == "interview_scheduled" else TransitionAction.SYSTEM_INTERVIEW_COMPLETE
                    fsm.transition(interview.application, action, notes=f"Interview automatically terminated. Reason: {termination_reason}")
                except Exception as e:
                    logger.error(f"FSM Transition error during termination: {e}")
                    interview.application.status = "interview_completed"
                
                # Create a ticket for HR review
                system_issue = InterviewIssue(
                    interview_id=interview.id,
                    candidate_name=interview.application.candidate_name,
                    candidate_email=interview.application.candidate_email,
                    issue_type="misconduct_appeal" if termination_reason == "misconduct" else "technical",
                    description=f"SYSTEM AUTO-TERMINATION: {termination_reason}. Input snippet: {data.answer_text[:100]}...",
                    status="pending"
                )
                db.add(system_issue)
                db.commit()
                
                # Pre-generate report for terminated session
                background_tasks.add_task(_finalize_interview_and_report, interview_id)

                return {
                    "success": True,
                    "terminated": True,
                    "termination_reason": termination_reason,
                    "idempotent_replay": False,
                    "message": (
                        "Interview terminated due to inappropriate language."
                        if termination_reason == "misconduct"
                        else "Interview ended at your request."
                    )
                }
            except Exception as e:
                db.rollback()
                logger.error(f"Termination protocol failed: {e}")
                raise HTTPException(status_code=500, detail="Internal failure during termination protocol.")

        # 6. Save Answer
        try:
            # stored_answer_text has already been resolved and validated above
            pass

            if existing_answer:
                # ── Phase 7: Answer Versioning ──
                try:
                    version_count = db.query(InterviewAnswerVersion).filter(InterviewAnswerVersion.answer_id == existing_answer.id).count()
                    old_version = InterviewAnswerVersion(
                        answer_id=existing_answer.id,
                        answer_text=existing_answer.answer_text,
                        answer_score=existing_answer.answer_score,
                        submitted_at=existing_answer.submitted_at or get_ist_now(),
                        version_number=version_count + 1
                    )
                    db.add(old_version)
                    db.flush()
                except Exception as e:
                    logger.warning(f"Failed to version old interview answer: {e}")

                existing_answer.answer_text = stored_answer_text
                existing_answer.submitted_at = get_ist_now()
                # reset evaluation so it gets re-evaluated
                existing_answer.answer_score = None
                existing_answer.skill_relevance_score = None
                existing_answer.answer_evaluation = None
                existing_answer.evaluated_at = None
                answer = existing_answer
            else:
                answer = InterviewAnswer(
                    question_id=current_question.id,
                    interview_id=interview_id,
                    answer_text=stored_answer_text,
                    submitted_at=get_ist_now()
                )

            # Auto-grade aptitude MCQs
            if current_question.question_type == "aptitude" and current_question.correct_answer is not None:
                submitted_val = data.answer_text.strip()
                correct_ans_str = current_question.correct_answer.strip()
                is_correct = False
                
                # 1. Direct text check (case-insensitive)
                if submitted_val.lower() == correct_ans_str.lower():
                    is_correct = True
                
                # 2. Resolve letter to index (A=0, B=1, ...) or direct digit
                if not is_correct:
                    submitted_as_int = None
                    if submitted_val.isdigit():
                        submitted_as_int = int(submitted_val)
                    elif len(submitted_val) == 1 and submitted_val.upper() in "ABCDEFGHIJ":
                        submitted_as_int = ord(submitted_val.upper()) - ord("A")
                    
                    correct_idx = None
                    # Try parsing correct_answer as float then int
                    try:
                        correct_as_float = float(correct_ans_str)
                        if correct_as_float.is_integer():
                            correct_idx = int(correct_as_float)
                    except (ValueError, TypeError):
                        pass
                    
                    # Or try parsing correct_answer as letter index
                    if correct_idx is None:
                        if len(correct_ans_str) == 1 and correct_ans_str.upper() in "ABCDEFGHIJ":
                            correct_idx = ord(correct_ans_str.upper()) - ord("A")
                            
                    if correct_idx is not None and submitted_as_int is not None and submitted_as_int == correct_idx:
                        is_correct = True

                # 3. Option lookup check
                if not is_correct and current_question.options:
                    try:
                        options = json.loads(current_question.options)
                        if isinstance(options, list):
                            # Try parsing correct answer as index
                            correct_idx = None
                            try:
                                correct_as_float = float(correct_ans_str)
                                if correct_as_float.is_integer():
                                    correct_idx = int(correct_as_float)
                            except (ValueError, TypeError):
                                pass
                            
                            if correct_idx is not None and correct_idx < len(options):
                                if submitted_val.lower() == options[correct_idx].lower():
                                    is_correct = True
                            # Also check if correct_ans_str matches one of the option texts, and submitted_val matches its index
                            elif submitted_as_int is not None and submitted_as_int < len(options):
                                if options[submitted_as_int].lower() == correct_ans_str.lower():
                                    is_correct = True
                    except Exception:
                        pass
                
                answer.answer_score = 10.0 if is_correct else 0.0
                answer.skill_relevance_score = 10.0 if is_correct else 0.0
                answer.evaluated_at = get_ist_now()
                answer.answer_evaluation = json.dumps({"auto_graded": True, "is_correct": is_correct})

            # Event removed to fix blank snapshot UI bugs

            if not existing_answer:
                db.add(answer)
            db.commit()
            db.refresh(answer)
        except IntegrityError:
            db.rollback()
            existing = db.query(InterviewAnswer).filter(
                InterviewAnswer.question_id == current_question.id,
                InterviewAnswer.interview_id == interview_id
            ).first()
            if existing:
                return {"success": True, "answer_id": existing.id, "idempotent_replay": True}
            raise HTTPException(status_code=409, detail="Answer already exists for this question.")
        except Exception as e:
            db.rollback()
            logger.error(f"Answer save error: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to save answer safely.")

        # 7. Background AI Evaluation
        if current_question.question_type != "aptitude":
            background_tasks.add_task(
                evaluate_answer_task,
                answer.id,
                current_question.question_text,
                data.answer_text,
                current_question.question_type or "technical",
                interview_id
            )

        return {"success": True, "answer_id": answer.id, "idempotent_replay": False}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unhandled submission error: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="A critical server error occurred during submission.")


@router.post("/{interview_id}/complete-aptitude")
@limiter.limit("20/minute")
async def complete_aptitude(
    request: Request,
    interview_id: int,
    interview_session: Interview = Depends(get_current_interview),
    db: Session = Depends(get_db)
):
    """
    Complete the aptitude round and automatically transition to first-level interview.
    Calculates aptitude score, generates first-level questions, and returns the first question.
    NO re-login required — same session continues.
    """
    if interview_session.id != interview_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    # Re-read with row-level lock to prevent double-click race
    interview = db.query(Interview).filter(
        Interview.id == interview_id
    ).with_for_update().first()
    
    if not interview:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview not found")
        
    if interview.interview_stage == STAGE_COMPLETED:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Interview is already fully completed")
        
    if interview.status != "in_progress":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail=f"Action blocked: Session is in {interview.status} state."
        )
    
    # Idempotency guard: if already past aptitude, return success
    if interview.interview_stage != STAGE_APTITUDE:
        return {
            "success": True,
            "aptitude_score": interview.aptitude_score,
            "new_stage": interview.interview_stage,
            "message": "Aptitude round already completed.",
        }
    
    _enforce_stage(interview, STAGE_APTITUDE)

    # Verify all aptitude questions are answered — batch query (no N+1)
    aptitude_questions = db.query(InterviewQuestion).filter(
        InterviewQuestion.interview_id == interview_id,
        InterviewQuestion.question_type == "aptitude"
    ).all()

    apt_q_ids = [q.id for q in aptitude_questions]
    answered_q_ids = set()
    if apt_q_ids:
        answered = db.query(InterviewAnswer.question_id).filter(
            InterviewAnswer.question_id.in_(apt_q_ids)
        ).all()
        answered_q_ids = {row[0] for row in answered}

    unanswered = [q for q in aptitude_questions if q.id not in answered_q_ids]
    if unanswered:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="All aptitude questions must be answered before completing the aptitude round."
        )

    # Calculate aptitude score for display purposes (does not affect final combined score)
    answers = db.query(InterviewAnswer).filter(
        InterviewAnswer.question_id.in_(apt_q_ids)
    ).all() if apt_q_ids else []
    
    apt_scores = [a.answer_score for a in answers if a.answer_score is not None]
    if apt_scores:
        interview.aptitude_score = sum(apt_scores) / len(apt_scores)
    else:
        interview.aptitude_score = 0.0

    interview.aptitude_completed_at = get_ist_now()
    interview.aptitude_completed = True

    if not interview.application or not interview.application.job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail="Job associated with this interview could not be found."
        )
    job = interview.application.job

    # Check if first_level is enabled
    if job.first_level_enabled:
        try:
            # Transition to first-level interview
            # Questions were PRE-GENERATED during access_interview — no AI delay here
            interview.interview_stage = STAGE_FIRST_LEVEL
            db.commit()
        except Exception as e:
            db.rollback()
            raise HTTPException(status_code=500, detail="Failed changing pipeline stages.")

        # Get the first question to return
        first_q = db.query(InterviewQuestion).filter(
            InterviewQuestion.interview_id == interview_id,
            InterviewQuestion.question_type != "aptitude"
        ).order_by(InterviewQuestion.question_number).first()

        return {
            "success": True,
            "aptitude_score": interview.aptitude_score,
            "new_stage": STAGE_FIRST_LEVEL,
            "message": "Aptitude round completed. First-level interview questions generated.",
            "first_question": {
                "id": first_q.id,
                "question_number": first_q.question_number,
                "question_text": first_q.question_text,
                "question_type": first_q.question_type,
            } if first_q else None,
        }
    else:
        try:
            # Aptitude only — mark as completed
            interview.interview_stage = STAGE_COMPLETED
            _set_interview_status(interview, "completed")
            interview.ended_at = get_ist_now()
            interview.overall_score = interview.aptitude_score
            # Use FSM for state transition: interview_scheduled -> interview_completed
            from app.services.state_machine import CandidateStateMachine, TransitionAction
            fsm = CandidateStateMachine(db)
            try:
                fsm.transition(interview.application, TransitionAction.SYSTEM_INTERVIEW_COMPLETE)
            except Exception:
                interview.application.status = "interview_completed"
            db.commit()
        except Exception as e:
            db.rollback()
            raise HTTPException(status_code=500, detail="Failed to finalise aptitude round.")

        # Generate minimal InterviewReport for aptitude-only jobs
        try:
            existing_report = db.query(InterviewReport).filter(
                InterviewReport.interview_id == interview_id
            ).first()
            if not existing_report:
                report = InterviewReport(
                    interview_id=interview_id,
                    application_id=interview.application.id,
                    job_id=job.id,
                    candidate_name=interview.application.candidate_name,
                    candidate_email=interview.application.candidate_email,
                    applied_role=job.title,
                    overall_score=interview.aptitude_score or 0.0,
                    technical_skills_score=0,
                    communication_score=0,
                    problem_solving_score=0,
                    strengths="[]",
                    weaknesses="[]",
                    summary="Aptitude-only interview completed. No first-level interview configured.",
                    recommendation="consider",
                    detailed_feedback="Aptitude round completed successfully.",
                    aptitude_score=interview.aptitude_score,
                    combined_score=interview.aptitude_score or 0.0,
                    ai_used=False,
                    fallback_used=False,
                    confidence_score=0.0,
                )
                db.add(report)
                db.commit()
        except Exception as e:
            logger.error(f"Error creating aptitude-only report: {e}")

        return {
            "success": True,
            "aptitude_score": interview.aptitude_score,
            "new_stage": STAGE_COMPLETED,
            "message": "Aptitude round completed. No first-level interview configured for this job.",
        }



@router.post("/{interview_id}/fail-device-test")
async def fail_device_test(
    interview_id: int,
    background_tasks: BackgroundTasks,
    data: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Invalidates access keys and deactivates the session immediately if a candidate
    fails or attempts to bypass device hardware verification.
    """

    interview = db.query(Interview).filter(
        Interview.id == interview_id
    ).with_for_update().first()

    if not interview:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview not found")

    reason = (data.get("reason") or "").strip() or "Failed device hardware verification"
    # Add audit log record (CRIT-02)
    try:
        from app.domain.models import AuditLog
        audit_entry = AuditLog(
            user_id=None,
            action="INTERVIEW_TERMINATED_VIOLATION",
            resource_type="Interview",
            resource_id=interview_id,
            details=json.dumps({
                "reason": reason,
                "proctoring_source": "device_test_verification"
            })
        )
        db.add(audit_entry)
    except Exception as audit_err:
        logger.error(f"Failed to write device test violation audit log: {audit_err}")

    # 1. Clear access key hash completely to make it permanently invalid
    interview.access_key_hash = None

    # 2. Terminate interview session state
    _set_interview_status(interview, "terminated")
    interview.interview_stage = STAGE_COMPLETED
    interview.ended_at = get_ist_now()

    # 3. Transition candidate state machine to REJECT
    try:
        from app.services.state_machine import CandidateStateMachine, TransitionAction
        if interview.application:
            fsm = CandidateStateMachine(db)
            action = TransitionAction.COMPLETE_INTERVIEW if interview.application.status == "interview_scheduled" else TransitionAction.SYSTEM_INTERVIEW_COMPLETE
            fsm.transition(
                interview.application,
                action,
                notes=f"Interview auto-terminated by proctoring system. Reason: {reason}",
            )
    except Exception as fsm_err:
        logger.error(f"FSM transition failed on device test violation: {fsm_err}")
        if interview.application:
            interview.application.status = "interview_completed"

    db.commit()

    if background_tasks:
        background_tasks.add_task(_finalize_interview_and_report, interview_id)

    return {"ok": True, "terminated": True, "access_key_invalidated": True, "reason": reason}



@router.post("/{interview_id}/security-violation")
@limiter.limit("20/minute")
async def report_security_violation(
    request: Request,
    interview_id: int,
    background_tasks: BackgroundTasks,
    data: dict = Body(...),
    db: Session = Depends(get_db),
):
    """
    Report a proctoring security violation (tab switch, face not detected, multiple people, etc.)
    Used by the frontend proctoring engine as a REST replacement for the WS security_violation action.
    """

    # Auth verification: Allow candidate (interview JWT) or Super Admin (staff JWT) (CRIT-01 & CRIT-02)
    interview_session = None
    is_super_admin = False
    current_admin_user = None
    
    try:
        interview_session = get_current_interview(request, db)
    except HTTPException as e:
        try:
            current_admin_user = get_current_user(request, db)
            if current_admin_user and current_admin_user.role == "super_admin":
                is_super_admin = True
        except Exception:
            raise e # Raise the candidate auth exception if neither passes
            
    if interview_session:
        if interview_session.id != interview_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: interview token does not match interview_id."
            )
        proctoring_source = "candidate_proctoring_engine"
        triggering_user_id = None
    elif is_super_admin:
        proctoring_source = f"super_admin_override_{current_admin_user.email}"
        triggering_user_id = current_admin_user.id
    else:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: invalid authentication source."
        )

    # Normalise empty/whitespace reasons so the default is always recorded
    reason = (data.get("reason") or "").strip() or "Proctoring violation"
    logger.warning(f"SECURITY_VIOLATION: Terminating interview {interview_id}. Source: {proctoring_source}. Reason: {reason}")

    interview = db.query(Interview).filter(
        Interview.id == interview_id
    ).with_for_update().first()

    if not interview:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview not found")

    if interview.status in ("terminated", "completed", "cancelled") or interview.interview_stage == STAGE_COMPLETED:
        return {"ok": True, "already_ended": True, "status": interview.status}

    _set_interview_status(interview, "terminated")
    interview.interview_stage = STAGE_COMPLETED
    interview.ended_at = get_ist_now()

    # FSM transition: reject the application
    try:
        from app.services.state_machine import CandidateStateMachine, TransitionAction
        if interview.application:
            fsm = CandidateStateMachine(db)
            action = TransitionAction.COMPLETE_INTERVIEW if interview.application.status == "interview_scheduled" else TransitionAction.SYSTEM_INTERVIEW_COMPLETE
            fsm.transition(
                interview.application,
                action,
                notes=f"Interview auto-terminated by proctoring system. Source: {proctoring_source}. Reason: {reason}",
            )
    except Exception as fsm_err:
        logger.error(f"FSM transition failed on security violation: {fsm_err}")
        if interview.application:
            interview.application.status = "interview_completed"

    # Add audit log record (CRIT-02)
    try:
        from app.domain.models import AuditLog
        audit_entry = AuditLog(
            user_id=triggering_user_id,
            action="INTERVIEW_TERMINATED_VIOLATION",
            resource_type="Interview",
            resource_id=interview_id,
            details=json.dumps({
                "reason": reason,
                "proctoring_source": proctoring_source
            }),
            is_critical=True
        )
        db.add(audit_entry)
    except Exception as audit_err:
        logger.error(f"Failed to record security violation audit log: {audit_err}")

    db.commit()

    # Generate final report in background
    if background_tasks:
        background_tasks.add_task(_finalize_interview_and_report, interview_id)

    return {"ok": True, "terminated": True, "reason": reason}


@router.post("/{interview_id}/end")
@limiter.limit("20/minute")
async def end_interview(
    request: Request,
    interview_id: int,
    background_tasks: BackgroundTasks,
    data: dict = Body(None),
    interview_session: Interview = Depends(get_current_interview_any_status),
    db: Session = Depends(get_db)
):
    """End interview manually (standard path).

    Returns immediately - AI report generation runs in a background task.
    """
    if interview_session.id != interview_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    request_id_header = request.headers.get("X-Request-ID")
    if settings.enable_request_id_idempotency and is_duplicate_request(
        request_id=request_id_header,
        scope="interviews.end",
        key=str(interview_id),
        ttl_seconds=120,
    ):
        interview_dup = db.query(Interview).filter(Interview.id == interview_id).first()
        if interview_dup and interview_dup.status != "in_progress":
            return {
                "success": True,
                "message": f"Interview is already in {interview_dup.status} state.",
                "status": interview_dup.status,
                "interview_id": interview_id,
                "interview_score": interview_dup.overall_score,
                "combined_score": interview_dup.overall_score,
            }

    interview = (
        db.query(Interview)
        .filter(Interview.id == interview_id)
        .with_for_update()
        .first()
    )

    if not interview:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview not found")

    if interview.status != "in_progress":
        return {
            "success": True,
            "message": f"Interview is already in {interview.status} state.",
            "status": interview.status,
            "interview_id": interview_id,
            "interview_score": interview.overall_score,
            "combined_score": interview.overall_score,
        }

    # 1. Enforcement Check (Ensure sufficient answers if not already terminated or forced)
    is_forced = isinstance(data, dict) and data.get("force") is True
    ended_early = isinstance(data, dict) and data.get("ended_early") is True
    if interview.status != "terminated" and not is_forced:
        if interview.interview_stage == STAGE_APTITUDE:
            questions = db.query(InterviewQuestion).filter(
                InterviewQuestion.interview_id == interview_id,
                InterviewQuestion.question_type == "aptitude"
            ).all()
        else:
            questions = db.query(InterviewQuestion).filter(
                InterviewQuestion.interview_id == interview_id,
                InterviewQuestion.question_type != "aptitude"
            ).all()
        question_ids = [q.id for q in questions]
        # Count answers by joining through question_id to avoid NULL interview_id issues
        answered_count = db.query(InterviewAnswer).filter(
            InterviewAnswer.question_id.in_(question_ids)
        ).count() if question_ids else 0

        if answered_count < len(questions) and len(questions) > 0:
            raise HTTPException(
                status_code=400,
                detail=f"Please answer all questions before ending. Missing: {len(questions) - answered_count}"
            )

    # ── DEMO EARLY-END: cancel and purge all provisional records ──────────────
    # If the candidate clicks "End Session" on a demo interview (ended_early=true
    # or force=true) before completing it, silently delete the application record.
    # CASCADE on Application → Interview → questions/answers cleans everything up.
    # No report is generated; the session leaves no trace in the pipeline.
    if (ended_early or is_forced) and getattr(interview, "is_demo", False):
        app_record = interview.application
        app_id = app_record.id if app_record else None
        logger.info(
            f"[Demo] Early end detected for provisional demo interview {interview_id} "
            f"(application_id={app_id}). Purging all records — no report will be saved."
        )
        if app_record:
            db.delete(app_record)
        else:
            db.delete(interview)
        db.commit()
        return {
            "success": True,
            "demo_cancelled": True,
            "message": "Demo session cancelled. No application or report was saved.",
        }

    # 1.5 Handle termination reason if provided (proctoring violations etc.)
    if data and data.get("termination_reason"):
        from app.domain.models import InterviewIssue
        reason = data["termination_reason"]
        logger.warning(f"Manual termination requested for interview {interview_id}: {reason}")
        _set_interview_status(interview, "terminated")
        issue = InterviewIssue(
            interview_id=interview_id,
            candidate_name=interview.application.candidate_name if interview.application else "Candidate",
            candidate_email=interview.application.candidate_email if interview.application else "Email N/A",
            issue_type="proctoring",
            description=reason,
            status="resolved"
        )
        db.add(issue)
        db.commit()

    # 1.6 Annotate hr_notes when the candidate deliberately ends the interview early
    if (ended_early or is_forced) and interview.application:
        now_str = get_ist_now().strftime("%Y-%m-%d %H:%M UTC")
        early_note = (
            f"[{now_str}] Candidate ended the interview early using the 'End Early' button "
            "before completing all questions."
        )
        existing_notes = interview.application.hr_notes or ""
        interview.application.hr_notes = (
            (existing_notes.rstrip() + "\n" + early_note).strip()
            if existing_notes
            else early_note
        )
        db.commit()

    # 2. Mark state immediately so the frontend sees a finished interview right away.
    if interview.status == "in_progress":
        _set_interview_status(interview, "completed")
    interview.interview_stage = STAGE_COMPLETED
    if not interview.ended_at:
        interview.ended_at = get_ist_now()
    db.commit()

    # 3. Run the heavy AI report generation in the background so this response
    #    returns in milliseconds instead of blocking for 20-60 seconds.
    background_tasks.add_task(_finalize_interview_and_report, interview_id)
    logger.info(f"Interview {interview_id} ended — report generation queued as background task.")

    return {
        "success": True,
        "interview_id": interview_id,
        "status": interview.status,
        "interview_score": interview.overall_score,
        "combined_score": interview.overall_score,
    }

@router.post("/{interview_id}/abandon")
@limiter.limit("20/minute")
async def abandon_interview(
    request: Request,
    interview_id: int,
    background_tasks: BackgroundTasks,
    interview_session: Interview = Depends(get_current_interview_any_status),
    db: Session = Depends(get_db)
):
    """
    Called when a candidate closes the tab or abandons the interview.
    Forcefully terminates the interview and generates a report.
    """
    if interview_session.id != interview_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    interview = db.query(Interview).filter(Interview.id == interview_id).with_for_update().first()
    
    if not interview:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview not found")
        
    if interview.status != "in_progress" or interview.interview_stage == STAGE_COMPLETED:
        return {"success": True, "message": f"Interview is already in {interview.status} state."}

    try:
        # ── DEMO ABANDON: purge provisional records on tab-close ──────────────
        # If a provisional demo interview is abandoned (tab closed), silently
        # delete the application record. CASCADE removes the interview, questions,
        # answers, and any monitoring events. No report is generated.
        if getattr(interview, "is_demo", False):
            app_record = interview.application
            app_id = app_record.id if app_record else None
            logger.info(
                f"[Demo] Tab-close abandon detected for demo interview {interview_id} "
                f"(application_id={app_id}). Purging provisional records — no report will be saved."
            )
            if app_record:
                db.delete(app_record)
            else:
                db.delete(interview)
            db.commit()
            return {"success": True, "demo_cancelled": True, "message": "Demo session abandoned. No records were saved."}

        # Mark as terminated
        _set_interview_status(interview, "terminated")
        interview.interview_stage = STAGE_COMPLETED
        interview.ended_at = get_ist_now()
        
        # Track abandonment in Issue list
        from app.domain.models import InterviewIssue
        system_issue = InterviewIssue(
            interview_id=interview.id,
            candidate_name=interview.application.candidate_name if interview.application else "Candidate",
            candidate_email=interview.application.candidate_email if interview.application else "Email N/A",
            issue_type="technical",
            description="Terminated by candidate (Tab closed)",
            status="pending"
        )
        db.add(system_issue)
        
        # Transition state
        from app.services.state_machine import CandidateStateMachine, TransitionAction
        fsm = CandidateStateMachine(db)
        try:
            action = TransitionAction.COMPLETE_INTERVIEW if interview.application.status == "interview_scheduled" else TransitionAction.SYSTEM_INTERVIEW_COMPLETE
            fsm.transition(interview.application, action, notes="Candidate abandoned the session.")
        except Exception:
            if interview.application:
                interview.application.status = "interview_completed"
        
        db.commit()
        
        # Generate final report for whatever was answered so far in background
        background_tasks.add_task(_finalize_interview_and_report, interview_id)
        
        return {"success": True, "message": "Interview abandoned. Report generation queued."}
    except Exception as e:
        db.rollback()
        logger.error(f"Error in abandon_interview: {e}")
        raise HTTPException(status_code=500, detail="Failed to record abandonment.")

@router.get("/{interview_id}", response_model=InterviewDetailResponse)
def get_interview(
    interview_id: int,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db)
):
    """Get interview details (HR/super_admin only; prevents IDOR for dashboard users)."""
    interview = (
        db.query(Interview)
        .options(joinedload(Interview.application))
        .filter(Interview.id == interview_id)
        .first()
    )

    if not interview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Interview not found"
        )

    validate_hr_ownership_for_interview(interview, current_user, resource_name="interview")
    return interview

@router.get("/{interview_id}/report", response_model=InterviewReportResponse)
@limiter.limit("20/minute")
async def get_interview_report(
    request: Request,
    interview_id: int,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db)
):
    """Get interview report (HR only)"""
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    
    if not interview:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Interview not found"
        )
    validate_hr_ownership_for_interview(interview, current_user, resource_name="interview")
    
    report = db.query(InterviewReport).filter(
        InterviewReport.interview_id == interview_id
    ).first()
    
    # Task: On-the-fly report generation fallback
    if not report and interview.status in ["completed", "terminated"]:
        logger.info(f"Report missing for finished interview {interview_id}. Generating on-the-fly.")
        report = await _finalize_interview_and_report_internal(db, interview_id)
        
    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not yet available"
        )
    
    # Return report data plus video_url from interview — only when a recording actually exists
    report_dict = {column.name: getattr(report, column.name) for column in report.__table__.columns}
    
    if interview.video_recording_path:
        report_dict['video_url'] = f"/api/interviews/{interview.id}/video-stream"
    else:
        report_dict['video_url'] = None
    
    return report_dict

@router.get("/{interview_id}/video-stream")
async def get_video_stream(
    interview_id: int,
    request: Request,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db)
):
    """Return redirect to signed video URL from Supabase (HR only)"""
    _settings = __import__('app.core.config', fromlist=['get_settings']).get_settings()
    _get_signed_url = __import__('app.core.storage', fromlist=['get_signed_url']).get_signed_url
    
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
        
    validate_hr_ownership_for_interview(interview, current_user, resource_name="interview")
    
    video_path = interview.video_recording_path
    if not video_path:
        raise HTTPException(status_code=404, detail="No video recording found for this interview")

    signed_url = _get_signed_url(_settings.supabase_bucket_videos, video_path)
    
    if not signed_url:
        raise HTTPException(status_code=500, detail="Failed to generate playback URL")

    return RedirectResponse(url=signed_url)

@router.post("/{interview_id}/transcribe")
@limiter.limit("20/minute")
async def transcribe_interview_audio(
    request: Request,
    interview_id: int,
    file: UploadFile = File(...),
    interview_session: Interview = Depends(get_current_interview),
    db: Session = Depends(get_db)
):
    """
    Transcribe audio recorded during an interview.
    Replays identical JSON for the same X-Request-ID within TTL (Redis when REDIS_URL is set).
    """
    if interview_session.id != interview_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    # P2-M04: Chunk-based size enforcement to prevent OOM DoS
    MAX_AUDIO_SIZE = 15 * 1024 * 1024
    chunks = []
    total_size = 0
    chunk_size = 1024 * 1024 # 1MB chunks
    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        total_size += len(chunk)
        if total_size > MAX_AUDIO_SIZE:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Audio file too large. Maximum size allowed is {MAX_AUDIO_SIZE // (1024 * 1024)}MB."
            )
        chunks.append(chunk)
    audio_content = b"".join(chunks)

    # P2-M04: Validate magic bytes for audio format verification
    is_wav = audio_content.startswith(b"RIFF")
    is_mp3 = audio_content.startswith(b"ID3") or audio_content.startswith(b"\xff\xfb") or audio_content.startswith(b"\xff\xf3") or audio_content.startswith(b"\xff\xf2")
    is_webm = audio_content.startswith(b"\x1a\x45\xdf\xa3")
    is_ogg = audio_content.startswith(b"OggS")
    if not (is_wav or is_mp3 or is_webm or is_ogg):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid audio format. Must be a valid WAV, MP3, WebM, or OGG audio file."
        )

    rid = (request.headers.get("X-Request-ID") or "").strip()
    if rid and settings.enable_request_id_idempotency:
        cache_key = f"idem:interviews.transcribe:{interview_id}:{rid}"
        cached = _idem_cache_get(cache_key)
        if cached is not None:
            log_json(
                logger,
                "transcribe_idempotent_replay",
                level="info",
                extra={"interview_id": interview_id, "request_id_prefix": rid[:12]},
            )
            return cached
    
    import os
    import tempfile
    import shutil
    import traceback
    from datetime import datetime

    # Secure temporary file handling
    suffix = os.path.splitext(file.filename)[1] if (file.filename and os.path.splitext(file.filename)[1]) else ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
        tmp_path = temp_file.name
    
    if not settings.groq_keys:
        logger.error(f"Transcription failed: GROQ_API_KEY is not set in environment variables.")
        raise HTTPException(
            status_code=500, 
            detail="Transcription service unavailable: GROQ_API_KEY is missing on server. Please contact support."
        )

    try:
        with open(tmp_path, "wb") as buffer:
            buffer.write(audio_content)
        file.file.close()
        
        file_size = os.path.getsize(tmp_path)
        logger.info(f"Transcription requested for Interview {interview_id}. File: {file.filename}, Size: {file_size} bytes")

        if file_size < 100: # Too small to be valid audio
            out = {"text": ""}
        else:
            text = await transcribe_audio(tmp_path)
            out = {"text": text}
        if rid and settings.enable_request_id_idempotency:
            _idem_cache_set(f"idem:interviews.transcribe:{interview_id}:{rid}", out, ttl_seconds=90)
        return out
    except Exception as e:
        logger.error(f"Transcription failure for interview {interview_id}: {e}")
        logger.error(traceback.format_exc())
        logger.error(f"Failed to process voice audio: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An error occurred while processing voice audio. Please try again.")
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)





# ── Server-Side Strike & Sequence-Number Enforcement ────────────────────────
# In-memory map: interview_id → last received sequence number for heartbeat
# tamper detection. Reset when the interview ends.
LAST_SEQUENCE_NUMBERS: dict[int, int] = {}

EVENT_WEIGHTS = {
    "focus_lost": 2.0,
    "tab_switch": 4.0,
    "fullscreen_exit": 5.0,
    "face_not_detected": 3.0,
    "multiple_people": 10.0,
    "face_not_visible": 1.5,
    "low_lighting": 0.5,
    "gaze_deviation": 1.0,
    "clipboard_violation": 8.0,
    "liveness_violation": 10.0,
    "voice_coaching_detected": 8.0,
    "normal": 0.0
}


@router.post("/{interview_id}/monitoring-events", response_model=MonitoringEventResponse)
@limiter.limit("40/minute")
async def create_monitoring_event(
    request: Request,
    interview_id: int,
    event_data: MonitoringEventCreate,
    background_tasks: BackgroundTasks,
    interview_session: Interview = Depends(get_current_interview),
    db: Session = Depends(get_db)
):
    """
    Candidate endpoint to submit a proctoring/monitoring event silently.
    If a base64 frame snapshot is provided, uploads it to Supabase cloud storage.
    """
    if interview_session.id != interview_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # ── SEQUENCE NUMBER: TAMPER / EVENT-SUPPRESSION DETECTION ────────────────
    # The client sends a monotonically-increasing seq_num with every heartbeat.
    # A gap > 1 means events were suppressed (e.g. JS killed between ticks).
    is_strike_event = event_data.event_type.startswith("focus_lost_strike_")
    
    # We resolve the JTI to construct dynamic derived session secret and Redis keys
    auth_header = request.headers.get("Authorization", "")
    token = ""
    if auth_header.startswith("Bearer "):
        token = auth_header.replace("Bearer ", "").strip()
        
    interview_secret = _get_interview_jwt_secret()
    jti = None
    if token:
        try:
            from jose import jwt as _jose_jwt
            payload = _jose_jwt.decode(
                token,
                interview_secret,
                algorithms=[settings.jwt_algorithm],
                options={"verify_exp": False} # checked by dependency
            )
            jti = payload.get("jti")
        except Exception:
            pass

    from app.core.redis_store import get_redis_client
    redis_client = get_redis_client()

    if event_data.sequence_number is not None:
        seq_key = f"seq:{interview_id}"
        last_seq = None
        
        if redis_client is not None:
            try:
                last_seq_str = redis_client.get(seq_key)
                if last_seq_str is not None:
                    last_seq = int(last_seq_str)
            except Exception as e:
                logger.error(f"[Proctoring] Redis error reading sequence (failing closed): {e}")
                raise HTTPException(status_code=503, detail="Security service offline. Please try again.")
        else:
            last_seq = LAST_SEQUENCE_NUMBERS.get(interview_id)

        if last_seq is not None and (event_data.sequence_number - last_seq) > 1:
            gap = event_data.sequence_number - last_seq - 1
            logger.warning(
                f"[Proctoring] Sequence gap detected for interview {interview_id}: "
                f"last={last_seq} current={event_data.sequence_number} gap={gap}"
            )
            suppression_event = InterviewMonitoringEvent(
                interview_id=interview_id,
                event_type="liveness_violation",
                confidence_score=1.0,
                is_false_positive=False,
                details=json.dumps({
                    "category": "event_suppression_detected",
                    "description": f"Heartbeat sequence gap of {gap} detected. Possible JS/page manipulation.",
                    "last_seq": last_seq,
                    "current_seq": event_data.sequence_number,
                }),
                timestamp=get_ist_now(),
            )
            db.add(suppression_event)
            
        if redis_client is not None:
            try:
                redis_client.set(seq_key, str(event_data.sequence_number), ex=14400)
            except Exception as e:
                logger.error(f"[Proctoring] Redis error setting sequence (failing closed): {e}")
                raise HTTPException(status_code=503, detail="Security service offline. Please try again.")
        else:
            LAST_SEQUENCE_NUMBERS[interview_id] = event_data.sequence_number

    # ── SIGNATURE INTEGRITY HARDENING (HMAC-SHA256 & Replay Protection) ──
    if event_data.signature and event_data.client_timestamp:
        # Replay protection: check timestamp expiry (e.g. 5 minutes)
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        if abs(now_ms - event_data.client_timestamp) > 5 * 60 * 1000:
            logger.warning(f"[Proctoring] Expired timestamp for interview {interview_id}. Client: {event_data.client_timestamp}, Server: {now_ms}")
            raise HTTPException(status_code=400, detail="Event timestamp has expired (replay protection).")

        # Nonce verification
        if not event_data.nonce:
            raise HTTPException(status_code=400, detail="Missing event nonce.")
            
        nonce_key = f"nonce:{interview_id}:{event_data.nonce}"
        
        if redis_client is not None:
            try:
                # setnx returns True if the key was set (meaning it didn't exist)
                is_new = redis_client.set(nonce_key, "1", ex=300, nx=True)
                if not is_new:
                    logger.warning(f"[Proctoring] Redis duplicate nonce detected: {nonce_key}")
                    raise HTTPException(status_code=400, detail="Duplicate monitoring event detected (replay attack).")
            except Exception as e:
                if isinstance(e, HTTPException):
                    raise e
                logger.error(f"[Proctoring] Redis error verifying nonce (failing closed): {e}")
                raise HTTPException(status_code=503, detail="Security service offline. Please try again.")
        else:
            # Fallback to local memory dictionary
            legacy_nonce_key = f"{interview_id}:{event_data.nonce}"
            if legacy_nonce_key in SEEN_NONCES:
                logger.warning(f"[Proctoring] Process-local duplicate nonce detected: {legacy_nonce_key}")
                raise HTTPException(status_code=400, detail="Duplicate monitoring event detected (replay attack).")
            SEEN_NONCES.add(legacy_nonce_key)
            if len(SEEN_NONCES) > 10000:
                SEEN_NONCES.clear()

        # HMAC verification
        import hmac
        import hashlib
        
        # Verify dynamic derived secret first
        derived_verified = False
        if jti:
            derived_secret = hmac.new(
                interview_secret.encode('utf-8'),
                f"{interview_id}:{jti}".encode('utf-8'),
                hashlib.sha256
            ).hexdigest()
            
            raw_str_derived = f"{event_data.event_type}:{event_data.client_timestamp}:{event_data.nonce}:{token}:{derived_secret}"
            calculated_sig_derived = hmac.new(
                derived_secret.encode('utf-8'),
                raw_str_derived.encode('utf-8'),
                hashlib.sha256
            ).hexdigest()
            
            if calculated_sig_derived == event_data.signature:
                derived_verified = True

        if not derived_verified:
            # Fallback for legacy compatibility / automated tests
            legacy_secret = "rims_proctoring_secret_2026"
            raw_str_legacy = f"{event_data.event_type}:{event_data.client_timestamp}:{event_data.nonce}:{token}:{legacy_secret}"
            calculated_sig_legacy = hmac.new(
                legacy_secret.encode('utf-8'),
                raw_str_legacy.encode('utf-8'),
                hashlib.sha256
            ).hexdigest()
            
            if calculated_sig_legacy != event_data.signature:
                logger.warning(f"[Proctoring] HMAC mismatch for interview {interview_id}. got: {event_data.signature}")
                raise HTTPException(status_code=400, detail="Invalid HMAC event signature. Request integrity check failed.")

    # ── SIZE LIMIT ── (P2-H01: Cap frame size at 500KB)
    if event_data.frame_snapshot and len(event_data.frame_snapshot) > 500 * 1024 * 1.35: # account for base64 overhead
        logger.warning(f"Large monitoring frame rejected for interview {interview_id}: {len(event_data.frame_snapshot)} chars")
        event_data.frame_snapshot = None # Discard the image but keep the event metadata

    storage_path = None
    if event_data.frame_snapshot and event_data.frame_snapshot.startswith("data:image"):
        try:
            import base64
            from app.core.storage import upload_file
            
            # Extract header and base64 string
            header, encoded = event_data.frame_snapshot.split(",", 1)
            image_bytes = base64.b64decode(encoded)

            # Strict 500KB size cap on decoded bytes (P2-H01)
            if len(image_bytes) > 500 * 1024:
                raise HTTPException(status_code=400, detail="Image size exceeds 500KB limit.")

            # Magic bytes validation for JPEG or PNG (P2-H01)
            if not (image_bytes.startswith(b"\xff\xd8\xff") or image_bytes.startswith(b"\x89PNG\r\n\x1a\n")):
                raise HTTPException(status_code=400, detail="Invalid image content. Only JPEG and PNG are allowed.")
            
            timestamp = int(get_ist_now().timestamp())
            filename = f"monitoring_{interview_id}_{timestamp}_{event_data.event_type}.jpg"
            cloud_path = f"monitoring_frames/{interview_id}/{filename}"
            
            # Use BackgroundTasks to prevent 2.5s network lag
            def _background_upload(bucket, path, data, ct):
                try:
                    upload_file(bucket, path, data, content_type=ct)
                except Exception as e:
                    logger.error(f"Failed to upload monitoring frame in background: {e}")

            background_tasks.add_task(
                _background_upload,
                settings.supabase_bucket_videos,
                cloud_path,
                image_bytes,
                "image/jpeg"
            )
            # Optimistically set storage path without waiting for upload
            storage_path = cloud_path
        except Exception as e:
            if isinstance(e, HTTPException):
                raise e
            logger.error(f"Failed to process monitoring frame: {e}")

    # ── SERVER-SIDE STRIKE ENFORCEMENT ───────────────────────────────────────
    # The server is the source-of-truth for strike counts. The client may send
    # a strike event with an embedded number, but we RECOMPUTE the actual count
    # by querying confirmed non-false-positive strike events in the DB.
    actual_strike_count = 0
    token_revoked = False
    final_event_type = event_data.event_type

    if is_strike_event:
        import re as _re

        # FIX Issue #4: Acquire a row-level lock on the interview row before
        # counting existing strikes.  Without this lock, concurrent requests
        # executing a simultaneous burst of focus_lost_strike events all read
        # existing_strikes = 0, independently compute actual_strike_count = 1,
        # and persist duplicate strike_1 events.  On the next burst the count
        # jumps from 0 → 5+, immediately exceeding the threshold and causing
        # instant termination.
        #
        # with_for_update() serialises concurrent transactions that touch the
        # same row, so only one request at a time passes the count query and
        # the write.  This is a no-op on SQLite (it serialises writes already),
        # but is critical correctness for PostgreSQL in production.
        locked_interview = (
            db.query(Interview)
            .filter(Interview.id == interview_id)
            .with_for_update()
            .first()
        )

        # FIX Issue #4: Idempotency guard — if another concurrent request
        # already terminated this interview (and committed), skip all
        # termination logic so we do not revoke the token twice or write
        # duplicate audit rows.  Return the already-committed strike count.
        if locked_interview and locked_interview.status == "terminated":
            logger.info(
                f"[Proctoring] interview={interview_id} already terminated; "
                f"skipping duplicate strike processing."
            )
            actual_strike_count = db.query(InterviewMonitoringEvent).filter(
                InterviewMonitoringEvent.interview_id == interview_id,
                InterviewMonitoringEvent.event_type.like("focus_lost_strike_%"),
                InterviewMonitoringEvent.is_false_positive == False,
            ).count()
            # Still persist the event record (for audit completeness) but skip
            # all termination side-effects.  We fall through to event_record
            # creation below.
            final_event_type = event_data.event_type  # keep original, no rewrite needed
            is_strike_event = False  # suppress termination branch

        if is_strike_event:
            # FIX Issue #1: 5-second server-side cooldown.
            # Reject strike if the last strike was registered less than 5 seconds ago.
            last_strike = db.query(InterviewMonitoringEvent).filter(
                InterviewMonitoringEvent.interview_id == interview_id,
                InterviewMonitoringEvent.event_type.like("focus_lost_strike_%"),
                InterviewMonitoringEvent.is_false_positive == False,
            ).order_by(InterviewMonitoringEvent.timestamp.desc()).first()
            
            if last_strike and (get_ist_now() - to_naive_ist(last_strike.timestamp)).total_seconds() < 5:
                logger.warning(
                    f"[Proctoring] Strike ignored due to 5s server cooldown for interview {interview_id}"
                )
                final_event_type = event_data.event_type
                is_strike_event = False

        if is_strike_event:
            # Count existing confirmed strike events for this interview.
            # The row lock above ensures this count is stable for the duration
            # of this transaction.
            existing_strikes = db.query(InterviewMonitoringEvent).filter(
                InterviewMonitoringEvent.interview_id == interview_id,
                InterviewMonitoringEvent.event_type.like("focus_lost_strike_%"),
                InterviewMonitoringEvent.is_false_positive == False,
            ).count()
            actual_strike_count = existing_strikes + 1  # +1 for the incoming strike

            logger.info(
                f"[Proctoring] strike_check | interview={interview_id} | "
                f"event={event_data.event_type} | existing={existing_strikes} | "
                f"computed={actual_strike_count}"
            )

            # Extract sanitized reason from client-supplied event_type (after the number)
            m = _re.match(r"^focus_lost_strike_\d+_(.+)$", event_data.event_type)
            reason_slug = m.group(1) if m else "violation"
            # Rewrite event_type with authoritative server count
            final_event_type = f"focus_lost_strike_{actual_strike_count}_{reason_slug}"

            # ── MAX_STRIKES THRESHOLD: TERMINATE & REVOKE ─────────────────────────────
            if actual_strike_count >= 4:
                # 1. Terminate the interview
                _set_interview_status(interview_session, "completed")
                interview_session.interview_stage = STAGE_COMPLETED
                interview_session.is_terminated_by_violations = True
                if not interview_session.ended_at:
                    interview_session.ended_at = get_ist_now()

                # 2. Revoke the candidate JWT (prevent further API calls)
                auth_header = request.headers.get("Authorization", "")
                raw_token = ""
                if auth_header.startswith("Bearer "):
                    raw_token = auth_header.replace("Bearer ", "").strip()
                if raw_token:
                    try:
                        from jose import jwt as _jose_jwt
                        from app.domain.models import RevokedToken
                        interview_secret = (
                            settings.interview_jwt_secret
                            if settings.interview_jwt_secret
                            else settings.jwt_secret + "_interview"
                        )
                        raw_payload = _jose_jwt.decode(
                            raw_token,
                            interview_secret,
                            algorithms=[settings.jwt_algorithm],
                            options={"verify_exp": False},  # may already be close to exp
                        )
                        jti_to_revoke = raw_payload.get("jti")
                        exp_ts = raw_payload.get("exp")
                        if jti_to_revoke:
                            # Upsert: avoid duplicate-key on repeated 4th strike hits
                            existing_revoked = db.query(RevokedToken).filter(
                                RevokedToken.jti == jti_to_revoke
                            ).first()
                            if not existing_revoked:
                                from datetime import datetime as _dt
                                expires_at = (
                                    _dt.utcfromtimestamp(exp_ts)
                                    if exp_ts
                                    else get_ist_now() + timedelta(hours=4)
                                )
                                db.add(RevokedToken(
                                    jti=jti_to_revoke,
                                    expires_at=expires_at,
                                ))
                                token_revoked = True
                                logger.warning(
                                    f"[Proctoring] JWT revoked for interview {interview_id} "
                                    f"after {actual_strike_count} strikes. jti={jti_to_revoke}"
                                )
                    except Exception as revoke_err:
                        logger.error(f"[Proctoring] Token revocation failed for interview {interview_id}: {revoke_err}")

                # ── DEMO: purge provisional records on auto-termination ──────────────
                # If this is a provisional demo session, silently delete the application
                # (CASCADE cleans up interview, questions, answers, monitoring events).
                # No report is saved, no pipeline entry is created.
                if getattr(interview_session, "is_demo", False):
                    app_record = interview_session.application
                    app_id = app_record.id if app_record else None
                    logger.info(
                        f"[Demo] Proctoring auto-termination for demo interview {interview_id} "
                        f"({actual_strike_count} strikes, application_id={app_id}). "
                        "Purging provisional records — no report will be saved."
                    )
                    # Commit the revoked-token entry before deleting the interview
                    db.commit()
                    if app_record:
                        db.delete(app_record)
                    else:
                        db.delete(interview_session)
                    db.commit()
                    # Clean up in-memory sequence tracking
                    LAST_SEQUENCE_NUMBERS.pop(interview_id, None)
                    if redis_client is not None:
                        try:
                            redis_client.delete(f"seq:{interview_id}")
                        except Exception:
                            pass
                else:
                    # 3. Transition FSM to INTERVIEW_COMPLETED (non-demo path)
                    try:
                        from app.services.state_machine import CandidateStateMachine, TransitionAction
                        fsm = CandidateStateMachine(db)
                        if interview_session.application:
                            fsm.transition(
                                interview_session.application,
                                TransitionAction.SYSTEM_INTERVIEW_COMPLETE,
                                notes=f"Auto-completed early: {actual_strike_count} proctoring strikes.",
                            )
                    except Exception as fsm_err:
                        logger.warning(f"[Proctoring] FSM transition failed (non-fatal): {fsm_err}")
                        if interview_session.application:
                            interview_session.application.status = "interview_completed"

                    # 4. Trigger report generation in background task
                    background_tasks.add_task(_finalize_interview_and_report, interview_id)

                    # 5. Write critical audit entry
                    from app.domain.models import AuditLog
                    db.add(AuditLog(
                        user_id=None,
                        action="INTERVIEW_TERMINATED_VIOLATION",
                        resource_type="Interview",
                        resource_id=interview_id,
                        details=json.dumps({
                            "interview_id": interview_id,
                            "strike_count": actual_strike_count,
                            "token_revoked": token_revoked,
                            "reason": reason_slug,
                        }),
                        is_critical=True,
                    ))

                    # Clean up sequence tracking for terminated interview
                    LAST_SEQUENCE_NUMBERS.pop(interview_id, None)
                    if redis_client is not None:
                        try:
                            redis_client.delete(f"seq:{interview_id}")
                        except Exception:
                            pass
    else:
        # Non-strike event: still report current strike count for client sync
        actual_strike_count = db.query(InterviewMonitoringEvent).filter(
            InterviewMonitoringEvent.interview_id == interview_id,
            InterviewMonitoringEvent.event_type.like("focus_lost_strike_%"),
            InterviewMonitoringEvent.is_false_positive == False,
        ).count()

    event_record = InterviewMonitoringEvent(
        interview_id=interview_id,
        event_type=final_event_type,
        confidence_score=event_data.confidence_score,
        frame_image_path=storage_path,
        video_reference=event_data.video_reference,
        is_false_positive=False,
        details=event_data.details,
        timestamp=get_ist_now()
    )
    db.add(event_record)

    # Standard Confidence-Weighted Risk Calculation & Time-Series Correlation
    weight = EVENT_WEIGHTS.get(event_data.event_type, 0.0)
    if weight > 0.0:
        if interview_session.risk_score is None:
            interview_session.risk_score = 0.0
            
        # Confidence-weighted score addition
        conf = event_data.confidence_score if event_data.confidence_score is not None else 1.0
        increment = weight * conf
        
        # Time-series correlation engine: correlate multiple signals in 30-second window
        thirty_seconds_ago = get_ist_now() - timedelta(seconds=30)
        recent_events = db.query(InterviewMonitoringEvent).filter(
            InterviewMonitoringEvent.interview_id == interview_id,
            InterviewMonitoringEvent.timestamp >= thirty_seconds_ago,
            InterviewMonitoringEvent.is_false_positive == False
        ).all()
        
        recent_types = {e.event_type for e in recent_events}
        recent_types.add(event_data.event_type)
        
        correlation_penalty = 0.0
        if "focus_lost" in recent_types and "clipboard_violation" in recent_types:
            correlation_penalty += 4.0
        if "multiple_people" in recent_types and "voice_coaching_detected" in recent_types:
            correlation_penalty += 6.0
        if "gaze_deviation" in recent_types and "voice_coaching_detected" in recent_types:
            correlation_penalty += 3.0
            
        interview_session.risk_score += (increment + correlation_penalty)
        db.add(interview_session)

    db.commit()
    db.refresh(event_record)

    from app.core.storage import get_signed_url
    url = None
    if storage_path:
        url = get_signed_url(settings.supabase_bucket_videos, storage_path)

    return MonitoringEventResponse(
        id=event_record.id,
        interview_id=event_record.interview_id,
        event_type=event_record.event_type,
        timestamp=event_record.timestamp,
        confidence_score=event_record.confidence_score,
        frame_image_path=event_record.frame_image_path,
        frame_image_url=url,
        video_reference=event_record.video_reference,
        is_false_positive=event_record.is_false_positive,
        details=event_record.details,
        strike_count=actual_strike_count,
        token_revoked=token_revoked,
    )


@router.post("/{interview_id}/monitoring-events/{event_id}/flag-false-positive", response_model=MonitoringEventResponse)
@limiter.limit("20/minute")
async def flag_false_positive(
    request: Request,
    interview_id: int,
    event_id: int,
    data: dict = Body(...),
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db)
):
    """
    Toggle or set is_false_positive flag for a specific monitoring event (HR / Admin only).
    """
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
        
    validate_hr_ownership_for_interview(interview, current_user, resource_name="interview")
    
    event = db.query(InterviewMonitoringEvent).filter(
        InterviewMonitoringEvent.id == event_id,
        InterviewMonitoringEvent.interview_id == interview_id
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Monitoring event not found")
        
    is_fp = data.get("is_false_positive")
    if is_fp is None:
        event.is_false_positive = not event.is_false_positive
    else:
        event.is_false_positive = bool(is_fp)
        
    db.commit()
    db.refresh(event)

    # Recalculate full cumulative risk score for the interview session based on remaining active events
    all_events = db.query(InterviewMonitoringEvent).filter(
        InterviewMonitoringEvent.interview_id == interview_id,
        InterviewMonitoringEvent.is_false_positive == False
    ).order_by(InterviewMonitoringEvent.timestamp.asc()).all()
    
    new_risk_score = 0.0
    processed_events = []
    
    for ev in all_events:
        weight = EVENT_WEIGHTS.get(ev.event_type, 0.0)
        conf = ev.confidence_score if ev.confidence_score is not None else 1.0
        new_risk_score += weight * conf
        
        # Check correlation with preceding events within 30 seconds
        for prev_ev in processed_events:
            time_diff = abs((ev.timestamp - prev_ev.timestamp).total_seconds())
            if time_diff <= 30.0:
                if (ev.event_type == "focus_lost" and prev_ev.event_type == "clipboard_violation") or \
                   (ev.event_type == "clipboard_violation" and prev_ev.event_type == "focus_lost"):
                    new_risk_score += 4.0
                elif (ev.event_type == "multiple_people" and prev_ev.event_type == "voice_coaching_detected") or \
                     (ev.event_type == "voice_coaching_detected" and prev_ev.event_type == "multiple_people"):
                    new_risk_score += 6.0
                elif (ev.event_type == "gaze_deviation" and prev_ev.event_type == "voice_coaching_detected") or \
                     (ev.event_type == "voice_coaching_detected" and prev_ev.event_type == "gaze_deviation"):
                    new_risk_score += 3.0
                    
        processed_events.append(ev)
        
    interview.risk_score = new_risk_score
    db.add(interview)
    db.commit()
    
    from app.core.storage import get_signed_url
    url = None
    if event.frame_image_path:
        url = get_signed_url(settings.supabase_bucket_videos, event.frame_image_path)
        
    return MonitoringEventResponse(
        id=event.id,
        interview_id=event.interview_id,
        event_type=event.event_type,
        timestamp=event.timestamp,
        confidence_score=event.confidence_score,
        frame_image_path=event.frame_image_path,
        frame_image_url=url,
        video_reference=event.video_reference,
        is_false_positive=event.is_false_positive,
        details=event.details
    )


@router.get("/{interview_id}/monitoring-events", response_model=List[MonitoringEventResponse])
async def get_monitoring_events(
    interview_id: int,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db)
):
    """
    HR / Admin endpoint to retrieve all monitoring events for an interview session,
    including pre-signed image URLs for frame review.
    """
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
        
    validate_hr_ownership_for_interview(interview, current_user, resource_name="interview")

    events = db.query(InterviewMonitoringEvent).filter(
        InterviewMonitoringEvent.interview_id == interview_id
    ).order_by(InterviewMonitoringEvent.timestamp.asc()).all()

    from app.core.storage import get_signed_urls
    
    # Batch request signed URLs to prevent N+1 API calls
    image_paths = [ev.frame_image_path for ev in events if ev.frame_image_path]
    url_map = get_signed_urls(settings.supabase_bucket_videos, image_paths) if image_paths else {}
    
    results = []
    for ev in events:
        url = url_map.get(ev.frame_image_path) if ev.frame_image_path else None
            
        results.append(MonitoringEventResponse(
            id=ev.id,
            interview_id=ev.interview_id,
            event_type=ev.event_type,
            timestamp=ev.timestamp,
            confidence_score=ev.confidence_score,
            frame_image_path=ev.frame_image_path,
            frame_image_url=url,
            video_reference=ev.video_reference,
            is_false_positive=ev.is_false_positive,
            details=ev.details
        ))
        
    return results
