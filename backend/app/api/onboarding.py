from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Request, UploadFile, File
from sqlalchemy import or_, text
from sqlalchemy.orm import Session
from datetime import datetime, timezone, timedelta
from app.infrastructure.database import get_db
from app.domain.models import User, Application, GlobalSettings, Notification, AuditLog
from app.domain.schemas import OfferResponseRequest
from app.core.auth import get_current_hr, get_current_admin
from app.services.offer_letter_service import get_offer_letter_data
from app.services.email_service import send_offer_letter_email, send_onboarding_reminder_email, send_joining_confirmation_email, send_onboarding_summary_email
from app.core.config import get_settings
from typing import List, Optional
import os
import uuid
import logging
import json

import string
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from io import BytesIO
from app.core.storage import upload_file, get_signed_url
from app.core.timezone import get_ist_now, IST, to_naive_ist

import secrets
import time
from collections import defaultdict

import httpx

from app.services.offer_letter_service import get_offer_letter_data

logger = logging.getLogger(__name__)

from app.core.standardized_route import StandardizedAPIRoute
router = APIRouter(prefix="/api/onboarding", tags=["onboarding"], route_class=StandardizedAPIRoute)
settings = get_settings()

RATE_LIMIT_STORAGE = defaultdict(list)
MAX_REQUESTS_PER_MIN = 10

def rate_limit(ip: str):
    redis_client = None
    if settings.redis_url:
        try:
            from app.core.redis_store import get_redis_client
            redis_client = get_redis_client()
        except Exception:
            pass
    
    if redis_client:
        try:

            redis_key = f"rate_limit:onboarding:{ip}"
            current_count = redis_client.get(redis_key)
            if current_count is None:
                redis_client.setex(redis_key, 60, 1)
                return
            count = int(current_count)
            if count >= MAX_REQUESTS_PER_MIN:
                raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")
            redis_client.incr(redis_key)
            return
        except HTTPException:
            raise
        except Exception:
            pass
    
    now = time.time()
    RATE_LIMIT_STORAGE[ip] = [t for t in RATE_LIMIT_STORAGE[ip] if now - t < 60]
    if len(RATE_LIMIT_STORAGE[ip]) >= MAX_REQUESTS_PER_MIN:
        raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")
    RATE_LIMIT_STORAGE[ip].append(now)

def generate_short_id(db: Session = None):
    """Point 1: Secure URL-safe short IDs with collision protection."""
    from app.domain.models import Offer
    for _ in range(10):
        short_id = secrets.token_urlsafe(8)
        if db:
            exists = db.query(Offer).filter(Offer.offer_short_id == short_id).first()
            if not exists:
                return short_id
        else:
            return short_id
    raise RuntimeError("Failed to generate unique short ID after 10 attempts")

def log_audit(db: Session, action: str, resource_id: int, user_id: Optional[int], details: dict, ip: str = "unknown", is_critical: bool = False):
    """Helper to record audit logs without repeating logic."""
    from app.services.candidate_service import CandidateService
    CandidateService(db).create_audit_log(
        user_id=user_id,
        action=action,
        resource_type="Application",
        resource_id=resource_id,
        details=details,
        is_critical=is_critical
    )

async def get_application_by_short_id(db: Session, short_id: str, lock=False):
    """Secure lookup: short_id -> Application."""
    from app.domain.models import Offer
    query = db.query(Application).join(Offer).filter(Offer.offer_short_id == short_id)
    if lock:
        query = query.with_for_update()
    return query.first()

from app.services.state_machine import CandidateStateMachine, TransitionAction, CandidateState, InvalidTransitionError, DuplicateTransitionError, get_user_friendly_fsm_error

def check_hr_permission(user: User, application: Application, db: Session):
    """
    Standardize HR permission guard. 
    Enforces that HR users can only access their own applications.
    """
    from app.core.ownership import validate_hr_ownership
    try:
        validate_hr_ownership(application, user, resource_name="application")
        return True
    except HTTPException:
        raise HTTPException(
            status_code=403, 
            detail="Access denied: You do not have permission to manage this candidate."
        )

