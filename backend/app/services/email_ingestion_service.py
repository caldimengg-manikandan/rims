import imaplib
import email
import socket
import time
import uuid
import mimetypes
import hashlib
from email.header import decode_header
from email.utils import parsedate_to_datetime
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timezone
from app.domain.models import AttachmentResume, Application, Job, User
from app.core.config import get_settings
import logging
import requests
import re


logger = logging.getLogger(__name__)

def _retry_with_backoff(func, max_attempts=3, delays=[2, 4, 8]):
    """Retry function with exponential backoff"""
    for attempt in range(max_attempts):
        try:
            return func()
        except (ConnectionRefusedError, socket.timeout) as e:
            if attempt < max_attempts - 1:
                delay = delays[attempt] if attempt < len(delays) else delays[-1]
                logger.warning(f"Attempt {attempt + 1} failed: {e}. Retrying in {delay}s...")
                time.sleep(delay)
            else:
                raise
    return None

def _decode_subject(subject_header):
    """Safely decode email subject with fallback encodings, supporting multipart encoded words"""
    if not subject_header:
        return ""
    
    try:
        decoded_parts = decode_header(subject_header)
        subject_parts = []
        for part, encoding in decoded_parts:
            if part is None:
                continue
            if isinstance(part, bytes):
                if encoding:
                    try:
                        decoded_part = part.decode(encoding)
                    except (UnicodeDecodeError, LookupError):
                        decoded_part = part.decode('utf-8', errors='replace')
                else:
                    # Fallback encodings
                    decoded_part = None
                    for enc in ['utf-8', 'latin-1', 'cp1252']:
                        try:
                            decoded_part = part.decode(enc)
                            break
                        except (UnicodeDecodeError, LookupError):
                            continue
                    if decoded_part is None:
                        decoded_part = part.decode('utf-8', errors='replace')
                subject_parts.append(decoded_part)
            else:
                subject_parts.append(str(part))
        return "".join(subject_parts)
    except Exception as e:
        logger.warning(f"Failed to decode subject: {e}")
        return ""

def _extract_email(sender_str):
    """Extract and validate email address from sender string"""
    if not sender_str:
        return None
    
    if isinstance(sender_str, bytes):
        try:
            sender_str = sender_str.decode('utf-8', errors='replace')
        except Exception:
            sender_str = str(sender_str)
    else:
        sender_str = str(sender_str)
        
    # Try angle bracket format first
    match = re.search(r'<([^>]+)>', sender_str)
    if match:
        email_addr = match.group(1).strip().lower()
    else:
        # Try direct email format
        email_addr = sender_str.strip().lower()
    
    # Validate email format
    if re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email_addr):
        return email_addr
    
    return None

def _decode_email_body(msg_obj):
    """Decode email body with charset detection, HTML fallback, and fallback encodings"""
    email_body = ""
    html_body = ""
    
    def decode_payload(part):
        try:
            payload = part.get_payload(decode=True)
            if not payload:
                return ""
            if isinstance(payload, str):
                return payload
            charset = part.get_content_charset() or 'utf-8'
            try:
                return payload.decode(charset, errors='replace')
            except (UnicodeDecodeError, LookupError):
                for enc in ['utf-8', 'latin-1', 'cp1252']:
                    try:
                        return payload.decode(enc, errors='replace')
                    except (UnicodeDecodeError, LookupError):
                        continue
                return payload.decode('utf-8', errors='replace')
        except Exception as e:
            logger.warning(f"Failed to decode part: {e}")
            return ""

    try:
        if msg_obj.is_multipart():
            for part in msg_obj.walk():
                content_type = part.get_content_type()
                content_disposition = str(part.get("Content-Disposition"))
                
                if "attachment" not in content_disposition:
                    if content_type == "text/plain":
                        email_body += decode_payload(part)
                    elif content_type == "text/html":
                        html_body += decode_payload(part)
        else:
            content_type = msg_obj.get_content_type()
            if content_type == "text/plain":
                email_body = decode_payload(msg_obj)
            elif content_type == "text/html":
                html_body = decode_payload(msg_obj)
    except Exception as e:
        logger.error(f"Error decoding email body: {e}")
    
    if email_body.strip():
        return email_body
    
    if html_body.strip():
        # Clean HTML tags to extract readable text
        cleaned = re.sub(r'<style[^>]*>.*?</style>', '', html_body, flags=re.DOTALL | re.IGNORECASE)
        cleaned = re.sub(r'<script[^>]*>.*?</script>', '', cleaned, flags=re.DOTALL | re.IGNORECASE)
        cleaned = re.sub(r'<[^>]+>', ' ', cleaned)
        cleaned = re.sub(r'\s+', ' ', cleaned).strip()
        return cleaned

    return "[Email body could not be decoded]"

