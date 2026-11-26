from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload
from datetime import datetime, timezone
from typing import Optional
from pydantic import BaseModel
from app.infrastructure.database import get_db
from app.domain.models import User, Application, HiringDecision, Job, Interview, GlobalSettings
from app.domain.schemas import HiringDecisionMake, HiringDecisionResponse
from app.core.auth import get_current_user, get_current_hr
from app.core.ownership import validate_hr_ownership
from app.services.email_service import send_hired_email, send_rejected_email
import logging
from app.core.timezone import get_ist_now, to_naive_ist

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/decisions", tags=["hiring decisions"])
from fastapi import Request
from app.core.rate_limiter import limiter


from pydantic import BaseModel, Field, field_validator
from datetime import datetime

class HireRequest(BaseModel):
    joining_date: datetime
    notes: Optional[str] = Field(None, max_length=2000)

    @field_validator('joining_date')
    @classmethod
    def validate_joining_date(cls, v):
        if v.year < 2000 or v.year > 2100:
            raise ValueError('Year must be between 2000 and 2100')
        
        # LOW-02: Prevent selecting a past date
        v_naive = to_naive_ist(v)
        if v_naive.date() < get_ist_now().date():
            raise ValueError('Joining date cannot be in the past')
            
        return v

@router.put("/applications/{application_id}/decide", response_model=HiringDecisionResponse)
@limiter.limit("60/minute")
def make_hiring_decision(
    request: Request, application_id: int,
    decision_data: HiringDecisionMake,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db)
):
    """Make hiring decision (HR only) — uses FSM for state transitions."""
    from app.services.state_machine import (
        CandidateStateMachine, TransitionAction,
        InvalidTransitionError, DuplicateTransitionError,
        get_user_friendly_fsm_error,
    )
    
    """Make hiring decision (HR only)"""
    application = db.query(Application).filter(Application.id == application_id).with_for_update().first()
    
    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found"
        )
    validate_hr_ownership(application, current_user, resource_name="application")
    
    # Use FSM for state transition (Guards are centralized in CandidateStateMachine)
    fsm = CandidateStateMachine(db)
    action = TransitionAction.HIRE if decision_data.decision == "hired" else TransitionAction.REJECT
    
    try:
        result = fsm.transition(
            application=application,
            action=action,
            user_id=current_user.id,
            notes=decision_data.decision_comments,
        )
    except (InvalidTransitionError, DuplicateTransitionError) as e:
        raise HTTPException(status_code=400, detail=get_user_friendly_fsm_error(e))
    
    # Create decision record
    hiring_decision = HiringDecision(
        application_id=application_id,
        hr_id=current_user.id,
        decision=decision_data.decision,
        decision_comments=decision_data.decision_comments,
        decided_at=get_ist_now()
    )
    
    # Populate ownership context for immediate response
    hiring_decision.is_owner = True # Just created it
    hiring_decision.assigned_hr_id = current_user.id
    hiring_decision.assigned_hr_name = current_user.full_name
    
    
    try:
        db.add(hiring_decision)
        db.commit()
        db.refresh(hiring_decision)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to save hiring decision securely")
    
    # Extract plain scalar values before session closes to avoid DetachedInstanceError in BackgroundTasks
    candidate_email = application.candidate_email
    job_title = application.job.title if application.job else "N/A"
    interview_id = application.interview.id if application.interview else None
    tenant_id = (
        getattr(application, "tenant_id", None)
        or (getattr(application.interview, "tenant_id", None) if application.interview else None)
        or (getattr(application.job, "tenant_id", None) if application.job else None)
    )
    tenant_ref = str(tenant_id) if tenant_id else None

    if result.email_type == "hired":
        background_tasks.add_task(
            send_hired_email,
            candidate_email,
            job_title,
            tenant=tenant_ref,
            interview_id=interview_id,
        )
    elif result.email_type == "rejected":
        background_tasks.add_task(send_rejected_email, candidate_email, job_title, False)
    elif result.email_type == "approved_for_interview":
        # Note: raw_access_key would be needed here if this action was APPROVE_FOR_INTERVIEW
        # But this endpoint is for HIRE/REJECT. FSM might return approved_for_interview if state was weird.
        pass
    
    return hiring_decision

