from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from app.infrastructure.database import get_db, SessionLocal
from app.domain.models import GlobalSettings, User
from app.domain.schemas import GlobalSettingsUpdate, GlobalSettingsResponse
from app.core.auth import get_current_admin, get_current_hr
from app.services.email_ingestion_service import fetch_resume_attachments, run_batch_resume_processing
from app.core.encryption import encrypt_field, decrypt_field
import imaplib
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])
from fastapi import Request
from app.core.rate_limiter import limiter


def ensure_global_settings_table(db: Session) -> None:
    """Create the settings table on demand for legacy databases."""
    GlobalSettings.__table__.create(bind=db.get_bind(), checkfirst=True)


def _verify_imap_credentials(email: str, password: str) -> dict:
    """Test IMAP connection to Gmail. Returns {"ok": True} or {"ok": False, "error": "..."}."""
    import re
    # 1. Basic format validation before attempting connection
    email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not email or not re.match(email_pattern, email.strip()):
        return {"ok": False, "error": "Invalid email format. Please enter a valid email address (e.g. user@gmail.com)."}

    try:
        mail = imaplib.IMAP4_SSL("imap.gmail.com", 993, timeout=15)
        try:
            mail.login(email, password)
            mail.logout()
            return {"ok": True}
        except imaplib.IMAP4.error as e:
            return {
                "ok": False,
                "error": f"Authentication failed. Please check your email and App Password. ({e})"
            }
        except Exception as e:
            return {"ok": False, "error": f"IMAP login error: {e}"}
    except Exception as e:
        return {"ok": False, "error": f"Could not connect to Gmail IMAP server: {e}"}

def _get_sensitive_settings_dict(db: Session, current_user: User) -> dict:
    ensure_global_settings_table(db)
    
    from app.core.branding import get_all_branding
    branding = get_all_branding(db)
    
    if current_user.role == 'super_admin':
        settings_records = db.query(GlobalSettings).all()
        settings_dict = {s.key: s.value for s in settings_records}
        
        return {
            "company_logo_url": branding.get("company_logo_url"),
            "company_name": branding.get("company_name"),
            "company_address": settings_dict.get("company_address", ""),
            "hr_email": settings_dict.get("hr_email", ""),
            "hr_name": settings_dict.get("hr_name", ""),
            "hr_phone": settings_dict.get("hr_phone", ""),
            "offer_letter_template": settings_dict.get("offer_letter_template", ""),
            "imap_email": current_user.imap_email or "",
            "imap_password": "••••••••" if current_user.imap_password else "",
            "auto_sync_enabled": bool(current_user.auto_sync_enabled),
            
            "product_name": branding.get("product_name"),
            "dark_logo_url": branding.get("dark_logo_url"),
            "favicon_url": branding.get("favicon_url"),
            "footer_text": branding.get("footer_text"),
            "support_email": branding.get("support_email"),
            "theme_color": branding.get("theme_color"),
            "terms_url": branding.get("terms_url"),
            "privacy_url": branding.get("privacy_url"),
            "seo_title_default": branding.get("seo_title_default"),
            "seo_description_default": branding.get("seo_description_default")
        }
    else:
        return {
            "company_logo_url": branding.get("company_logo_url"),
            "company_name": branding.get("company_name"),
            "company_address": "",
            "hr_email": "",
            "hr_name": "",
            "hr_phone": "",
            "offer_letter_template": "",
            "imap_email": current_user.imap_email or "",
            "imap_password": "••••••••" if current_user.imap_password else "",
            "auto_sync_enabled": bool(current_user.auto_sync_enabled),
            
            "product_name": branding.get("product_name"),
            "dark_logo_url": branding.get("dark_logo_url"),
            "favicon_url": branding.get("favicon_url"),
            "footer_text": branding.get("footer_text"),
            "support_email": branding.get("support_email"),
            "theme_color": branding.get("theme_color"),
            "terms_url": branding.get("terms_url"),
            "privacy_url": branding.get("privacy_url"),
            "seo_title_default": branding.get("seo_title_default"),
            "seo_description_default": branding.get("seo_description_default")
        }


