import pytest
import uuid
from datetime import timedelta
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.main import app
from app.infrastructure.database import SessionLocal
from app.domain.models import User, Tenant
from app.core.auth import create_access_token, hash_password
from app.core.rate_limiter import limiter

limiter.enabled = False

client = TestClient(app)


@pytest.fixture(scope="module")
def root_admin_token():
    with SessionLocal() as db:
        # Find or create Root Admin
        root_admin = db.query(User).filter(User.role.in_(["root-admin", "root_admin"])).first()
        if not root_admin:
            root_admin = User(
                email="platform.root@calrims.test",
                full_name="Platform Root Admin",
                password_hash=hash_password("RootAdminPass123!"),
                role="root-admin",
                is_active=True,
                is_verified=True,
                approval_status="approved",
                tenant_id=None
            )
            db.add(root_admin)
            db.commit()
            db.refresh(root_admin)

        token = create_access_token(
            {"sub": str(root_admin.id), "role": "root-admin"},
            expires_delta=timedelta(days=1)
        )
        return token, root_admin.id


@pytest.fixture(scope="module")
def regular_tenant_admin_token():
    with SessionLocal() as db:
        amazon_tenant = db.query(Tenant).filter(Tenant.slug == "amazon").first()
        admin = db.query(User).filter(User.email == "amazon.admin@calrims.test").first()
        if not admin:
            admin = User(
                email="amazon.admin@calrims.test",
                full_name="Amazon Admin",
                password_hash=hash_password("AmazonPass123!"),
                role="super_admin",
                is_active=True,
                is_verified=True,
                approval_status="approved",
                tenant_id=amazon_tenant.id if amazon_tenant else None
            )
            db.add(admin)
            db.commit()
            db.refresh(admin)

        token = create_access_token(
            {"sub": str(admin.id), "role": "super_admin", "tenant_id": str(admin.tenant_id), "tenant_slug": "amazon"},
            expires_delta=timedelta(days=1)
        )
        return token, admin.id


def test_tenant_registration_pending_lifecycle(root_admin_token, regular_tenant_admin_token):
    root_tok, _ = root_admin_token
    reg_tok, _ = regular_tenant_admin_token

    test_slug = f"testorg-{uuid.uuid4().hex[:6]}"
    admin_email = f"admin@{test_slug}.com"
    raw_password = "Password123!Safe"

    # Clean up if existed
    with SessionLocal() as db:
        old_u = db.query(User).filter(User.email == admin_email).first()
        if old_u:
            db.delete(old_u)
        old_t = db.query(Tenant).filter(Tenant.slug == test_slug).first()
        if old_t:
            db.delete(old_t)
        db.commit()

    # 1. Register company through /api/auth/company-register
    reg_res = client.post(
        "/api/auth/company-register",
        json={
            "company_name": "Test Org Inc",
            "slug": test_slug,
            "industry": "Technology & Software",
            "company_size": "11-50 employees",
            "primary_color": "#6366f1",
            "admin_name": "Test Org Admin",
            "admin_email": admin_email,
            "admin_password": raw_password,
        }
    )
    assert reg_res.status_code == 200, reg_res.text
    reg_data = reg_res.json()

    # Verify response message matches requirement:
    # "Thank you for registering. Please wait while we set things up for you. We’ll contact you soon."
    assert reg_data["success"] is True
    assert "Thank you for registering. Please wait while we set things up for you. We’ll contact you soon." in reg_data["message"]
    assert reg_data["tenant"]["status"] == "pending"
    tenant_id = reg_data["tenant"]["id"]

    # Verify no session cookies were issued
    assert "access_token" not in reg_res.cookies

    # Verify in database: tenant is pending, admin is inactive & pending
    with SessionLocal() as db:
        db_tenant = db.query(Tenant).filter(Tenant.slug == test_slug).first()
        assert db_tenant is not None
        assert db_tenant.status == "pending"

        db_admin = db.query(User).filter(User.email == admin_email).first()
        assert db_admin is not None
        assert db_admin.role == "super_admin"
        assert db_admin.approval_status == "pending"
        assert db_admin.is_active is False
        assert str(db_admin.tenant_id) == str(db_tenant.id)

    # 2. Pending admin attempts login -> blocked with 401 "Invalid credentials"
    login_res = client.post(
        "/api/auth/login",
        json={"email": admin_email, "password": raw_password},
        headers={"X-Tenant-Slug": test_slug}
    )
    assert login_res.status_code == 401
    assert "Invalid credentials" in str(login_res.json())

    # 3. Non-root user attempts to access /api/tenants -> blocked with 403 Forbidden
    non_root_res = client.get(
        "/api/tenants",
        headers={"Authorization": f"Bearer {reg_tok}"}
    )
    assert non_root_res.status_code == 403

    # 4. Root Admin views pending tenants -> sees newly registered tenant
    pending_res = client.get(
        "/api/tenants/pending",
        headers={"Authorization": f"Bearer {root_tok}"}
    )
    assert pending_res.status_code == 200
    pending_data = pending_res.json()
    assert pending_data["count"] >= 1
    found_pending = any(t["slug"] == test_slug for t in pending_data["tenants"])
    assert found_pending is True

    # 5. Root Admin approves the tenant
    approve_res = client.post(
        f"/api/tenants/{tenant_id}/approve",
        headers={"Authorization": f"Bearer {root_tok}"}
    )
    assert approve_res.status_code == 200
    assert approve_res.json()["success"] is True

    # Check DB: tenant status active, admin is active & approved
    with SessionLocal() as db:
        db_tenant = db.query(Tenant).filter(Tenant.id == uuid.UUID(tenant_id)).first()
        assert db_tenant.status == "active"
        db_admin = db.query(User).filter(User.email == admin_email).first()
        assert db_admin.is_active is True
        assert db_admin.approval_status == "approved"

    # 6. Approved tenant admin logs in successfully
    approved_login_res = client.post(
        "/api/auth/login",
        json={"email": admin_email, "password": raw_password},
        headers={"X-Tenant-Slug": test_slug}
    )
    assert approved_login_res.status_code == 200
    assert "access_token" in approved_login_res.cookies

    # 7. Root Admin suspends tenant
    suspend_res = client.put(
        f"/api/tenants/{tenant_id}/status",
        json={"status": "suspended", "reason": "Billing review"},
        headers={"Authorization": f"Bearer {root_tok}"}
    )
    assert suspend_res.status_code == 200
    assert suspend_res.json()["tenant"]["status"] == "suspended"

    # Suspended tenant admin login is blocked with 401 "Invalid credentials"
    suspended_login_res = client.post(
        "/api/auth/login",
        json={"email": admin_email, "password": raw_password},
        headers={"X-Tenant-Slug": test_slug}
    )
    assert suspended_login_res.status_code == 401
    assert "Invalid credentials" in str(suspended_login_res.json())

    # 8. Root Admin reactivates tenant
    reactivate_res = client.put(
        f"/api/tenants/{tenant_id}/status",
        json={"status": "active", "reason": "Review resolved"},
        headers={"Authorization": f"Bearer {root_tok}"}
    )
    assert reactivate_res.status_code == 200
    assert reactivate_res.json()["tenant"]["status"] == "active"

    # Reactivated tenant admin can log in again
    reactivated_login_res = client.post(
        "/api/auth/login",
        json={"email": admin_email, "password": raw_password},
        headers={"X-Tenant-Slug": test_slug}
    )
    assert reactivated_login_res.status_code == 200

    # 9. Clean up test records
    with SessionLocal() as db:
        db.query(User).filter(User.email == admin_email).delete()
        db.query(Tenant).filter(Tenant.slug == test_slug).delete()
        db.commit()


