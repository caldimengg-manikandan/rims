from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Request
from typing import Optional, List, Any
from sqlalchemy.orm import Session
from app.infrastructure.database import get_db
from app.domain.models import User, Job, Application, JobVersion
from app.domain.schemas import JobCreate, JobUpdate, JobResponse, JobExtractionResponse, JobPublicResponse
from app.core.auth import get_current_hr
from app.core.ownership import validate_hr_ownership
from app.core.rate_limiter import limiter
from app.services.ai_service import extract_job_details
from app.services.resume_parser import parse_resume
from app.core.config import get_settings
from app.core.idempotency import is_duplicate_request
from app.core.observability import get_request_id, log_json, safe_hash
import json
import os
import uuid
from pathlib import Path
from datetime import datetime, timedelta, timezone
from sqlalchemy.exc import IntegrityError
import logging
import re
from app.core.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/jobs", tags=["jobs"])
settings = get_settings()

VALID_INTERVIEW_MODES = {"ai", "upload", "mixed"}
ALLOWED_QUESTION_EXTENSIONS = {".txt", ".pdf", ".docx"}
ALLOWED_QUESTION_MIMES = {
    "text/plain", 
    "application/pdf", 
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
}
ALLOWED_APTITUDE_EXTENSIONS = {".txt", ".pdf", ".docx"}
MAX_QUESTION_FILE_SIZE = 5 * 1024 * 1024  # 5MB


def generate_unique_job_id(db: Session) -> str:
    """Generate a unique job ID in the format JOB-XXXXXX"""
    while True:
        import random
        import string
        suffix = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
        job_id = f"JOB-{suffix}"
        
        # Check if already exists
        exists = db.query(Job).filter(Job.job_id == job_id).first()
        if not exists:
            return job_id


def _validate_job_content(title: str, description: str, db: Session = None, current_job_id: int = None):
    """
    Validate job title and description. 
    Prevents symbol-only, numeric-only, and mixed invalid characters.
    """
    if not title or not title.strip():
        raise HTTPException(status_code=400, detail="Job Title is required.")

    title_trimmed = title.strip()

    # JP004 + H012–H016 (Title validation)
    # - Must contain at least 1 alphabet
    # - Allowed: letters, numbers, spaces, and basic symbols: - , . ( ) /
    # - Length: 3–100
    # - Reject repeated special chars (>3 in a row)
    if len(title_trimmed) < 3 or len(title_trimmed) > 100:
        log_json(logger, "validation_failed", level="warning", extra={"module": "jobs", "field": "title", "reason": "length_out_of_range", "input_preview": title_trimmed[:32]})
        raise HTTPException(status_code=400, detail="Job title must contain meaningful text with alphabets")

    if not any(c.isalpha() for c in title_trimmed):
        log_json(logger, "validation_failed", level="warning", extra={"module": "jobs", "field": "title", "reason": "no_alphabet", "input_preview": title_trimmed[:32]})
        raise HTTPException(status_code=400, detail="Job title must contain at least some letters (alphabets).")

    # Allow: letters, numbers, spaces, and common symbols: - , . ( ) / : & ! ? @ # _ + * = % [ ]
    if not re.match(r'^[A-Za-z0-9\s\-\.,\(\)\/\:\&\!\?\@\#\_\+\*\=\%\[\]]+$', title_trimmed):
        log_json(logger, "validation_failed", level="warning", extra={"module": "jobs", "field": "title", "reason": "invalid_characters", "input_preview": title_trimmed[:32]})
        raise HTTPException(status_code=400, detail="Job title contains unsupported special characters. Please use standard letters, numbers, and symbols.")

    if re.search(r'([\-.,\(\)\/\:\&\!\?\@\#\_\+\*\=\%\[\]])\1{3,}', title_trimmed):
        log_json(logger, "validation_failed", level="warning", extra={"module": "jobs", "field": "title", "reason": "repeated_special_chars", "input_preview": title_trimmed[:32]})
        raise HTTPException(status_code=400, detail="Job title contains too many repeated special characters.")

    # Description validation (JP004)
    if not description or not description.strip():
        raise HTTPException(status_code=400, detail="Job Description is required.")
    
    desc_trimmed = description.strip()

    # Description validation (JP004)
    # Keep this intentionally permissive to avoid breaking existing flows:
    # require meaningful alphabetic content + minimum length.
    if len(desc_trimmed) < 10:
        log_json(logger, "validation_failed", level="warning", extra={"module": "jobs", "field": "description", "reason": "too_short", "input_preview": desc_trimmed[:32]})
        raise HTTPException(status_code=400, detail="Description must contain meaningful text (minimum 10 characters)")

    if not any(c.isalpha() for c in desc_trimmed):
        log_json(logger, "validation_failed", level="warning", extra={"module": "jobs", "field": "description", "reason": "no_alphabet", "input_preview": desc_trimmed[:32]})
        raise HTTPException(status_code=400, detail="Description must contain meaningful text")

    if re.search(r'([\-.,\(\)\/])\1{3,}', desc_trimmed):
        log_json(logger, "validation_failed", level="warning", extra={"module": "jobs", "field": "description", "reason": "repeated_special_chars", "input_preview": desc_trimmed[:32]})
        raise HTTPException(status_code=400, detail="Description must contain meaningful text")


