from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload
from typing import List
from datetime import datetime
import secrets
import logging
import html

logger = logging.getLogger(__name__)

from app.infrastructure.database import get_db
from app.domain.models import InterviewIssue, InterviewFeedback, Interview, Application, User, Job
from app.domain.schemas import (
    InterviewIssueCreate, InterviewIssueResponse, InterviewIssueResolve,
    InterviewFeedbackCreate, InterviewFeedbackResponse, GeneralGrievanceCreate
)
from app.core.auth import (
    get_current_user,
    hash_password,
    verify_password,
    get_current_hr,
    get_current_interview_any_status,
)
from app.core.ownership import validate_hr_ownership
from app.services.email_service import send_ticket_resolved_email, send_key_reissued_email
from app.core.timezone import get_ist_now
from datetime import timedelta

router = APIRouter(prefix="/api/tickets", tags=["Tickets"])
from fastapi import Request
from app.core.rate_limiter import limiter

@router.post("", response_model=InterviewIssueResponse)
@limiter.limit("60/minute")
def report_issue(
    request: Request, issue: InterviewIssueCreate,
    interview_session: Interview = Depends(get_current_interview_any_status),
    db: Session = Depends(get_db),
):
    """
    Candidate issue report during/after interview.
    Requires interview JWT; body interview_id must match the token (prevents arbitrary interview_id spam).
    """
    if issue.interview_id != interview_session.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Interview token does not match interview_id for this ticket.",
        )

    interview = db.query(Interview).filter(Interview.id == issue.interview_id).first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")

    application = interview.application
    
    # Prevent duplicate active tickets.
    existing_pending = (
        db.query(InterviewIssue)
        .filter(
            InterviewIssue.interview_id == issue.interview_id,
            InterviewIssue.status == "pending",
        )
        .first()
    )
    if existing_pending:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An active support request for this interview is already under review.",
        )

    # Input validation and XSS mitigation
    if not issue.description.strip():
        raise HTTPException(status_code=400, detail="Description cannot be empty.")
    if len(issue.description) > 5000:
        raise HTTPException(status_code=400, detail="Description exceeds maximum allowed length of 5000 characters.")
    if not issue.issue_type.strip():
        raise HTTPException(status_code=400, detail="Issue type cannot be empty.")
    if len(issue.issue_type) > 100:
        raise HTTPException(status_code=400, detail="Issue type exceeds maximum allowed length of 100 characters.")
        
    valid_types = {"technical", "interruption", "misconduct_appeal", "other"}
    normalized_type = issue.issue_type.strip().lower()
    if normalized_type not in valid_types:
        raise HTTPException(status_code=400, detail="Invalid issue type.")
        
    sanitized_issue_type = html.escape(normalized_type)
    sanitized_description = html.escape(issue.description.strip())
    
    new_issue = InterviewIssue(
        interview_id=issue.interview_id,
        candidate_name=application.candidate_name,
        candidate_email=application.candidate_email,
        issue_type=sanitized_issue_type,
        description=sanitized_description,
        status='pending'
    )
    db.add(new_issue)
    db.commit()
    db.refresh(new_issue)
    
    # Add extra fields for response
    new_issue.application_id = application.id
    new_issue.test_id = interview.test_id
    new_issue.job_id = application.job_id
    new_issue.job_identifier = application.job.job_id
    return new_issue

