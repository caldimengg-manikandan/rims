"""
Middleware collection for CALRIMS FastAPI application.

Contains:
  - PerformanceLoggingMiddleware  : slow-route detection (pre-existing)
  - SecurityHeadersMiddleware     : CSP / security response headers (pre-existing)
  - TenantResolutionMiddleware    : multi-tenant identification and injection (new)

All three use the pure Starlette ASGI interface (not BaseHTTPMiddleware) to
avoid the well-known CORS-header-stripping bug.
"""
import json
import logging
import time
import uuid
from typing import Optional

from starlette.types import ASGIApp, Receive, Scope, Send

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pre-existing middleware (unchanged)
# ---------------------------------------------------------------------------

class PerformanceLoggingMiddleware:
    """Logs any HTTP request taking >500 ms with method, path, and status."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        start = time.perf_counter()

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                elapsed_ms = (time.perf_counter() - start) * 1000
                if elapsed_ms > 500:
                    path = scope.get("path", "")
                    method = scope.get("method", "")
                    status = message.get("status", 0)
                    logger.warning(
                        f"[SLOW ROUTE] method={method} "
                        f"route={path} "
                        f"time={elapsed_ms:.0f}ms "
                        f"status={status}"
                    )
            await send(message)

        await self.app(scope, receive, send_wrapper)


class SecurityHeadersMiddleware:
    """Injects hardened security response headers on every HTTP response."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])

                def set_header(name: bytes, value: bytes):
                    for idx, (k, v) in enumerate(headers):
                        if k.lower() == name.lower():
                            headers[idx] = (name, value)
                            return
                    headers.append((name, value))

                set_header(b"x-frame-options", b"DENY")
                set_header(b"x-content-type-options", b"nosniff")
                set_header(b"x-xss-protection", b"1; mode=block")
                set_header(b"referrer-policy", b"strict-origin-when-cross-origin")

                from app.core.config import get_settings
                settings = get_settings()
                if scope.get("scheme") == "https" or settings.env == "production":
                    set_header(b"strict-transport-security", b"max-age=31536000; includeSubDomains")

                dev_connect_src = (
                    b" http://localhost:10000 http://127.0.0.1:10000"
                    b" http://localhost:3000 http://127.0.0.1:3000"
                    if settings.env != "production"
                    else b""
                )
                set_header(b"content-security-policy",
                           # BUG-026 Fix: Removed 'unsafe-inline' from script-src.
                           # This was a CSP bypass that allowed arbitrary inline script execution.
                           b"default-src 'self'; "
                           b"script-src 'self' https://cdn.jsdelivr.net; "
                           b"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
                           b"font-src 'self' https://fonts.gstatic.com data:; "
                           b"img-src 'self' data: blob: https://*.supabase.co https://*.googleusercontent.com; "
                           b"connect-src 'self' https://*.supabase.co https://api.openai.com https://api.anthropic.com https://api.groq.com https://tfhub.dev https://storage.googleapis.com" + dev_connect_src + b"; "
                           b"frame-ancestors 'none'; object-src 'none'")

            await send(message)

        await self.app(scope, receive, send_wrapper)


# ---------------------------------------------------------------------------
# TenantResolutionMiddleware (new)
# ---------------------------------------------------------------------------

# Paths where tenant context is not mandatory (auth, branding, candidate onboarding, docs, system)
_TENANT_EXEMPT_PREFIXES = (
    "/health",
    "/ready",
    "/live",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/api/auth/",
    "/api/settings/branding",
    "/api/support/",
    "/api/onboarding/",
    "/api/storage/",
    "/_next/",
    "/static/",
    "/favicon",
)

# Routes that MUST have a valid, active tenant (protected tenant space)
_TENANT_REQUIRED_PREFIXES = (
    "/api/jobs",
    "/api/applications",
    "/api/interviews",
    "/api/analytics",
    "/api/decisions",
    "/api/notifications",
    "/api/tickets",
    "/api/hr-tickets",
    "/api/repository",
)


def _is_exempt(path: str) -> bool:
    return any(path.startswith(p) for p in _TENANT_EXEMPT_PREFIXES)


def _is_tenant_required(path: str) -> bool:
    return any(path.startswith(p) for p in _TENANT_REQUIRED_PREFIXES)


