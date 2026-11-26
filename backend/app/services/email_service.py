import smtplib
import html
import re
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from email.utils import formataddr, make_msgid
import os
import asyncio
import base64
from app.core.config import get_settings
import logging
from urllib.parse import urlparse, urlencode
import httpx

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

settings = get_settings()
logger = logging.getLogger(__name__)

def _safe_email_target(to_email: str) -> str:
    """PII-safe target string for logs/audits."""
    try:
        from app.core.observability import safe_hash
        return safe_hash((to_email or "").lower().strip())
    except Exception:
        return "<hash_error>"

def _audit_email_event(action: str, *, to_email: str, details: dict[str, Any]) -> None:
    """
    Best-effort DB audit log for email events.
    Never raises (email failures must not crash request flow).
    """
    try:
        from app.infrastructure.database import SessionLocal
        from app.domain.models import AuditLog
        import json

        payload = {
            "to_hash": _safe_email_target(to_email),
            **(details or {}),
        }
        with SessionLocal() as db:
            db.add(
                AuditLog(
                    user_id=None,
                    action=action,
                    resource_type="Email",
                    resource_id=None,
                    details=json.dumps(payload),
                    ip_address=None,
                )
            )
            db.commit()
    except Exception:
        # Intentionally silent: DB may be down and should not affect email flow.
        pass

def _is_gmail_quota_error(error: BaseException | str) -> bool:
    msg = str(error or "")
    return ("Daily user sending limit exceeded" in msg) or ("5.4.5" in msg and "sending limit" in msg)

def _html_to_text(html_body: str) -> str:
    """
    Extract readable plain text from HTML content for email multipart fallback.
    """
    if not html_body:
        return ""
    
    # Strip style/head/script content completely
    text = re.sub(r'<style[^>]*>.*?</style>', '', html_body, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'<head[^>]*>.*?</head>', '', text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL | re.IGNORECASE)
    
    # Convert common tags to layout elements
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</p>', '\n\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</td>', ' ', text, flags=re.IGNORECASE)
    text = re.sub(r'</tr>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</div>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</h1>|</h2>|</h3>|</h4>', '\n\n', text, flags=re.IGNORECASE)
    text = re.sub(r'<hr[^>]*>', '\n---\n', text, flags=re.IGNORECASE)

    # Convert links to "Text (URL)" format
    def _replace_link(match):
        url = match.group(1) or ""
        link_text = match.group(2) or ""
        # Strip nested tags in the text
        link_text = re.sub(r'<[^>]+>', '', link_text)
        if url and link_text:
            if url.startswith("http"):
                return f"{link_text.strip()} ({url.strip()})"
            return link_text.strip()
        return link_text.strip() or url.strip()

    text = re.sub(
        r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>',
        _replace_link,
        text,
        flags=re.DOTALL | re.IGNORECASE
    )
    
    # Strip remaining HTML tags
    text = re.sub(r'<[^>]+>', '', text)
    
    # Unescape HTML entities
    import html as html_lib
    text = html_lib.unescape(text)
    
    # Clean up excess spaces and line breaks
    lines = [line.strip() for line in text.splitlines()]
    cleaned_lines = []
    prev_blank = False
    for line in lines:
        if line:
            cleaned_lines.append(line)
            prev_blank = False
        else:
            if not prev_blank:
                cleaned_lines.append("")
                prev_blank = True
                
    return "\n".join(cleaned_lines).strip()

def resolve_tenant_for_email(
    tenant: Optional[Any] = None,
    application: Optional[Any] = None,
    interview: Optional[Any] = None,
    to_email: Optional[str] = None
) -> Optional[Any]:
    """
    Dynamically resolve the Tenant model instance for an outgoing email.
    Evaluates:
    1. Explicit tenant instance / slug / UUID
    2. application.tenant, application.job.tenant, application.tenant_id
    3. interview.tenant, interview.application.tenant, interview.tenant_id
    4. Database lookup based on to_email (User -> Tenant, then Application -> Tenant)
    """
    try:
        from app.domain.models import Tenant
        import uuid

        # 1. Direct tenant parameter
        if tenant is not None:
            if hasattr(tenant, "name") and hasattr(tenant, "slug"):
                return tenant
            from app.infrastructure.database import SessionLocal
            with SessionLocal() as db:
                if isinstance(tenant, (str, uuid.UUID)):
                    try:
                        tenant_uuid = uuid.UUID(str(tenant)) if isinstance(tenant, str) else tenant
                        t = db.query(Tenant).filter(Tenant.id == tenant_uuid).first()
                        if t:
                            return t
                    except Exception:
                        pass
                    t = db.query(Tenant).filter(Tenant.slug == str(tenant)).first()
                    if t:
                        return t

        # 2. Check application object
        if application is not None:
            t = getattr(application, "tenant", None)
            if t and hasattr(t, "name"):
                return t
            job = getattr(application, "job", None)
            if job is not None:
                t = getattr(job, "tenant", None)
                if t and hasattr(t, "name"):
                    return t
            tenant_id = getattr(application, "tenant_id", None)
            if tenant_id:
                from app.infrastructure.database import SessionLocal
                with SessionLocal() as db:
                    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
                    if t:
                        return t

        # 3. Check interview object
        if interview is not None:
            t = getattr(interview, "tenant", None)
            if t and hasattr(t, "name"):
                return t
            app = getattr(interview, "application", None)
            if app is not None:
                t = getattr(app, "tenant", None)
                if t and hasattr(t, "name"):
                    return t
                if hasattr(app, "job") and app.job:
                    t = getattr(app.job, "tenant", None)
                    if t and hasattr(t, "name"):
                        return t
            tenant_id = getattr(interview, "tenant_id", None)
            if tenant_id:
                from app.infrastructure.database import SessionLocal
                with SessionLocal() as db:
                    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
                    if t:
                        return t

        # 4. Database lookup by to_email
        if to_email and isinstance(to_email, str) and "@" in to_email:
            cleaned_email = to_email.strip().lower()
            from app.infrastructure.database import SessionLocal
            from app.domain.models import User, Application
            with SessionLocal() as db:
                # A. Check User table (HR, Admin, Candidate account)
                user = db.query(User).filter(User.email.ilike(cleaned_email)).first()
                if user:
                    if user.tenant and hasattr(user.tenant, "name"):
                        return user.tenant
                    if user.tenant_id:
                        t = db.query(Tenant).filter(Tenant.id == user.tenant_id).first()
                        if t:
                            return t

                # B. Check Application table (applicant/candidate email)
                app = db.query(Application).filter(Application.candidate_email.ilike(cleaned_email)).order_by(Application.id.desc()).first()
                if app:
                    if app.tenant and hasattr(app.tenant, "name"):
                        return app.tenant
                    if app.tenant_id:
                        t = db.query(Tenant).filter(Tenant.id == app.tenant_id).first()
                        if t:
                            return t
                    if app.job and app.job.tenant and hasattr(app.job.tenant, "name"):
                        return app.job.tenant
    except Exception as e:
        logger.debug(f"Could not resolve tenant for email ({to_email}): {e}")

    return None

def get_branding_dict(tenant: Optional[Any] = None) -> dict:
    try:
        from app.infrastructure.database import SessionLocal
        from app.core.branding import get_all_branding
        from app.domain.models import Tenant
        import uuid
        with SessionLocal() as db:
            tenant_obj = None
            if tenant is not None:
                if isinstance(tenant, (str, uuid.UUID)):
                    try:
                        tenant_obj = db.query(Tenant).filter((Tenant.id == tenant) | (Tenant.slug == str(tenant))).first()
                    except Exception:
                        pass
                elif hasattr(tenant, "slug") or hasattr(tenant, "settings") or hasattr(tenant, "name"):
                    tenant_obj = tenant
            return get_all_branding(db, tenant_ctx=tenant_obj)
    except Exception as e:
        logger.warning(f"Could not load branding settings from DB: {e}")
        try:
            from app.core.branding import BRANDING_DEFAULTS
            return BRANDING_DEFAULTS.copy()
        except Exception:
            return {
                "company_name": "CALDIM",
                "product_name": "CAL-RIMS",
                "theme_color": "#2563eb",
                "support_email": "support@caldimproducts.com",
                "footer_text": "Powered by CALDIM. Built for teams who care about who they hire."
            }