def _decode_filename(filename_header):
    """Safely decode attachment filename, supporting multipart encoded words"""
    if not filename_header:
        return None
    
    try:
        decoded_parts = decode_header(filename_header)
        filename_parts = []
        for part, encoding in decoded_parts:
            if part is None:
                continue
            if isinstance(part, bytes):
                if encoding:
                    try:
                        decoded_part = part.decode(encoding)
                    except (UnicodeDecodeError, LookupError):
                        decoded_part = part.decode('utf-8', errors='replace')
                else:
                    decoded_part = None
                    for enc in ['utf-8', 'latin-1', 'cp1252']:
                        try:
                            decoded_part = part.decode(enc)
                            break
                        except (UnicodeDecodeError, LookupError):
                            continue
                    if decoded_part is None:
                        decoded_part = part.decode('utf-8', errors='replace')
                filename_parts.append(decoded_part)
            else:
                filename_parts.append(str(part))
        return "".join(filename_parts) if filename_parts else None
    except Exception as e:
        logger.warning(f"Failed to decode filename: {e}")
        return None

def _generate_synthetic_message_id(sender, subject, received_at):
    """Generate synthetic message ID for emails without Message-ID header"""
    content = f"{sender}{subject}{received_at}".encode('utf-8')
    return hashlib.sha256(content).hexdigest()


# ---------------------------------------------------------------------------
# Job-relevance filter
# ---------------------------------------------------------------------------
_JOB_SUBJECT_KEYWORDS = [
    # Job-application intent keywords
    "job", "position", "role", "vacancy", "opening",
    "application", "applying", "applied",
    "resume", "cv", "curriculum vitae",
    "cover letter", "candidacy", "candidate",
    "hiring", "recruitment", "recruiter",
    "employment", "career",
    # Job-code pattern (e.g. JOB-ABCD12) is checked separately via regex
]

_BLOCKED_SENDER_DOMAINS = {
    # Automated system emails — delivery / bounce / abuse
    "mailer-daemon",
    "postmaster",
    "noreply",
    "no-reply",
    "donotreply",
    "do-not-reply",
    # Well-known marketing / transactional platforms that are never job applications
    "mailchimp.com",
    "sendgrid.net",
    "amazonses.com",
    "bounce.linkedin.com",
    "email.udemy.com",
    "notifications.udemy.com",
    "bounce.glassdoor.com",
    "fb.com",
    "facebookmail.com",
    "twitter.com",
    "email.twitter.com",
    "pinterest.com",
    "email.quora.com",
}

_JOB_CODE_RE = re.compile(r'JOB-[A-Z0-9]{4,10}\b', re.IGNORECASE)

# Compile a regex of the keywords with word boundaries to avoid matching substrings in unrelated words
_KEYWORDS_PATTERN = "|".join(re.escape(kw) for kw in _JOB_SUBJECT_KEYWORDS) + "|résumé"
_KEYWORDS_PATTERN = _KEYWORDS_PATTERN.replace("cover\\ letter", "cover\\s+letter").replace("curriculum\\ vitae", "curriculum\\s+vitae")
_JOB_KEYWORDS_RE = re.compile(rf'\b({_KEYWORDS_PATTERN})s?\b', re.IGNORECASE)


def _normalize_job_code(code: str) -> str:
    """Normalize Job ID code to avoid character confusion (O vs 0, I vs 1 vs L)."""
    if not code:
        return ""
    return code.upper().strip().replace("0", "O").replace("1", "I").replace("L", "I")

def _is_job_related_email(sender: str, subject: str, allowed_jobs: list = None) -> bool:
    """
    Return True ONLY for emails that look like genuine job applications matching an open job.
    Matches by alphanumeric Job Code, numeric Job ID, or Job Title.
    """
    subject_lower = (subject or "").lower().strip()
    sender_lower  = (sender  or "").lower().strip()
    subject_upper = (subject or "").upper().strip()

    # 1. Hard reject: automated bounce / system senders
    for blocked in _BLOCKED_SENDER_DOMAINS:
        if blocked in sender_lower:
            logger.debug(f"🚫 Skipping non-job email — blocked sender domain '{blocked}': {sender!r}")
            return False

    # 2. Hard reject: common automated-reply subject prefixes
    auto_prefixes = (
        "delivery status notification",
        "undeliverable",
        "mail delivery",
        "auto-reply",
        "auto reply",
        "out of office",
        "automatic reply",
        "do not reply",
    )
    for prefix in auto_prefixes:
        if subject_lower.startswith(prefix) or prefix in subject_lower:
            logger.debug(f"🚫 Skipping non-job email — automated subject prefix '{prefix}': {subject!r}")
            return False

    # 3. Match against allowed jobs
    if allowed_jobs:
        # Pattern A: Match Job Code (e.g. JOB-XXXXXX)
        subject_norm = _normalize_job_code(subject_upper)
        for job_db_id, job_id, title in allowed_jobs:
            code = (job_id or "").upper().strip()
            norm_code = _normalize_job_code(code)
            if norm_code and norm_code in subject_norm:
                logger.info(f"✅ Email subject matched job '{code}' ('{title}') via Job Code.")
                return True

        # Pattern B: Match numeric Job ID with word boundaries
        numeric_id_match = re.search(r'\bjob\s*(?:id|code)?\s*[:\-\#]?\s*(\d+)\b', subject_lower)
        if numeric_id_match:
            extracted_id = int(numeric_id_match.group(1).strip())
            for job_db_id, job_id, title in allowed_jobs:
                if job_db_id == extracted_id:
                    logger.info(f"✅ Email subject matched job ID {job_db_id} ('{title}') via numeric Job ID.")
                    return True

        # Pattern C: Match Job Title with 80% word intersection threshold
        subject_words = set(subject_lower.split())
        for job_db_id, job_id, title in allowed_jobs:
            job_title_words = set((title or "").lower().split())
            if len(job_title_words) > 0:
                match_count = len(job_title_words & subject_words)
                match_percentage = match_count / len(job_title_words)
                if match_percentage >= 0.8:
                    logger.info(f"✅ Email subject matched Job Title '{title}' ({match_percentage:.0%} match).")
                    return True

    logger.debug(f"🚫 Skipping email — does not match any open job by Code, ID, or Title in subject line: {subject!r}")
    return False