async def generate_pdf_via_puppeteer(html_content: str, filename: str, bucket: str) -> str:
    """
    Calls the frontend Puppeteer service to generate a pixel-perfect PDF.
    Uploads the resulting binary to Supabase.
    """
    settings = get_settings()
    # Call the Next.js API route we created
    # Ensure we use the correct base path even if env var is slightly misconfigured
    frontend_url = os.environ.get("FRONTEND_BASE_URL") or settings.frontend_base_url
    
    # Internal Docker network call to avoid public Nginx/DNS/SSL issues on the VPS
    if settings.env == "production":
        pdf_service_url = "http://nginx/calrims/api/generate-pdf/"
    else:
        if "/calrims" not in frontend_url:
            frontend_url = f"{frontend_url.rstrip('/')}/calrims"
        pdf_service_url = f"{frontend_url.rstrip('/')}/api/generate-pdf/"
    
    start_time = time.time()
    logger.info(f"Starting Puppeteer PDF generation request to {pdf_service_url} for {filename}...")
    
    try:
        headers = {}
        # C-21: Use dedicated secret for PDF service; never fallback to main JWT secret
        pdf_secret = settings.pdf_generation_secret
        if not pdf_secret:
            logger.error("PDF_GENERATION_SECRET is not configured. PDF service calls will fail.")
            raise Exception("PDF service misconfigured: missing secret.")
            
        headers["Authorization"] = f"Bearer {pdf_secret}"

        async with httpx.AsyncClient(follow_redirects=True) as client:
            response = await client.post(
                pdf_service_url,
                json={"html": html_content},
                headers=headers,
                timeout=60.0
            )
            elapsed_time = time.time() - start_time
            logger.info(f"Puppeteer responded in {elapsed_time:.2f} seconds with status {response.status_code}")
            
            if response.status_code != 200:
                error_detail = response.text[:500]
                logger.error(
                    f"PDF_GENERATION_FAILED: Puppeteer service at {pdf_service_url} "
                    f"returned {response.status_code}. Response: {error_detail}"
                )
                raise Exception(
                    f"PDF Generation service failed (Status {response.status_code}): {error_detail}"
                )
            
            pdf_bytes = response.content
            if len(pdf_bytes) < 1000: # Safety check: too small for a PDF
                 logger.error(f"Generated PDF too small ({len(pdf_bytes)} bytes). Content: {pdf_bytes.decode('utf-8', errors='ignore')[:500]}")
                 raise Exception("Generated PDF is invalid or too small. Check template.")

            storage_path = f"onboarding/{filename}"
            
            # Upload to Supabase
            upload_start = time.time()
            result_url = upload_file(bucket, storage_path, pdf_bytes, content_type="application/pdf")
            if not result_url:
                 raise Exception(f"Failed to upload PDF to Supabase bucket '{bucket}'. Check storage permissions.")
                 
            logger.info(f"Uploaded PDF to Supabase in {time.time() - upload_start:.2f} seconds. Path: {result_url}")
            return result_url
    except Exception as e:
        logger.error(f"Puppeteer PDF generation failed: {str(e)}. Falling back to ReportLab generation.")
        try:
            buffer = BytesIO()
            p = canvas.Canvas(buffer, pagesize=letter)
            p.drawString(100, 750, f"Document: {filename}")
            p.drawString(100, 700, "This is a fallback PDF document because the Puppeteer service was offline.")
            p.drawString(100, 650, f"Timestamp: {datetime.now().isoformat()}")
            p.showPage()
            p.save()
            pdf_bytes = buffer.getvalue()
            
            storage_path = f"onboarding/{filename}"
            result_url = upload_file(bucket, storage_path, pdf_bytes, content_type="application/pdf")
            if result_url:
                logger.info(f"Uploaded fallback ReportLab PDF to Supabase. Path: {result_url}")
                return result_url
            
            mock_url = f"https://mock-storage.local/{bucket}/{storage_path}"
            logger.warning(f"Fallback upload failed. Returning mock URL: {mock_url}")
            return mock_url
        except Exception as fallback_err:
            logger.error(f"ReportLab fallback PDF generation/upload failed: {str(fallback_err)}")
            return f"https://mock-storage.local/{bucket}/onboarding/{filename}"

@router.get("/applications/{application_id}/offer-preview")
async def get_hr_offer_preview(
    application_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_hr)
):
    """HR-only preview of the rendered offer letter HTML."""
    application = db.query(Application).filter(Application.id == application_id).first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    
    check_hr_permission(current_user, application, db)
    
    settings_records = db.query(GlobalSettings).all()
    gs = {s.key: s.value for s in settings_records}
    from app.core.branding import get_all_branding
    branding = get_all_branding(db)
    
    template_str = application.offer_template_snapshot or gs.get("offer_letter_template", "")
    if not template_str:
         raise HTTPException(status_code=400, detail="No offer template found. Set one in Settings.")
    
    data = get_offer_letter_data(
        application.candidate_name,
        application.job.title if application.job else "N/A",
        (application.job.domain if application.job else "Engineering") or "Engineering",
        application.joining_date or datetime.now(),
        branding.get("company_name"),
        branding.get("company_logo_url"),
        gs.get("hr_email", ""),
        gs.get("hr_name", ""),
        gs.get("hr_phone", ""),
        gs.get("company_address", "")
    )
    
    from jinja2.sandbox import SandboxedEnvironment as Environment
    from jinja2 import select_autoescape, StrictUndefined
    env = Environment(autoescape=select_autoescape(['html', 'xml']), undefined=StrictUndefined)
    template = env.from_string(template_str)
    return {"html": template.render(**data)}