def get_sender_display_name(
    branding: Optional[dict] = None,
    tenant: Optional[Any] = None,
    explicit_sender: Optional[str] = None
) -> str:
    """
    Dynamically determine the sender display name for emails without hardcoding tenant names.
    Order of precedence:
    1. Explicit sender name (if not default platform names)
    2. Tenant settings branding override (sender_name / company_name)
    3. Tenant organization name (e.g. 'GK', 'Amazon', 'Acme Technologies')
    4. Branding company_name (from get_all_branding)
    5. Branding product_name (if customized away from 'CAL-RIMS')
    6. Platform default fallback: 'CAL-RIMS'
    """
    neutral_names = {"default organization", "caldim", "cal-rims"}

    # 1. Explicitly provided sender
    if explicit_sender and str(explicit_sender).strip():
        cand = str(explicit_sender).strip()
        if cand.lower() not in neutral_names:
            return cand

    # 2. Check tenant object directly
    if tenant is not None:
        tenant_settings = getattr(tenant, "settings", None) or {}
        if isinstance(tenant_settings, dict):
            t_branding = tenant_settings.get("branding", {})
            if isinstance(t_branding, dict):
                sender_override = t_branding.get("sender_name") or t_branding.get("company_name")
                if sender_override and str(sender_override).strip():
                    cand = str(sender_override).strip()
                    if cand.lower() not in neutral_names:
                        return cand

        tenant_name = getattr(tenant, "name", None)
        if tenant_name and str(tenant_name).strip():
            cand = str(tenant_name).strip()
            if cand.lower() not in neutral_names:
                return cand

    # 3. Check branding dict
    if branding and isinstance(branding, dict):
        if branding.get("sender_name") and str(branding["sender_name"]).strip():
            cand = str(branding["sender_name"]).strip()
            if cand.lower() not in neutral_names:
                return cand

        company = branding.get("company_name")
        if company and str(company).strip():
            cand = str(company).strip()
            if cand.lower() not in neutral_names:
                return cand

        prod = branding.get("product_name")
        if prod and str(prod).strip():
            cand = str(prod).strip()
            if cand.lower() not in neutral_names:
                return cand

    # 4. Fallback to platform default
    return "CAL-RIMS"

def _send_via_smtp(
    to_email: str, 
    subject: str, 
    html_body: str, 
    attachments: list = None,
    sender_name: Optional[str] = None,
    tenant: Optional[Any] = None
) -> dict:
    """Core SMTP sending logic using Gmail with a single attempt."""
    # Local development helper: log HTML preview and reroute mock emails to developer's inbox
    if getattr(settings, "env", "development") == "development":
        # BUG-033 Fix: Write only safe metadata to disk (NO body/HTML).
        # The previous implementation wrote the full HTML body, which could include
        # OTPs, candidate PII, offer letter content, and interview links.
        try:
            import time
            debug_dir = os.path.join(str(settings.base_dir), "debug_emails")
            os.makedirs(debug_dir, exist_ok=True)
            safe_subject = "".join(c for c in subject if c.isalnum() or c in (" ", "-", "_")).rstrip()
            safe_subject = safe_subject.replace(" ", "_")[:50]
            filename = f"email_meta_{int(time.time())}_{safe_subject}.txt"
            filepath = os.path.join(debug_dir, filename)
            
            from app.core.observability import safe_hash
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(f"[DEV EMAIL LOG - METADATA ONLY]\n")
                f.write(f"To (hashed): {safe_hash((to_email or '').lower().strip())}\n")
                f.write(f"Subject: {subject}\n")
                f.write(f"Timestamp: {time.time()}\n")
                f.write(f"Body: [REDACTED - not logged to prevent PII/credential exposure]\n")
            logger.info(f"[DEV EMAIL LOGGED] Metadata saved to: {filepath} (body omitted)")
        except Exception as dev_err:
            logger.warning(f"[DEV EMAIL LOGGING FAILED] {dev_err}")


        # Reroute mock/test domain recipients to developer's real configured inbox (SMTP_USER/SMTP_FROM)
        mock_suffixes = [
            "example.com", "test.com"
        ]
        to_email_lower = to_email.lower().strip()
        is_mock = any(to_email_lower.endswith(suffix) for suffix in mock_suffixes)
        
        dev_recipient = settings.smtp_from or settings.smtp_user
        if is_mock and dev_recipient:
            logger.info(f"[DEV EMAIL REDIRECT] Rerouting mock email '{_safe_email_target(to_email)}' to developer's inbox '{dev_recipient}'")
            subject = f"[DEV][to: {_safe_email_target(to_email)}] {subject}"
            to_email = dev_recipient

    try:
        # Create a mixed root message to support attachments alongside the alternative body
        msg = MIMEMultipart("mixed")
        msg["Subject"] = subject
        
        # Set professional Display Name based on tenant and branding settings
        display_name = (sender_name or "").strip() if sender_name else None
        if not display_name:
            meta_match = re.search(r'<meta\s+name=["\']x-sender-name["\']\s+content=["\']([^"\']+)["\']', html_body, re.IGNORECASE)
            if meta_match:
                extracted = meta_match.group(1).strip()
                if extracted:
                    display_name = extracted

        if not display_name:
            match = re.search(r'class="logo-text"[^>]*>([^<]+)<', html_body)
            if match:
                extracted = match.group(1).strip()
                if extracted and extracted.lower() not in ("cal-rims", "caldim", "default organization"):
                    display_name = extracted

        if not display_name:
            tenant_obj = resolve_tenant_for_email(tenant=tenant, to_email=to_email)
            branding = get_branding_dict(tenant=tenant_obj)
            display_name = get_sender_display_name(branding=branding, tenant=tenant_obj)

        if not display_name:
            display_name = "CAL-RIMS"

        from_addr = settings.smtp_from or settings.smtp_user
        msg["From"] = formataddr((display_name, from_addr))
        msg["To"] = to_email

        # Add a unique Message-ID header for domain alignment and spam filter compliance
        from_domain = "rims.local"
        if "@" in from_addr:
            from_domain = from_addr.split("@")[-1]
        msg["Message-ID"] = make_msgid(domain=from_domain)
        msg["X-Auto-Response-Suppress"] = "All"

        # Create the alternative container for text/plain and text/html
        alt_part = MIMEMultipart("alternative")
        
        # Add plain text alternative (must be attached first)
        text_body = _html_to_text(html_body)
        alt_part.attach(MIMEText(text_body, "plain", "utf-8"))
        
        # Add HTML body (attached second)
        alt_part.attach(MIMEText(html_body, "html", "utf-8"))
        
        # Attach the alternative content to the mixed message
        msg.attach(alt_part)

        if attachments:
            for attr in attachments:
                part = MIMEBase("application", "octet-stream")
                part.set_payload(base64.b64decode(attr["content"]))
                encoders.encode_base64(part)
                part.add_header(
                    "Content-Disposition",
                    f"attachment; filename= {attr['filename']}",
                )
                msg.attach(part)

        # Use a timeout for the SMTP connection
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as server:
            server.starttls()
            server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)
        
        # LOG SUCCESS ONLY ONCE THE MESSAGE IS SENT
        logger.info(f"[EMAIL SUCCESS] Mail definitely accepted by relay for {_safe_email_target(to_email)}")
        _audit_email_event(
            "EMAIL_SEND_SUCCESS",
            to_email=to_email,
            details={
                "provider": "smtp",
                "smtp_host": settings.smtp_host,
                "smtp_port": settings.smtp_port,
            },
        )
        return {"success": True, "error": None}
    except Exception as e:
        error_msg = str(e)
        deferred = _is_gmail_quota_error(e)
        logger.error(
            f"[EMAIL ATTEMPT FAILED] provider=smtp to={_safe_email_target(to_email)} deferred={deferred} "
            f"exc_class={e.__class__.__name__} error={error_msg}",
            exc_info=True,
        )
        _audit_email_event(
            "EMAIL_SEND_FAILED",
            to_email=to_email,
            details={
                "provider": "smtp",
                "deferred": deferred,
                "exc_class": e.__class__.__name__,
                "error": error_msg[:800],
            },
        )
        return {"success": False, "error": error_msg, "deferred": deferred}