def test_root_admin_tenant_details_and_status_actions(root_admin_token, regular_tenant_admin_token):
    root_tok, _ = root_admin_token
    reg_tok, _ = regular_tenant_admin_token

    # Find a tenant in DB (or create one)
    with SessionLocal() as db:
        tenant = db.query(Tenant).filter(Tenant.slug != "default").first()
        if not tenant:
            tenant = Tenant(
                name="Action Test Corp",
                slug=f"action-test-{uuid.uuid4().hex[:6]}",
                status="active",
                settings={}
            )
            db.add(tenant)
            db.commit()
            db.refresh(tenant)
        tenant_id = str(tenant.id)

    # Clear any residual cookies from previous tests
    client.cookies.clear()

    # 1. Unauthenticated calls -> 401 Unauthorized
    unauth_details = client.get(f"/api/tenants/{tenant_id}")
    assert unauth_details.status_code == 401
    assert "Could not validate credentials" in str(unauth_details.json())

    unauth_status = client.put(f"/api/tenants/{tenant_id}/status", json={"status": "suspended"})
    assert unauth_status.status_code == 401
    assert "Could not validate credentials" in str(unauth_status.json())

    # 2. Non-root user (e.g. tenant admin) -> 403 Forbidden
    nonroot_details = client.get(
        f"/api/tenants/{tenant_id}",
        headers={"Authorization": f"Bearer {reg_tok}"}
    )
    assert nonroot_details.status_code == 403

    nonroot_status = client.put(
        f"/api/tenants/{tenant_id}/status",
        json={"status": "suspended", "reason": "Unauthorized attempt"},
        headers={"Authorization": f"Bearer {reg_tok}"}
    )
    assert nonroot_status.status_code == 403

    # 3. Root Admin -> 200 OK for Details
    root_details = client.get(
        f"/api/tenants/{tenant_id}",
        headers={"Authorization": f"Bearer {root_tok}"}
    )
    assert root_details.status_code == 200
    details_data = root_details.json()
    assert details_data["id"] == tenant_id
    assert "name" in details_data
    assert "slug" in details_data
    assert "users" in details_data
    assert "stats" in details_data
    assert isinstance(details_data["users"], list)

    # 4. Root Admin -> 200 OK for Suspend
    suspend_res = client.put(
        f"/api/tenants/{tenant_id}/status",
        json={"status": "suspended", "reason": "Administrative suspension"},
        headers={"Authorization": f"Bearer {root_tok}"}
    )
    assert suspend_res.status_code == 200
    suspend_data = suspend_res.json()
    assert suspend_data["success"] is True
    assert suspend_data["tenant"]["status"] == "suspended"

    # Verify updated in DB
    with SessionLocal() as db:
        t = db.query(Tenant).filter(Tenant.id == uuid.UUID(tenant_id)).first()
        assert t.status == "suspended"

    # 5. Root Admin -> 200 OK for Reactivate
    activate_res = client.put(
        f"/api/tenants/{tenant_id}/status",
        json={"status": "active", "reason": "Administrative reactivation"},
        headers={"Authorization": f"Bearer {root_tok}"}
    )
    assert activate_res.status_code == 200
    activate_data = activate_res.json()
    assert activate_data["success"] is True
    assert activate_data["tenant"]["status"] == "active"

    # Verify updated in DB
    with SessionLocal() as db:
        t = db.query(Tenant).filter(Tenant.id == uuid.UUID(tenant_id)).first()
        assert t.status == "active"