@router.post("/grievance", response_model=InterviewIssueResponse)
@limiter.limit("60/minute")
def report_grievance(request: Request, issue: GeneralGrievanceCreate, db: Session = Depends(get_db)):
    # Uniform error response to mitigate email enumeration/information disclosure
    generic_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid email or access key. Please ensure you use the key from your invitation email."
    )

    # Find the most recent interview for this email
    interview = db.query(Interview).join(Application).filter(
        Application.candidate_email == issue.email.lower().strip()
    ).order_by(Interview.created_at.desc()).first()
    
    if not interview:
        raise generic_error

    # Verify access key
    if not verify_password(issue.access_key, interview.access_key_hash):
        logger.warning(f"[SECURITY] Invalid access key used for grievance report. Email: {issue.email}")
        raise generic_error

    # Input validation and XSS mitigation
    if not issue.description.strip():
        raise HTTPException(status_code=400, detail="Description cannot be empty.")
    if len(issue.description) > 5000:
        raise HTTPException(status_code=400, detail="Description exceeds maximum allowed length of 5000 characters.")
    if not issue.issue_type.strip():
        raise HTTPException(status_code=400, detail="Issue type cannot be empty.")
    if len(issue.issue_type) > 100:
        raise HTTPException(status_code=400, detail="Issue type exceeds maximum allowed length of 100 characters.")

    valid_types = {"technical", "interruption", "misconduct_appeal", "other"}
    normalized_type = issue.issue_type.strip().lower()
    if normalized_type not in valid_types:
        raise HTTPException(status_code=400, detail="Invalid issue type.")

    sanitized_issue_type = html.escape(normalized_type)
    sanitized_description = html.escape(issue.description.strip())

    # Prevent duplicate active tickets.
    existing_pending = (
        db.query(InterviewIssue)
        .filter(
            InterviewIssue.interview_id == interview.id,
            InterviewIssue.status == "pending",
        )
        .first()
    )
    if existing_pending:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An active support request for this interview is already under review.",
        )

    new_issue = InterviewIssue(
        interview_id=interview.id,
        candidate_name=interview.application.candidate_name,
        candidate_email=issue.email,
        issue_type=sanitized_issue_type,
        description=sanitized_description,
        status='pending'
    )
    db.add(new_issue)
    db.commit()
    db.refresh(new_issue)
    
    # Add extra fields for response
    new_issue.application_id = interview.application_id
    new_issue.test_id = interview.test_id
    new_issue.job_id = interview.application.job_id
    new_issue.job_identifier = interview.application.job.job_id
    return new_issue

@router.post("/feedback", response_model=InterviewFeedbackResponse)
@limiter.limit("60/minute")
def submit_feedback(request: Request, feedback: InterviewFeedbackCreate, db: Session = Depends(get_db)):
    # Verify interview exists
    interview = db.query(Interview).filter(Interview.id == feedback.interview_id).first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    
    # Check if feedback already exists
    existing = db.query(InterviewFeedback).filter(InterviewFeedback.interview_id == feedback.interview_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Feedback already submitted for this interview")

    new_feedback = InterviewFeedback(
        interview_id=feedback.interview_id,
        ui_ux_rating=feedback.ui_ux_rating,
        feedback_text=feedback.feedback_text
    )
    db.add(new_feedback)
    db.commit()
    db.refresh(new_feedback)
    return new_feedback

@router.get("/feedback", response_model=None)
@limiter.limit("60/minute")
def list_feedback(
    request: Request, skip: int = 0,
    limit: int = 50,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db),
):
    """List all candidate feedback submissions. HR sees only their own; super_admin sees all."""
    query = (
        db.query(InterviewFeedback)
        .options(
            joinedload(InterviewFeedback.interview)
            .joinedload(Interview.application)
            .joinedload(Application.job)
        )
        .join(Interview, InterviewFeedback.interview_id == Interview.id)
        .join(Application, Interview.application_id == Application.id)
        .join(Job, Application.job_id == Job.id)
    )
    if current_user.role.lower() != "super_admin":
        query = query.filter(or_(Job.hr_id == current_user.id, Application.hr_id == current_user.id))

    total = query.count()
    feedbacks = query.order_by(InterviewFeedback.created_at.desc(), InterviewFeedback.id.desc()).offset(skip).limit(limit).all()

    # Enrich with candidate data from the joined tables
    result = []
    for fb in feedbacks:
        app = fb.interview.application if fb.interview else None
        result.append({
            "id": fb.id,
            "interview_id": fb.interview_id,
            "ui_ux_rating": fb.ui_ux_rating,
            "feedback_text": fb.feedback_text,
            "created_at": fb.created_at.isoformat() if fb.created_at else None,
            "candidate_name": app.candidate_name if app else "Unknown",
            "candidate_email": app.candidate_email if app else "N/A",
            "job_title": app.job.title if (app and app.job) else "N/A",
            "job_id": app.job.id if (app and app.job) else None,
        })

    return {"items": result, "total": total}