async def _send_via_resend(
    to_email: str, 
    subject: str, 
    html_body: str, 
    idempotency_key: Optional[str] = None,
    sender_name: Optional[str] = None,
    tenant: Optional[Any] = None
) -> dict:
    """
    Send an HTML email via Resend's HTTP API.
    Note: for now we don't implement attachments here.
    """
    try:
        api_key = getattr(settings, "resend_api_key", "") or ""
        if not api_key:
            return {"success": False, "error": "RESEND_API_KEY not configured"}

        # Resend is explicit opt-in: require RESEND_FROM to avoid unverified sender domains.
        from_email = getattr(settings, "resend_from", "") or ""
        if not from_email:
            return {"success": False, "error": "RESEND_FROM not configured (Resend disabled)"}

        # Set professional Display Name based on tenant and branding settings
        display_name = (sender_name or "").strip() if sender_name else None
        if not display_name:
            meta_match = re.search(r'<meta\s+name=["\']x-sender-name["\']\s+content=["\']([^"\']+)["\']', html_body, re.IGNORECASE)
            if meta_match:
                extracted = meta_match.group(1).strip()
                if extracted:
                    display_name = extracted

        if not display_name:
            match = re.search(r'class="logo-text"[^>]*>([^<]+)<', html_body)
            if match:
                extracted = match.group(1).strip()
                if extracted and extracted.lower() not in ("cal-rims", "caldim", "default organization"):
                    display_name = extracted

        if not display_name:
            tenant_obj = resolve_tenant_for_email(tenant=tenant, to_email=to_email)
            branding = get_branding_dict(tenant=tenant_obj)
            display_name = get_sender_display_name(branding=branding, tenant=tenant_obj)

        if not display_name:
            display_name = "CAL-RIMS"

        from_formatted = formataddr((display_name, from_email))

        # Generate readable plain text representation as a fallback
        text_body = _html_to_text(html_body)

        payload = {
            "from": from_formatted,
            "to": to_email,
            "subject": subject,
            "html": html_body,
            "text": text_body,
        }
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        
        # Prevent duplicates during retries by sending the unique Idempotency-Key header to Resend API
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key

        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post("https://api.resend.com/emails", json=payload, headers=headers)

        if resp.status_code in (200, 201):
            logger.info(f"[EMAIL SUCCESS] Resend accepted message for {_safe_email_target(to_email)}")
            _audit_email_event(
                "EMAIL_SEND_SUCCESS",
                to_email=to_email,
                details={
                    "provider": "resend",
                    "status_code": resp.status_code,
                },
            )
            return {"success": True, "error": None}

        # Avoid returning huge bodies to logs.
        err_preview = (resp.text or "").strip()[:500]
        logger.error(
            f"[EMAIL ATTEMPT FAILED] provider=resend to={_safe_email_target(to_email)} http_status={resp.status_code} "
            f"error_preview={err_preview}"
        )
        _audit_email_event(
            "EMAIL_SEND_FAILED",
            to_email=to_email,
            details={
                "provider": "resend",
                "status_code": resp.status_code,
                "error_preview": err_preview,
            },
        )
        return {"success": False, "error": f"Resend failed with HTTP {resp.status_code}", "status_code": resp.status_code}
    except Exception as e:
        logger.error(f"[EMAIL ATTEMPT FAILED] Resend {_safe_email_target(to_email)}: {e}", exc_info=True)
        _audit_email_event(
            "EMAIL_SEND_FAILED",
            to_email=to_email,
            details={
                "provider": "resend",
                "exc_class": e.__class__.__name__,
                "error": str(e)[:800],
            },
        )
        return {"success": False, "error": str(e)}

async def _send_via_smtp_helper(
    to_email: str, 
    subject: str, 
    html_body: str, 
    attachments: list = None,
    sender_name: Optional[str] = None,
    tenant: Optional[Any] = None
) -> dict:
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        None,
        lambda: _send_via_smtp(
            to_email,
            subject,
            html_body,
            attachments,
            sender_name=sender_name,
            tenant=tenant,
        ),
    )
    return {**result, "provider": "smtp"}


async def _send_via_resend_helper(
    to_email: str, 
    subject: str, 
    html_body: str, 
    idempotency_key: Optional[str] = None,
    sender_name: Optional[str] = None,
    tenant: Optional[Any] = None
) -> dict:
    result = await _send_via_resend(
        to_email, subject, html_body, idempotency_key, sender_name=sender_name, tenant=tenant
    )
    if result["success"]:
        return {**result, "provider": "resend"}

    # Fallback to SMTP if SMTP is configured
    smtp_configured = bool(settings.smtp_host and settings.smtp_user and settings.smtp_password)
    if smtp_configured:
        logger.warning(
            f"[EMAIL FALLBACK TO SMTP] Resend failed for {_safe_email_target(to_email)} ({result.get('error')}); falling back to SMTP."
        )
        return await _send_via_smtp_helper(
            to_email, subject, html_body, None, sender_name=sender_name, tenant=tenant
        )

    return {**result, "provider": "resend"}


async def send_email_async(
    to_email: str,
    subject: str,
    html_body: str,
    attachments: list = None,
    provider: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    sender_name: Optional[str] = None,
    tenant: Optional[Any] = None
) -> dict:
    """Async wrapper for SMTP / Resend selection with fallback and standardized retries:
    Attempt 1 -> 1s delay -> Attempt 2 -> 5s delay -> Attempt 3.
    """
    if not idempotency_key:
        idempotency_key = str(uuid.uuid4())

    retry_delays = [1.0, 5.0]
    last_result = {"success": False, "error": "Not attempted"}

    for attempt in range(3):
        if provider == "smtp":
            result = await _send_via_smtp_helper(
                to_email, subject, html_body, attachments, sender_name=sender_name, tenant=tenant
            )
        elif provider == "resend":
            result = await _send_via_resend_helper(
                to_email, subject, html_body, idempotency_key, sender_name=sender_name, tenant=tenant
            )
        else:
            if attachments:
                result = await _send_via_smtp_helper(
                    to_email, subject, html_body, attachments, sender_name=sender_name, tenant=tenant
                )
            else:
                resend_api_key = (getattr(settings, "resend_api_key", "") or "").strip()
                resend_from = (getattr(settings, "resend_from", "") or "").strip()
                if resend_api_key and resend_from:
                    result = await _send_via_resend_helper(
                        to_email, subject, html_body, idempotency_key, sender_name=sender_name, tenant=tenant
                    )
                else:
                    result = await _send_via_smtp_helper(
                        to_email, subject, html_body, attachments, sender_name=sender_name, tenant=tenant
                    )
        
        if result["success"]:
            return result
        
        last_result = result
        if result.get("deferred"):
            # If SMTP deferred (Gmail daily sending limit or quota error), do not retry
            return result
            
        if attempt < 2:
            wait_time = retry_delays[attempt]
            logger.warning(
                f"[EMAIL RETRY] Attempt {attempt + 1} failed for {_safe_email_target(to_email)}. "
                f"Retrying in {wait_time}s... Error: {result.get('error')}"
            )
            await asyncio.sleep(wait_time)

    return last_result

async def execute_email_with_retries(
    to_email: str, 
    subject: str, 
    body: str, 
    application: Any = None, 
    max_retries: int = 3, # Standard retry logic is now embedded in send_email_async
    event_type: str = "GENERIC",
    attachments: list = None,
    sender_name: Optional[str] = None,
    tenant: Optional[Any] = None
):
    """Production-grade email wrapper with persistent idempotency and retries."""
    event_id = str(uuid.uuid4())[:8]
    logger.info(f"[EMAIL][QUEUE] {event_type} (Event: {event_id}) for {_safe_email_target(to_email)}")
    
    tenant_obj = tenant or resolve_tenant_for_email(application=application, to_email=to_email)

    # 1. Atomic Idempotency Check (Persistent)
    if application and hasattr(application, 'id'):
        try:
            from app.infrastructure.database import SessionLocal
            from app.domain.models import Application
            from sqlalchemy import update, and_, or_
            from app.core.timezone import get_ist_now
            
            # Crash/restart tolerance window: 15 minutes.
            # If email_status is 'processing' but updated_at is older than 15 minutes,
            # we assume the process died/hung and allow retrying it.
            expiry_threshold = get_ist_now() - timedelta(minutes=15)
            
            with SessionLocal() as db:
                # Atomically set to 'processing' ONLY if:
                # - Not already 'sent' AND
                # - (Status is not 'processing' OR status is 'processing' but it has timed out/expired)
                stmt = (
                    update(Application)
                    .where(and_(
                        Application.id == application.id,
                        Application.email_status != 'sent',
                        or_(
                            Application.email_status != 'processing',
                            Application.updated_at < expiry_threshold
                        )
                    ))
                    .values(email_status='processing', updated_at=get_ist_now())
                )
                res = db.execute(stmt)
                db.commit()
                if res.rowcount == 0:
                    logger.warning(f"[EMAIL][SKIPPED] Atomic duplicate prevented (Event: {event_id}) for App #{application.id}")
                    return True
        except Exception as db_err:
            logger.warning(f"[EMAIL][ATOMIC_GUARD_FAILED] Fallback to runtime check (Event: {event_id}): {db_err}")
            if hasattr(application, 'email_sent_at') and application.email_sent_at:
                return True

    # 2. Call standard sender (which handles internal retries, using event_id as the stable idempotency key)
    try:
        result = await send_email_async(
            to_email, subject, body, attachments, 
            idempotency_key=event_id,
            sender_name=sender_name,
            tenant=tenant_obj
        )
        if result["success"]:
            logger.info(f"[EMAIL][EXECUTED] (Event: {event_id}) successfully sent to {_safe_email_target(to_email)}")
            
            # 3. Update Persistence
            if application and hasattr(application, 'id'):
                try:
                    from app.infrastructure.database import SessionLocal
                    from app.domain.models import Application
                    from sqlalchemy import update
                    from app.core.timezone import get_ist_now
                    with SessionLocal() as db:
                        db.execute(
                            update(Application)
                            .where(Application.id == application.id)
                            .values(email_sent_at=get_ist_now(), email_status='sent', updated_at=get_ist_now())
                        )
                        db.commit()
                except Exception as db_err:
                    logger.warning(f"[EMAIL][DB_UPDATE_FAILED] Could not persist status (Event: {event_id}): {db_err}")
            
            return True
        else:
            error_msg = result.get("error")
            logger.error(f"[EMAIL][FAILURE] (Event: {event_id}) failed: {error_msg}")
    except Exception as e:
        logger.error(f"[EMAIL][ERROR] (Event: {event_id}) Unexpected error: {str(e)}")

    # 4. Final Failure Update
    if application and hasattr(application, 'id'):
        try:
            from app.infrastructure.database import SessionLocal
            from app.domain.models import Application
            from sqlalchemy import update
            from app.core.timezone import get_ist_now
            with SessionLocal() as db:
                db.execute(
                    update(Application)
                    .where(Application.id == application.id)
                    .values(email_status='failed', updated_at=get_ist_now())
                )
                db.commit()
        except Exception as e:
            logger.warning(f"Failed to update email status for application {application.id}: {e}")

    logger.error(f"[EMAIL][PERMANENT_FAILURE] (Event: {event_id}) Failed for {_safe_email_target(to_email)}")
    return False