def test_root_admin_suspends_currently_selected_tenant(root_admin_token):
    root_tok, _ = root_admin_token
    client.cookies.clear()

    # 1. Create a dedicated test tenant and a tenant admin
    test_slug = f"switch-suspend-{uuid.uuid4().hex[:6]}"
    with SessionLocal() as db:
        test_tenant = Tenant(
            name="Switch Suspend Org",
            slug=test_slug,
            status="active",
            settings={}
        )
        db.add(test_tenant)
        db.commit()
        db.refresh(test_tenant)
        tenant_id = str(test_tenant.id)

        tenant_user = User(
            email=f"admin@{test_slug}.com",
            full_name="Switch Admin",
            password_hash=hash_password("Pass123!"),
            role="super_admin",
            is_active=True,
            is_verified=True,
            approval_status="approved",
            tenant_id=test_tenant.id
        )
        db.add(tenant_user)
        db.commit()

    try:
        # 2. Root Admin switches into this tenant (simulating tenant switcher sending X-Tenant-Slug)
        # Verify Root Admin can call /api/auth/tenants with this slug
        res_before = client.get(
            "/api/auth/tenants",
            headers={"Authorization": f"Bearer {root_tok}", "X-Tenant-Slug": test_slug}
        )
        assert res_before.status_code == 200
        slugs_before = [t["slug"] for t in res_before.json()]
        assert test_slug in slugs_before

        # 3. Root Admin suspends this same currently selected tenant
        suspend_res = client.put(
            f"/api/tenants/{tenant_id}/status",
            json={"status": "suspended", "reason": "Administrative suspension of switched tenant"},
            headers={"Authorization": f"Bearer {root_tok}", "X-Tenant-Slug": test_slug}
        )
        assert suspend_res.status_code == 200
        assert suspend_res.json()["tenant"]["status"] == "suspended"

        # 4. Root Admin calls /api/auth/tenants even while X-Tenant-Slug still points to the suspended tenant
        # MUST SUCCEED (200 OK), NOT 403!
        res_after = client.get(
            "/api/auth/tenants",
            headers={"Authorization": f"Bearer {root_tok}", "X-Tenant-Slug": test_slug}
        )
        assert res_after.status_code == 200
        tenants_after = res_after.json()
        slugs_after = [t["slug"] for t in tenants_after]
        # The suspended tenant is excluded from active tenants
        assert test_slug not in slugs_after
        # Default organization is present
        assert "default" in slugs_after

        # 5. Root Admin retains full access to /api/tenants
        mgmt_res = client.get(
            "/api/tenants",
            headers={"Authorization": f"Bearer {root_tok}", "X-Tenant-Slug": test_slug}
        )
        assert mgmt_res.status_code == 200
        all_tenants = mgmt_res.json()
        found_t = next((t for t in all_tenants if t["id"] == tenant_id), None)
        assert found_t is not None
        assert found_t["status"] == "suspended"

        # 6. Tenant user belonging to the suspended tenant is completely blocked
        # Login is blocked with 401 "Invalid credentials"
        login_res = client.post(
            "/api/auth/login",
            json={"email": f"admin@{test_slug}.com", "password": "Pass123!"},
            headers={"X-Tenant-Slug": test_slug}
        )
        assert login_res.status_code == 401
        assert "Invalid credentials" in str(login_res.json())

        # Protected tenant route (e.g. /api/jobs) with suspended slug is blocked with 403
        jobs_res = client.get(
            "/api/jobs",
            headers={"X-Tenant-Slug": test_slug}
        )
        assert jobs_res.status_code == 403
        assert "currently suspended" in jobs_res.text

    finally:
        # Cleanup
        with SessionLocal() as db:
            db.query(User).filter(User.email == f"admin@{test_slug}.com").delete()
            db.query(Tenant).filter(Tenant.slug == test_slug).delete()
            db.commit()