@router.get("/count")
@limiter.limit("60/minute")
def get_ticket_count(
    request: Request, current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db)
):
    """Lightweight endpoint returning just the pending ticket count for sidebar badges."""
    q = db.query(InterviewIssue).filter(InterviewIssue.status == "pending")

    if current_user.role.lower() != "super_admin":
        q = q.join(Interview, InterviewIssue.interview_id == Interview.id).join(Application, Interview.application_id == Application.id).filter(Application.hr_id == current_user.id)

    count = q.count()
    return {"count": count}

@router.get("", response_model=None)
@limiter.limit("60/minute")
def get_tickets(
    request: Request, status: str = 'pending',
    skip: int = 0,
    limit: int = 50,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db)
):
    query = (
        db.query(InterviewIssue)
        .options(
            joinedload(InterviewIssue.interview)
            .joinedload(Interview.application)
            .joinedload(Application.job),
            joinedload(InterviewIssue.interview)
            .joinedload(Interview.application)
            .joinedload(Application.hr),
            joinedload(InterviewIssue.application)
            .joinedload(Application.job),
            joinedload(InterviewIssue.application)
            .joinedload(Application.hr)
        )
    )

    if current_user.role.lower() != "super_admin":
        query = query.join(Interview, InterviewIssue.interview_id == Interview.id).join(Application, Interview.application_id == Application.id).filter(Application.hr_id == current_user.id)

    if status != 'all':
        query = query.filter(InterviewIssue.status == status)

    total = query.count()
    tickets = query.order_by(InterviewIssue.created_at.desc(), InterviewIssue.id.desc()).offset(skip).limit(limit).all()

    # Hybrid population
    for t in tickets:
        app = t.application or (t.interview.application if t.interview else None)
        if app:
            t.application_id = app.id
            t.job_id = app.job_id
            t.job_identifier = app.job.job_id if app.job else None
        else:
            t.application_id = None
            t.job_id = None
            t.job_identifier = None

        t.test_id = t.interview.test_id if t.interview else None

        # Ownership Awareness (Architecture Rule 3)
        if app:
            t.assigned_hr_id = app.hr_id
            t.assigned_hr_name = app.hr.full_name if app.hr else "Unknown"
            t.is_owner = (app.hr_id == current_user.id)
        else:
            t.assigned_hr_id = None
            t.assigned_hr_name = None
            t.is_owner = False

    return {"items": tickets, "total": total}

