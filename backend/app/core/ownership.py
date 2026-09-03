"""
Resource ownership and access-control helpers.

Provides:
  - validate_hr_ownership()          : HR-level resource ownership guard (pre-existing)
  - validate_hr_ownership_for_interview() : interview-specific guard (pre-existing)
  - get_tenant_context()             : FastAPI dependency — reads tenant from request.state
  - RequireTenant                    : FastAPI Depends() factory for tenant-protected routes

All pre-existing functions are fully preserved and backward-compatible.
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import Depends, HTTPException, Request, status

from app.core.tenant_context import TenantContext


# ---------------------------------------------------------------------------
# Pre-existing ownership validators (unchanged)
# ---------------------------------------------------------------------------

def validate_hr_ownership_for_interview(interview, current_user, *, resource_name: str = "interview") -> None:
    """Ensure the HR (or super_admin) owns the application attached to this interview."""
    if interview is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview not found")

    # Super admins can bypass
    if current_user.role.lower() == "super_admin":
        return

    application = getattr(interview, "application", None)
    if application is None:
        # If application was deleted or is missing, treat as not found for safety
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview context not found")

    validate_hr_ownership(application, current_user, resource_name=resource_name)


def validate_hr_ownership(resource, current_user, *, resource_name: str = "resource") -> None:
    """
    Centralized ownership guard for all non-admin users.
    Checks both direct assignment (hr_id) and job-level ownership.
    """
    if current_user.role.lower() == "super_admin":
        return

    # Check Direct Ownership (Resource assigned to this HR)
    owner_id = getattr(resource, "hr_id", None)
    if owner_id is not None and owner_id == current_user.id:
        return

    # Check Job-Level Ownership (HR owns the job this application is for)
    # This works for both Job and Application objects
    job = getattr(resource, "job", None)
    if job and getattr(job, "hr_id", None) == current_user.id:
        return

    # Standard Job check (if resource is a Job)
    if hasattr(resource, "title") and hasattr(resource, "hr_id") and resource.hr_id == current_user.id:
        return

    # If all checks fail, DENY.
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Access denied: You do not have permission to manage this {resource_name}.",
    )


# ---------------------------------------------------------------------------
# Tenant dependency helpers (new)
# ---------------------------------------------------------------------------

def get_tenant_context(request: Request) -> TenantContext:
    """
    FastAPI dependency that extracts the resolved TenantContext from
    ``request.state.tenant`` (set by TenantResolutionMiddleware).

    Raises HTTP 400 if the middleware did not resolve a tenant (should not
    happen on protected routes, but guards against misconfiguration).
    """
    tenant: Optional[TenantContext] = getattr(request.state, "tenant", None)
    if tenant is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tenant context missing. Ensure the request includes a valid X-Tenant-Slug or X-Tenant-ID header.",
        )
    if tenant.is_suspended:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This organization is currently suspended.",
        )
    return tenant


def get_optional_tenant_context(request: Request) -> Optional[TenantContext]:
    """
    Like get_tenant_context() but returns None instead of raising when no
    tenant is set.  Useful for hybrid public/private routes.
    """
    return getattr(request.state, "tenant", None)


def get_tenant_id(request: Request) -> uuid.UUID:
    """
    FastAPI dependency that returns just the active tenant UUID.
    Use this when you only need the ID for FK stamping.
    """
    ctx = get_tenant_context(request)
    return ctx.id


# Convenience alias for Depends() — allows:
#   tenant: TenantContext = Depends(RequireTenant)
RequireTenant = get_tenant_context


def validate_tenant_ownership(resource, tenant_ctx: Optional[TenantContext], *, resource_name: str = "resource") -> None:
    """Ensure the requested resource belongs to the currently active tenant."""
    if resource is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{resource_name.capitalize()} not found")
    if tenant_ctx is None:
        return
    res_tenant_id = getattr(resource, "tenant_id", None)
    if res_tenant_id is not None and str(res_tenant_id) != str(tenant_ctx.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{resource_name.capitalize()} not found")