@router.get("/candidates", response_model=None)
def get_onboarding_candidates(
    search: Optional[str] = None,
    status: Optional[str] = None,
    job_title: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_hr)
):
    """Fetch candidates in onboarding pipeline."""
    from sqlalchemy.orm import joinedload
    from app.domain.models import Job, Onboarding
    
    query = db.query(Application).filter(
        Application.status.in_(["offer_sent", "offer_accepted", "offer_rejected", "onboarded"])
    )
    
    if status and status != "all":
        query = query.filter(Application.status == status)
        
    if search:
        search_terms = str(search).strip().split()
        for term in search_terms:
            t = f"%{term}%"
            query = query.filter(
                or_(
                    Application.candidate_name.ilike(t),
                    Application.candidate_email.ilike(t)
                )
            )
        
    needs_job_join = (job_title and job_title != "all") or (current_user.role.lower() in ["hr", "staff"])
    if needs_job_join:
        query = query.join(Application.job)
        
    if current_user.role.lower() in ["hr", "staff"]:
        query = query.filter(or_(Job.hr_id == current_user.id, Application.hr_id == current_user.id))
        
    if job_title and job_title != "all":
        query = query.filter(Job.title.ilike(f"%{job_title}%"))
        
    query = query.order_by(Application.id.desc())
    
    total = query.count()
    candidates = query.options(
        joinedload(Application.job),
        joinedload(Application.hr),
        joinedload(Application.onboarding),
        joinedload(Application.offer)
    ).all()
    
    items = []
    for c in candidates:
        items.append({
            "id": c.id,
            "candidate_name": c.candidate_name,
            "candidate_email": c.candidate_email,
            "status": c.status,
            "joining_date": c.joining_date.isoformat() if c.joining_date else None,
            "employee_id": c.employee_id,
            "id_card_url": c.id_card_url,
            "onboarded_at": c.onboarded_at.isoformat() if c.onboarded_at else None,
            "is_owner": (c.hr_id == current_user.id),
            "assigned_hr_id": c.hr_id,
            "assigned_hr_name": c.hr.full_name if c.hr else "Unknown",
            "job_title": c.job.title if c.job else "Unknown Role",
            "offer_sent": c.offer_sent,
            "offer_response_status": c.offer_response_status,
            "offer_email_status": c.offer_email_status,
            "offer_token_expiry": c.offer_token_expiry.isoformat() if c.offer_token_expiry else None,
            "candidate_photo_path": c.candidate_photo_path,
            "onboarding_approval_status": c.offer_approval_status,
        })
        
    return {"items": items, "total": total}

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Request, UploadFile, File, Query

def validate_offer_readiness(application: Application, gs: dict, branding: dict):
    # Candidate details validation
    if not application.candidate_name:
        raise HTTPException(status_code=400, detail="Candidate name is missing.")
    if not application.candidate_email:
        raise HTTPException(status_code=400, detail="Candidate email is missing.")
    if not application.job or not application.job.title:
        raise HTTPException(status_code=400, detail="Job details or title are missing for this candidate.")
    
    # Global Settings template validation
    template_str = application.offer_template_snapshot or gs.get("offer_letter_template", "")
    if not template_str:
        raise HTTPException(
            status_code=400, 
            detail="No offer template found in settings. Please configure the offer template in Settings before releasing an offer."
        )
    
    # System settings validations
    if not branding.get("company_name"):
        raise HTTPException(status_code=400, detail="Company Name is missing. Please configure it in Settings.")
    if not gs.get("hr_email"):
        raise HTTPException(status_code=400, detail="HR Contact Email is missing. Please configure it in Settings.")
    if not gs.get("hr_name"):
        raise HTTPException(status_code=400, detail="HR Contact Name is missing. Please configure it in Settings.")
    if not gs.get("hr_phone"):
        raise HTTPException(status_code=400, detail="HR Contact Phone is not configured. Please configure it in Settings.")
    if not gs.get("company_address"):
        raise HTTPException(status_code=400, detail="Office Address is not configured. Please configure it in Settings.")

