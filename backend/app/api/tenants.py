from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, text
import uuid
import logging
from datetime import datetime, timezone

from app.infrastructure.database import get_db
from app.domain.models import Tenant, User, Job, Application, Interview, AuditLog
from app.domain.schemas import TenantStatusUpdate
from app.core.auth import get_current_root_admin
from app.core.middleware import invalidate_tenant_cache
from app.core.timezone import get_ist_now

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tenants", tags=["tenants"])


@router.get("", response_model=List[Dict[str, Any]])
def list_tenants(
    status_filter: Optional[str] = Query(None, alias="status"),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_root_admin: User = Depends(get_current_root_admin),
):
    """
    List all tenants with aggregated metrics and primary admin info.
    Restricted to Platform Root Admins.
    """
    query = db.query(Tenant)

    if status_filter and status_filter.lower() != "all":
        query = query.filter(Tenant.status == status_filter.lower())

    if search:
        search_term = f"%{search.strip().lower()}%"
        query = query.filter(
            or_(
                func.lower(Tenant.name).like(search_term),
                func.lower(Tenant.slug).like(search_term),
                func.lower(Tenant.custom_domain).like(search_term)
            )
        )

    tenants = query.order_by(Tenant.created_at.desc()).all()

    result = []
    for t in tenants:
        # Fetch stats for each tenant
        users_count = db.query(func.count(User.id)).filter(User.tenant_id == t.id).scalar() or 0
        jobs_count = db.query(func.count(Job.id)).filter(Job.tenant_id == t.id).scalar() or 0
        applications_count = db.query(func.count(Application.id)).filter(Application.tenant_id == t.id).scalar() or 0

        # Find primary super_admin for this tenant
        primary_admin = (
            db.query(User)
            .filter(User.tenant_id == t.id, User.role == "super_admin")
            .order_by(User.created_at.asc())
            .first()
        )
        if not primary_admin:
            # Fallback to any user for this tenant
            primary_admin = (
                db.query(User)
                .filter(User.tenant_id == t.id)
                .order_by(User.created_at.asc())
                .first()
            )

        admin_data = None
        if primary_admin:
            admin_data = {
                "id": primary_admin.id,
                "full_name": primary_admin.full_name,
                "email": primary_admin.email,
                "role": primary_admin.role,
                "is_active": primary_admin.is_active,
                "approval_status": primary_admin.approval_status,
                "created_at": primary_admin.created_at.isoformat() if hasattr(primary_admin, "created_at") and primary_admin.created_at else None,
            }

        result.append({
            "id": str(t.id),
            "name": t.name,
            "slug": t.slug,
            "custom_domain": t.custom_domain,
            "logo_url": t.logo_url,
            "status": t.status,
            "settings": t.settings or {},
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "updated_at": t.updated_at.isoformat() if t.updated_at else None,
            "primary_admin": admin_data,
            "stats": {
                "users_count": users_count,
                "jobs_count": jobs_count,
                "applications_count": applications_count,
            }
        })

    return result


@router.get("/pending", response_model=Dict[str, Any])
def get_pending_tenants(
    db: Session = Depends(get_db),
    current_root_admin: User = Depends(get_current_root_admin),
):
    """
    Quick count and listing of pending tenant registrations awaiting Root Admin review.
    """
    pending_query = db.query(Tenant).filter(Tenant.status == "pending")
    count = pending_query.count()
    pending_list = pending_query.order_by(Tenant.created_at.desc()).all()

    tenants_data = []
    for t in pending_list:
        primary_admin = (
            db.query(User)
            .filter(User.tenant_id == t.id)
            .order_by(User.created_at.asc())
            .first()
        )
        tenants_data.append({
            "id": str(t.id),
            "name": t.name,
            "slug": t.slug,
            "logo_url": t.logo_url,
            "status": t.status,
            "settings": t.settings or {},
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "admin_name": primary_admin.full_name if primary_admin else None,
            "admin_email": primary_admin.email if primary_admin else None,
        })

    return {
        "count": count,
        "tenants": tenants_data
    }