@router.post("/applications/{application_id}/hire")
@limiter.limit("60/minute")
async def hire_candidate(
    request: Request, application_id: int,
    hire_data: HireRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db)
):
    """
    Final Hire Action — generates an offer letter PDF from the global HTML
    template (Flow 2), uploads it to Supabase, and emails the candidate.
    No PDF upload required from HR.
    """
    from app.services.state_machine import (
        CandidateStateMachine, TransitionAction,
        InvalidTransitionError, DuplicateTransitionError,
        get_user_friendly_fsm_error,
    )
    from app.services.offer_letter_service import get_offer_letter_data, generate_offer_letter_pdf_bytes
    from app.core.storage import upload_file
    from app.core.config import get_settings
    from app.core.config import get_settings
    settings = get_settings()

    application = db.query(Application).filter(Application.id == application_id).with_for_update().first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    validate_hr_ownership(application, current_user, resource_name="application")

    # 1. Store the joining date (already validated by Pydantic)
    jdate = hire_data.joining_date

    # Convert to naive IST for database compatibility and uniform comparison
    jdate_ist = to_naive_ist(jdate)

    # 2. Load global settings (company branding, offer template)
    gs = {s.key: s.value for s in db.query(GlobalSettings).all()}
    from app.core.branding import get_all_branding
    branding = get_all_branding(db)
    
    template_str = gs.get("offer_letter_template", "")
    if not template_str:
        raise HTTPException(
            status_code=400,
            detail="No offer letter template found. Please configure one in Settings before hiring."
        )

    # 3. FSM transition: physical_interview → hired
    fsm = CandidateStateMachine(db)
    try:
        result = fsm.transition(
            application=application,
            action=TransitionAction.HIRE,
            user_id=current_user.id,
            notes=hire_data.notes or "Hired via formal process",
        )
    except (InvalidTransitionError, DuplicateTransitionError) as e:
        raise HTTPException(status_code=400, detail=get_user_friendly_fsm_error(e))

    # 4. Snapshot the template on the Application for historical record
    application.joining_date = jdate_ist
    application.offer_template_snapshot = template_str

    # 5. Render the HTML template with candidate data
    data = get_offer_letter_data(
        candidate_name=application.candidate_name,
        job_role=application.job.title if application.job else "N/A",
        department=(application.job.domain if application.job else "Engineering") or "Engineering",
        joining_date=jdate_ist,
        company_name=branding.get("company_name"),
        logo_url=branding.get("company_logo_url"),
        hr_email=gs.get("hr_email", ""),
        hr_name=gs.get("hr_name", ""),
        hr_phone=gs.get("hr_phone", ""),
        company_address=gs.get("company_address", "")
    )

    # 6. Generate PDF bytes in-memory (xhtml2pdf)
    try:
        pdf_bytes = generate_offer_letter_pdf_bytes(template_str, data)
    except RuntimeError as e:
        logger.error(f"Offer letter PDF generation failed for application {application_id}: {e}")
        raise HTTPException(status_code=500, detail="We encountered a problem generating the offer letter document. Please verify the template configuration.")

    # 7. Upload generated PDF to Supabase
    timestamp = int(get_ist_now().timestamp())
    storage_path = f"offer_letters/offer_{application_id}_{timestamp}.pdf"
    try:
        upload_file(settings.supabase_bucket_offers, storage_path, pdf_bytes, content_type="application/pdf")
    except Exception as e:
        logger.error(f"Offer letter upload failed for application {application_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload offer letter to storage.")

    # 8. Persist HiringDecision and update Application atomically
    application.offer_sent = True
    application.offer_sent_date = get_ist_now()
    application.offer_pdf_path = storage_path
    
    hiring_decision = HiringDecision(
        application_id=application_id,
        hr_id=current_user.id,
        decision="hired",
        decision_comments=hire_data.notes,
        joining_date=jdate_ist,
        offer_letter_path=storage_path,
        decided_at=get_ist_now()
    )
    # Extract plain scalar values before commit/session close to avoid DetachedInstanceError in BackgroundTasks
    candidate_email = application.candidate_email
    job_title = application.job.title if application.job else "N/A"
    interview_id = application.interview.id if application.interview else None
    tenant_id = (
        getattr(application, "tenant_id", None)
        or (getattr(application.interview, "tenant_id", None) if application.interview else None)
        or (getattr(application.job, "tenant_id", None) if application.job else None)
    )
    tenant_ref = str(tenant_id) if tenant_id else None

    db.add(hiring_decision)
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"Hiring decision commit failed for application {application_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to finalise hiring decision.")

    # 9. Email with offer letter attachment (background, after commit)
    if result.email_type == "hired":
        background_tasks.add_task(
            send_hired_email,
            candidate_email,
            job_title,
            offer_letter_path=storage_path,
            tenant=tenant_ref,
            interview_id=interview_id,
        )

    return {"status": "success", "message": "Candidate hired and offer letter generated and sent."}