@router.put("/{ticket_id}/resolve", response_model=InterviewIssueResponse)
@limiter.limit("60/minute")
def resolve_ticket(
    request: Request, ticket_id: int,
    resolution: InterviewIssueResolve,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db)
):
    # NOTE: PostgreSQL does not allow FOR UPDATE with LEFT OUTER JOINs (generated by joinedload).
    # Fix: first lock the bare row, then load the full object with relations separately.
    locked = (
        db.query(InterviewIssue.id)
        .filter(InterviewIssue.id == ticket_id)
        .with_for_update()
        .scalar()
    )
    if not locked:
        raise HTTPException(status_code=404, detail="Ticket not found")

    ticket = (
        db.query(InterviewIssue)
        .options(
            joinedload(InterviewIssue.interview)
            .joinedload(Interview.application)
            .joinedload(Application.job)
        )
        .filter(InterviewIssue.id == ticket_id)
        .first()
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    app = ticket.application or (ticket.interview.application if ticket.interview else None)
    job = app.job if app else None

    if app:
        validate_hr_ownership(app, current_user, resource_name="ticket's application")

    # Check if the ticket is already resolved/dismissed to prevent concurrency double-processing
    if ticket.status in ['resolved', 'dismissed'] and resolution.action in ['resolve', 'resolved', 'dismiss', 'dismissed', 'reissue_key']:
        raise HTTPException(status_code=400, detail="This ticket has already been resolved or dismissed.")

    # Status update logic – accept both canonical forms (e.g. 'resolve'/'resolved', 'dismiss'/'dismissed')
    if resolution.action == 'reissue_key':
        if not ticket.interview:
            raise HTTPException(status_code=400, detail="Cannot reissue key: This ticket is not linked to an active interview session.")
        ticket.status = 'resolved'
    elif resolution.action in ['resolve', 'resolved']:
        ticket.status = 'resolved'
    elif resolution.action in ['dismiss', 'dismissed']:
        ticket.status = 'dismissed'
    elif resolution.action == 'reply':
        # Just update response and send email, keep status as pending
        ticket.status = 'pending'
    
    sanitized_response = html.escape(resolution.hr_response.strip()) if resolution.hr_response else ""
    ticket.hr_response = sanitized_response or ticket.hr_response or ""
    ticket.resolved_at = (datetime.now() if ticket.status != 'pending' else None)
    
    # Pre-populate return fields from available relations
    ticket.application_id = app.id if app else ticket.application_id
    ticket.test_id = ticket.interview.test_id if ticket.interview else ticket.test_id
    ticket.job_id = app.job_id if app else ticket.job_id
    ticket.job_identifier = app.job.job_id if (app and app.job) else ticket.job_identifier

    if not app:
        # If application is missing, we can only update the ticket status, not send emails or reissue
        db.commit()
        db.refresh(ticket)
        return ticket

    job_title = app.job.title if app.job else "your applied position"
    
    if resolution.action == 'reissue_key':
        # Generate new access key
        new_key = secrets.token_urlsafe(16)
        ticket.interview.access_key_hash = hash_password(new_key)
        ticket.interview.is_used = False
        ticket.interview.status = 'not_started'
        ticket.interview.started_at = None
        ticket.interview.expires_at = get_ist_now() + timedelta(days=10)
        ticket.interview.active_session_jti = None
        ticket.is_reissue_granted = True
        
        # Reset interview stage if it was completed/terminated early
        if ticket.interview:
            if not ticket.interview.interview_stage or ticket.interview.interview_stage in ('completed', 'terminated'):
                if getattr(ticket.interview, 'aptitude_completed', False) or not (job and job.aptitude_enabled):
                    ticket.interview.interview_stage = 'first_level'
                else:
                    ticket.interview.interview_stage = 'aptitude'
                    
            # Move application back to interview_scheduled so it can be restarted
            if app and app.status in ('rejected', 'interview_completed', 'review_later'):
                app.status = 'interview_scheduled'
        
        # Send reissue email if requested
        if resolution.send_email:
            final_response = resolution.hr_response or "Your interview access key has been reissued due to the reported technical issue. You can now resume your assessment."
            background_tasks.add_task(
                send_key_reissued_email,
                to_email=ticket.candidate_email,
                job_title=job_title,
                new_key=new_key,
                hr_response=final_response
            )
            logger.info(f"RE-ISSUED KEY queued for {ticket.candidate_email}")
    else:
        if resolution.action in ('resolve', 'resolved'):
            # Reactivate existing interview without changing the key
            if ticket.interview:
                ticket.interview.is_used = False
                ticket.interview.status = 'not_started'
                ticket.interview.expires_at = get_ist_now() + timedelta(days=10)
                ticket.interview.active_session_jti = None
                
                # Reset interview stage if it was completed/terminated early
                if not ticket.interview.interview_stage or ticket.interview.interview_stage in ('completed', 'terminated'):
                    if getattr(ticket.interview, 'aptitude_completed', False) or not (job and job.aptitude_enabled):
                        ticket.interview.interview_stage = 'first_level'
                    else:
                        ticket.interview.interview_stage = 'aptitude'
                        
                # Move application back to interview_scheduled so it can be restarted
                if app and app.status in ('rejected', 'interview_completed', 'review_later'):
                    app.status = 'interview_scheduled'

        # Send resolution/dismissal email if requested
        if resolution.send_email and resolution.hr_response:
            background_tasks.add_task(
                send_ticket_resolved_email,
                to_email=ticket.candidate_email,
                issue_type=ticket.issue_type,
                hr_response=resolution.hr_response,
                job_title=job_title
            )

    db.commit()
    db.refresh(ticket)
    
    # Final population of extra fields for response consistency
    ticket.application_id = app.id
    ticket.test_id = ticket.interview.test_id if ticket.interview else None
    ticket.job_id = app.job_id
    ticket.job_identifier = app.job.job_id if app.job else None
    
    return ticket