def get_templated_email(
    content_html: str, 
    title: str, 
    tenant: Optional[Any] = None,
    sender_name: Optional[str] = None
) -> str:
    tenant_obj = resolve_tenant_for_email(tenant=tenant)
    branding = get_branding_dict(tenant=tenant_obj)
    company_name = branding.get("company_name", "CALDIM")
    product_name = branding.get("product_name", "CAL-RIMS")
    theme_color = branding.get("theme_color", "#2563eb")
    support_email = branding.get("support_email", "support@caldimproducts.com")
    footer_text = branding.get("footer_text", "Powered by CALDIM. Built for teams who care about who they hire.")

    sender_display_name = get_sender_display_name(branding=branding, tenant=tenant_obj, explicit_sender=sender_name)

    neutral_names = {"default organization", "caldim", "cal-rims"}
    if product_name and product_name.strip().lower() not in neutral_names:
        header_display_name = product_name.strip()
    elif sender_display_name and sender_display_name.strip().lower() not in neutral_names:
        header_display_name = sender_display_name.strip()
    else:
        header_display_name = product_name or "CAL-RIMS"

    copyright_name = sender_display_name if sender_display_name.strip().lower() not in neutral_names else (company_name or "CALDIM")

    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-sender-name" content="{html.escape(sender_display_name)}">
  <title>{html.escape(title)}</title>
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background-color: #f8fafc;
      color: #1e293b;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }}
    .email-container {{
      max-width: 580px;
      margin: 40px auto;
      padding: 0 20px;
    }}
    .header {{
      text-align: center;
      padding-bottom: 24px;
    }}
    .logo-text {{
      font-size: 24px;
      font-weight: 800;
      color: {theme_color};
      letter-spacing: -0.5px;
      margin: 0;
    }}
    .card {{
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 32px 40px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
    }}
    .footer {{
      text-align: center;
      padding-top: 24px;
      font-size: 12px;
      color: #64748b;
      line-height: 1.5;
    }}
    .footer a {{
      color: {theme_color};
      text-decoration: none;
    }}
    .divider {{
      border: 0;
      border-top: 1px solid #e2e8f0;
      margin: 24px 0;
    }}
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <h1 class="logo-text">{html.escape(header_display_name)}</h1>
    </div>
    <div class="card">
      {content_html}
    </div>
    <div class="footer">
      <p>{html.escape(footer_text)}</p>
      <p>
        Need help? Contact our support at <a href="mailto:{html.escape(support_email)}">{html.escape(support_email)}</a>
      </p>
      <p style="margin-top: 16px; font-size: 11px; color: #94a3b8;">
        This email was automatically generated. If you did not initiate this request, please ignore this email or contact support.
      </p>
      <p style="margin-top: 8px; font-size: 11px; color: #94a3b8;">
        © {datetime.now(timezone.utc).year} {html.escape(copyright_name)}. All rights reserved.
      </p>
    </div>
  </div>