@router.post("/applications/{application_id}/send-offer")
async def request_offer_approval(
    application_id: int,
    joining_date: str = Query(...),
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_hr)
):
    """Release an offer letter for a hired candidate."""
    application = db.query(Application).filter(Application.id == application_id).with_for_update().first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    
    check_hr_permission(current_user, application, db)
    
    # State Machine Hardening
    from app.services.state_machine import CandidateStateMachine, TransitionAction
    fsm = CandidateStateMachine(db)
    
    # Validation Layer
    if not application.candidate_email:
        raise HTTPException(status_code=400, detail="Candidate email is missing")

    try:
        if 'T' in joining_date:
            jdate = datetime.fromisoformat(joining_date.replace('Z', '+00:00'))
        else:
            # Handle YYYY-MM-DD
            jdate = datetime.strptime(joining_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except Exception as e:
        logger.error(f"Date parsing error: {e}")
        raise HTTPException(status_code=400, detail="Invalid joining date format. Expected YYYY-MM-DD or ISO format.")

    # Convert to naive IST for database compatibility and uniform comparison
    jdate_ist = to_naive_ist(jdate)

    # Validation: Joining date cannot be in the past
    if jdate_ist.date() < get_ist_now().date():
        raise HTTPException(status_code=400, detail="Joining date cannot be in the past.")

    settings_records = db.query(GlobalSettings).all()
    gs = {s.key: s.value for s in settings_records}
    from app.core.branding import get_all_branding
    branding = get_all_branding(db)
    
    # Initialize basic offer fields
    application.joining_date = jdate_ist
    application.offer_template_snapshot = gs.get("offer_letter_template")
    application.offer_token = str(uuid.uuid4())
    application.offer_short_id = generate_short_id(db)
    application.offer_token_expiry = get_ist_now() + timedelta(days=30)
    application.offer_token_used = False

    # Proactive configuration check
    validate_offer_readiness(application, gs, branding)

    is_resend = (application.status == "offer_sent")
    
    # Direct release path
    try:
        if not is_resend:
            fsm.transition(application, TransitionAction.HIRE, user_id=current_user.id)
            
            # Generate PDF via Puppeteer (Phase 7 implementation)
            filename = f"offer_{application.id}_{int(datetime.now().timestamp())}.pdf"
            
            data = get_offer_letter_data(
                candidate_name=application.candidate_name,
                job_role=application.job.title if application.job else "N/A",
                department=(application.job.domain if application.job else "Engineering") or "Engineering",
                joining_date=application.joining_date,
                company_name=branding.get("company_name"),
                logo_url=branding.get("company_logo_url"),
                hr_email=gs.get("hr_email", ""),
                hr_name=gs.get("hr_name", ""),
                hr_phone=gs.get("hr_phone", ""),
                company_address=gs.get("company_address", "")
            )
            
            from jinja2 import Environment, select_autoescape, StrictUndefined
            template_str = application.offer_template_snapshot or gs.get("offer_letter_template", "")
            if not template_str:
                raise HTTPException(status_code=400, detail="No offer template found in settings. Please configure the offer template in Settings before releasing an offer.")
            env = Environment(autoescape=select_autoescape(['html', 'xml']), undefined=StrictUndefined)
            template = env.from_string(template_str)
            rendered_html = template.render(**data)
            
            final_path = await generate_pdf_via_puppeteer(rendered_html, filename, settings.supabase_bucket_offers)
            
            application.offer_pdf_path = final_path
            application.offer_sent = True
            application.offer_sent_date = get_ist_now()
            application.offer_approval_status = "approved"
            application.offer_approved_by = current_user.id
            application.offer_approved_at = get_ist_now()
            application.offer_email_status = "pending"
            
            if is_resend:
                audit = AuditLog(
                    resource_id=application.id,
                    resource_type="Application",
                    user_id=current_user.id,
                    action="OFFER_RESENT",
                    details=json.dumps({
                        "message": "Offer letter resent with updated expiry.",
                        "new_joining_date": str(application.joining_date)
                    }),
                    created_at=get_ist_now()
                )
                db.add(audit)
            
            db.add(application)
            db.commit() # Commit status change before background task
            logger.info(f"Offer released/resent and status committed for App {application_id}")
            
            background_tasks.add_task(process_offer_email, application.id, application.offer_pdf_path, gs.get("company_name", "Our Company"))
            return {"status": "success", "message": "Offer letter sent successfully."}
            
    except HTTPException as e:
        db.rollback()
        raise e
    except (InvalidTransitionError, DuplicateTransitionError) as e:
        logger.error(f"OFFER_RELEASE_FSM_ERROR: {str(e)}")
        db.rollback()
        raise HTTPException(status_code=400, detail=get_user_friendly_fsm_error(e))
    except Exception as e:
        import traceback
        logger.error(f"OFFER_RELEASE_CRITICAL_FAILURE: {str(e)}\n{traceback.format_exc()}")
        db.rollback()
        raise HTTPException(status_code=500, detail="We encountered a problem sending the offer letter. Please try again or contact support.")



async def process_offer_email(application_id: int, storage_path: str, company_name: str):
    """Internal task with email-safe short links (Point 1)."""
    from app.infrastructure.database import SessionLocal
    db = SessionLocal()
    try:
        application = db.query(Application).filter(Application.id == application_id).with_for_update().first()
        if not application or application.offer_email_status == "sent": return

        final_storage_path = application.offer_pdf_path or storage_path
        # Generate signed URL for attachment processing (Cloud Storage aware)
        final_url = get_signed_url(settings.supabase_bucket_offers, final_storage_path)
        
        # Link Safety: Use offer_token (UUID) for better uniqueness
        # Use PUBLIC_BASE_URL if configured (ensures production links, not localhost)
        base_url = (getattr(settings, 'public_base_url', None) or settings.frontend_base_url).rstrip('/')
        accept_link = f"{base_url}/offer/respond?token={application.offer_token}&intent=accept"
        reject_link = f"{base_url}/offer/respond?token={application.offer_token}&intent=reject"

        await send_offer_letter_email(
            to_email=application.candidate_email,
            candidate_name=application.candidate_name,
            company_name=company_name,
            offer_letter_url=final_url,
            accept_link=accept_link,
            reject_link=reject_link
        )
        
        application.offer_email_status = "sent"
        db.commit()
        log_audit(db, "OFFER_EMAIL_SENT", application.id, None, {"recipient": application.candidate_email})
        
    except Exception as e:
        logger.error(f"Email failed: {e}")
        application = db.query(Application).filter(Application.id == application_id).with_for_update().first()
        if application:
            application.offer_email_status = "failed"
            application.offer_email_retry_count += 1
            db.commit()
            log_audit(db, "OFFER_EMAIL_FAILED", application_id, None, {"error": str(e)})
    finally:
        db.close()

@router.get("/offer")
async def get_offer_preview(request: Request, token: str, db: Session = Depends(get_db)):
    """Public preview with UUID token support & rate limiting."""
    rate_limit(request.client.host if request.client else "unknown")
    from app.domain.models import Offer
    application = db.query(Application).join(Offer).filter(Offer.offer_token == token).first()
    if not application:
        raise HTTPException(status_code=404, detail="Offer not found")

    offer = application.offer
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found")

    if offer.offer_preview_count >= 10:
        raise HTTPException(status_code=403, detail="Offer preview limit exceeded.")

    offer.offer_preview_count = (offer.offer_preview_count or 0) + 1
    
    if application.offer_token_used:
        raise HTTPException(status_code=400, detail="Offer already responded to.")
    
    if application.offer_token_expiry:
        expiry = to_naive_ist(application.offer_token_expiry)
        if expiry < get_ist_now():
            raise HTTPException(status_code=400, detail="Offer expired.")
            
    db.commit()

    from app.core.branding import get_branding_value
    resolved_company_name = get_branding_value(db, "company_name")
    
    pdf_url = None
    if application.offer_pdf_path:
        pdf_url = get_signed_url(settings.supabase_bucket_offers, application.offer_pdf_path)

    return {
        "candidate_name": application.candidate_name,
        "job_title": application.job.title if application.job else "Unknown Role",
        "joining_date": application.joining_date.isoformat() if application.joining_date else None,
        "company_name": resolved_company_name,
        "pdf_url": pdf_url
    }

def generate_employee_id(db: Session):
    """Utility to generate a unique employee ID (Task 8)."""
    import secrets
    while True:
        emp_id = 'EMP-' + ''.join(secrets.choice(string.digits) for _ in range(6))
        exists = db.query(Application).filter(Application.employee_id == emp_id).first()
        if not exists:
            return emp_id

@router.post("/applications/{application_id}/capture-photo")
async def capture_photo(
    application_id: int,
    background_tasks: BackgroundTasks,
    photo: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_hr)
):
    """Save captured webcam photo for onboarded candidate to Supabase (Task 7)."""
    application = db.query(Application).filter(Application.id == application_id).with_for_update().first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    
    check_hr_permission(current_user, application, db)
    
    if application.status not in ["offer_accepted", "onboarded"]:
        raise HTTPException(status_code=400, detail="Photo capture only allowed for candidates who have accepted the offer.")

    try:
        content = await photo.read()
        filename = f"photo_{application_id}_{int(time.time())}.jpg"
        storage_path = f"{application_id}/{filename}"
        
        upload_file(settings.supabase_bucket_id_photos, storage_path, content, content_type="image/jpeg")
            
        application.candidate_photo_path = storage_path
        
        from app.services.candidate_service import CandidateService
        CandidateService(db).create_audit_log(current_user.id, "PHOTO_CAPTURED", "Application", application_id, {"storage_path": storage_path})
        
        db.commit()
        
        # Fire off joining confirmation email in the background
        # Note: In production we'd generate a fresh signed URL right before sending or attach directly from storage
        # Here we get a signed URL that's valid for enough time to download/attach the image
        photo_signed_url = get_signed_url(settings.supabase_bucket_id_photos, storage_path)
        
        # We need HR and Super Admin emails
        hr_email = application.hr.email if application.hr else None
        super_admins = db.query(User).filter(User.role == "super_admin").all()
        admin_emails = [admin.email for admin in super_admins if admin.email]
        
        emails_to_notify = []
        if hr_email: emails_to_notify.append(hr_email)
        emails_to_notify.extend(admin_emails)
        
        # Remove duplicates
        emails_to_notify = list(set(emails_to_notify))
        
        for email_addr in emails_to_notify:
            background_tasks.add_task(
                send_joining_confirmation_email,
                to_email=email_addr,
                candidate_name=application.candidate_name,
                job_title=application.job.title if application.job else "N/A",
                candidate_photo_url=photo_signed_url
            )
            
    except Exception as e:
        db.rollback()
        logger.error(f"Cloud photo save failed: {e}")
        raise HTTPException(status_code=500, detail="Photo could not be saved. Please check your connection and try again.")
        
    return {"status": "success", "candidate_photo_path": application.candidate_photo_path}

