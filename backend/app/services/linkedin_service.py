"""
LinkedIn Auto-Post Service
==========================
Reusable, isolated service for posting job listings to a LinkedIn company page.

Key design principles:
- Non-blocking: all failures are swallowed and logged; job creation always succeeds.
- Feature-flagged: controlled by ENABLE_LINKEDIN_POSTING env var (default: false).
- Stateless: no DB dependency; accepts plain data, returns nothing.
- Production-safe: credentials read strictly from env vars, never hard-coded.

LinkedIn UGC Post API Reference:
  https://learn.microsoft.com/en-us/linkedin/marketing/integrations/community-management/shares/ugc-post-api
"""

import os
import logging
import requests
from typing import Optional
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config helpers (read-only at call time so hot-reload / test override works)
# ---------------------------------------------------------------------------

def _is_enabled() -> bool:
    return os.getenv("ENABLE_LINKEDIN_POSTING", "false").strip().lower() == "true"

def _get_organization_id() -> str:
    """LinkedIn organization URN numeric ID (digits only, not the full URN)."""
    return os.getenv("LINKEDIN_ORGANIZATION_ID", "").strip()

def get_active_linkedin_token(db: Session) -> str:
    """Get active LinkedIn access token. Refreshes if expired or expiring soon."""
    from app.domain.models import GlobalSettings
    from app.core.config import get_settings
    
    settings = get_settings()
    
    # 1. Fetch settings from DB
    gs_records = db.query(GlobalSettings).filter(
        GlobalSettings.key.in_([
            "linkedin_access_token",
            "linkedin_token_expires_at",
            "linkedin_refresh_token",
            "linkedin_refresh_token_expires_at"
        ])
    ).all()
    gs_dict = {r.key: r.value for r in gs_records}
    
    access_token = gs_dict.get("linkedin_access_token")
    expires_at_str = gs_dict.get("linkedin_token_expires_at")
    refresh_token = gs_dict.get("linkedin_refresh_token")
    
    # Fallback to env variables if not in DB
    if not access_token:
        access_token = settings.linkedin_access_token
        # If we fall back to env token, we don't have an expiry or refresh token.
        # Let's save it to DB so it can be managed.
        if access_token:
            try:
                db.add(GlobalSettings(key="linkedin_access_token", value=access_token))
                db.commit()
            except Exception:
                db.rollback()
                
    if not access_token:
        return ""
        
    # Check if expiring or expired (within 7 days)
    should_refresh = False
    if expires_at_str:
        try:
            expires_at = datetime.fromisoformat(expires_at_str)
            now = datetime.now(timezone.utc) if expires_at.tzinfo else datetime.now(timezone.utc).replace(tzinfo=None)
            if expires_at < now + timedelta(days=7):
                should_refresh = True
        except Exception as e:
            logger.error(f"[LinkedIn] Failed to parse token expiry: {e}")
            
    if should_refresh and refresh_token:
        client_id = settings.linkedin_client_id
        client_secret = settings.linkedin_client_secret
        if client_id and client_secret:
            logger.info("[LinkedIn] Token is expiring or expired. Attempting refresh...")
            try:
                res = requests.post(
                    "https://www.linkedin.com/oauth/v2/accessToken",
                    data={
                        "grant_type": "refresh_token",
                        "refresh_token": refresh_token,
                        "client_id": client_id,
                        "client_secret": client_secret,
                    },
                    timeout=10
                )
                if res.status_code == 200:
                    data = res.json()
                    new_access_token = data.get("access_token")
                    expires_in = data.get("expires_in")
                    new_refresh_token = data.get("refresh_token")
                    refresh_expires_in = data.get("refresh_token_expires_in")
                    
                    if new_access_token:
                        access_token = new_access_token
                        now = datetime.now(timezone.utc).replace(tzinfo=None)
                        token_expiry = (now + timedelta(seconds=expires_in)).isoformat()
                        
                        def update_or_create(k, v):
                            item = db.query(GlobalSettings).filter(GlobalSettings.key == k).first()
                            if item:
                                item.value = v
                            else:
                                db.add(GlobalSettings(key=k, value=v))
                                
                        update_or_create("linkedin_access_token", new_access_token)
                        update_or_create("linkedin_token_expires_at", token_expiry)
                        
                        if new_refresh_token:
                            update_or_create("linkedin_refresh_token", new_refresh_token)
                        if refresh_expires_in:
                            ref_expiry = (now + timedelta(seconds=refresh_expires_in)).isoformat()
                            update_or_create("linkedin_refresh_token_expires_at", ref_expiry)
                            
                        db.commit()
                        logger.info("[LinkedIn] Token refreshed successfully.")
                else:
                    logger.error(f"[LinkedIn] Token refresh failed: status={res.status_code} body={res.text}")
            except Exception as e:
                logger.error(f"[LinkedIn] Exception during token refresh: {e}")
                
    return access_token