</body>
</html>
"""

# --- Email Templates ---

async def send_otp_email(to_email: str, otp: str, tenant: Optional[Any] = None):
    subject = "Verify your account for the Recruitment System"
    tenant_obj = resolve_tenant_for_email(tenant=tenant, to_email=to_email)
    branding = get_branding_dict(tenant=tenant_obj)
    sender_name = get_sender_display_name(branding=branding, tenant=tenant_obj)
    company_name = sender_name if sender_name.lower() not in ("cal-rims", "caldim", "default organization") else branding.get("company_name", "CALDIM")
    content_html = f"""
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:700; text-align:center;">Account Verification</h2>
      <p style="font-size:15px; line-height:1.6; color:#334155; text-align:center; margin-bottom:24px;">
        Thank you for joining <strong>{html.escape(company_name)}</strong>! Please use the verification code below to complete your account setup. This code will expire in 30 minutes.
      </p>
      <div style="text-align:center; margin:32px 0;">
        <span style="display:inline-block; background:#f1f5f9; color:#0f172a; font-size:28px; font-weight:700; font-family:monospace; padding:12px 28px; border-radius:8px; border:1px solid #e2e8f0; letter-spacing:6px; padding-left:34px;">{html.escape(str(otp))}</span>
      </div>
      <p style="font-size:13px; line-height:1.5; color:#64748b; text-align:center; margin-top:24px;">
        If you did not request this verification code, please ignore this message. Your account remains secure.
      </p>
    """
    body = get_templated_email(content_html, subject, tenant=tenant_obj, sender_name=sender_name)
    return await execute_email_with_retries(
        to_email, subject, body, 
        tenant=tenant_obj, 
        sender_name=sender_name, 
        event_type="OTP_VERIFICATION"
    )

async def send_password_reset_email(to_email: str, otp: str, tenant: Optional[Any] = None):
    subject = "Password Reset Request"
    tenant_obj = resolve_tenant_for_email(tenant=tenant, to_email=to_email)
    branding = get_branding_dict(tenant=tenant_obj)
    sender_name = get_sender_display_name(branding=branding, tenant=tenant_obj)
    theme_color = branding.get("theme_color", "#2563eb")
    company_name = sender_name if sender_name.lower() not in ("cal-rims", "caldim", "default organization") else branding.get("company_name", "CALDIM")
    frontend_url = settings.frontend_base_url
    reset_link = f"{frontend_url}/auth/reset-password?email={to_email}&otp={otp}"
    
    content_html = f"""
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:700; text-align:center;">Reset Your Password</h2>
      <p style="font-size:15px; line-height:1.6; color:#334155; text-align:center; margin-bottom:24px;">
        We received a request to reset the password for your account at <strong>{html.escape(company_name)}</strong>. Use the verification code below or click the button to set a new password. This link and code will expire in 30 minutes.
      </p>
      <div style="text-align:center; margin:32px 0;">
        <span style="display:inline-block; background:#f1f5f9; color:#0f172a; font-size:28px; font-weight:700; font-family:monospace; padding:12px 28px; border-radius:8px; border:1px solid #e2e8f0; letter-spacing:6px; padding-left:34px;">{html.escape(str(otp))}</span>
      </div>
      <div style="text-align:center; margin:32px 0;">
        <a href="{reset_link}" style="background-color:{theme_color}; color:#ffffff; padding:12px 28px; text-decoration:none; border-radius:8px; font-weight:700; font-size:15px; display:inline-block; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">Reset Password</a>
      </div>
      <div class="divider"></div>
      <p style="font-size:13px; line-height:1.5; color:#64748b; margin-top:24px;">
        If the button above does not work, copy and paste this link into your browser:
      </p>
      <p style="font-size:13px; word-break:break-all; line-height:1.5; color:#64748b;">
        <a href="{reset_link}" style="color:{theme_color}; text-decoration:underline;">{reset_link}</a>
      </p>
      <p style="font-size:13px; line-height:1.5; color:#64748b; margin-top:24px;">
        If you did not request a password reset, please ignore this email. Your password will remain unchanged.
      </p>
    """
    body = get_templated_email(content_html, subject, tenant=tenant_obj, sender_name=sender_name)
    return await execute_email_with_retries(
        to_email, subject, body, 
        tenant=tenant_obj, 
        sender_name=sender_name, 
        event_type="PASSWORD_RESET"
    )

async def send_application_received_email(to_email_or_app: Any, job_title: str = None, tenant: Optional[Any] = None):
    app_obj = to_email_or_app if hasattr(to_email_or_app, 'candidate_email') else None
    to_email = app_obj.candidate_email if app_obj else str(to_email_or_app)
    if app_obj and hasattr(app_obj, 'job') and app_obj.job:
        job_title = app_obj.job.title
    else:
        job_title = job_title or "Position"

    tenant_obj = resolve_tenant_for_email(tenant=tenant, application=app_obj, to_email=to_email)
    branding = get_branding_dict(tenant=tenant_obj)
    sender_name = get_sender_display_name(branding=branding, tenant=tenant_obj)
    subject = f"Application Received: {job_title}"
    content_html = f"""
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:700; text-align:center;">Thank You for Applying!</h2>
      <p style="font-size:15px; line-height:1.6; color:#334155; text-align:center; margin-bottom:24px;">
        We have successfully received your application for the position of <strong>{html.escape(str(job_title))}</strong>.
      </p>
      <p style="font-size:15px; line-height:1.6; color:#334155; text-align:center;">
        Our hiring team will review your profile shortly and get back to you with updates on the next steps.
      </p>
    """
    body = get_templated_email(content_html, subject, tenant=tenant_obj, sender_name=sender_name)
    return await execute_email_with_retries(
        to_email, subject, body, 
        application=app_obj if hasattr(app_obj, 'id') else None,
        tenant=tenant_obj,
        sender_name=sender_name,
        event_type="APP_RECEIVED"
    )

async def send_interview_invitation_email(application: Any, raw_access_key: str = "", tenant: Optional[Any] = None):
    tenant_obj = resolve_tenant_for_email(tenant=tenant, application=application, to_email=application.candidate_email)
    branding = get_branding_dict(tenant=tenant_obj)
    sender_name = get_sender_display_name(branding=branding, tenant=tenant_obj)
    subject = f"Congratulations! You're invited to interview for {application.job.title}"
    theme_color = branding.get("theme_color", "#2563eb")
    frontend_url = settings.frontend_base_url
    access_url = f"{frontend_url}/interview/access?email={application.candidate_email}&key={raw_access_key}"
    support_url = f"{frontend_url}/support?{urlencode({'email': application.candidate_email, 'access_key': raw_access_key})}"
    
    content_html = f"""
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:700; text-align:center;">Interview Invitation</h2>
      <p style="font-size:15px; line-height:1.6; color:#334155; text-align:center; margin-bottom:24px;">
        Great news! Your application for <strong>{html.escape(str(application.job.title))}</strong> has been approved.
      </p>
      <p style="font-size:15px; line-height:1.6; color:#334155; text-align:center; margin-bottom:24px;">
        Please use the secure link below to access the interview portal. This link is unique to you.
      </p>
      <div style="text-align:center; margin:32px 0;">
        <a href="{html.escape(str(access_url))}" style="background-color:{theme_color}; color:#ffffff; padding:14px 28px; text-decoration:none; border-radius:8px; font-weight:700; font-size:16px; display:inline-block; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">Begin Interview</a>
      </div>
      <p style="font-size:13px; line-height:1.5; color:#64748b;">
        If the button above does not work, copy and paste this link into your browser:
      </p>
      <p style="font-size:13px; word-break:break-all; line-height:1.5; color:#64748b; margin-bottom:24px;">
        <a href="{html.escape(str(access_url))}" style="color:{theme_color}; text-decoration:underline;">{html.escape(str(access_url))}</a>
      </p>
      <div class="divider"></div>
      <div style="background:#f8fafc; border-left:4px solid #f59e0b; padding:16px; border-radius:6px; margin:24px 0; text-align:left;">
        <p style="margin:0 0 8px 0; font-weight:700; color:#92400e; font-size:14px;">📅 Need to Reschedule?</p>
        <p style="margin:0 0 8px 0; color:#555; font-size:13px; line-height:1.5;">If you are unable to attend the interview at this time or encountered a technical issue, please contact us via the Support Portal below.</p>
        <p style="margin:0; font-size:13px; word-break:break-all; line-height:1.5;">
          👉 <a href="{html.escape(str(support_url))}" style="color:{theme_color}; font-weight:700; text-decoration:underline;">{html.escape(str(support_url))}</a>
        </p>
      </div>
    """
    body = get_templated_email(content_html, subject, tenant=tenant_obj, sender_name=sender_name)
    return await execute_email_with_retries(
        application.candidate_email, 
        subject, 
        body, 
        application=application,
        tenant=tenant_obj,
        sender_name=sender_name,
        event_type="INTERVIEW_INVITE"
    )

async def send_approved_for_interview_email(to_email: str, job_title: str, raw_access_key: str = "", tenant: Optional[Any] = None, application: Any = None):
    tenant_obj = resolve_tenant_for_email(tenant=tenant, application=application, to_email=to_email)
    branding = get_branding_dict(tenant=tenant_obj)
    sender_name = get_sender_display_name(branding=branding, tenant=tenant_obj)
    subject = f"Congratulations! You're invited to interview for {job_title}"
    theme_color = branding.get("theme_color", "#2563eb")
    frontend_url = settings.frontend_base_url
    try:
        parsed = urlparse(frontend_url)
        base = parsed.netloc or frontend_url
        logger.debug(f"Generated interview link base: {base}")
    except Exception:
        pass
    access_url = f"{frontend_url}/interview/access?email={to_email}&key={raw_access_key}"
    support_url = f"{frontend_url}/support?{urlencode({'email': to_email, 'access_key': raw_access_key})}"
    
    content_html = f"""
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:700; text-align:center;">Interview Invitation</h2>
      <p style="font-size:15px; line-height:1.6; color:#334155; text-align:center; margin-bottom:24px;">
        Your application for <strong>{html.escape(str(job_title))}</strong> has been approved!
      </p>
      <p style="font-size:15px; line-height:1.6; color:#334155; text-align:center; margin-bottom:24px;">
        Please use the secure link below to access the interview portal. This link is unique to you and expires in 10 days.
      </p>
      <div style="text-align:center; margin:32px 0;">
        <a href="{html.escape(str(access_url))}" style="background-color:{theme_color}; color:#ffffff; padding:14px 28px; text-decoration:none; border-radius:8px; font-weight:700; font-size:16px; display:inline-block; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">Begin Interview</a>
      </div>
      <p style="font-size:13px; line-height:1.5; color:#64748b;">
        If the button above does not work, copy and paste this link into your browser:
      </p>
      <p style="font-size:13px; word-break:break-all; line-height:1.5; color:#64748b; margin-bottom:24px;">
        <a href="{html.escape(str(access_url))}" style="color:{theme_color}; text-decoration:underline;">{html.escape(str(access_url))}</a>
      </p>
      <div class="divider"></div>
      <div style="background:#f8fafc; border-left:4px solid #f59e0b; padding:16px; border-radius:6px; margin:24px 0; text-align:left;">
        <p style="margin: 0 0 6px 0; font-weight:700; color:#92400e; font-size:14px;">Need help with your interview experience?</p>
        <p style="margin: 0 0 12px 0; color:#555; font-size:13px; line-height:1.5;">If you faced a technical issue, unexpected termination, or need to raise a grievance, use the Support Portal:</p>
        <p style="margin: 0; font-size:13px; word-break:break-all; line-height:1.5;">
          👉 <a href="{html.escape(str(support_url))}" style="color:{theme_color}; font-weight:700; text-decoration:underline;">{html.escape(str(support_url))}</a>
        </p>
      </div>
    """
    body = get_templated_email(content_html, subject, tenant=tenant_obj, sender_name=sender_name)
    return await execute_email_with_retries(
        to_email, subject, body, 
        application=application,
        tenant=tenant_obj,
        sender_name=sender_name,
        event_type="INTERVIEW_INVITE"
    )

async def send_hired_email(
    to_email: str,
    job_title: str,
    interview=None,
    offer_letter_path: str = None,
    application: Any = None,
    tenant: Optional[Any] = None,
    interview_id: Optional[int] = None,
):
    subject = "Congratulations! You have been selected"
    if interview is None and interview_id is not None and tenant is None and application is None:
        try:
            from app.infrastructure.database import SessionLocal
            from app.domain.models import Interview, Application
            from sqlalchemy.orm import joinedload
            with SessionLocal() as db:
                db_interview = (
                    db.query(Interview)
                    .options(
                        joinedload(Interview.application).joinedload(Application.job)
                    )
                    .filter(Interview.id == interview_id)
                    .first()
                )
                if db_interview is not None:
                    tenant_obj = resolve_tenant_for_email(
                        tenant=tenant, application=application, interview=db_interview, to_email=to_email
                    )
                else:
                    tenant_obj = resolve_tenant_for_email(
                        tenant=tenant, application=application, interview=interview, to_email=to_email
                    )
        except Exception:
            tenant_obj = resolve_tenant_for_email(tenant=tenant, application=application, interview=interview, to_email=to_email)
    else:
        tenant_obj = resolve_tenant_for_email(tenant=tenant, application=application, interview=interview, to_email=to_email)
    branding = get_branding_dict(tenant=tenant_obj)
    sender_name = get_sender_display_name(branding=branding, tenant=tenant_obj)
    company_name = sender_name if sender_name.lower() not in ("cal-rims", "caldim", "default organization") else branding.get("company_name", "CALDIM")
    content_html = f"""
      <h2 style="margin-top:0; color:#10b981; font-size:20px; font-weight:700; text-align:center;">Congratulations!</h2>
      <p style="font-size:15px; line-height:1.6; color:#334155; text-align:center; margin-bottom:24px;">
        We are thrilled to inform you that you have been selected for the position of <strong>{html.escape(str(job_title))}</strong> at <strong>{html.escape(company_name)}</strong>!
      </p>
      <p style="font-size:15px; line-height:1.6; color:#334155; text-align:center;">
        Our HR team will reach out to you within 24-48 hours to guide you through the next steps of the onboarding process.
      </p>
    """
    body = get_templated_email(content_html, subject, tenant=tenant_obj, sender_name=sender_name)
    attachments = []
    if offer_letter_path:
        # Determine storage type: Supabase storage paths (e.g. "offer_letters/offer_123_456.pdf")
        # must ALWAYS be fetched from cloud — never from local disk — to prevent a stale local
        # file from silently shadowing the canonical Supabase copy.
        is_supabase_path = "offer_letters/" in offer_letter_path and not (os.path.isabs(offer_letter_path) or offer_letter_path.startswith("/") or offer_letter_path.startswith("\\"))

        # 1. Cloud Storage (primary for all template-driven offer letters)
        if is_supabase_path:
            try:
                from app.core.storage import download_file
                from app.core.config import get_settings
                settings = get_settings()

                logger.info(f"Fetching offer letter from cloud storage: {offer_letter_path}")
                content_bytes = download_file(settings.supabase_bucket_offers, offer_letter_path)

                if content_bytes:
                    content_b64 = base64.b64encode(content_bytes).decode("utf-8")
                    attachments.append({
                        "filename": f"Offer_Letter_{os.path.basename(offer_letter_path)}",
                        "content": content_b64,
                    })
                else:
                    logger.error(f"Offer letter not found in bucket {settings.supabase_bucket_offers}: {offer_letter_path}")
            except Exception as e:
                logger.error(f"Cloud storage attachment failed for {offer_letter_path}: {e}")

        # 2. Local disk (legacy fallback for absolute paths from manual uploads only)
        elif os.path.exists(offer_letter_path):
            try:
                with open(offer_letter_path, "rb") as f:
                    content = base64.b64encode(f.read()).decode("utf-8")
                    attachments.append({
                        "filename": os.path.basename(offer_letter_path),
                        "content": content,
                    })
            except Exception as e:
                logger.error(f"Failed to read local offer letter: {e}")

        else:
            logger.warning(f"Offer letter path not found locally or in cloud: {offer_letter_path}")

    return await execute_email_with_retries(
        to_email, subject, body, 
        application=application,
        tenant=tenant_obj,
        sender_name=sender_name,
        attachments=attachments if attachments else None,
        event_type="HIRED_NOTICE"
    )

async def send_simple_email(to_email: str, subject: str, message: str, tenant: Optional[Any] = None):
    """Utility for sending internal/simple notification emails."""
    tenant_obj = resolve_tenant_for_email(tenant=tenant, to_email=to_email)
    branding = get_branding_dict(tenant=tenant_obj)
    sender_name = get_sender_display_name(branding=branding, tenant=tenant_obj)
    content_html = f"""
      <p style="font-size:15px; line-height:1.6; color:#334155;">
        {html.escape(str(message))}
      </p>
    """
    body = get_templated_email(content_html, subject, tenant=tenant_obj, sender_name=sender_name)
    result = await send_email_async(
        to_email, subject, body, 
        tenant=tenant_obj, 
        sender_name=sender_name
    )
    return result["success"]

async def send_offer_letter_email(to_email: str, candidate_name: str, company_name: str, offer_letter_url: str, accept_link: str = "", reject_link: str = "", tenant: Optional[Any] = None, application: Any = None):
    """
    Sends offer letter email with attachment. 
    Supports both local paths and cloud URLs (will download before attaching).
    """
    tenant_obj = resolve_tenant_for_email(tenant=tenant, application=application, to_email=to_email)
    branding = get_branding_dict(tenant=tenant_obj)
    sender_name = get_sender_display_name(branding=branding, tenant=tenant_obj, explicit_sender=company_name)
    display_company = sender_name if sender_name.lower() not in ("cal-rims", "caldim", "default organization") else (company_name or "CALDIM")
    subject = f"Offer Letter - {display_company}"
    theme_color = branding.get("theme_color", "#2563eb")
    content_html = f"""
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:700;">Hello {html.escape(str(candidate_name))},</h2>
      <p style="font-size:15px; line-height:1.6; color:#334155; margin-bottom:24px;">
        Congratulations! We are pleased to offer you a position at <strong>{html.escape(str(display_company))}</strong>.
      </p>
      <p style="font-size:15px; line-height:1.6; color:#334155; margin-bottom:24px;">
        Please find the attached offer letter for your review. We are excited about the possibility of you joining our team!
      </p>
      
      <div style="margin: 32px 0; padding: 24px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; text-align: center;">
        <h4 style="margin-top: 0; color:#0f172a; margin-bottom: 16px;">Please respond to this offer:</h4>
        <a href="{html.escape(str(accept_link))}" style="background-color: #10b981; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-right: 15px; display: inline-block; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">Accept Offer</a>
        <a href="{html.escape(str(reject_link))}" style="background-color: #ef4444; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">Reject Offer</a>
      </div>

      <p style="font-size:13px; line-height:1.5; color:#64748b;">If the buttons above do not work, use these links:</p>
      <p style="font-size:13px; word-break:break-all; line-height:1.5; color:#64748b;">
        Accept: <a href="{html.escape(str(accept_link))}" style="color:{theme_color}; text-decoration:underline;">{html.escape(str(accept_link))}</a>
      </p>
      <p style="font-size:13px; word-break:break-all; line-height:1.5; color:#64748b; margin-bottom:24px;">
        Reject: <a href="{html.escape(str(reject_link))}" style="color:{theme_color}; text-decoration:underline;">{html.escape(str(reject_link))}</a>
      </p>
      
      <br><p>Best Regards,<br>HR Team, {html.escape(str(display_company))}</p>
    """
    body = get_templated_email(content_html, subject, tenant=tenant_obj, sender_name=sender_name)
    attachments = []
    if offer_letter_url:
        try:
            # Check if it's a URL or local path
            if offer_letter_url.startswith("http"):
                # Download from Cloud (e.g. Supabase)
                async with httpx.AsyncClient(timeout=30.0) as client:
                    logger.info(f"Downloading offer letter from cloud: {offer_letter_url}")
                    resp = await client.get(offer_letter_url)
                    if resp.status_code == 200:
                        content = base64.b64encode(resp.content).decode("utf-8")
                        attachments.append({
                            "filename": f"Offer_Letter_{candidate_name.replace(' ', '_')}.pdf",
                            "content": content,
                        })
                    else:
                        logger.error(f"Failed to download offer letter for attachment: {resp.status_code}")
            elif os.path.exists(offer_letter_url):
                with open(offer_letter_url, "rb") as f:
                    content = base64.b64encode(f.read()).decode("utf-8")
                    attachments.append({
                        "filename": os.path.basename(offer_letter_url),
                        "content": content,
                    })
        except Exception as e:
            logger.error(f"Email attachment processing failed: {e}")

    return await execute_email_with_retries(
        to_email, subject, body, 
        application=application,
        tenant=tenant_obj,
        sender_name=sender_name,
        attachments=attachments if attachments else None,
        event_type="OFFER_LETTER"
    )


async def send_screened_email(to_email: str, job_title: str, application: Any = None, tenant: Optional[Any] = None):
    tenant_obj = resolve_tenant_for_email(tenant=tenant, application=application, to_email=to_email)
    branding = get_branding_dict(tenant=tenant_obj)
    sender_name = get_sender_display_name(branding=branding, tenant=tenant_obj)
    subject = "Update on Your Application"
    content_html = f"""
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:700; text-align:center;">Application Update</h2>
      <p style="font-size:15px; line-height:1.6; color:#334155; text-align:center; margin-bottom:24px;">
        We are writing to let you know that your application for the <strong>{html.escape(str(job_title))}</strong> position has been successfully screened by our team.
      </p>
      <p style="font-size:15px; line-height:1.6; color:#334155; text-align:center;">
        Your profile is currently under review, and we will get back to you with the next steps soon.
      </p>
    """
    body = get_templated_email(content_html, subject, tenant=tenant_obj, sender_name=sender_name)
    return await execute_email_with_retries(
        to_email, subject, body, 
        application=application, 
        tenant=tenant_obj,
        sender_name=sender_name,
        event_type="APP_SCREENED"
    )

async def send_rejected_email(to_email: str, job_title: str, is_ai_auto_reject: bool = False, application: Any = None, tenant: Optional[Any] = None):
    tenant_obj = resolve_tenant_for_email(tenant=tenant, application=application, to_email=to_email)
    branding = get_branding_dict(tenant=tenant_obj)
    sender_name = get_sender_display_name(branding=branding, tenant=tenant_obj)
    subject = f"Update on your application for {job_title}"
    reason = "we found that your resume did not align closely enough with the job requirements." if is_ai_auto_reject else "we have decided to move forward with other candidates at this time."
    content_html = f"""
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:700; text-align:center;">Application Update</h2>
      <p style="font-size:15px; line-height:1.6; color:#334155; text-align:center; margin-bottom:24px;">
        Thank you for your interest in the <strong>{html.escape(str(job_title))}</strong> position and for taking the time to apply.
      </p>
      <p style="font-size:15px; line-height:1.6; color:#334155; text-align:center; margin-bottom:24px;">
        Unfortunately, {html.escape(str(reason))}
      </p>
      <p style="font-size:15px; line-height:1.6; color:#334155; text-align:center;">
        We encourage you to apply for future roles that align with your background and skills. We wish you the best in your career search.
      </p>
    """
    body = get_templated_email(content_html, subject, tenant=tenant_obj, sender_name=sender_name)
    return await execute_email_with_retries(
        to_email, subject, body, 
        application=application, 
        tenant=tenant_obj,
        sender_name=sender_name,
        event_type="REJECTED_NOTICE"
    )

async def send_call_for_interview_email(to_email: str, job_title: str, tenant: Optional[Any] = None, application: Any = None):
    tenant_obj = resolve_tenant_for_email(tenant=tenant, application=application, to_email=to_email)
    branding = get_branding_dict(tenant=tenant_obj)
    sender_name = get_sender_display_name(branding=branding, tenant=tenant_obj)
    subject = f"Interview Invitation — {job_title}"
    content_html = f"""
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:700; text-align:center;">You're Invited for an Interview!</h2>
      <p style="font-size:15px; line-height:1.6; color:#334155; text-align:center; margin-bottom:24px;">
        Based on your AI assessment, you have been invited to schedule an interview for the <strong>{html.escape(str(job_title))}</strong> role.
      </p>
      <p style="font-size:15px; line-height:1.6; color:#334155; text-align:center;">
        Our HR team will contact you shortly to coordinate the scheduling details.
      </p>
    """
    body = get_templated_email(content_html, subject, tenant=tenant_obj, sender_name=sender_name)
    result = await send_email_async(
        to_email, subject, body, 
        tenant=tenant_obj, 
        sender_name=sender_name
    )
    if not result["success"]:
        logger.warning(f"Call for Interview Email failed for {_safe_email_target(to_email)}: {result['error']}")
    return result["success"]

async def send_ticket_resolved_email(to_email: str, issue_type: str, hr_response: str, job_title: str = "your applied position", tenant: Optional[Any] = None, application: Any = None):
    tenant_obj = resolve_tenant_for_email(tenant=tenant, application=application, to_email=to_email)
    branding = get_branding_dict(tenant=tenant_obj)
    sender_name = get_sender_display_name(branding=branding, tenant=tenant_obj)
    subject = f"Support Ticket Update - {job_title}"
    theme_color = branding.get("theme_color", "#2563eb")
    
    # Contextual link: if it was a technical issue or interruption, they probably need to go back to the interview
    link_html = ""
    if issue_type in ["technical", "interruption", "reschedule"]:
        access_url = f"{settings.frontend_base_url}/interview/access?email={to_email}"
        link_html = f"""
        <div style="text-align:center; margin:32px 0;">
            <a href="{access_url}" style="background-color:{theme_color}; color:#ffffff; padding:12px 25px; text-decoration:none; border-radius:6px; font-weight:bold; display:inline-block; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">Return to Interview Portal</a>
        </div>
        """

    content_html = f"""
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:700;">Support Ticket Update</h2>
      <p style="font-size:15px; line-height:1.6; color:#334155; margin-bottom:24px;">
        Your support ticket regarding <strong>{html.escape(str(issue_type.replace('_', ' ')))}</strong> for the <strong>{html.escape(str(job_title))}</strong> position has been reviewed.
      </p>
      <div style="background:#f8fafc; padding:20px; border-left:4px solid #3b82f6; border-radius:6px; margin:24px 0;">
        <strong style="color:#0f172a; font-size:14px; display:block; margin-bottom:8px;">Resolution Details:</strong>
        <p style="margin:0; font-size:14px; line-height:1.5; color:#334155;">{html.escape(str(hr_response))}</p>
      </div>
      {link_html}
      <p style="font-size:15px; line-height:1.6; color:#334155;">
        Thank you for your patience during this process.
      </p>
    """
    body = get_templated_email(content_html, subject, tenant=tenant_obj, sender_name=sender_name)
    result = await send_email_async(
        to_email, subject, body, 
        tenant=tenant_obj, 
        sender_name=sender_name
    )
    if not result["success"]:
        logger.warning(f"Ticket Resolved Email failed for {_safe_email_target(to_email)}: {result['error']}")
    return result["success"]

async def send_key_reissued_email(to_email: str, job_title: str, new_key: str, hr_response: str, tenant: Optional[Any] = None, application: Any = None):
    tenant_obj = resolve_tenant_for_email(tenant=tenant, application=application, to_email=to_email)
    branding = get_branding_dict(tenant=tenant_obj)
    sender_name = get_sender_display_name(branding=branding, tenant=tenant_obj)
    subject = f"Re: Congratulations! You're invited to interview for {job_title}"
    theme_color = branding.get("theme_color", "#2563eb")
    frontend_url = settings.frontend_base_url
    access_url = f"{frontend_url}/interview/access?email={to_email}&key={new_key}"
    
    content_html = f"""
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:700;">Access Key Re-issued</h2>
      <p style="font-size:15px; line-height:1.6; color:#334155; margin-bottom:24px;">
        Your request for the <strong>{html.escape(str(job_title))}</strong> position has been approved.
      </p>
      <div style="background:#f8fafc; padding:20px; border-left:4px solid #10b981; border-radius:6px; margin:24px 0;">
        <p style="margin:0; font-size:14px; line-height:1.5; color:#334155;">{html.escape(str(hr_response))}</p>
      </div>
      <p style="font-size:15px; line-height:1.6; color:#334155;">
        <strong>New Access Key:</strong> <span style="background:#f1f5f9; padding:6px 12px; font-family:monospace; font-weight:bold; border-radius:4px; border:1px solid #e2e8f0; font-size:15px;">{html.escape(str(new_key))}</span>
      </p>
      <div style="text-align:center; margin:32px 0;">
        <a href="{html.escape(str(access_url))}" style="background-color:{theme_color}; color:#ffffff; padding:12px 24px; text-decoration:none; border-radius:6px; font-weight:bold; display:inline-block; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">Resume Interview</a>
      </div>
      <p style="font-size:13px; line-height:1.5; color:#64748b;">
        If the button above does not work, copy and paste this link:
      </p>
      <p style="font-size:13px; word-break:break-all; line-height:1.5; color:#64748b;">
        <a href="{html.escape(str(access_url))}" style="color:{theme_color}; text-decoration:underline;">{html.escape(str(access_url))}</a>
      </p>
    """
    body = get_templated_email(content_html, subject, tenant=tenant_obj, sender_name=sender_name)
    result = await send_email_async(
        to_email, subject, body, 
        tenant=tenant_obj, 
        sender_name=sender_name
    )
    if not result["success"]:
        logger.warning(f"Key Reissued Email failed for {_safe_email_target(to_email)}: {result['error']}")
    return result["success"]

async def send_onboarding_reminder_email(to_email: str, candidate_name: str, joining_date: str, job_title: str, tenant: Optional[Any] = None, application: Any = None):
    tenant_obj = resolve_tenant_for_email(tenant=tenant, application=application, to_email=to_email)
    branding = get_branding_dict(tenant=tenant_obj)
    sender_name = get_sender_display_name(branding=branding, tenant=tenant_obj)
    subject = f"Upcoming Onboarding Reminder: {candidate_name}"
    content_html = f"""
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:700;">Onboarding Reminder</h2>
      <p style="font-size:15px; line-height:1.6; color:#334155; margin-bottom:24px;">
        This is a reminder that <strong>{html.escape(str(candidate_name))}</strong> is scheduled to join the company in 7 days on <strong>{html.escape(str(joining_date))}</strong> for the <strong>{html.escape(str(job_title))}</strong> role.
      </p>
      <p style="font-size:15px; line-height:1.6; color:#334155;">
        Please ensure all necessary preparations (IT access, workspace setup, credentials) are completed ahead of time.
      </p>
    """
    body = get_templated_email(content_html, subject, tenant=tenant_obj, sender_name=sender_name)
    return await execute_email_with_retries(
        to_email, subject, body, 
        application=application,
        tenant=tenant_obj,
        sender_name=sender_name,
        event_type="ONBOARDING_REMINDER"
    )

async def send_onboarding_summary_email(to_email: str, candidates_list: list, tenant: Optional[Any] = None):
    """
    Send a consolidated summary email to super admins / HR listing all candidates
    joining in the next 7 days.

    candidates_list: list of dicts with keys: name, job_title, joining_date (str)
    """
    if not candidates_list:
        return True

    tenant_obj = resolve_tenant_for_email(tenant=tenant, to_email=to_email)
    branding = get_branding_dict(tenant=tenant_obj)
    sender_name = get_sender_display_name(branding=branding, tenant=tenant_obj)

    subject = f"📅 Upcoming Joinings — Next 7 Days ({len(candidates_list)} candidate{'s' if len(candidates_list) != 1 else ''})"

    rows_html = "".join(
        f"""
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 14px; font-weight:600; color:#111827;">{html.escape(str(c['name']))}</td>
          <td style="padding:10px 14px; color:#374151;">{html.escape(str(c['job_title']))}</td>
          <td style="padding:10px 14px; color:#059669; font-weight:600;">{html.escape(str(c['joining_date']))}</td>
        </tr>
        """
        for c in candidates_list
    )

    body = f"""
    <html>
    <head>
      <meta name="x-sender-name" content="{html.escape(sender_name)}">
    </head>
    <body style="font-family:'Segoe UI',sans-serif; color:#111827; background:#f9fafb; margin:0; padding:0;">
      <div style="max-width:600px; margin:32px auto; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        
        <!-- Header -->
        <div style="background:linear-gradient(135deg,#1d4ed8 0%,#2563eb 100%); padding:28px 32px;">
          <h1 style="margin:0; font-size:22px; color:#ffffff; font-weight:700;">📅 Upcoming Joinings — Next 7 Days</h1>
          <p style="margin:8px 0 0 0; color:#bfdbfe; font-size:14px;">
            {html.escape(str(len(candidates_list)))} candidate{'s are' if len(candidates_list) != 1 else ' is'} scheduled to join in the next 7 days.
            Please ensure all preparations (IT access, workspace, credentials) are completed well in advance.
          </p>
        </div>

        <!-- Table -->
        <div style="padding:24px 32px;">
          <table style="width:100%; border-collapse:collapse; font-size:14px;">
            <thead>
              <tr style="background:#f3f4f6;">
                <th style="padding:10px 14px; text-align:left; color:#6b7280; font-weight:600; text-transform:uppercase; font-size:12px; border-bottom:2px solid #e5e7eb;">Candidate</th>
                <th style="padding:10px 14px; text-align:left; color:#6b7280; font-weight:600; text-transform:uppercase; font-size:12px; border-bottom:2px solid #e5e7eb;">Role / Position</th>
                <th style="padding:10px 14px; text-align:left; color:#6b7280; font-weight:600; text-transform:uppercase; font-size:12px; border-bottom:2px solid #e5e7eb;">Joining Date</th>
              </tr>
            </thead>
            <tbody>
              {rows_html}
            </tbody>
          </table>
        </div>

        <!-- Footer -->
        <div style="padding:20px 32px; background:#f9fafb; border-top:1px solid #e5e7eb;">
          <p style="margin:0; font-size:13px; color:#9ca3af;">
            This is an automated daily summary from the Recruitment & Onboarding Management System.
            Please do not reply to this email.
          </p>
        </div>
      </div>
    </body>
    </html>
    """
    return await execute_email_with_retries(
        to_email, subject, body, 
        tenant=tenant_obj, 
        sender_name=sender_name, 
        event_type="ONBOARDING_SUMMARY"
    )

async def send_joining_confirmation_email(to_email: str, candidate_name: str, job_title: str, candidate_photo_url: str, tenant: Optional[Any] = None, application: Any = None):
    tenant_obj = resolve_tenant_for_email(tenant=tenant, application=application, to_email=to_email)
    branding = get_branding_dict(tenant=tenant_obj)
    sender_name = get_sender_display_name(branding=branding, tenant=tenant_obj)
    subject = f"Joining Confirmation: {candidate_name}"
    content_html = f"""
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:700;">Candidate Joined Today</h2>
      <p style="font-size:15px; line-height:1.6; color:#334155; margin-bottom:16px;">
        This is to confirm that <strong>{html.escape(str(candidate_name))}</strong> has officially joined the company today for the <strong>{html.escape(str(job_title))}</strong> role.
      </p>
      <p style="font-size:15px; line-height:1.6; color:#334155;">
        Please find the live photograph of the candidate attached to this email.
      </p>
    """
    body = get_templated_email(content_html, subject, tenant=tenant_obj, sender_name=sender_name)
    
    attachments = []
    if candidate_photo_url:
        try:
            if candidate_photo_url.startswith("http"):
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.get(candidate_photo_url)
                    if resp.status_code == 200:
                        content = base64.b64encode(resp.content).decode("utf-8")
                        attachments.append({
                            "filename": f"Photo_{candidate_name.replace(' ', '_')}.jpg",
                            "content": content,
                        })
                    else:
                        logger.error(f"Failed to download candidate photo for email attachment: {resp.status_code}")
            elif os.path.exists(candidate_photo_url):
                with open(candidate_photo_url, "rb") as f:
                    content = base64.b64encode(f.read()).decode("utf-8")
                    attachments.append({
                        "filename": os.path.basename(candidate_photo_url),
                        "content": content,
                    })
        except Exception as e:
            logger.error(f"Email photo attachment processing failed: {e}")

    return await execute_email_with_retries(
        to_email, subject, body, 
        application=application,
        tenant=tenant_obj,
        sender_name=sender_name,
        attachments=attachments if attachments else None,
        event_type="JOINING_CONFIRMATION"
    )


async def send_interview_completed_email(application: Any, tenant: Optional[Any] = None):
    """Notify candidate that their interview session has been successfully saved."""
    tenant_obj = resolve_tenant_for_email(tenant=tenant, application=application, to_email=application.candidate_email)
    branding = get_branding_dict(tenant=tenant_obj)
    sender_name = get_sender_display_name(branding=branding, tenant=tenant_obj)
    subject = f"Interview Completed: {application.job.title}"
    content_html = f"""
      <h2 style="margin-top:0; color:#2563eb; font-size:20px; font-weight:700; text-align:center;">Interview Successfully Completed</h2>
      <p style="font-size:15px; line-height:1.6; color:#334155; margin-top:24px; margin-bottom:16px;">
        Hello {html.escape(str(application.candidate_name))},
      </p>
      <p style="font-size:15px; line-height:1.6; color:#334155; margin-bottom:16px;">
        Thank you for completing your interview for the <strong>{html.escape(str(application.job.title))}</strong> position.
      </p>
      <p style="font-size:15px; line-height:1.6; color:#334155;">
        Your responses and technical assessment have been successfully recorded. Our HR team will review your report and get back to you with the next steps.
      </p>
    """
    body = get_templated_email(content_html, subject, tenant=tenant_obj, sender_name=sender_name)
    return await execute_email_with_retries(
        application.candidate_email, 
        subject, 
        body, 
        application=application,
        tenant=tenant_obj,
        sender_name=sender_name,
        event_type="INTERVIEW_COMPLETED_NOTICE"
    )

async def send_interview_terminated_email(application: Any, reason: str, tenant: Optional[Any] = None):
    """Notify candidate that their session was terminated due to policy violations."""
    tenant_obj = resolve_tenant_for_email(tenant=tenant, application=application, to_email=application.candidate_email)
    branding = get_branding_dict(tenant=tenant_obj)
    sender_name = get_sender_display_name(branding=branding, tenant=tenant_obj)
    subject = f"Urgent: Interview Session Terminated - {application.job.title}"
    theme_color = branding.get("theme_color", "#2563eb")
    
    reason_text = "policy violations (such as multiple tab switches or loss of camera focus)"
    if "misconduct" in reason.lower():
        reason_text = "inappropriate language or conduct detected during the session"
    
    frontend_url = settings.frontend_base_url
    support_url = f"{frontend_url}/support"
    if application.candidate_email:
        support_url += f"?{urlencode({'email': application.candidate_email})}"
    
    content_html = f"""
      <h2 style="margin-top:0; color:#ef4444; font-size:20px; font-weight:700; text-align:center;">Session Terminated</h2>
      <p style="font-size:15px; line-height:1.6; color:#334155; margin-top:24px; margin-bottom:16px;">
        Hello {html.escape(str(application.candidate_name))},
      </p>
      <p style="font-size:15px; line-height:1.6; color:#334155; margin-bottom:16px;">
        Your interview session for <strong>{html.escape(str(application.job.title))}</strong> has been automatically terminated due to <strong>{reason_text}</strong>.
      </p>
      <p style="font-size:15px; line-height:1.6; color:#334155; margin-bottom:24px;">
        If you believe this was a technical error or happened under unexpected circumstances, please reach out to our compliance and support team immediately via the support portal or by replying to this email.
      </p>
      <div style="text-align:center; margin:32px 0;">
        <a href="{html.escape(support_url)}" style="background-color:#ef4444; color:#ffffff; padding:12px 24px; text-decoration:none; border-radius:6px; font-weight:bold; display:inline-block; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">Access Support Portal</a>
      </div>
      <p style="font-size:13px; line-height:1.5; color:#64748b; text-align:center;">
        If the button above does not work, copy and paste this link into your browser:
      </p>
      <p style="font-size:13px; word-break:break-all; line-height:1.5; color:#64748b; text-align:center; margin-bottom:24px;">
        <a href="{html.escape(support_url)}" style="color:#ef4444; text-decoration:underline;">{html.escape(support_url)}</a>
      </p>
    """
    body = get_templated_email(content_html, subject, tenant=tenant_obj, sender_name=sender_name)
    return await execute_email_with_retries(
        application.candidate_email, 
        subject, 
        body, 
        application=application,
        tenant=tenant_obj,
        sender_name=sender_name,
        event_type="INTERVIEW_TERMINATED_NOTICE"
    )
