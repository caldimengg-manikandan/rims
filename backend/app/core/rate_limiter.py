"""
IP-based rate limiting for sensitive endpoints.
Uses slowapi (built on top of limits library).
"""
from slowapi import Limiter
from slowapi.util import get_remote_address
from fastapi import Request

def custom_key_func(request: Request) -> str:
    """Rate limit by client IP only to prevent header injection bypasses."""
    return get_remote_address(request)

from app.core.config import get_settings

# Global rate limiter instance — keyed by client IP only
settings = get_settings()
storage_uri = settings.redis_url.strip() if settings.redis_url else "memory://"

limiter = Limiter(
    key_func=custom_key_func,
    storage_uri=storage_uri
)