# ---------------------------------------------------------------------------
# In-process tenant cache (fallback when Redis is not configured)
# ---------------------------------------------------------------------------
import time as _time
import threading as _threading

_tenant_cache: dict = {}
_tenant_cache_lock = _threading.Lock()
_CACHE_TTL = 300  # 5 minutes


def _cache_get(key: str) -> Optional[dict]:
    with _tenant_cache_lock:
        entry = _tenant_cache.get(key)
        if entry and (_time.monotonic() - entry["ts"]) < _CACHE_TTL:
            return entry["data"]
        if entry:
            del _tenant_cache[key]
    return None


def _cache_set(key: str, data: Optional[dict]) -> None:
    with _tenant_cache_lock:
        _tenant_cache[key] = {"data": data, "ts": _time.monotonic()}


def _redis_cache_get(redis_client, key: str) -> Optional[dict]:
    try:
        raw = redis_client.get(key)
        if raw:
            return json.loads(raw)
    except Exception:
        pass
    return None


def _redis_cache_set(redis_client, key: str, data: Optional[dict]) -> None:
    try:
        redis_client.setex(key, _CACHE_TTL, json.dumps(data))
    except Exception:
        pass


def _cached_get(cache_key: str) -> Optional[dict]:
    """Try Redis first, fall back to in-process cache."""
    try:
        from app.core.redis_store import get_redis_client
        rc = get_redis_client()
        if rc:
            return _redis_cache_get(rc, cache_key)
    except Exception:
        pass
    return _cache_get(cache_key)


def _cached_set(cache_key: str, data: Optional[dict]) -> None:
    """Write to both Redis (if available) and in-process cache."""
    try:
        from app.core.redis_store import get_redis_client
        rc = get_redis_client()
        if rc:
            _redis_cache_set(rc, cache_key, data)
    except Exception:
        pass
    _cache_set(cache_key, data)


_NOT_FOUND: dict = {"__not_found__": True}


def _get_or_lookup(cache_key: str, lookup_fn, *args) -> Optional[dict]:
    """Retrieve tenant from cache, or look up from DB and cache result (including negative hits)."""
    cached = _cached_get(cache_key)
    if cached is not None:
        if isinstance(cached, dict) and cached.get("__not_found__"):
            return None
        return cached
    data = lookup_fn(*args)
    _cached_set(cache_key, data if data is not None else _NOT_FOUND)
    return data


# ---------------------------------------------------------------------------
# Tenant DB lookup
# ---------------------------------------------------------------------------

def _lookup_tenant_by_slug(slug: str) -> Optional[dict]:
    """Fetch tenant row by slug from the database. Returns a plain dict or None."""
    try:
        from app.infrastructure.database import SessionLocal
        from sqlalchemy import text
        db = SessionLocal()
        try:
            row = db.execute(
                text(
                    "SELECT id, name, slug, status, logo_url, custom_domain, settings "
                    "FROM public.tenants WHERE slug = :slug LIMIT 1"
                ),
                {"slug": slug},
            ).fetchone()
            if row:
                return {
                    "id": str(row[0]),
                    "name": row[1],
                    "slug": row[2],
                    "status": row[3],
                    "logo_url": row[4],
                    "custom_domain": row[5],
                    "settings": row[6] or {},
                }
        finally:
            db.close()
    except Exception as exc:
        logger.warning("[TenantMiddleware] DB lookup failed for slug=%r: %s", slug, exc)
    return None


def _lookup_tenant_by_id(tenant_id_str: str) -> Optional[dict]:
    """Fetch tenant row by UUID. Returns a plain dict or None."""
    try:
        uuid.UUID(tenant_id_str)  # validate format
    except (ValueError, AttributeError):
        return None

    try:
        from app.infrastructure.database import SessionLocal
        from sqlalchemy import text
        db = SessionLocal()
        try:
            row = db.execute(
                text(
                    "SELECT id, name, slug, status, logo_url, custom_domain, settings "
                    "FROM public.tenants WHERE id = :tid LIMIT 1"
                ),
                {"tid": tenant_id_str},
            ).fetchone()
            if row:
                return {
                    "id": str(row[0]),
                    "name": row[1],
                    "slug": row[2],
                    "status": row[3],
                    "logo_url": row[4],
                    "custom_domain": row[5],
                    "settings": row[6] or {},
                }
        finally:
            db.close()
    except Exception as exc:
        logger.warning("[TenantMiddleware] DB lookup failed for id=%r: %s", tenant_id_str, exc)
    return None