def _validate_interview_pipeline(job_data, experience_level: str):
    """
    Validate interview pipeline fields and return sanitized values.
    Raises HTTPException(400) on invalid combinations.
    """
    aptitude_enabled = getattr(job_data, 'aptitude_enabled', False) or False
    # Auto-enable first_level if an interview mode is selected
    interview_mode = getattr(job_data, 'interview_mode', None)
    initial_first_level = getattr(job_data, 'first_level_enabled', None)
    
    first_level_enabled = initial_first_level
    if first_level_enabled is None:
        first_level_enabled = True if interview_mode else False
    
    # If a valid mode is picked, force first_level to True (UX sanity)
    if interview_mode in VALID_INTERVIEW_MODES:
        first_level_enabled = True
    uploaded_question_file = getattr(job_data, 'uploaded_question_file', None)
    aptitude_config = getattr(job_data, 'aptitude_config', None)

    # Rule 1: aptitude_enabled only allowed for junior and intern
    if aptitude_enabled and experience_level not in ["junior", "intern"]:
        raise HTTPException(
            status_code=400,
            detail="Aptitude round is only available for Junior (0-2 years) or Intern experience levels."
        )

    # Rule 2: If first_level_enabled, interview_mode must be valid
    if first_level_enabled:
        if interview_mode not in VALID_INTERVIEW_MODES:
            raise HTTPException(
                status_code=400,
                detail=f"When First Level Interview is enabled, interview_mode must be one of: {', '.join(VALID_INTERVIEW_MODES)}."
            )
    else:
        # Rule 3: If first_level disabled, force nulls
        interview_mode = None
        uploaded_question_file = None

    # Rule 4: If mode is AI only, clear the file (Upload and Mixed modes retain uploaded files)
    if interview_mode == "ai":
        uploaded_question_file = None

    # Rule 5: If mode is upload or mixed, file OR repo_set_id is required
    if interview_mode == "upload" or interview_mode == "mixed":
        technical_repo_set_id = getattr(job_data, 'technical_repo_set_id', None)
        if not uploaded_question_file and not technical_repo_set_id:
            raise HTTPException(
                status_code=400,
                detail=f"When interview mode is '{interview_mode}', either upload a question file or select a repository set."
            )

    return {
        "aptitude_enabled": aptitude_enabled,
        "first_level_enabled": first_level_enabled,
        "interview_mode": interview_mode,
        "uploaded_question_file": uploaded_question_file,
        "aptitude_config": aptitude_config,
        "aptitude_questions_file": getattr(job_data, 'aptitude_questions_file', None),
        "aptitude_mode": getattr(job_data, 'aptitude_mode', "ai"),
        "behavioral_role": getattr(job_data, 'behavioral_role', "general"),
        "duration_minutes": getattr(job_data, 'duration_minutes', 60) or 60,
        "aptitude_repo_set_id": getattr(job_data, 'aptitude_repo_set_id', None),
        "technical_repo_set_id": getattr(job_data, 'technical_repo_set_id', None),
        "behavioural_repo_set_id": getattr(job_data, 'behavioural_repo_set_id', None),
    }


