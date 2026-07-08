from pydantic_settings import BaseSettings
from pydantic import model_validator, Field
from functools import lru_cache
from typing import List, Optional
import os
from pathlib import Path
from dotenv import load_dotenv
import logging

# Project root (backend folder)
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Environment-specific dotenv loading (non-breaking).
# Precedence rules:
# 1) Load env-specific file first (if present). We use override=True so explicit production config wins.
# 2) Load `.env` afterwards (if present) to fill any missing vars (override=False).
_active_env = (os.getenv("ENV") or "development").strip().lower()
_env_specific = ".env.production" if _active_env == "production" else ".env.local"
_env_specific_path = os.path.join(str(BASE_DIR), _env_specific)
_base_env_path = os.path.join(str(BASE_DIR), ".env")

if os.path.exists(_env_specific_path):
    load_dotenv(_env_specific_path, override=True)
if os.path.exists(_base_env_path):
    load_dotenv(_base_env_path, override=False)

class Settings(BaseSettings):
    base_dir: Path = BASE_DIR
    # Database
    database_url: str = "sqlite:///./rims.db" # Mandatory via validate_config
    db_pool_size: Optional[int] = None
    db_max_overflow: Optional[int] = None


    # JWT
    jwt_secret: str = "dev_jwt_secret_key_must_be_at_least_32_chars_long"
    interview_jwt_secret: str = "" # Isolated key for interview candidate sessions
    jwt_algorithm: str = "HS256"
    pdf_generation_secret: str = "" # Secret for authorizing internal PDF service calls
    jwt_expiration_minutes: int = 120
    jwt_refresh_expiration_days: int = 7

    # OpenAI
    openai_api_key: str = ""
    deepseek_api_key: str = ""
    gemini_api_key: str = ""
    anthropic_api_key: str = ""
    groq_api_key: str = ""

    # Encryption
    encryption_key: str = ""
    enforce_encryption: bool = False

    # Internal lists for rotation
    @property
    def openai_keys(self) -> List[str]:
        return [k.strip() for k in self.openai_api_key.split(",") if k.strip()]

    @property
    def deepseek_keys(self) -> List[str]:
        return [k.strip() for k in self.deepseek_api_key.split(",") if k.strip()]

    @property
    def gemini_keys(self) -> List[str]:
        return [k.strip() for k in self.gemini_api_key.split(",") if k.strip()]

    @property
    def anthropic_keys(self) -> List[str]:
        return [k.strip() for k in self.anthropic_api_key.split(",") if k.strip()]

    @property
    def groq_keys(self) -> List[str]:
        return [k.strip() for k in self.groq_api_key.split(",") if k.strip()]

    # SMTP Email Configuration
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""

    # IMAP Email Configuration
    imap_email: str = ""
    imap_password: str = ""
    
    # Resend API
    resend_api_key: str = ""
    # Optional override for the "from" address used by Resend.
    # If empty, we fall back to SMTP_FROM / SMTP_USER for convenience.
    resend_from: str = ""
    
    # Brevo API
    brevo_api_key: str = ""

    # Super Admin bootstrap (optional, auto-created at startup)
    super_admin_email: str = ""
    super_admin_password: str = ""
    super_admin_full_name: str = "Super Admin"
    allowed_origins: str = "http://localhost:3000,http://localhost:8000,http://127.0.0.1:3000,http://127.0.0.1:8000,http://localhost:3001,http://localhost:3002,http://127.0.0.1:3001,http://127.0.0.1:3002"
    
    # Observability
    sentry_dsn: Optional[str] = Field(default=None, alias="SENTRY_DSN")
    
    # Company branding
    company_name: str = "Company"
    hr_allowed_domains: str = ""
    test_admin_secret: str = ""
    disposable_email_domains: str = "fengnu.com,mailinator.com,guerrillamail.com,10minutemail.com,tempmail.com,yopmail.com,sharklasers.com,getnada.com,dispostable.com,trashmail.com,mail.tm,mail.gw,temp-mail.org"

    # Server
    host: str = "127.0.0.1"
    port: int = 10000  # Default to 10000 for Render
    debug: bool = False
    env: str = "development"
    ws_enforce_interview_jwt: bool = False
    enable_request_id_idempotency: bool = True
    # Demo interview endpoint toggle — set ENABLE_DEMO=true in development/staging to enable the public demo.
    # Defaults to False (disabled) to prevent accidental exposure in production.
    enable_demo: bool = False
    # redis://host:6379/0 — shared idempotency + X-Request-ID replay across workers
    redis_url: str = ""
    # Clamp idempotency marker + ephemeral replay TTLs (seconds); Redis and in-memory fallback both honor this band.

    # LinkedIn Auto-Post Integration
    enable_linkedin_posting: bool = False
    linkedin_access_token: str = ""
    linkedin_organization_id: str = ""
    linkedin_client_id: str = ""
    linkedin_client_secret: str = ""
    linkedin_redirect_uri: str = ""

    idempotency_ttl_min_seconds: int = 60
    idempotency_ttl_max_seconds: int = 120
    ai_observability_enabled: bool = True
    # A007: Use env var as-is (no auto replacement from ALLOWED_ORIGINS)
    # Supabase Storage
    supabase_url: str = ""
    supabase_key: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_bucket_resumes: str = "resumes"
    supabase_bucket_offers: str = "offers"
    supabase_bucket_id_cards: str = "id-cards"
    supabase_bucket_id_photos: str = "id-photos"
    supabase_bucket_videos: str = "videos"

    # Frontend URL (Point 8, A007)
    # Pydantic-settings will prioritize the env vars listed in validation_alias.
    frontend_base_url: str = Field(
        default="http://localhost:3000",
        validation_alias="FRONTEND_BASE_URL"
    )

    # Public URL for candidate-facing links (offer accept/reject, interview access).
    # Set to the externally accessible production URL (e.g. https://caldimproducts.com/calrims).
    # Falls back to frontend_base_url if not set.
    public_base_url: str = Field(
        default="",
        validation_alias="PUBLIC_BASE_URL"
    )

    class Config:
        env_file = os.path.join(str(BASE_DIR), ".env")
        case_sensitive = False
        extra = "ignore"

    @model_validator(mode="after")
    def _enforce_ws_jwt_in_production(self):
        """Standardize and validate configuration values."""
        # Standardize Supabase Key (Map service_role to generic key if missing)
        if not self.supabase_key and self.supabase_service_role_key:
            object.__setattr__(self, "supabase_key", self.supabase_service_role_key)

        # Normalize common email-provider inputs early to avoid subtle auth/config bugs.
        try:
            object.__setattr__(self, "smtp_host", (self.smtp_host or "").strip())
            object.__setattr__(self, "smtp_user", (self.smtp_user or "").strip())
            # Gmail "App Passwords" are often pasted with spaces; SMTP AUTH requires the raw token.
            object.__setattr__(self, "smtp_password", (self.smtp_password or "").strip())
            object.__setattr__(self, "smtp_from", (self.smtp_from or "").strip())
            object.__setattr__(self, "imap_email", (self.imap_email or "").strip())
            object.__setattr__(self, "imap_password", (self.imap_password or "").strip())
            object.__setattr__(self, "resend_api_key", (self.resend_api_key or "").strip())
            object.__setattr__(self, "resend_from", (self.resend_from or "").strip())
            object.__setattr__(self, "frontend_base_url", (self.frontend_base_url or "").strip())
        except Exception:
            pass

        # Warning if localhost is used in production
        if (self.env or "").strip().lower() == "production":
            if "localhost" in self.frontend_base_url or "127.0.0.1" in self.frontend_base_url:
                 logging.getLogger(__name__).warning(
                    f"CRITICAL CONFIG WARNING: frontend_base_url set to '{self.frontend_base_url}' while ENV=production."
                )

        # Check LinkedIn posting config (P2-L05)
        if self.enable_linkedin_posting:
            from urllib.parse import urlparse
            parsed_front = urlparse(self.frontend_base_url)
            is_valid_https = parsed_front.scheme == "https" and bool(parsed_front.netloc)
            if not self.frontend_base_url or not is_valid_https:
                logging.getLogger(__name__).critical(
                    "CRITICAL CONFIG ERROR: enable_linkedin_posting is True, but frontend_base_url "
                    f"('{self.frontend_base_url}') is not a valid absolute HTTPS URL. Disabling LinkedIn posting."
                )
                object.__setattr__(self, "enable_linkedin_posting", False)

        if not self.test_admin_secret and (self.env or "").strip().lower() not in ("production", "staging"):
            object.__setattr__(self, "test_admin_secret", "test_admin_dev_secret")

        explicit = os.environ.get("WS_ENFORCE_INTERVIEW_JWT")
        if explicit is not None:
            return self
        if (self.env or "").strip().lower() not in ("development", "local"):
            object.__setattr__(self, "ws_enforce_interview_jwt", True)
        return self

    def get_allowed_origins(self) -> List[str]:
        """Convert comma-separated string to list, with safety fallbacks"""
        origins = [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]
        
        # If in development and no origins are set or only localhost, 
        # consider allowing * for easier debugging, but keep default strict for production.
        if self.env == "development" and ("*" not in origins):
            # We don't force * here to keep it secure by default, 
            # but main.py's exception handlers already check self.env.
            pass
            
        return origins

    def validate_config(self):
        """Validate critical settings at startup. Called from main.py."""
        import logging
        logger = logging.getLogger(__name__)

        # 0. Production Safety Guards
        if (self.env or "").strip().lower() == "production":
            if not self.database_url or "sqlite" in self.database_url:
                error_msg = "SECURITY ERROR: SQLite database is not allowed in production."
                logger.critical(error_msg)
                raise ValueError(error_msg)
            if not self.jwt_secret or self.jwt_secret == "dev_jwt_secret_key_must_be_at_least_32_chars_long":
                error_msg = "SECURITY ERROR: Default development JWT secret is not allowed in production."
                logger.critical(error_msg)
                raise ValueError(error_msg)

        # 1. Fatal Mandatory Settings (Must stop app if missing)
        fatal_required = {
            "DATABASE_URL": self.database_url,
            "JWT_SECRET": self.jwt_secret,
        }
        if (self.env or "").strip().lower() == "production":
            fatal_required["INTERVIEW_JWT_SECRET"] = self.interview_jwt_secret

        missing_fatal = [k for k, v in fatal_required.items() if not v or v == ""]
        if missing_fatal:
            error_msg = f"FATAL CONFIG ERROR: Missing mandatory environment variables: {', '.join(missing_fatal)}. The server cannot start."
            logger.critical(error_msg)
            raise ValueError(error_msg)

        if self.jwt_secret and len(self.jwt_secret) < 32:
            logger.warning(
                "SECURITY WARNING: 'JWT_SECRET' is too short (less than 32 characters). "
                "For production, please generate a strong 256-bit key (e.g., using 'openssl rand -hex 32')."
            )

        # 2. Critical Settings (Warn in dev, fatal in production)
        critical_required = {
            "SUPABASE_URL": self.supabase_url,
            "SUPABASE_KEY": self.supabase_key,
            "GROQ_API_KEY": self.groq_api_key,
            "ENCRYPTION_KEY": self.encryption_key,
        }
        missing_critical = [k for k, v in critical_required.items() if not v or v == ""]
        if missing_critical:
            error_msg = f"CRITICAL CONFIG ERROR: Missing variables: {', '.join(missing_critical)}."
            if self.env == "production":
                logger.critical(error_msg)
                raise ValueError(error_msg)
            else:
                logger.warning(f"DEV WARNING: {error_msg} Proceeding with degraded functionality.")

        # 3. Production-Only Strict Mode
        if self.env == "production":
            if self.debug:
                raise ValueError("SECURITY ERROR: 'DEBUG=true' is not allowed in production.")
            
            # CORS safety check
            if "localhost" in self.allowed_origins or "*" in self.allowed_origins:
                logger.warning("SECURITY WARNING: Permissive CORS found in production (localhost/*).")

        # 4. Functional Warnings (Non-blocking)
        if not self.redis_url or self.redis_url == "":
            logger.warning("CONFIG WARNING: 'REDIS_URL' is missing. Idempotency replay cache will fall back to local in-process memory.")

        # Email provider check
        smtp_configured = bool(self.smtp_host and self.smtp_user and self.smtp_password)
        resend_configured = bool(self.resend_api_key)
        if not smtp_configured and not resend_configured:
            logger.warning("CONFIG WARNING: No email provider (SMTP/Resend) configured. Notifications will fail.")

        # A007: In production, warn if we detect localhost URLs but do not change them.
        # This keeps behavior stable and ensures deployment can control correctness via env vars.
        if self.env == "production":
            if "localhost" in self.frontend_base_url or "127.0.0.1" in self.frontend_base_url:
                import logging
                logging.getLogger(__name__).warning(
                    "WARNING: frontend_base_url appears to be localhost while ENV=production. "
                    "Check NEXT_PUBLIC_FRONTEND_URL / FRONTEND_BASE_URL in your environment."
                )

        # Additive logging: active environment and resolved URLs.
        try:
            api_base_url = os.getenv("NEXT_PUBLIC_API_BASE_URL", "")
            resolved_origins = self.get_allowed_origins()
            logging.getLogger(__name__).info(
                "Environment config",
                extra={
                    "env": self.env,
                    "frontend_base_url": self.frontend_base_url,
                    "api_base_url": api_base_url,
                    "allowed_origins": resolved_origins,
                },
            )
        except Exception:
            pass

@lru_cache()
def get_settings():
    return Settings()