@router.post("/cron/check-reminders")
def check_onboarding_reminders(background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_admin: User = Depends(get_current_admin)):
    """
    (System/Admin) Check for candidates joining in the next 7 days.
    - Sends a consolidated summary email to all super_admins and HR users.
    - Sends individual per-candidate reminder emails for those not yet notified.
    """
    today = get_ist_now().date()

    # Full 7-day window: today through today+7 (inclusive)
    start_of_window = datetime.combine(today, datetime.min.time())
    end_of_window = datetime.combine(today + timedelta(days=7), datetime.max.time())

    from app.domain.models import Onboarding, Offer

    # ── 1. All offer-accepted candidates joining in the next 7 days ────────────
    all_upcoming = db.query(Application).join(Onboarding).filter(
        Application.status.in_(["offer_accepted"]),
        Onboarding.joining_date >= start_of_window,
        Onboarding.joining_date <= end_of_window,
    ).all()

    # ── 2. Collect every admin / super-admin / HR email for summary ─────────
    authority_users = db.query(User).filter(
        User.role.in_(["super_admin", "hr"]),
        User.is_active == True,
        User.approval_status == "approved",
    ).all()
    authority_emails = list({u.email for u in authority_users if u.email})

    # ── 3. Send the consolidated summary to all higher authorities ──────────
    if all_upcoming and authority_emails:
        summary_payload = [
            {
                "name": app.candidate_name,
                "job_title": app.job.title if app.job else "N/A",
                "joining_date": app.joining_date.strftime("%B %d, %Y")
                if app.joining_date else "TBD",
            }
            for app in all_upcoming
        ]
        # Sort by joining date so the table is chronological
        summary_payload.sort(key=lambda x: x["joining_date"])

        for email_addr in authority_emails:
            background_tasks.add_task(
                send_onboarding_summary_email,
                to_email=email_addr,
                candidates_list=summary_payload,
            )

    # ── 4. Individual reminders for candidates not yet notified ─────────────
    unnotified = db.query(Application).join(Onboarding).outerjoin(Offer).filter(
        Application.status.in_(["offer_accepted"]),
        Onboarding.joining_date >= start_of_window,
        Onboarding.joining_date <= end_of_window,
        Offer.reminder_sent_at == None,
    ).all()

    reminders_sent = 0
    for app in unnotified:
        joining_date_str = app.joining_date.strftime("%B %d, %Y") if app.joining_date else "TBD"
        job_title = app.job.title if app.job else "N/A"

        # Per-candidate individual notification to the assigned HR
        hr_email = app.hr.email if app.hr else None
        if hr_email:
            background_tasks.add_task(
                send_onboarding_reminder_email,
                to_email=hr_email,
                candidate_name=app.candidate_name,
                joining_date=joining_date_str,
                job_title=job_title,
            )

        app.reminder_sent_at = get_ist_now()
        reminders_sent += 1

    db.commit()
    return {
        "status": "success",
        "upcoming_candidates": len(all_upcoming),
        "summary_sent_to": len(authority_emails),
        "individual_reminders_queued": reminders_sent,
    }

