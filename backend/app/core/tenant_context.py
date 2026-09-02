"""
Tenant Context — async-safe per-request tenant tracking.

Uses Python's ``contextvars.ContextVar`` to store the active tenant for the
duration of a request.  Because each ASGI request runs in its own context
copy, there is no risk of cross-request contamination even under concurrency.

Usage
-----
    # In middleware (after resolving the tenant):
    from app.core.tenant_context import set_current_tenant_id, set_current_tenant
    set_current_tenant_id(uuid.UUID("..."))
    set_current_tenant(tenant_context_object)

    # Anywhere in the call-stack (service, repo, background task):
    from app.core.tenant_context import get_current_tenant_id
    tid = get_current_tenant_id()          # UUID | None
"""
from __future__ import annotations

import uuid
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


# ---------------------------------------------------------------------------
# TenantContext value object
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class TenantContext:
    """Immutable snapshot of the resolved tenant for a single request."""
    id: uuid.UUID
    name: str
    slug: str
    status: str                             # 'active' | 'suspended' | 'trial'
    logo_url: Optional[str] = None
    custom_domain: Optional[str] = None
    settings: Dict[str, Any] = field(default_factory=dict)

    @property
    def is_active(self) -> bool:
        return self.status == "active"

    @property
    def is_suspended(self) -> bool:
        return self.status == "suspended"

    def __str__(self) -> str:
        return f"Tenant(slug={self.slug!r}, id={self.id}, status={self.status})"


# ---------------------------------------------------------------------------
# ContextVar singletons  (module-level — one per process, safe across requests)
# ---------------------------------------------------------------------------

_current_tenant_id: ContextVar[Optional[uuid.UUID]] = ContextVar(
    "current_tenant_id", default=None
)
_current_tenant: ContextVar[Optional[TenantContext]] = ContextVar(
    "current_tenant", default=None
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_current_tenant_id() -> Optional[uuid.UUID]:
    """Return the active tenant UUID for the current request context, or None."""
    return _current_tenant_id.get()


def set_current_tenant_id(tenant_id: Optional[uuid.UUID]) -> None:
    """Set the active tenant UUID in the current request context."""
    _current_tenant_id.set(tenant_id)


def get_current_tenant() -> Optional[TenantContext]:
    """Return the full TenantContext for the current request, or None."""
    return _current_tenant.get()


def set_current_tenant(tenant: Optional[TenantContext]) -> None:
    """Set the full TenantContext in the current request context."""
    _current_tenant.set(tenant)
    _current_tenant_id.set(tenant.id if tenant is not None else None)


def require_current_tenant() -> TenantContext:
    """
    Return the active TenantContext or raise RuntimeError.
    Use this inside service / repository code that must never run without
    a tenant (belt-and-suspenders on top of the FastAPI dependency guard).
    """
    tenant = _current_tenant.get()
    if tenant is None:
        raise RuntimeError(
            "No tenant context is set for the current request. "
            "Ensure TenantResolutionMiddleware is registered and the route "
            "uses the RequireTenant dependency."
        )
    return tenant