def fetch_resume_attachments(db: Session, imap_user: str, imap_pass: str, hr_id: int = None):
    """
    Connect to IMAP, fetch emails, extract attachments (PDFs/Docx), 
    and store them into the AttachmentResume table with comprehensive error handling.
    """
    if not imap_user or not imap_pass:
        logger.error("IMAP credentials not provided.")
        return {"success": False, "error": "IMAP credentials missing."}

    imap_server = "imap.gmail.com"
    
    def connect_imap():
        mail = imaplib.IMAP4_SSL(imap_server, timeout=30)
        mail.login(imap_user, imap_pass)
        return mail
    
    try:
        # Connect with retry logic
        mail = _retry_with_backoff(connect_imap)
        if not mail:
            return {"success": False, "error": "Failed to connect after retries"}
        
        # Select mailbox
        status, response = mail.select("INBOX")
        if status != "OK":
            logger.error(f"Failed to select INBOX. Status: {status}, Response: {response}")
            return {"success": False, "error": f"Could not access inbox. Status: {status}"}
        
        # ── Checkpoint-based IMAP search ──────────────────────────────────
        from app.infrastructure.database import SessionLocal

        since_date_str = None
        with SessionLocal() as local_db:
            # Query the date of the last synced email for this user
            last_email = local_db.query(AttachmentResume).filter(
                AttachmentResume.hr_id == hr_id
            ).order_by(AttachmentResume.received_at.desc()).first() if hr_id else None
            
            if last_email and last_email.received_at:
                since_date_str = last_email.received_at.strftime("%d-%b-%Y")
                logger.info(f"📌 Checkpoint found: last sync email date was {last_email.received_at} → SINCE {since_date_str}")
            else:
                # Fall back to checking global settings if hr_id is None
                from app.domain.models import GlobalSettings as GS
                checkpoint_row = local_db.query(GS).filter(GS.key == "last_email_sync_at").first() if not hr_id else None
                if checkpoint_row and checkpoint_row.value:
                    try:
                        last_sync_dt = datetime.fromisoformat(checkpoint_row.value)
                        since_date_str = last_sync_dt.strftime("%d-%b-%Y")
                        logger.info(f"📌 Global checkpoint found: last sync was {checkpoint_row.value} → SINCE {since_date_str}")
                    except Exception:
                        since_date_str = datetime.utcnow().strftime("%d-%b-%Y")
                else:
                    since_date_str = datetime.utcnow().strftime("%d-%b-%Y")
                    logger.info(f"📌 No checkpoint found. Using today: {since_date_str}")

        # 1. Fetch UNSEEN emails
        status, unseen_messages = mail.search(None, 'UNSEEN')
        if status != "OK":
            return {"success": False, "error": "Could not search inbox for UNSEEN."}

        # 2. Fetch all emails SINCE the checkpoint date
        status, since_messages = mail.search(None, f'SINCE {since_date_str}')
        if status != "OK":
            return {"success": False, "error": f"Could not search inbox SINCE {since_date_str}."}

        unseen_ids = unseen_messages[0].split()
        since_ids = since_messages[0].split()

        # Combine and deduplicate
        combined_ids = list(set(unseen_ids + since_ids))
        # Sort by integer ID ascending (oldest first)
        combined_ids.sort(key=lambda x: int(x))

        email_ids = combined_ids

        # BUG-003 Fix: Add detailed logging to track email fetch counts
        total_emails = len(email_ids)
        logger.info(f"🔍 IMAP Search Result: Found {total_emails} emails (UNSEEN={len(unseen_ids)}, SINCE {since_date_str}={len(since_ids)})")

        # Process 100 most recent emails
        if len(email_ids) > 100:
            email_ids = email_ids[-100:]
            logger.warning(f"⚠️  Inbox has {total_emails} emails. Limiting to 100 most recent for this sync.")
            
        saved_count = 0
        duplicate_count = 0
        error_count = 0
        processed_count = 0

        # Pre-fetch open jobs for this HR user (or all if hr_id is None or user is super_admin) to isolate sync scoping
        with SessionLocal() as local_db:
            user_record = local_db.query(User).filter(User.id == hr_id).first() if hr_id else None
            is_super_admin = (user_record.role == 'super_admin') if user_record else False

            query = local_db.query(Job).filter(Job.status == 'open')
            if hr_id is not None and not is_super_admin:
                query = query.filter(Job.hr_id == hr_id)
            hr_jobs = query.all()
            allowed_jobs = [(j.id, j.job_id, j.title) for j in hr_jobs if j.job_id and j.title]

        logger.info(f"📋 Loaded {len(allowed_jobs)} open jobs for relevance filtering: {allowed_jobs}")
        
        logger.info(f"📧 Processing {len(email_ids)} email(s) for resume attachments...")
        
        for email_id in reversed(email_ids):
            try:
                # Fetch metadata
                res, msg_meta = mail.fetch(email_id, "(BODY[HEADER.FIELDS (SUBJECT FROM DATE MESSAGE-ID)])")
                if res != "OK" or not msg_meta or not isinstance(msg_meta, list) or not msg_meta[0] or len(msg_meta[0]) < 2 or msg_meta[0][1] is None:
                    logger.warning(f"Failed to fetch metadata or invalid metadata structure for email ID {email_id.decode() if isinstance(email_id, bytes) else email_id}")
                    continue
                
                header_obj = email.message_from_bytes(msg_meta[0][1])
                
                # Extract and decode subject
                subject = _decode_subject(header_obj.get("Subject"))
                
                # Extract sender email and decode it
                sender = header_obj.get("From", "")
                if isinstance(sender, bytes):
                    try:
                        sender = sender.decode('utf-8', errors='replace')
                    except Exception:
                        sender = str(sender)
                else:
                    sender = str(sender)
                
                raw_email = _extract_email(sender)
                if not raw_email:
                    logger.warning(f"Could not extract valid email from: {sender}")
                    continue

                # --- Job-relevance filter (must contain both Job ID and Job Title) ---
                if not _is_job_related_email(sender, subject, allowed_jobs=allowed_jobs):
                    logger.info(f"⏭️  Skipping non-job-related email from {raw_email}: {subject!r}")
                    continue
                
                # Parse date with fallback
                date_str = header_obj.get("Date")
                received_at = datetime.utcnow()
                if date_str:
                    try:
                        received_dt = parsedate_to_datetime(date_str)
                        if received_dt.tzinfo is not None:
                            received_at = received_dt.astimezone(timezone.utc).replace(tzinfo=None)
                        else:
                            received_at = received_dt
                    except Exception as e:
                        logger.warning(f"Failed to parse date '{date_str}': {e}. Using current time.")
                
                # Get or generate message ID
                msg_id = (header_obj.get("Message-ID") or "").strip()
                if not msg_id:
                    msg_id = _generate_synthetic_message_id(sender, subject, received_at)
                    logger.info(f"Generated synthetic message ID for email from {raw_email}")
                
                # Duplicate check - Message-ID first
                is_duplicate_check = False
                with SessionLocal() as local_db:
                    existing = local_db.query(AttachmentResume).filter(
                        AttachmentResume.message_id == msg_id
                    ).first()
                    
                    if existing:
                        is_duplicate_check = True
                    
                    # Secondary duplicate check - more specific composite key
                    if not existing and subject and raw_email:
                        existing = local_db.query(AttachmentResume).filter(
                            AttachmentResume.subject == subject,
                            AttachmentResume.sender_email.ilike(f"%{raw_email}%"),
                            AttachmentResume.received_at == received_at
                        ).first()
                        
                        if existing:
                            is_duplicate_check = True
                
                if is_duplicate_check:
                    duplicate_count += 1
                    logger.debug(f"⏭️  Skipping duplicate email: {subject} from {raw_email}")
                    continue
                
                # Fetch full email
                res, msg = mail.fetch(email_id, "(RFC822)")
                if res != "OK":
                    logger.warning(f"Failed to fetch full content for email ID {email_id.decode()}")
                    continue
                
                for response_part in msg:
                    if isinstance(response_part, tuple):
                        msg_obj = email.message_from_bytes(response_part[1])
                        
                        # Decode email body
                        email_body = _decode_email_body(msg_obj)
                        email_body = email_body[:2000] if email_body else ""

                        # Extract and process attachments
                        resume_count = 0
                        found_resume = False
                        if msg_obj.is_multipart():
                            for part in msg_obj.walk():
                                content_type = part.get_content_type()
                                content_disposition = str(part.get("Content-Disposition", ""))
                                
                                is_attachment = bool(
                                    content_disposition and (
                                        "attachment" in content_disposition
                                        or "inline" in content_disposition
                                    )
                                )

                                # Gmail and some clients omit Content-Disposition entirely
                                # but still include the filename in Content-Type's name= param.
                                # Detect those parts by checking for a resume-named Content-Type name.
                                if not is_attachment:
                                    ct_name = part.get_param("name")
                                    if ct_name:
                                        ct_name_decoded = _decode_filename(ct_name) or ct_name
                                        if ct_name_decoded.lower().endswith((".pdf", ".doc", ".docx")):
                                            is_attachment = True

                                if not is_attachment:
                                    continue

                                # Extract filename (from Content-Disposition or Content-Type name param)
                                filename = part.get_filename()
                                if not filename:
                                    filename = part.get_param('name')

                                if filename:
                                    filename = _decode_filename(filename)

                                if not filename:
                                    ext = mimetypes.guess_extension(content_type) or '.bin'
                                    filename = f"resume_{int(time.time())}{ext}"
                                    logger.warning(f"Generated fallback filename: {filename}")

                                is_resume = filename.lower().endswith((".pdf", ".doc", ".docx"))
                                if not is_resume:
                                    continue

                                file_data = part.get_payload(decode=True)
                                if not file_data or len(file_data) == 0:
                                    logger.warning(f"Empty attachment data for {filename} from {raw_email}")
                                    continue

                                if len(file_data) > 10 * 1024 * 1024:
                                    logger.warning(f"Attachment {filename} exceeds 10MB limit ({len(file_data)} bytes)")
                                    continue

                                ext_lower = filename.lower()
                                magic_valid = True
                                if ext_lower.endswith(".pdf") and not file_data.startswith(b"%PDF"):
                                    logger.warning(f"Rejecting attachment '{filename}': invalid PDF magic bytes.")
                                    magic_valid = False
                                elif ext_lower.endswith(".docx") and not file_data.startswith(b"PK\x03\x04"):
                                    logger.warning(f"Rejecting attachment '{filename}': invalid DOCX magic bytes.")
                                    magic_valid = False
                                elif ext_lower.endswith(".doc") and not file_data.startswith(b"\xd0\xcf\x11\xe0"):
                                    logger.warning(f"Rejecting attachment '{filename}': invalid DOC magic bytes.")
                                    magic_valid = False
                                if not magic_valid:
                                    continue

                                if not content_type or content_type == 'application/octet-stream':
                                    content_type = mimetypes.guess_type(filename)[0] or 'application/octet-stream'

                                from app.core.storage import upload_file, get_signed_url, delete_file

                                safe_sender = raw_email.split("@")[0].replace(".", "_")
                                safe_filename = re.sub(r'[^\w\.-]', '_', filename)
                                random_suffix = str(uuid.uuid4())[:6]
                                storage_path = f"ingested/{safe_sender}_{int(time.time())}_{random_suffix}_{safe_filename}"

                                upload_res = upload_file('MAIL_ATTACHMENTS', storage_path, file_data, content_type)
                                if not upload_res:
                                    time.sleep(2)
                                    upload_res = upload_file('MAIL_ATTACHMENTS', storage_path, file_data, content_type)

                                if not upload_res:
                                    logger.error(f"Failed to upload {filename} after retry. Skipping.")
                                    continue

                                file_url = get_signed_url('MAIL_ATTACHMENTS', storage_path, expires_in=86400)
                                if not file_url:
                                    time.sleep(2)
                                    file_url = get_signed_url('MAIL_ATTACHMENTS', storage_path, expires_in=86400)

                                if not file_url:
                                    if upload_res:
                                        try:
                                            delete_file('MAIL_ATTACHMENTS', storage_path)
                                            logger.warning(f"Deleted orphaned file {storage_path} after signed URL failure.")
                                        except Exception as del_err:
                                            logger.error(f"Failed to delete orphaned file {storage_path}: {del_err}")
                                    logger.error(f"Failed to get signed URL for {filename}. Skipping.")
                                    continue

                                # Create database record
                                new_resume = AttachmentResume(
                                    message_id=msg_id,
                                    sender_email=sender,
                                    subject=subject,
                                    file_name=safe_filename,
                                    file_url=file_url,
                                    file_data=None,
                                    email_body=email_body,
                                    mime_type=content_type,
                                    received_at=received_at,
                                    retry_count=0,
                                    last_error=None,
                                    hr_id=hr_id
                                )
                                with SessionLocal() as local_db:
                                    existing_check = local_db.query(AttachmentResume).filter(
                                        AttachmentResume.message_id == msg_id
                                    ).first()
                                    if not existing_check:
                                        local_db.add(new_resume)
                                        local_db.commit()
                                        saved_count += 1
                                        resume_count += 1
                                        found_resume = True
                                        logger.info(f"Ingested new resume from {raw_email}: {safe_filename}")
                                    else:
                                        duplicate_count += 1

                        
                        if resume_count == 0:
                            logger.info(f"Email from {raw_email} had no resume attachments. Ingesting email metadata only.")
                            new_resume = AttachmentResume(
                                message_id=msg_id,
                                sender_email=sender,
                                subject=subject,
                                file_name=None,
                                file_url=None,
                                file_data=None, 
                                email_body=email_body,
                                mime_type="text/plain",
                                received_at=received_at,
                                processed=True,  # Mark processed since there is no attachment to parse/map
                                mapping_failed=True,
                                retry_count=0,
                                last_error="No resume attachment found in email.",
                                hr_id=hr_id
                            )
                            with SessionLocal() as local_db:
                                existing_check = local_db.query(AttachmentResume).filter(
                                    AttachmentResume.message_id == msg_id
                                ).first()
                                if not existing_check:
                                    local_db.add(new_resume)
                                    local_db.commit()
                                    saved_count += 1
                                else:
                                    duplicate_count += 1
            except Exception as e:
                logger.error(f"Error processing email {email_id.decode() if isinstance(email_id, bytes) else email_id}: {e}", exc_info=True)
                error_count += 1

        logger.info(f"   [UNSEEN] {len(unseen_ids)}, SINCE {since_date_str}: {len(since_ids)}")
        logger.info(f"   [Processed] {len(email_ids)}")
        logger.info(f"   [Saved] {saved_count}")
        logger.info(f"   [Duplicates] {duplicate_count}")
        logger.info(f"   [Errors] {error_count}")

        # ── Save global checkpoint only if hr_id is None ────────────────
        if hr_id is None:
            sync_now = datetime.utcnow().isoformat()
            try:
                with SessionLocal() as local_db:
                    from app.domain.models import GlobalSettings as GS
                    checkpoint_row = local_db.query(GS).filter(GS.key == "last_email_sync_at").first()
                    if checkpoint_row:
                        checkpoint_row.value = sync_now
                    else:
                        local_db.add(GS(key="last_email_sync_at", value=sync_now))
                    local_db.commit()
                logger.info(f"📌 Global checkpoint updated: last_email_sync_at = {sync_now}")
            except Exception as ckpt_err:
                logger.warning(f"⚠️  Failed to save global sync checkpoint: {ckpt_err}")
        
        mail.close()
        mail.logout()
        return {"success": True, "count": saved_count}
        
    except socket.timeout:
        logger.error("IMAP connection timed out")
        return {"success": False, "error": "Connection timed out. Please check your network and try again."}
    except imaplib.IMAP4.error as e:
        error_str = str(e).lower()
        logger.error(f"IMAP authentication or protocol error: {e}")
        if "authentication" in error_str or "login" in error_str or "invalid credentials" in error_str or b"AUTHENTICATIONFAILED" in str(e).encode():
            return {"success": False, "error": "Authentication failed. Please verify your email and App Password."}
        return {"success": False, "error": "Mailbox connection failed. Please verify your IMAP settings and that IMAP access is enabled in Gmail."}
    except ConnectionRefusedError:
        logger.error("IMAP connection refused")
        return {"success": False, "error": "Could not reach the Gmail IMAP server. Please check your network connection and try again."}
    except Exception as e:
        logger.error(f"IMAP Error: {e}", exc_info=True)
        return {"success": False, "error": "Mailbox sync failed. Please verify your IMAP credentials and try again."}