@router.post("/upload-questions")
async def upload_question_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_hr),
):
    """Upload a question file (.txt, .pdf, .docx). Returns the stored file path."""
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="No file provided.")

    # Validate extension and MIME type
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_QUESTION_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file extension '{ext}'. Allowed: {', '.join(ALLOWED_QUESTION_EXTENSIONS)}"
        )
    if file.content_type not in ALLOWED_QUESTION_MIMES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid MIME type '{file.content_type}'. File contents do not match extension."
        )

    # Validate file size (read content to check)
    content = await file.read()
    if len(content) > MAX_QUESTION_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size is {MAX_QUESTION_FILE_SIZE // (1024*1024)}MB."
        )

    # Sanitize filename: use UUID to prevent path traversal and collisions
    safe_name = f"{uuid.uuid4().hex}{ext}"
    # Upload to Supabase Storage
    path = f"questions/{safe_name}"
    from app.core.storage import upload_file
    upload_file(settings.supabase_bucket_resumes, path, content, content_type=file.content_type)
    
    return {"file_path": path, "original_name": file.filename}


@router.post("/upload-aptitude-questions")
async def upload_aptitude_questions(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_hr)
):
    """
    Upload an Excel (.xlsx) file containing aptitude questions.
    Expects columns: 'Question', 'Answer', and optionally 'Options'
    """
    # Accept excel files
    if not file:
        raise HTTPException(status_code=400, detail="No file uploaded")

    filename = file.filename.lower()
    ext = os.path.splitext(filename)[1]
    
    # We only accept excel mode for the new spec
    if ext not in [".xlsx", ".xls"]:
         raise HTTPException(status_code=400, detail="Only Excel (.xlsx/.xls) capabilities are accepted.")
         
    ALLOWED_EXCEL_MIMES = {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 
        "application/vnd.ms-excel",
        "application/wps-office.xlsx"
    }
    if file.content_type not in ALLOWED_EXCEL_MIMES:
        raise HTTPException(status_code=400, detail=f"Invalid MIME type '{file.content_type}'. File is not a valid Excel document.")
    
    content = await file.read()
    if len(content) > MAX_QUESTION_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size is {MAX_QUESTION_FILE_SIZE // (1024*1024)}MB."
        )
        
    # Validate magic bytes for XLSX
    if ext == ".xlsx" and not content.startswith(b"PK\x03\x04"):
        raise HTTPException(status_code=400, detail="Invalid Excel file. File signature does not match.")
    try:
        import pandas as pd
        import io
        
        df = pd.read_excel(io.BytesIO(content))
        
        # Normalize columns to lowercase for robust matching
        df.columns = [str(c).strip().lower() for c in df.columns]
        
        # Validate columns (case-insensitive)
        required_cols = ['question', 'answer']
        missing = [col for col in required_cols if col not in df.columns]
        if missing:
             raise HTTPException(status_code=400, detail=f"Missing required columns (case-insensitive): {', '.join(missing)}\nFound columns: {list(df.columns)}")
        
        questions = []
        for index, row in df.iterrows():
            q_text = str(row['question']).strip()
            answer = str(row['answer']).strip()
            
            if not q_text or q_text == 'nan' or q_text == '':
                 continue
                 
            if not answer or answer == 'nan' or answer == '':
                 continue
            
            # Normalize float representation of numbers (e.g. "1.0" -> "1")
            try:
                val = float(answer)
                if val.is_integer():
                    answer = str(int(val))
                else:
                    answer = str(val)
            except ValueError:
                pass
                 
            q_dict = {
                "question": q_text,
                "answer": answer
            }
            if 'options' in df.columns and pd.notna(row['options']):
                 q_dict["options"] = [opt.strip() for opt in str(row['options']).split(',') if opt.strip()]
                 
            questions.append(q_dict)
            
    except Exception as e:
        if isinstance(e, HTTPException):
             raise e
        raise HTTPException(status_code=400, detail=f"Could not parse Excel file: {str(e)}")

    if len(questions) < 1:
        raise HTTPException(
            status_code=400,
            detail="No valid questions found in the uploaded file."
        )

    # Save as JSON for _generate_aptitude_questions to consume
    safe_name = f"{uuid.uuid4().hex}.json"
    path = f"aptitude_questions/{safe_name}"
    
    import json as json_mod
    questions_json = json_mod.dumps(questions, ensure_ascii=False, indent=2)
    from app.core.storage import upload_file
    upload_file(settings.supabase_bucket_resumes, path, questions_json.encode("utf-8"), content_type="application/json")

    return {
        "file_path": path,
        "original_name": file.filename,
        "questions_count": len(questions),
    }