@router.get("/applications/{application_id}/decision")
@limiter.limit("60/minute")
def get_application_decision(
    request: Request, application_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get hiring decision for application"""
    application = db.query(Application).filter(Application.id == application_id).first()
    
    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found"
        )
    if current_user.role.lower() not in ["super_admin", "admin", "hr"]:
        raise HTTPException(status_code=403, detail="Forbidden: Access restricted.")
    validate_hr_ownership(application, current_user, resource_name="application")
    
    
    decision = db.query(HiringDecision).options(
        joinedload(HiringDecision.hr)
    ).filter(
        HiringDecision.application_id == application_id
    ).first()
    
    if not decision:
        return {"message": "Decision not yet made"}
    
    # Populate ownership context
    decision.assigned_hr_id = decision.hr_id
    decision.assigned_hr_name = decision.hr.full_name if decision.hr else "Unknown"
    decision.is_owner = (decision.hr_id == current_user.id)
    
    return decision

@router.get("/pipeline")
@limiter.limit("60/minute")
def get_hiring_pipeline(
    request: Request, status_filter: str = None,
    job_id: str = None,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db)
):
    """Get hiring pipeline for all applications (HR only)"""
    from sqlalchemy.orm import joinedload, load_only
    
    query = db.query(Application).outerjoin(Job).options(
        joinedload(Application.job).load_only(Job.id, Job.title, Job.hr_id),
        joinedload(Application.hr).load_only(User.id, User.full_name),
        joinedload(Application.interview).load_only(Interview.id, Interview.status, Interview.overall_score),
        joinedload(Application.hiring_decision).load_only(HiringDecision.decision, HiringDecision.decided_at),
        load_only(Application.id, Application.candidate_name, Application.status, Application.applied_at, Application.job_id, Application.hr_id)
    )
    
    if job_id and str(job_id).lower() != "all":
        job_id_str = str(job_id).strip()
        if job_id_str.isdigit():
            query = query.filter(Application.job_id == int(job_id_str))
        else:
            query = query.filter(Job.job_id == job_id_str)
    
    if status_filter:
        query = query.filter(Application.status == status_filter)

    # Apply visibility isolation: Anyone not a super_admin is restricted to their own data
    if current_user.role.lower() not in ["super_admin", "admin"]:
        query = query.filter(or_(Job.hr_id == current_user.id, Application.hr_id == current_user.id))
    
    total = query.count()
    applications = query.all()
    
    # Build detailed response — all data already loaded, zero extra queries
    pipeline = []
    for app in applications:
        app_data = {
            "application_id": app.id,
            "candidate_name": app.candidate_name,
            "job_title": app.job.title,
            "status": app.status,
            "applied_at": app.applied_at,
            "interview": None,
            "decision": None,
            "assigned_hr_id": app.hr_id,
            "assigned_hr_name": app.hr.full_name if app.hr else "Unknown",
            "is_owner": (app.hr_id == current_user.id)
        }
        
        if app.interview:
            app_data["interview"] = {
                "id": app.interview.id,
                "status": app.interview.status,
                "score": app.interview.overall_score
            }
        
        if app.hiring_decision:
            app_data["decision"] = {
                "decision": app.hiring_decision.decision,
                "decided_at": app.hiring_decision.decided_at
            }
        
        pipeline.append(app_data)
    
    return {"items": pipeline, "total": total}