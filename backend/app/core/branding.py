import os
import logging
from typing import Optional, Any
from sqlalchemy.orm import Session
from app.domain.models import GlobalSettings

logger = logging.getLogger(__name__)

BRANDING_DEFAULTS = {
    "company_name": "CALDIM",
    "product_name": "CAL-RIMS",
    "company_logo_url": "/calrims/logo.png",
    "dark_logo_url": "/calrims/logo-dark.png",
    "favicon_url": "/calrims/logo.png",
    "footer_text": "Powered by CALDIM. Built for teams who care about who they hire.",
    "support_email": "support@caldimproducts.com",
    "theme_color": "#2563eb",
    "terms_url": "/calrims/terms/",
    "privacy_url": "/calrims/privacy/",
    "seo_title_default": "CAL-RIMS - AI-Powered Recruitment Intelligence System",
    "seo_description_default": "CAL-RIMS is an AI-powered automated recruitment platform for seamless hiring, empowering teams to find, evaluate, and hire top-tier talent efficiently."
}

def get_branding_value(db: Session, key: str, tenant_ctx: Optional[Any] = None) -> str:
    """
    Get a single branding configuration value with tenant isolation.
    """
    all_b = get_all_branding(db, tenant_ctx=tenant_ctx)
    return all_b.get(key, BRANDING_DEFAULTS.get(key, ""))

def get_all_branding(db: Session, tenant_ctx: Optional[Any] = None) -> dict:
    """
    Retrieve branding configuration values.
    - If tenant_ctx is provided, branding strictly derives from that tenant's configuration
      with fallback ONLY to neutral BRANDING_DEFAULTS (never falling back to another tenant).
    - If tenant_ctx is None, returns neutral platform defaults from BRANDING_DEFAULTS.
    """
    if tenant_ctx:
        # ── TENANT-SCOPED BRANDING ──────────────────────────────────────────
        # Start strictly with neutral CALRIMS defaults
        branding = BRANDING_DEFAULTS.copy()

        # 1. Tenant organization name
        tenant_name = getattr(tenant_ctx, "name", None)
        if tenant_name and str(tenant_name).strip():
            branding["company_name"] = str(tenant_name).strip()

        # 2. Tenant logo
        tenant_logo = getattr(tenant_ctx, "logo_url", None)
        if tenant_logo and str(tenant_logo).strip():
            branding["company_logo_url"] = str(tenant_logo).strip()
            branding["dark_logo_url"] = str(tenant_logo).strip()
            branding["favicon_url"] = str(tenant_logo).strip()

        # 3. Tenant settings dictionary
        tenant_settings = getattr(tenant_ctx, "settings", None) or {}
        if isinstance(tenant_settings, dict):
            if tenant_settings.get("primaryColor"):
                branding["theme_color"] = tenant_settings["primaryColor"]

            t_branding = tenant_settings.get("branding", {})
            if isinstance(t_branding, dict):
                for k in BRANDING_DEFAULTS.keys():
                    if t_branding.get(k):
                        branding[k] = t_branding[k]

        return branding

    # ── UNSCOPED / PLATFORM-LEVEL BRANDING ─────────────────────────────────
    db_settings = {}
    try:
        settings_records = db.query(GlobalSettings).all()
        db_settings = {s.key: s.value for s in settings_records}
    except Exception:
        pass

    branding = {}
    for key, default_val in BRANDING_DEFAULTS.items():
        val = db_settings.get(key)
        if val in ("[UNREADABLE]", "[DECRYPTION_ERROR]"):
            val = None
        if val is None or str(val).strip() == "":
            val = os.getenv(key.upper())
        if val is None or str(val).strip() == "":
            val = default_val
        branding[key] = val

    return branding