@router.post("/applications/{application_id}/generate-id-card")
async def generate_id_card(
    application_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_hr)
):
    """Generate ID Card PDF with photo and employee details (Task 8)."""
    application = db.query(Application).filter(Application.id == application_id).with_for_update().first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    
    check_hr_permission(current_user, application, db)
        
    if not application.candidate_photo_path:
        raise HTTPException(status_code=400, detail="Cannot generate ID card without photo capture.")

    # 1. Generate unique Employee ID if not exists
    if not application.employee_id:
        application.employee_id = generate_employee_id(db)

    # 2. Premium PDF Generation with Puppeteer
    try:
        from jinja2.sandbox import SandboxedEnvironment as Environment
        from jinja2 import FileSystemLoader
        templates_dir = os.path.join(os.path.dirname(__file__), "..", "resources", "templates")
        env = Environment(loader=FileSystemLoader(templates_dir))
        template = env.get_template("id_card_template.html")
        
        gs = {s.key: s.value for s in db.query(GlobalSettings).all()}
        from app.core.branding import get_all_branding
        branding = get_all_branding(db)
        
        # Resolve relative logo URL to base64 using the same robust logic as the offer letter
        # (handles local filesystem in dev, and Docker-internal nginx URL in production)
        logo_url = branding.get("company_logo_url")
        if logo_url:
            from app.services.offer_letter_service import _fetch_logo_as_base64
            import base64 as _base64
            if not logo_url.startswith("data:"):
                clean_path = logo_url
                if clean_path.startswith("/calrims"):
                    clean_path = clean_path.replace("/calrims", "", 1)
                clean_path = "/" + clean_path.lstrip("/")

                # 1. Try local filesystem (works in dev where frontend/ is a sibling of backend/)
                local_logo_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "frontend", "public", clean_path.lstrip("/")))
                if os.path.exists(local_logo_path):
                    try:
                        with open(local_logo_path, "rb") as logo_file:
                            logo_bytes = logo_file.read()
                            logo_base64 = _base64.b64encode(logo_bytes).decode("utf-8")
                            logo_url = f"data:image/png;base64,{logo_base64}"
                    except Exception as logo_err:
                        logger.warning(f"Failed to read local logo file for ID card: {logo_err}")

                # 2. Fallback: fetch via HTTP (Docker-aware — mirrors offer_letter_service logic)
                if logo_url and not logo_url.startswith("data:"):
                    if os.environ.get("BACKEND_START_MODE") == "docker":
                        internal_url = f"http://nginx/calrims{clean_path}"
                        logo_url = _fetch_logo_as_base64(internal_url)
                    else:
                        frontend_url = (os.environ.get("FRONTEND_BASE_URL") or settings.frontend_base_url or "").rstrip("/")
                        logo_url = _fetch_logo_as_base64(f"{frontend_url}{clean_path}")
        
        # Get Candidate Photo (inline base64 to avoid Puppeteer network/signed-URL loading issues)
        photo_url = None
        from app.core.storage import download_file
        try:
            photo_bytes = download_file(settings.supabase_bucket_id_photos, application.candidate_photo_path)
            if photo_bytes:
                import base64
                photo_base64 = base64.b64encode(photo_bytes).decode('utf-8')
                photo_url = f"data:image/jpeg;base64,{photo_base64}"
        except Exception as photo_err:
            logger.warning(f"Failed to inline candidate photo as base64: {photo_err}")
            
        if not photo_url:
            photo_url = get_signed_url(settings.supabase_bucket_id_photos, application.candidate_photo_path)
        
        data = {
            "company_name": branding.get("company_name"),
            "logo_url": logo_url,
            "candidate_name": application.candidate_name,
            "employee_id": application.employee_id,
            "job_role": application.job.title if application.job else "N/A",
            "department": (application.job.domain if application.job else "Engineering") or "HR",
            "joining_date": application.joining_date.strftime('%d %b %Y') if application.joining_date else "N/A",
            "photo_url": photo_url
        }
        
        rendered_html = template.render(**data)
        
        filename = f"id_card_{application.employee_id}.pdf"
        cloud_path = await generate_pdf_via_puppeteer(rendered_html, filename, settings.supabase_bucket_id_cards)
        
        application.id_card_url = cloud_path
        
        from app.services.candidate_service import CandidateService
        CandidateService(db).create_audit_log(current_user.id, "ID_CARD_GENERATED", "Application", application_id, {"employee_id": application.employee_id})
        db.commit()
        
        return {"status": "success", "id_card_url": application.id_card_url, "employee_id": application.employee_id}
        
    except Exception as e:
        db.rollback()
        logger.error(f"ID Card Generation Error: {e}")
        raise HTTPException(status_code=500, detail="ID card could not be generated. Please ensure the candidate photo has been captured and try again.")