@router.get("", response_model=GlobalSettingsResponse)
@limiter.limit("60/minute")
def get_settings(
    request: Request, db: Session = Depends(get_db)
):
    """Fetch global settings (public - branding only, sensitive fields omitted)."""
    ensure_global_settings_table(db)
    from app.core.branding import get_all_branding
    branding = get_all_branding(db)

    return {
        "company_logo_url": branding.get("company_logo_url"),
        "company_name": branding.get("company_name"),
        "company_address": "",
        "hr_email": "",
        "hr_name": "",
        "hr_phone": "",
        "offer_letter_template": "",
        "imap_email": "",
        "imap_password": "",
        "auto_sync_enabled": False,
        
        "product_name": branding.get("product_name"),
        "dark_logo_url": branding.get("dark_logo_url"),
        "favicon_url": branding.get("favicon_url"),
        "footer_text": branding.get("footer_text"),
        "support_email": branding.get("support_email"),
        "theme_color": branding.get("theme_color"),
        "terms_url": branding.get("terms_url"),
        "privacy_url": branding.get("privacy_url"),
        "seo_title_default": branding.get("seo_title_default"),
        "seo_description_default": branding.get("seo_description_default")
    }


@router.get("/branding", response_model=GlobalSettingsResponse)
@limiter.limit("60/minute")
def get_branding_settings(
    request: Request, db: Session = Depends(get_db)
):
    """Fetch branding settings (public)."""
    return get_settings(request=request, db=db)


@router.get("/sensitive", response_model=GlobalSettingsResponse)
@limiter.limit("60/minute")
def get_sensitive_settings(
    request: Request,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db)
):
    """Fetch sensitive settings (Super Admin or HR)."""
    return _get_sensitive_settings_dict(db, current_user)


@router.post("", response_model=GlobalSettingsResponse)
@limiter.limit("60/minute")
def update_settings(
    request: Request, settings_data: GlobalSettingsUpdate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db)
):
    """Update settings (Super Admin or HR)."""
    ensure_global_settings_table(db)
    data = settings_data.model_dump(exclude_unset=True)
    
    if current_user.role != 'super_admin':
        allowed_keys = {"imap_email", "imap_password", "auto_sync_enabled"}
        data = {k: v for k, v in data.items() if k in allowed_keys}
    
    # ── IMAP credential verification ──────────────────────────────────
    imap_email_new = data.get("imap_email")
    imap_password_new = data.get("imap_password")
    
    is_password_placeholder = imap_password_new == "••••••••"
    if is_password_placeholder:
        data.pop("imap_password", None)
        imap_password_new = None

    if imap_email_new or imap_password_new:
        email_to_test = (imap_email_new if imap_email_new is not None else current_user.imap_email or "").strip()
        
        if imap_password_new is not None:
            password_to_test = imap_password_new.strip()
        else:
            raw_pass = current_user.imap_password or ""
            password_to_test = decrypt_field(raw_pass).strip()
        
        logger.info(f"Verifying IMAP credentials for: {email_to_test}")
        result = _verify_imap_credentials(email_to_test, password_to_test)
        if not result["ok"]:
            logger.warning(
                "IMAP credential verification failed for %s: %s",
                email_to_test, result["error"]
            )
            raise HTTPException(
                status_code=400,
                detail=result["error"]
            )
    # ──────────────────────────────────────────────────────────────────
    
    if "imap_email" in data:
        current_user.imap_email = data["imap_email"]
    if "imap_password" in data:
        current_user.imap_password = encrypt_field(data["imap_password"])
    if "auto_sync_enabled" in data:
        current_user.auto_sync_enabled = data["auto_sync_enabled"]
        
    db.add(current_user)
    
    if current_user.role == 'super_admin':
        for key, value in data.items():
            if key in {"imap_email", "imap_password", "auto_sync_enabled"}:
                continue
            if value is None:
                continue
                
            str_value = str(value)
            if isinstance(value, bool):
                str_value = "true" if value else "false"
                
            setting = db.query(GlobalSettings).filter(GlobalSettings.key == key).first()
            if setting:
                setting.value = str_value
            else:
                setting = GlobalSettings(key=key, value=str_value)
                db.add(setting)
                
    db.commit()
    db.refresh(current_user)

    # Reset background IMAP polling loop backoff so it syncs immediately
    if hasattr(request, "app") and hasattr(request.app, "state"):
        request.app.state.reset_imap_backoff = True

    if data.get("auto_sync_enabled") is True:
        async def run_sync_in_background():
            bg_db = SessionLocal()
            try:
                user_record = bg_db.query(User).filter(User.id == current_user.id).first()
                if user_record and user_record.imap_email and user_record.imap_password:
                    email = user_record.imap_email.strip()
                    password = decrypt_field(user_record.imap_password).strip()
                    fetch_resume_attachments(bg_db, email, password, hr_id=user_record.id)
                    await run_batch_resume_processing(bg_db, hr_id=user_record.id)
            except Exception as e:
                logger.error(f"Immediate background sync on setting save failed: {e}")
            finally:
                bg_db.close()
        background_tasks.add_task(run_sync_in_background)
    
    return _get_sensitive_settings_dict(db, current_user)