@router.post("/extract", response_model=JobExtractionResponse)
@limiter.limit("10/minute")
async def extract_job(
    request: Request,
    text_content: str = Form(None),
    file: UploadFile = File(None),
    current_user: User = Depends(get_current_hr)
):
    """Extract job details from text or PDF using AI"""
    content = ""
    
    if file and file.filename:
        content = parse_resume(file)
    elif text_content:
        content = text_content
        
    if not content or len(content.strip()) < 10:
        raise HTTPException(status_code=400, detail="Please provide job description text or upload a valid file.")
        
    extracted_data = await extract_job_details(content)
    warnings = []
    pe = extracted_data.get("primary_evaluated_skills") or []
    if not pe:
        warnings.append(
            "AI did not return primary evaluated skills. Add them manually for stronger interview targeting."
        )
    return {**extracted_data, "warnings": warnings}

@router.post("", response_model=JobResponse)
def create_job(
    request: Request,
    job_data: JobCreate,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db)
):
    """Create a new job posting (HR only)"""
    request_id = request.headers.get("X-Request-ID") or get_request_id(request)
    normalized_title_key = (job_data.title or "").strip().lower()[:180]
    idempotency_key = f"hr:{current_user.id}:title:{normalized_title_key}"
    if settings.enable_request_id_idempotency and is_duplicate_request(
        request_id=request_id,
        scope="jobs.create",
        key=idempotency_key,
        ttl_seconds=45,
    ):
        from app.core.timezone import get_ist_now
        recent_dup = (
            db.query(Job)
            .filter(
                Job.hr_id == current_user.id,
                Job.title.ilike((job_data.title or "").strip()),
                Job.created_at >= get_ist_now() - timedelta(seconds=90),
            )
            .order_by(Job.id.desc())
            .first()
        )
        if recent_dup:
            log_json(
                logger,
                "job_create_idempotent_replay",
                level="info",
                request_id=request_id,
                endpoint="/api/jobs",
                user_id=current_user.id,
                extra={"existing_job_id": recent_dup.id, "title_hash": safe_hash(job_data.title)},
            )
            return recent_dup
        raise HTTPException(status_code=409, detail="Duplicate create job request detected. Please retry in a moment.")

    # Use centralized validation
    _validate_job_content(job_data.title, job_data.description, db)
    pipeline = _validate_interview_pipeline(job_data, job_data.experience_level)

    description = job_data.description
    if getattr(job_data, "requirements", None):
        # Persist requirements inside the job description so AI question generation
        # has access to a single consolidated narrative.
        description = f"{description}\n\nRequirements:\n{job_data.requirements}"

    # Duration limit (H024)
    if job_data.duration_minutes is not None and job_data.duration_minutes < 1:
        raise HTTPException(status_code=400, detail="Interview duration must be at least 1 minute.")
    if job_data.duration_minutes and job_data.duration_minutes > 300:
        raise HTTPException(
            status_code=400,
            detail="Max allowed interview duration is 300 minutes."
        )

    # Generate unique Job ID
    job_identifier = generate_unique_job_id(db)

    # Lightweight race-condition duplicate protection (non-breaking):
    # same HR + same normalized title in very short recent window.
    recent_window = datetime.now(timezone.utc).timestamp() - 10
    normalized_title = (job_data.title or "").strip().lower()
    same_recent = db.query(Job).filter(
        Job.hr_id == current_user.id,
        Job.title.ilike(normalized_title),
        Job.created_at >= datetime.fromtimestamp(recent_window, tz=timezone.utc)
    ).order_by(Job.id.desc()).first()
    if same_recent:
        log_json(
            logger,
            "idempotent_job_reuse",
            level="warning",
            request_id=request_id,
            endpoint="/api/jobs",
            user_id=current_user.id,
            extra={"existing_job_id": same_recent.id, "title_hash": safe_hash(job_data.title)},
        )
        return same_recent

    new_job = Job(
        job_id=job_identifier,
        interview_token=uuid.uuid4().hex,
        title=job_data.title,
        description=description,
        experience_level=job_data.experience_level,
        hr_id=current_user.id,
        location=job_data.location,
        mode_of_work=job_data.mode_of_work,
        job_type=job_data.job_type,
        domain=job_data.domain,
        primary_evaluated_skills=json.dumps(job_data.primary_evaluated_skills) if job_data.primary_evaluated_skills else None,
        # Interview pipeline
        aptitude_enabled=pipeline["aptitude_enabled"],
        aptitude_mode=pipeline["aptitude_mode"] or "ai",
        first_level_enabled=pipeline["first_level_enabled"],
        interview_mode=pipeline["interview_mode"],
        behavioral_role=pipeline["behavioral_role"] or "general",
        uploaded_question_file=pipeline["uploaded_question_file"],
        aptitude_config=pipeline["aptitude_config"],
        aptitude_questions_file=pipeline["aptitude_questions_file"],
        duration_minutes=pipeline["duration_minutes"],
        # Repository question sets
        aptitude_repo_set_id=pipeline.get("aptitude_repo_set_id"),
        technical_repo_set_id=pipeline.get("technical_repo_set_id"),
        behavioural_repo_set_id=pipeline.get("behavioural_repo_set_id"),
    )
    
    try:
        db.add(new_job)
        db.commit()
        db.refresh(new_job)

        log_json(
            logger,
            "job_created",
            level="info",
            extra={
                "job_id": new_job.id,
                "title": new_job.title,
                "interview_mode": new_job.interview_mode,
                "aptitude_repo_set_id": new_job.aptitude_repo_set_id,
                "technical_repo_set_id": new_job.technical_repo_set_id,
                "behavioural_repo_set_id": new_job.behavioural_repo_set_id,
                "uploaded_question_file": new_job.uploaded_question_file,
            },
        )
        
        # ── Phase 6: Critical Audit Logging ──
        from app.services.candidate_service import CandidateService
        cand_service = CandidateService(db)
        cand_service.create_audit_log(current_user.id, "JOB_CREATED", "Job", new_job.id, {"title": new_job.title}, is_critical=True)
        db.commit() # Ensure log is persisted

        # ── LinkedIn Auto-Post (non-blocking, optional) ──────────────────────
        # Runs AFTER full DB commit. Any failure is caught inside the service
        # and logged — job creation always succeeds regardless.
        from app.services.linkedin_service import post_job_to_linkedin
        post_job_to_linkedin(
            job_id=new_job.job_id,
            title=new_job.title,
            location=new_job.location,
            experience_level=new_job.experience_level,
            frontend_base_url=settings.frontend_base_url,
            db=db,
        )
        # ─────────────────────────────────────────────────────────────────────

        return new_job
    except IntegrityError:
        db.rollback()
        # Clean up cloud files if they were uploaded
        from app.core.storage import delete_file
        for f_path in [new_job.uploaded_question_file, new_job.aptitude_questions_file]:
            if f_path:
                delete_file(settings.supabase_bucket_resumes, f_path)
        raise HTTPException(status_code=409, detail="Failed to create job due to ID collision. Please try submitting again.")
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating job: {e}")
        # Clean up cloud files if they were uploaded
        from app.core.storage import delete_file
        for f_path in [new_job.uploaded_question_file, new_job.aptitude_questions_file]:
            if f_path:
                delete_file(settings.supabase_bucket_resumes, f_path)
        raise HTTPException(status_code=500, detail="Failed to create job safely")