async def run_batch_resume_processing(db: Session = None, hr_id: int = None):
    """
    Finds all unprocessed resumes from the email ingestion database,
    automatically creates target Job Applications for them, and triggers the AI analysis pipeline.
    Uses row-level locking to prevent concurrent processing issues.
    """
    from app.infrastructure.database import SessionLocal
    from app.domain.models import Job, Application, AttachmentResume
    
    # 1. Fetch the IDs of unprocessed resumes first using a short-lived session
    with SessionLocal() as init_db:
        query = init_db.query(AttachmentResume.id).filter(
            AttachmentResume.processed == False
        )
        if hr_id is not None:
            query = query.filter(AttachmentResume.hr_id == hr_id)
        unprocessed_ids = [r.id for r in query.order_by(AttachmentResume.id.asc()).limit(30).all()]
        
    if not unprocessed_ids:
        return {"message": "No new resumes to process.", "count": 0}
        
    # 2. Fetch open jobs data using a short-lived session
    with SessionLocal() as jobs_db:
        user_record = jobs_db.query(User).filter(User.id == hr_id).first() if hr_id else None
        is_super_admin = (user_record.role == 'super_admin') if user_record else False

        query = jobs_db.query(Job).filter(Job.status == 'open')
        if hr_id is not None and not is_super_admin:
            query = query.filter(Job.hr_id == hr_id)
        open_jobs = query.all()
        if not open_jobs:
            logger.warning("No open jobs available to assign incoming emailed resumes to.")
            return {"message": "No open jobs to map resumes.", "count": 0}
        
        # Capture open jobs as serialized dicts to safely use across sessions without detach errors
        open_jobs_data = [
            {
                "id": j.id,
                "title": j.title,
                "job_id": j.job_id,
                "hr_id": j.hr_id,
                "status": j.status
            }
            for j in open_jobs
        ]
        
    processed_count = 0
    
    for resume_id in unprocessed_ids:
        # 3. Process each resume in its own short-lived session block
        with SessionLocal() as local_db:
            try:
                # Use SELECT FOR UPDATE SKIP LOCKED to prevent concurrent processing
                resume = local_db.query(AttachmentResume).filter(
                    AttachmentResume.id == resume_id,
                    AttachmentResume.processed == False
                ).with_for_update(skip_locked=True).first()
                
                if not resume:
                    continue
                    
                if not resume.file_url:
                    resume.processed = True
                    local_db.commit()
                    continue
                
                # Map to target Job
                target_job_data = None
                subject_str = resume.subject or ""
                body_str = resume.email_body or ""
                
                # Pattern A: Match Job Code ONLY in subject line (not body).
                job_codes = re.findall(r'JOB-[A-Z0-9]{4,10}', subject_str, re.IGNORECASE)
                if job_codes:
                    for code in job_codes:
                        norm_extracted_code = _normalize_job_code(code)
                        for job in open_jobs_data:
                            if job["job_id"] and _normalize_job_code(job["job_id"]) == norm_extracted_code:
                                target_job_data = job
                                break
                        if target_job_data:
                            logger.info(f"Successfully mapped emailed resume {resume.id} to Job Code {job['job_id']}")
                            if len(job_codes) > 1:
                                logger.info(f"Alternative job codes found in subject: {[c for c in job_codes if _normalize_job_code(c) != norm_extracted_code]}")
                            break
                
                # Pattern B: Match numeric Job ID with word boundaries in subject line only
                if not target_job_data:
                    subject_lower = subject_str.lower()
                    numeric_id_match = re.search(r'\bjob\s*(?:id|code)?\s*[:\-\#]?\s*(\d+)\b', subject_lower)
                    if numeric_id_match:
                        extracted_id = int(numeric_id_match.group(1).strip())
                        for job in open_jobs_data:
                            if job["id"] == extracted_id:
                                target_job_data = job
                                break
                        if target_job_data:
                            logger.info(f"Mapped resume {resume.id} to Job ID {extracted_id}")
                
                # Pattern C: Job title matching with 80% threshold in subject line only
                if not target_job_data:
                    subject_words = set(subject_str.lower().split())
                    for job in open_jobs_data:
                        job_title_words = set(job["title"].lower().split())
                        if len(job_title_words) > 0:
                            match_count = len(job_title_words & subject_words)
                            match_percentage = match_count / len(job_title_words)
                            if match_percentage >= 0.8:
                                target_job_data = job
                                logger.info(f"Mapped resume {resume.id} to Job Title '{job['title']}' ({match_percentage:.0%} match in subject)")
                                break
    
                if not target_job_data:
                    logger.warning(f"Could not map resume {resume.id} from {resume.sender_email} to any open job.")
                    resume.processed = True
                    resume.mapping_failed = True
                    local_db.commit()
                    continue
    
                # Re-query job status in DB to ensure it's still open
                job_record = local_db.query(Job).filter(Job.id == target_job_data["id"]).first()
                if not job_record or job_record.status != 'open':
                    logger.warning(f"Job {target_job_data['id']} is no longer open. Skipping.")
                    resume.processed = True
                    resume.mapping_failed = True
                    local_db.commit()
                    continue
    
                # Extract candidate info
                sender_raw = resume.sender_email
                match = re.search(r'([^<]+)<', sender_raw)
                if match:
                    candidate_name = match.group(1).strip()
                else:
                    # Fallback to email local part
                    email_match = re.search(r'([^@]+)@', sender_raw)
                    candidate_name = email_match.group(1).replace('.', ' ').title() if email_match else "Candidate"
                
                match_email = re.search(r'<([^>]+)>', sender_raw)
                candidate_email = match_email.group(1).lower().strip() if match_email else sender_raw.lower().strip()
                
                # Validate email
                if not re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', candidate_email):
                    logger.error(f"Invalid email format: {candidate_email}. Skipping.")
                    resume.processed = True
                    resume.last_error = f"Invalid email format: {candidate_email}"
                    local_db.commit()
                    continue
                
                # Get resume file path
                resume_file_path = None
                if resume.file_url and "/MAIL_ATTACHMENTS/" in resume.file_url:
                    bucket_path = resume.file_url.split("/MAIL_ATTACHMENTS/")[-1].split("?")[0]
                    resume_file_path = f"MAIL_ATTACHMENTS/{bucket_path}"
                elif resume.file_url and "/resumes/" in resume.file_url:
                    bucket_path = resume.file_url.split("/resumes/")[-1].split("?")[0]
                    resume_file_path = f"resumes/{bucket_path}"
                
                if not resume_file_path:
                    logger.error(f"Resume file path could not be determined for resume {resume.id}")
                    resume.processed = True
                    resume.last_error = "Resume file path could not be determined"
                    local_db.commit()
                    continue
                
                # SSRF Protection: validate resume.file_url before fetching (P2-H05)
                from urllib.parse import urlparse
                try:
                    parsed_url = urlparse(resume.file_url)
                    if not parsed_url.scheme or parsed_url.scheme.lower() != "https":
                        raise ValueError("Only HTTPS scheme is allowed for safety.")
                    
                    # Check netloc/domain
                    settings = get_settings()
                    allowed_domains = []
                    if settings.supabase_url:
                        supabase_netloc = urlparse(settings.supabase_url).netloc
                        if supabase_netloc:
                            allowed_domains.append(supabase_netloc)
                    
                    netloc_lower = parsed_url.netloc.lower()
                    is_allowed = netloc_lower.endswith(".supabase.co") or netloc_lower == "supabase.co" or any(d == netloc_lower for d in allowed_domains)
                    
                    if not is_allowed:
                        raise ValueError(f"Domain '{netloc_lower}' is not in the list of allowed Supabase storage domains.")
                except Exception as ssrf_err:
                    logger.error(f"SSRF Prevention: Blocked fetching URL '{resume.file_url}': {ssrf_err}")
                    resume.processed = True
                    resume.last_error = f"SSRF Prevention: Blocked fetching URL: {ssrf_err}"
                    local_db.commit()
                    continue
    
                # Download file and calculate hash
                content = b""
                try:
                    import asyncio
                    response = await asyncio.to_thread(requests.get, resume.file_url, timeout=30)
                    if response.status_code == 200:
                        content = response.content
                    else:
                        logger.error(f"Failed to download resume: HTTP {response.status_code}")
                        resume.processed = False
                        resume.retry_count += 1
                        resume.last_error = f"Download failed: HTTP {response.status_code}"
                        local_db.commit()
                        continue
                except Exception as e:
                    logger.error(f"Failed to download resume file from URL: {e}")
                    resume.processed = False
                    resume.retry_count += 1
                    resume.last_error = str(e)
                    local_db.commit()
                    continue
                
                # Calculate hash
                if len(content) == 0:
                    resume_hash = f"no_hash_{resume.id}_{int(time.time())}"
                    logger.warning(f"Empty content for resume {resume.id}. Using synthetic hash.")
                else:
                    resume_hash = hashlib.sha256(content).hexdigest()
                
                # Duplicate check with job_id
                existing_res = local_db.query(Application).filter(
                    Application.job_id == job_record.id,
                    Application.resume_hash == resume_hash
                ).first()
                
                if existing_res:
                    logger.info(f"Resume with hash {resume_hash} already applied to job {job_record.id}. Skipping.")
                    resume.processed = True
                    local_db.commit()
                    continue
    
                # Check if candidate has already applied to this job (uq_application_job_email constraint)
                existing_app = local_db.query(Application).filter(
                    Application.job_id == job_record.id,
                    Application.candidate_email == candidate_email
                ).first()
                
                if existing_app:
                    logger.info(f"Candidate {candidate_email} has already applied to job {job_record.id}. Skipping duplicate application ingestion.")
                    resume.processed = True
                    local_db.commit()
                    continue
    
                # Create application
                new_app = Application(
                    job_id=job_record.id,
                    hr_id=job_record.hr_id,
                    candidate_name=candidate_name,
                    candidate_email=candidate_email,
                    resume_file_name=resume.file_name,
                    resume_file_path=resume_file_path,
                    resume_hash=resume_hash,
                    status='applied',
                    hr_notes="Ingested automatically from Email Recruiter Channel.",
                    applied_at=datetime.utcnow(),
                    resume_status='pending'
                )
                local_db.add(new_app)
                local_db.flush()
                
                # Trigger AI analysis in the background to avoid blocking the sync request
                try:
                    from app.api.applications import process_application_background
                    import asyncio
                    asyncio.create_task(
                        process_application_background(
                            new_app.id,
                            job_record.id,
                            new_app.resume_file_path,
                            candidate_email,
                            candidate_name
                        )
                    )
                except Exception as e:
                    logger.error(f"Background processing launch failed for resume {resume.id}: {e}")
                    resume.processed = False
                    resume.retry_count += 1
                    resume.last_error = str(e)
                    local_db.commit()
                    continue
                
                resume.processed = True
                local_db.commit()
                processed_count += 1
                
            except Exception as e:
                logger.error(f"Error mapping resume {resume_id}: {e}", exc_info=True)
                local_db.rollback()
                
    return {"message": f"Successfully processed {processed_count} resumes.", "count": processed_count}