# ---------------------------------------------------------------------------
# Post builder
# ---------------------------------------------------------------------------

def _build_post_text(
    title: str,
    location: str | None,
    experience_level: str | None,
    apply_url: str,
) -> str:
    """Compose human-readable post text from job fields."""
    lines = [f"🚀 We're Hiring: {title}"]

    if location:
        lines.append(f"📍 Location: {location}")

    if experience_level:
        exp_map = {
            "intern": "Internship",
            "junior": "Junior (0–2 yrs)",
            "mid": "Mid-Level (2–5 yrs)",
            "senior": "Senior (5+ yrs)",
            "lead": "Lead / Principal",
        }
        readable = exp_map.get(experience_level.lower(), experience_level.title())
        lines.append(f"🎯 Experience: {readable}")

    lines.append(f"\n🔗 Apply here: {apply_url}")
    lines.append("\n#Hiring #Jobs #Careers #Recruitment")

    return "\n".join(lines)


def _build_ugc_payload(text: str, organization_id: str) -> dict:
    """Build the LinkedIn UGC Post API request body."""
    return {
        "author": f"urn:li:organization:{organization_id}",
        "lifecycleState": "PUBLISHED",
        "specificContent": {
            "com.linkedin.ugc.ShareContent": {
                "shareCommentary": {
                    "text": text
                },
                "shareMediaCategory": "NONE"
            }
        },
        "visibility": {
            "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
        }
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def post_job_to_linkedin(
    *,
    job_id: str,
    title: str,
    location: str | None = None,
    experience_level: str | None = None,
    frontend_base_url: str = "http://localhost:3000",
    db: Optional[Session] = None,
) -> None:
    """
    Fire-and-forget: post a new job opening to the LinkedIn company page.

    This function MUST be called AFTER the job is successfully committed to
    the database. It will silently log and return on any failure — it must
    never raise, so the caller's success flow is never interrupted.

    Parameters
    ----------
    job_id        : The public job identifier (e.g. "JOB-ABC123")
    title         : Job title
    location      : Optional location string
    experience_level : Optional experience level key (e.g. "junior", "senior")
    frontend_base_url : Base URL of the frontend for constructing the apply link
    db            : Optional DB session for retrieving/refreshing token
    """
    # --- Gate 1: feature flag ---
    if not _is_enabled():
        logger.debug("[LinkedIn] Posting disabled (ENABLE_LINKEDIN_POSTING != true). Skipping.")
        return

    try:
        if db is None:
            from app.infrastructure.database import SessionLocal
            with SessionLocal() as session:
                access_token = get_active_linkedin_token(session)
        else:
            access_token = get_active_linkedin_token(db)
            
        organization_id = _get_organization_id()

        # --- Gate 2: credential check ---
        if not access_token:
            logger.warning("[LinkedIn] LINKEDIN_ACCESS_TOKEN not set. Cannot post job.")
            return
        if not organization_id:
            logger.warning("[LinkedIn] LINKEDIN_ORGANIZATION_ID not set. Cannot post job.")
            return

        # Build the apply link
        apply_url = f"{frontend_base_url.rstrip('/')}/jobs/{job_id}"

        # Validate that the apply URL is a valid absolute HTTPS URL (P2-L05)
        from urllib.parse import urlparse
        parsed_url = urlparse(apply_url)
        if parsed_url.scheme != "https" or not parsed_url.netloc:
            logger.warning(
                f"[LinkedIn] Cancelled posting because apply_url '{apply_url}' is not a valid absolute HTTPS URL."
            )
            return

        post_text = _build_post_text(
            title=title,
            location=location,
            experience_level=experience_level,
            apply_url=apply_url,
        )

        payload = _build_ugc_payload(post_text, organization_id)

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "X-Restli-Protocol-Version": "2.0.0",
        }

        response = requests.post(
            "https://api.linkedin.com/v2/ugcPosts",
            json=payload,
            headers=headers,
            timeout=10,
        )

        if response.status_code in (200, 201):
            post_id = response.headers.get("x-restli-id", "unknown")
            logger.info(
                f"[LinkedIn] Job post published successfully. "
                f"job_id={job_id} title='{title}' linkedin_post_id={post_id}"
            )
        else:
            logger.warning(
                f"[LinkedIn] API returned non-2xx status. "
                f"status={response.status_code} body={response.text[:300]} job_id={job_id}"
            )

    except requests.exceptions.Timeout:
        logger.warning(f"[LinkedIn] Request timed out while posting job_id={job_id}. Skipping.")
    except requests.exceptions.ConnectionError:
        logger.warning(f"[LinkedIn] Connection error while posting job_id={job_id}. Skipping.")
    except Exception as exc:
        # Catch-all: never let LinkedIn failure surface to the caller
        logger.error(
            f"[LinkedIn] Unexpected error posting job_id={job_id}: {exc}",
            exc_info=True,
        )