def _clamp_pagination(*, skip: int, limit: Optional[int], default_limit: int = 100, max_limit: int = 200) -> tuple[int, int]:
    s = max(0, int(skip or 0))
    lim = int(limit) if limit is not None else default_limit
    if lim <= 0:
        lim = default_limit
    lim = min(max_limit, lim)
    return s, lim


@router.get("/public", response_model=list[JobPublicResponse])
def list_public_jobs(
    search: Optional[str] = None,
    skip: int = 0,
    limit: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """List open and closed jobs (Public endpoint). Use skip/limit for pagination (default limit 100, max 200)."""
    query = db.query(Job).filter(Job.status.in_(["open", "closed"]))

    if search:
        from sqlalchemy import or_
        search_term = f"%{search}%"
        # Ensure job search performs case-insensitive partial matching across title, description, and keywords
        query = query.filter(or_(
            Job.title.ilike(search_term),
            Job.domain.ilike(search_term),
            Job.primary_evaluated_skills.ilike(search_term),
            Job.experience_level.ilike(search_term),
            Job.location.ilike(search_term),
            Job.job_id.ilike(search_term),
        ))

    s, lim = _clamp_pagination(skip=skip, limit=limit, max_limit=200)
    jobs = query.order_by(Job.created_at.desc(), Job.id.desc()).offset(s).limit(lim).all()
    return jobs

@router.get("", response_model=list[JobResponse])
def list_jobs(
    status: str = None,
    skip: int = 0,
    limit: Optional[int] = None,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db)
):
    """List jobs for the HR user (paginated; default limit 100, max 200)."""
    query = db.query(Job)
    # Apply visibility isolation: Anyone not a super_admin is restricted to their own jobs
    if current_user.role.lower() not in ["super_admin", "admin"]:
        query = query.filter(Job.hr_id == current_user.id)

    # Apply optional status filter
    if status and status not in ("all", ""):
        query = query.filter(Job.status == status)

    s, lim = _clamp_pagination(skip=skip, limit=limit, default_limit=200, max_limit=500)
    jobs = query.order_by(Job.created_at.desc(), Job.id.desc()).offset(s).limit(lim).all()
    return jobs