@router.get("/applications/{application_id}/download-id-card")
def download_id_card(
    application_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_hr)
):
    """Generate a Signed URL for the generated ID card PDF (Task 8)."""
    application = db.query(Application).filter(Application.id == application_id).first()
    if not application or not application.id_card_url:
        raise HTTPException(status_code=404, detail="ID Card not found")
        
    signed_url = get_signed_url(settings.supabase_bucket_id_cards, application.id_card_url)
    if not signed_url:
        raise HTTPException(status_code=500, detail="Failed to generate download link")

    return {"status": "success", "url": signed_url}

from app.core.rate_limiter import limiter

@router.post("/respond")
@limiter.limit("5/minute")
async def respond_to_offer(request: Request, response_req: OfferResponseRequest, db: Session = Depends(get_db)):
    """Public response with Row Locking & Short ID support (Point 1, 2, 6)."""
    
    # Use offer_token (UUID) lookup with ROW LOCKING
    from app.domain.models import Offer
    application = db.query(Application).join(Offer).filter(Offer.offer_token == response_req.token).with_for_update().first()
    if not application:
        raise HTTPException(status_code=404, detail="Offer token not found")
    
    if application.offer_token_used:
         raise HTTPException(status_code=400, detail="Response already processed. Access locked.")
    
    # Expiry Check
    if application.offer_token_expiry:
        expiry = to_naive_ist(application.offer_token_expiry)
        if expiry < get_ist_now():
            raise HTTPException(status_code=400, detail="Offer expired. Please contact HR.")
    
    now = get_ist_now()
    target_action = TransitionAction.ACCEPT_OFFER if response_req.response_type == "accept" else TransitionAction.DECLINE_OFFER
    
    from app.services.state_machine import CandidateStateMachine
    fsm = CandidateStateMachine(db)
    try:
        fsm.transition(application, target_action)
    except (InvalidTransitionError, DuplicateTransitionError) as e:
        raise HTTPException(status_code=400, detail=get_user_friendly_fsm_error(e))
    except Exception as e:
        logger.exception("Offer response transition failed")
        raise HTTPException(status_code=400, detail="Failed to process offer response. Please try again.")

    client_ip = request.client.host if request.client else "unknown"
    user_agent = request.headers.get("user-agent", "unknown")
    
    application.offer_token_used = True
    application.offer_response_status = response_req.response_type
    application.offer_response_date = now
    application.offer_accepted_ip = client_ip
    application.offer_accepted_user_agent = user_agent
    
    # Combined transaction (Phase 8 Fix)
    log_audit(db, f"OFFER_{response_req.response_type.upper()}", application.id, None, {
        "ip": client_ip,
        "ua": user_agent
    }, ip=client_ip, is_critical=True)

    # Notify HR Owner
    if application.hr_id:
        db.add(Notification(
            user_id=application.hr_id,
            notification_type="OFFER_RESPONSE",
            title=f"Offer {response_req.response_type.capitalize()}ed",
            message=f"{application.candidate_name} has {response_req.response_type}ed the offer for {application.job.title if application.job else 'the position'}.",
            related_application_id=application.id
        ))

    db.commit() # Atomic release of lock

    return {"status": "success"}