def _resolve_slug_from_host(host: str) -> Optional[str]:
    """
    Extract the tenant slug from the Host header.

    Patterns handled:
      acme.rims.app      -> 'acme'
      acme.calrims.com   -> 'acme'
      rims.app           -> None   (apex domain, no tenant)
      localhost          -> None
      127.0.0.1          -> None
      192.168.1.100      -> None   (IPv4)
    """
    if not host:
        return None
    # Strip port
    host = host.split(":")[0].lower().strip()
    # Ignore bare IPs (IPv4)
    import re as _re
    if _re.match(r'^\d{1,3}(\.\d{1,3}){3}$', host):
        return None
    # Ignore localhost
    if host in ("localhost", "127.0.0.1", "0.0.0.0"):
        return None
    # Support *.localhost (RFC 6761)
    if host.endswith(".localhost"):
        sub = host[:-len(".localhost")]
        if sub and sub not in ("www", "api", "mail", "admin", "static"):
            return sub
    # Known platform apex domains have no tenant
    if host in ("calrims.com", "rims.app", "calrims.local"):
        return None

    parts = host.split(".")
    # Standard internet hostnames require at least 3 parts (e.g. acme.calrims.com)
    if len(parts) >= 3:
        candidate = parts[0]
        # Reject obviously generic subdomains
        if candidate not in ("www", "api", "mail", "admin", "static"):
            return candidate
    return None