@router.get("/public/{job_id}", response_model=JobPublicResponse)
def get_public_job(
    job_id: str,
    db: Session = Depends(get_db)
):
    """Get open/closed job details (Public endpoint). Supports numeric ID or JOB- identifier."""
    # Try numeric ID first if job_id is all digits
    job = None
    if job_id.isdigit():
        job = db.query(Job).filter(Job.id == int(job_id), Job.status.in_(["open", "closed"])).first()
    
    # If not found by numeric ID, try the string job_id (identifier)
    if not job:
        job = db.query(Job).filter(Job.job_id == job_id, Job.status.in_(["open", "closed"])).first()
    
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found or not open/closed"
        )
    
    return job

@router.get("/{job_id}", response_model=JobResponse)
def get_job(
    job_id: str,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db)
):
    """Get job details (HR only). Supports numeric ID or JOB- identifier."""
    job = None
    if job_id.isdigit():
        job = db.query(Job).filter(Job.id == int(job_id)).first()
    
    if not job:
        job = db.query(Job).filter(Job.job_id == job_id).first()
    
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found"
        )
    validate_hr_ownership(job, current_user, resource_name="job")
    return job

@router.put("/{job_id}", response_model=JobResponse)
def update_job(
    job_id: int,
    job_data: JobUpdate,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db)
):
    """Update job (HR only)"""
    job = db.query(Job).filter(Job.id == job_id).first()
    
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found"
        )
    validate_hr_ownership(job, current_user, resource_name="job")
    
    _validate_job_content(
        job_data.title or job.title, 
        job_data.description or job.description, 
        db, 
        job_id
    )

    # ── Phase 3: Versioning (Save snapshot before update) ──
    try:
        current_version_count = db.query(JobVersion).filter(JobVersion.job_id == job.id).count()
        new_version = JobVersion(
            job_id=job.id,
            version_number=current_version_count + 1,
            title=job.title,
            description=job.description,
            primary_evaluated_skills=job.primary_evaluated_skills,
            experience_level=job.experience_level
        )
        db.add(new_version)
        # We don't commit yet; it will commit with the job update.
    except Exception as e:
        logger.warning(f"Failed to create job version snapshot: {e}")

    # Duration limit (H024)
    if job_data.duration_minutes is not None and job_data.duration_minutes < 1:
        raise HTTPException(status_code=400, detail="Interview duration must be at least 1 minute.")
    if job_data.duration_minutes and job_data.duration_minutes > 300:
        raise HTTPException(
            status_code=400,
            detail="Max allowed interview duration is 300 minutes."
        )

    # Update standard fields
    if job_data.title:
        job.title = job_data.title
    if job_data.description:
        job.description = job_data.description
    if job_data.experience_level:
        job.experience_level = job_data.experience_level
    if job_data.location:
        job.location = job_data.location
    if job_data.mode_of_work:
        job.mode_of_work = job_data.mode_of_work
    if job_data.job_type:
        job.job_type = job_data.job_type
    if job_data.domain:
        job.domain = job_data.domain
    if job_data.status:
        if job_data.status == "closed" and job.status != "closed":
            from app.core.timezone import get_ist_now
            job.closed_at = get_ist_now()
        elif job_data.status != "closed":
            job.closed_at = None
        job.status = job_data.status
    if job_data.primary_evaluated_skills is not None:
        job.primary_evaluated_skills = json.dumps(job_data.primary_evaluated_skills)
    
    # Update interview pipeline fields if ANY pipeline field was sent
    pipeline_fields_sent = any([
        job_data.aptitude_enabled is not None,
        job_data.first_level_enabled is not None,
        job_data.interview_mode is not None,
        job_data.uploaded_question_file is not None,
        job_data.aptitude_config is not None,
        job_data.technical_repo_set_id is not None,
        job_data.aptitude_repo_set_id is not None,
        job_data.behavioural_repo_set_id is not None,
        job_data.behavioral_role is not None,
        job_data.aptitude_mode is not None,
    ])

    if pipeline_fields_sent:
        # Resolve effective experience level (could be changing in same request)
        effective_exp = job_data.experience_level or job.experience_level

        # Build a combined state using new values where provided, old values as fallback
        class _Combined:
            aptitude_enabled = job_data.aptitude_enabled if job_data.aptitude_enabled is not None else job.aptitude_enabled
            first_level_enabled = job_data.first_level_enabled if job_data.first_level_enabled is not None else job.first_level_enabled
            interview_mode = job_data.interview_mode if job_data.interview_mode is not None else job.interview_mode
            uploaded_question_file = job_data.uploaded_question_file if job_data.uploaded_question_file is not None else job.uploaded_question_file
            aptitude_config = job_data.aptitude_config
            duration_minutes = job_data.duration_minutes if job_data.duration_minutes is not None else job.duration_minutes
            technical_repo_set_id = job_data.technical_repo_set_id if job_data.technical_repo_set_id is not None else job.technical_repo_set_id
            aptitude_repo_set_id = job_data.aptitude_repo_set_id if job_data.aptitude_repo_set_id is not None else job.aptitude_repo_set_id
            behavioural_repo_set_id = job_data.behavioural_repo_set_id if job_data.behavioural_repo_set_id is not None else job.behavioural_repo_set_id
            behavioral_role = job_data.behavioral_role if job_data.behavioral_role is not None else job.behavioral_role
            aptitude_mode = job_data.aptitude_mode if getattr(job_data, "aptitude_mode", None) is not None else job.aptitude_mode
            aptitude_questions_file = job_data.aptitude_questions_file if job_data.aptitude_questions_file is not None else job.aptitude_questions_file

        pipeline = _validate_interview_pipeline(_Combined(), effective_exp)
        job.aptitude_enabled = pipeline["aptitude_enabled"]
        job.first_level_enabled = pipeline["first_level_enabled"]
        job.interview_mode = pipeline["interview_mode"]
        job.uploaded_question_file = pipeline["uploaded_question_file"]
        job.technical_repo_set_id = pipeline.get("technical_repo_set_id")
        job.aptitude_repo_set_id = pipeline.get("aptitude_repo_set_id")
        job.behavioural_repo_set_id = pipeline.get("behavioural_repo_set_id")
        job.behavioral_role = pipeline.get("behavioral_role") or "general"
        job.aptitude_mode = pipeline.get("aptitude_mode") or "ai"
        
        if pipeline["aptitude_config"] is not None:
            job.aptitude_config = pipeline["aptitude_config"]
        if pipeline["aptitude_questions_file"] is not None:
            job.aptitude_questions_file = pipeline["aptitude_questions_file"]
        if pipeline["duration_minutes"] is not None:
            job.duration_minutes = pipeline["duration_minutes"]
    elif job_data.duration_minutes is not None:
        # Duration-only update: safe to apply directly without pipeline validation
        job.duration_minutes = job_data.duration_minutes

    try:
        db.commit()
        db.refresh(job)
        return job
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to update job safely")