@router.get("/{tenant_id}", response_model=Dict[str, Any])
def get_tenant_details(
    tenant_id: str,
    db: Session = Depends(get_db),
    current_root_admin: User = Depends(get_current_root_admin),
):
    """
    Get detailed information about a single tenant, including linked team members.
    """
    try:
        t_uuid = uuid.UUID(tenant_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid tenant UUID")

    tenant = db.query(Tenant).filter(Tenant.id == t_uuid).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    # Fetch users
    users = db.query(User).filter(User.tenant_id == tenant.id).order_by(User.role.asc(), User.created_at.asc()).all()
    users_data = [
        {
            "id": u.id,
            "full_name": u.full_name,
            "email": u.email,
            "role": u.role,
            "is_active": u.is_active,
            "approval_status": u.approval_status,
            "created_at": u.created_at.isoformat() if hasattr(u, "created_at") and u.created_at else None,
        }
        for u in users
    ]

    # Stats
    jobs_count = db.query(func.count(Job.id)).filter(Job.tenant_id == tenant.id).scalar() or 0
    applications_count = db.query(func.count(Application.id)).filter(Application.tenant_id == tenant.id).scalar() or 0
    interviews_count = db.query(func.count(Interview.id)).filter(Interview.tenant_id == tenant.id).scalar() or 0

    return {
        "id": str(tenant.id),
        "name": tenant.name,
        "slug": tenant.slug,
        "custom_domain": tenant.custom_domain,
        "logo_url": tenant.logo_url,
        "status": tenant.status,
        "settings": tenant.settings or {},
        "created_at": tenant.created_at.isoformat() if tenant.created_at else None,
        "updated_at": tenant.updated_at.isoformat() if tenant.updated_at else None,
        "users": users_data,
        "stats": {
            "users_count": len(users_data),
            "jobs_count": jobs_count,
            "applications_count": applications_count,
            "interviews_count": interviews_count,
        }
    }


@router.post("/{tenant_id}/approve")
def approve_tenant(
    tenant_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_root_admin: User = Depends(get_current_root_admin),
):
    """
    Approve a pending tenant organization and activate its primary administrator.
    """
    try:
        t_uuid = uuid.UUID(tenant_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid tenant UUID")

    tenant = db.query(Tenant).filter(Tenant.id == t_uuid).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    tenant.status = "active"

    # Activate tenant users (super_admin and hr)
    tenant_users = db.query(User).filter(User.tenant_id == tenant.id).all()
    for u in tenant_users:
        u.is_active = True
        u.approval_status = "approved"

    # Invalidate cache
    invalidate_tenant_cache(slug=tenant.slug, tenant_id=str(tenant.id))

    # Audit log
    try:
        audit = AuditLog(
            user_id=current_root_admin.id,
            action="TENANT_APPROVED",
            resource_type="Tenant",
            resource_id=None,
            details=f"Root Admin {current_root_admin.email} approved tenant {tenant.name} (slug: {tenant.slug})",
            ip_address=request.client.host if request.client else None,
            is_critical=True,
        )
        db.add(audit)
    except Exception as e:
        logger.warning(f"Could not write audit log for tenant approval: {e}")

    db.commit()
    db.refresh(tenant)

    logger.info(f"[TENANT-APPROVED] Tenant '{tenant.name}' ({tenant.slug}) approved by Root Admin {current_root_admin.email}")

    return {
        "success": True,
        "message": f"Organization '{tenant.name}' has been approved and activated.",
        "tenant": {
            "id": str(tenant.id),
            "name": tenant.name,
            "slug": tenant.slug,
            "status": tenant.status,
        }
    }


@router.post("/{tenant_id}/reject")
def reject_tenant(
    tenant_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_root_admin: User = Depends(get_current_root_admin),
):
    """
    Reject a pending tenant registration and block associated administrator accounts.
    """
    try:
        t_uuid = uuid.UUID(tenant_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid tenant UUID")

    tenant = db.query(Tenant).filter(Tenant.id == t_uuid).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    tenant.status = "rejected"

    # Block tenant users
    tenant_users = db.query(User).filter(User.tenant_id == tenant.id).all()
    for u in tenant_users:
        u.is_active = False
        u.approval_status = "rejected"

    # Invalidate cache
    invalidate_tenant_cache(slug=tenant.slug, tenant_id=str(tenant.id))

    # Audit log
    try:
        audit = AuditLog(
            user_id=current_root_admin.id,
            action="TENANT_REJECTED",
            resource_type="Tenant",
            resource_id=None,
            details=f"Root Admin {current_root_admin.email} rejected tenant {tenant.name} (slug: {tenant.slug})",
            ip_address=request.client.host if request.client else None,
            is_critical=True,
        )
        db.add(audit)
    except Exception as e:
        logger.warning(f"Could not write audit log for tenant rejection: {e}")

    db.commit()
    db.refresh(tenant)

    logger.info(f"[TENANT-REJECTED] Tenant '{tenant.name}' ({tenant.slug}) rejected by Root Admin {current_root_admin.email}")

    return {
        "success": True,
        "message": f"Organization '{tenant.name}' registration has been rejected.",
        "tenant": {
            "id": str(tenant.id),
            "name": tenant.name,
            "slug": tenant.slug,
            "status": tenant.status,
        }
    }


@router.put("/{tenant_id}/status")
def update_tenant_status(
    tenant_id: str,
    payload: TenantStatusUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_root_admin: User = Depends(get_current_root_admin),
):
    """
    Update a tenant's operating status (e.g. active, suspended, deactivated).
    """
    try:
        t_uuid = uuid.UUID(tenant_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid tenant UUID")

    tenant = db.query(Tenant).filter(Tenant.id == t_uuid).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    old_status = tenant.status
    new_status = payload.status
    tenant.status = new_status

    # Synchronize users if deactivated or suspended
    tenant_users = db.query(User).filter(User.tenant_id == tenant.id).all()
    if new_status in ("suspended", "deactivated", "rejected"):
        for u in tenant_users:
            u.is_active = False
    elif new_status == "active":
        for u in tenant_users:
            if u.role in ("super_admin", "hr"):
                u.is_active = True
                u.approval_status = "approved"

    # Invalidate cache
    invalidate_tenant_cache(slug=tenant.slug, tenant_id=str(tenant.id))

    # Audit log
    try:
        audit = AuditLog(
            user_id=current_root_admin.id,
            action=f"TENANT_STATUS_{new_status.upper()}",
            resource_type="Tenant",
            resource_id=None,
            details=f"Root Admin {current_root_admin.email} changed tenant {tenant.slug} status from {old_status} to {new_status}. Reason: {payload.reason or 'None provided'}",
            ip_address=request.client.host if request.client else None,
            is_critical=True,
        )
        db.add(audit)
    except Exception as e:
        logger.warning(f"Could not write audit log for tenant status update: {e}")

    db.commit()
    db.refresh(tenant)

    logger.info(f"[TENANT-STATUS-UPDATED] Tenant '{tenant.name}' ({tenant.slug}) status updated from {old_status} to {new_status} by {current_root_admin.email}")

    return {
        "success": True,
        "message": f"Tenant status updated to '{new_status}'.",
        "tenant": {
            "id": str(tenant.id),
            "name": tenant.name,
            "slug": tenant.slug,
            "status": tenant.status,
        }
    }