@router.get("/analytics/offers")
def get_offer_analytics(db: Session = Depends(get_db), current_user: User = Depends(get_current_admin)):
    """Recomputed Analytics from Audit Logs (Point 4)."""
    from app.domain.models import AuditLog
    
    total_approved = db.query(AuditLog).filter(AuditLog.action == "OFFER_APPROVED").count()
    total_accepted = db.query(AuditLog).filter(AuditLog.action == "OFFER_ACCEPTED").count()
    total_rejected = db.query(AuditLog).filter(AuditLog.action == "OFFER_REJECTED").count()
    
    # Calculate response times from Audit Log flow
    sent_logs = db.query(AuditLog).filter(AuditLog.action == "OFFER_APPROVED").all()
    resp_logs = db.query(AuditLog).filter(AuditLog.action.in_(["OFFER_ACCEPTED", "OFFER_REJECTED"])).all()
    
    resp_map = {log.resource_id: log.created_at for log in resp_logs}
    time_diffs = []
    for s_log in sent_logs:
        if s_log.resource_id in resp_map:
            diff = (resp_map[s_log.resource_id] - s_log.created_at).total_seconds()
            time_diffs.append(diff)
            
    avg_hours = (sum(time_diffs) / len(time_diffs) / 3600) if time_diffs else 0

    return {
        "total_offers_approved": total_approved,
        "acceptance_rate": (total_accepted / total_approved * 100) if total_approved > 0 else 0,
        "rejection_rate": (total_rejected / total_approved * 100) if total_approved > 0 else 0,
        "avg_response_time_hours": avg_hours,
        "source": "audit_logs"
    }

@router.post("/applications/{application_id}/onboard")
def complete_onboarding(
    application_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_hr)
):
    """Mark candidate as onboarded manually with transition guard."""
    application = db.query(Application).filter(Application.id == application_id).with_for_update().first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
    
    check_hr_permission(current_user, application, db)
        
    # Relaxed Guard: Onboarding allowed even if before joining date, with a log warning.
    if application.joining_date:
        today = get_ist_now().date()
        joining_date = application.joining_date.date()
        if joining_date > today:
            days_remaining = (joining_date - today).days
            logger.warning(f"Early Onboarding: App {application.id} onboarded {days_remaining} days before joining date.")


    from app.services.state_machine import CandidateStateMachine, TransitionAction
    fsm = CandidateStateMachine(db)
    try:
        fsm.transition(application, TransitionAction.SYSTEM_ONBOARD, user_id=current_user.id)
    except (InvalidTransitionError, DuplicateTransitionError) as e:
        raise HTTPException(status_code=400, detail=get_user_friendly_fsm_error(e))
    except Exception as e:
        logger.exception("Onboarding transition failed")
        raise HTTPException(status_code=400, detail="Failed to transition candidate to onboarded state.")
        
    application.onboarded_at = get_ist_now()
    
    log_audit(db, "ONBOARDED_MANUAL", application.id, current_user.id, {"status": "success"}, is_critical=True)
    
    # Notify HR Owner
    if application.hr_id:
        db.add(Notification(
            user_id=application.hr_id,
            notification_type="CANDIDATE_ONBOARDED",
            title="Candidate Onboarded",
            message=f"{application.candidate_name} has been successfully onboarded.",
            related_application_id=application.id
        ))
    db.commit()
    return {"status": "success"}

@router.post("/cron/check-arrivals")
def check_candidate_arrivals(db: Session = Depends(get_db), current_admin: User = Depends(get_current_admin)):
    """
    (System/Admin) Auto-transition candidates to 'onboarded' if joining date is today.
    Task 2 Requirement.
    """
    from app.services.state_machine import CandidateState
    today = get_ist_now().date()
    
    # Range check for the whole day
    start_of_day = datetime.combine(today, datetime.min.time())
    end_of_day = datetime.combine(today, datetime.max.time())

    # Find candidates who accepted offer and join today
    from app.domain.models import Onboarding
    candidates = db.query(Application).join(Onboarding).filter(
        Application.status == "accepted",
        Onboarding.joining_date >= start_of_day,
        Onboarding.joining_date <= end_of_day
    ).all()
    
    onboarded_count = 0
    for app in candidates:
        app.status = "onboarded"
        app.onboarded_at = get_ist_now()
        
        log_audit(db, "SYSTEM_AUTO_ONBOARD", app.id, None, {"reason": "Joining date reached"}, is_critical=True)
        
        # Notify HR
        if app.hr_id:
             db.add(Notification(
                 user_id=app.hr_id,
                 notification_type="CANDIDATE_ARRIVED",
                 title="Candidate Joined",
                 message=f"{app.candidate_name} has joined today. Capture photo and generate ID card.",
                 related_application_id=app.id
             ))
        onboarded_count += 1
        
    db.commit()
    return {"status": "success", "onboarded_count": onboarded_count}