@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_job(
    job_id: int,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db)
):
    """Delete/Close job (HR only)"""
    job = db.query(Job).filter(Job.id == job_id).first()
    
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found"
        )
    validate_hr_ownership(job, current_user, resource_name="job")
    
    try:
        # Fetch all applications for this job
        applications = db.query(Application).filter(Application.job_id == job_id).all()
        
        # Log job deletion to audit log
        from app.services.candidate_service import CandidateService
        CandidateService(db).create_audit_log(
            current_user.id,
            "JOB_DELETED",
            "Job",
            job_id,
            {"title": job.title, "application_count": len(applications)},
            is_critical=True
        )
        
        for app in applications:
            # Delete related data for each application
            # Interviews
            if app.interview:
                # Delete interview questions and answers (if cascade doesn't handle it)
                for question in app.interview.questions:
                    for answer in question.answers:
                        db.delete(answer)
                    db.delete(question)
                if app.interview.report:
                    db.delete(app.interview.report)
                db.delete(app.interview)
            
            # Resume Extraction
            if app.resume_extraction:
                db.delete(app.resume_extraction)
                
            # Hiring Decision
            if app.hiring_decision:
                db.delete(app.hiring_decision)
            
            # Finally delete the application
            db.delete(app)
            
        # Clean up uploaded files from cloud
        from app.core.storage import delete_file
        for file_field in [job.aptitude_questions_file, job.uploaded_question_file]:
            if file_field:
                delete_file(settings.supabase_bucket_resumes, file_field)

        # Delete the job
        db.delete(job)
        db.commit()
    except Exception as e:
        db.rollback()
        logger.exception("Failed to delete job")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete job. Please try again."
        )
    return None