def _resolve_slug_from_jwt(authorization: str) -> Optional[str]:
    """
    Extract tenant_id from a Supabase / RIMS JWT Bearer token's app_metadata.
    Returns the tenant_id string (UUID) — callers convert to slug via DB lookup.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization[7:].strip()
    try:
        import base64
        parts = token.split(".")
        if len(parts) != 3:
            return None
        # Decode payload (no signature verification needed — we only read claims
        # for routing; the auth dependency verifies the signature separately)
        padding = 4 - len(parts[1]) % 4
        padded = parts[1] + "=" * padding
        payload = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
        app_meta = payload.get("app_metadata") or {}
        return app_meta.get("tenant_id") or app_meta.get("tenant_slug")
    except Exception:
        return None


def invalidate_tenant_cache(slug: Optional[str] = None, tenant_id: Optional[str] = None):
    """Invalidate tenant cache entry in Redis and in-process memory."""
    keys = []
    if slug:
        keys.append(f"tenant:slug:{slug}")
    if tenant_id:
        keys.append(f"tenant:id:{tenant_id}")
    with _tenant_cache_lock:
        for k in keys:
            _tenant_cache.pop(k, None)
    try:
        from app.core.redis_store import get_redis_client
        rc = get_redis_client()
        if rc:
            for k in keys:
                rc.delete(k)
    except Exception:
        pass


class TenantResolutionMiddleware:
    """
    ASGI middleware that resolves, validates, and injects tenant context for
    every incoming HTTP request.

    Resolution order (first match wins):
      1. Host header subdomain  (acme.rims.app → slug 'acme')
      2. X-Tenant-Slug header
      3. X-Tenant-ID header     (UUID)
      4. JWT app_metadata claim (tenant_id or tenant_slug)

    On success:
      - Sets ``request.state.tenant``    (TenantContext)
      - Sets ``request.state.tenant_id`` (uuid.UUID)
      - Sets ContextVar via set_current_tenant()

    On failure (tenant-required routes only):
      - 404 if slug/id cannot be resolved
      - 403 if the tenant exists but is not active (pending, suspended, rejected, deactivated)
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        path: str = scope.get("path", "")
        # System infrastructure fast path: docs, health, static assets skip resolution entirely
        _SYSTEM_BYPASS_PREFIXES = ("/health", "/ready", "/live", "/docs", "/redoc", "/openapi.json", "/_next/", "/static/", "/favicon")
        if any(path.startswith(p) for p in _SYSTEM_BYPASS_PREFIXES):
            await self.app(scope, receive, send)
            return

        # Build a lightweight header accessor from raw ASGI headers list
        raw_headers: list = scope.get("headers", [])
        headers: dict = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in raw_headers}

        tenant_data: Optional[dict] = None
        resolve_error: Optional[str] = None

        # ── Resolution Strategy ──────────────────────────────────────────────

        # 1. Subdomain from Host header
        host = headers.get("host", "")
        slug = _resolve_slug_from_host(host)
        if slug:
            cache_key = f"tenant:slug:{slug}"
            tenant_data = _get_or_lookup(cache_key, _lookup_tenant_by_slug, slug)

        # 2. X-Tenant-Slug header
        if tenant_data is None:
            slug_header = headers.get("x-tenant-slug", "").strip()
            if slug_header:
                cache_key = f"tenant:slug:{slug_header}"
                tenant_data = _get_or_lookup(cache_key, _lookup_tenant_by_slug, slug_header)
                if tenant_data is None:
                    resolve_error = f"Tenant slug '{slug_header}' not found"

        # 3. X-Tenant-ID header (UUID)
        if tenant_data is None and not resolve_error:
            tid_header = headers.get("x-tenant-id", "").strip()
            if tid_header:
                cache_key = f"tenant:id:{tid_header}"
                tenant_data = _get_or_lookup(cache_key, _lookup_tenant_by_id, tid_header)
                if tenant_data is None:
                    resolve_error = f"Tenant ID '{tid_header}' not found"

        # 4. JWT claim fallback
        if tenant_data is None and not resolve_error:
            auth_header = headers.get("authorization", "")
            jwt_tenant_ref = _resolve_slug_from_jwt(auth_header)
            if jwt_tenant_ref:
                # Could be a slug or a UUID string
                try:
                    uuid.UUID(jwt_tenant_ref)  # it's a UUID
                    cache_key = f"tenant:id:{jwt_tenant_ref}"
                    tenant_data = _get_or_lookup(cache_key, _lookup_tenant_by_id, jwt_tenant_ref)
                except ValueError:
                    # Treat as slug
                    cache_key = f"tenant:slug:{jwt_tenant_ref}"
                    tenant_data = _get_or_lookup(cache_key, _lookup_tenant_by_slug, jwt_tenant_ref)

        # 5. Default tenant fallback (dev/single-tenant deployments)
        if tenant_data is None and not resolve_error:
            from app.core.config import get_settings as _get_settings
            _settings = _get_settings()
            if _settings.env != "production":
                cache_key = "tenant:slug:default"
                tenant_data = _get_or_lookup(cache_key, _lookup_tenant_by_slug, "default")

        # ── Enforce on protected routes ──────────────────────────────────────
        tenant_required = _is_tenant_required(path) and not _is_exempt(path)

        if tenant_required and (resolve_error or tenant_data is None):
            status_code = 404
            body = json.dumps({"detail": resolve_error or "Tenant context could not be resolved"}).encode()
            await self._respond(send, status_code, body)
            return

        if tenant_required and tenant_data and tenant_data.get("status") in ("suspended", "pending", "rejected", "deactivated"):
            t_status = tenant_data.get("status")
            body = json.dumps({"detail": f"This organization is currently {t_status}"}).encode()
            await self._respond(send, 403, body)
            return

        # ── Inject tenant into scope & ContextVar ───────────────────────────
        if tenant_data:
            from app.core.tenant_context import TenantContext, set_current_tenant

            ctx = TenantContext(
                id=uuid.UUID(tenant_data["id"]),
                name=tenant_data["name"],
                slug=tenant_data["slug"],
                status=tenant_data["status"],
                logo_url=tenant_data.get("logo_url"),
                custom_domain=tenant_data.get("custom_domain"),
                settings=tenant_data.get("settings") or {},
            )
            set_current_tenant(ctx)

            # Attach to ASGI scope so downstream code can read via request.state
            if "state" not in scope:
                scope["state"] = {}
            scope["state"]["tenant"] = ctx
            scope["state"]["tenant_id"] = ctx.id

        await self.app(scope, receive, send)

    @staticmethod
    async def _respond(send: Send, status_code: int, body: bytes) -> None:
        await send({
            "type": "http.response.start",
            "status": status_code,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        })
        await send({"type": "http.response.body", "body": body})
