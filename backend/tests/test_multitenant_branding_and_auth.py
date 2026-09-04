import pytest
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import app
from app.infrastructure.database import SessionLocal
from app.domain.models import User, Tenant
from app.core.auth import create_access_token, hash_password
from app.core.timezone import IST
from app.services.email_service import get_branding_dict, get_templated_email

from app.core.rate_limiter import limiter

limiter.enabled = False

client = TestClient(app)

def test_branding_default_tenant():
    """Default organization must return neutral CALRIMS branding and Default Organization name, never Amazon."""
    res = client.get("/api/settings/branding", headers={"X-Tenant-Slug": "default"})
    assert res.status_code == 200
    data = res.json()
    assert data["company_name"] == "Default Organization"
    assert data["product_name"] == "CAL-RIMS"
    assert data["company_logo_url"] == "/calrims/logo.png"
    assert data["favicon_url"] == "/calrims/logo.png"
    assert "Amazon" not in str(data)

def test_branding_amazon_tenant():
    """Amazon tenant must return isolated Amazon branding."""
    res = client.get("/api/settings/branding", headers={"X-Tenant-Slug": "amazon"})
    assert res.status_code == 200
    data = res.json()
    assert data["company_name"] == "Amazon"
    assert data["product_name"] == "Amazon Recruitment Portal"
    assert "Amazon_icon.png" in data["company_logo_url"]
    assert data["theme_color"] == "#06b6d4"

def test_branding_acme_tenant():
    """Acme tenant must return Acme branding."""
    res = client.get("/api/settings/branding", headers={"X-Tenant-Slug": "acme"})
    assert res.status_code == 200
    data = res.json()
    assert data["company_name"] == "Acme Technologies"
    assert data["product_name"] == "CAL-RIMS"
    assert data["theme_color"] == "#6366f1"
    assert "Amazon" not in str(data)

def test_email_branding_isolation():
    """Emails generated for different tenants must not leak cross-tenant branding."""
    with SessionLocal() as db:
        default_tenant = db.query(Tenant).filter(Tenant.slug == "default").first()
        amazon_tenant = db.query(Tenant).filter(Tenant.slug == "amazon").first()

        default_email = get_templated_email("<p>Hello Default</p>", "Test", tenant=default_tenant)
        amazon_email = get_templated_email("<p>Hello Amazon</p>", "Test", tenant=amazon_tenant)

        assert "Amazon" not in default_email
        assert "Default Organization" in default_email or "CAL-RIMS" in default_email
        assert "Amazon Recruitment Portal" in amazon_email
        assert "Amazon" in amazon_email

def test_auth_login_and_me_lifecycle():
    """Login returns 200, and immediately subsequent /api/auth/me returns 200 with user profile."""
    with SessionLocal() as db:
        user = db.query(User).filter(User.role.in_(["root-admin", "root_admin"])).first()
        if not user:
            pytest.skip("No root-admin user found for auth test")
        
        # Fresh access token
        token = create_access_token(
            data={"sub": str(user.id), "role": user.role, "email": user.email},
            expires_delta=timedelta(hours=1)
        )
        
        # Call /api/auth/me with Bearer token
        res_me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert res_me.status_code == 200
        user_data = res_me.json()
        assert user_data["email"] == user.email

def test_stale_token_rejected_when_password_changed():
    """Tokens issued before password_changed_at must be strictly rejected with 401."""
    with SessionLocal() as db:
        user = db.query(User).filter(User.role.in_(["root-admin", "root_admin", "super_admin"])).first()
        if not user:
            pytest.skip("No admin user found")
        
        # Set password_changed_at to now in IST
        now_ist = datetime.now(IST)
        user.password_changed_at = now_ist.replace(tzinfo=None)
        db.commit()
        db.refresh(user)

        # Create a token with iat in the past (1 hour before password change)
        past_utc = datetime.now(timezone.utc) - timedelta(hours=1)
        stale_token = create_access_token(
            data={"sub": str(user.id), "role": user.role, "email": user.email, "iat": int(past_utc.timestamp())},
            expires_delta=timedelta(hours=2)
        )

        res_stale = client.get("/api/auth/me", headers={"Authorization": f"Bearer {stale_token}"})
        assert res_stale.status_code == 401
        assert "Password has been changed" in str(res_stale.json())

def test_bearer_header_overrides_stale_cookie():
    """Explicit Authorization Bearer header takes precedence over a stale cookie."""
    with SessionLocal() as db:
        user = db.query(User).filter(User.role.in_(["root-admin", "root_admin"])).first()
        if not user:
            pytest.skip("No root-admin user found")
        
        valid_token = create_access_token(
            data={"sub": str(user.id), "role": user.role, "email": user.email},
            expires_delta=timedelta(hours=1)
        )
        
        # Send valid Bearer header alongside an invalid cookie
        res = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {valid_token}"},
            cookies={"access_token": "stale_invalid_cookie_string"}
        )
        assert res.status_code == 200
        assert res.json()["email"] == user.email

def test_login_amazon_user_on_amazon_subdomain():
    """Amazon user can successfully log in on amazon subdomain."""
    res = client.post(
        "/api/auth/login",
        json={"email": "amazon.hr@calrims.local", "password": "Password@123"},
        headers={"X-Tenant-Slug": "amazon"}
    )
    assert res.status_code == 200
    data = res.json()
    assert data["message"] == "Login successful"
    assert data["user"]["tenant_slug"] == "amazon"

def test_login_amazon_user_on_default_subdomain_blocked():
    """Amazon user logging in on default organization (localhost:3000) is blocked with 401 Invalid credentials."""
    res = client.post(
        "/api/auth/login",
        json={"email": "amazon.hr@calrims.local", "password": "Password@123"},
        headers={"X-Tenant-Slug": "default"}
    )
    assert res.status_code == 401
    assert "Invalid credentials" in str(res.json())

def test_login_amazon_user_on_acme_subdomain_blocked():
    """Amazon user logging in on acme subdomain is blocked with 401 Invalid credentials."""
    res = client.post(
        "/api/auth/login",
        json={"email": "amazon.hr@calrims.local", "password": "Password@123"},
        headers={"X-Tenant-Slug": "acme"}
    )
    assert res.status_code == 401
    assert "Invalid credentials" in str(res.json())

def test_login_root_admin_on_amazon_subdomain_blocked():
    """Platform Root Admin cannot log in through a tenant subdomain (e.g. amazon.localhost:3000)."""
    res = client.post(
        "/api/auth/login",
        json={"email": "caldiminternship@gmail.com", "password": "Password@123"},
        headers={"X-Tenant-Slug": "amazon"}
    )
    assert res.status_code == 401
    assert "Invalid credentials" in str(res.json())

def test_login_root_admin_on_central_platform_allowed():
    """Platform Root Admin can log in through the central platform portal (default / root)."""
    res = client.post(
        "/api/auth/login",
        json={"email": "caldiminternship@gmail.com", "password": "Password@123"},
        headers={"X-Tenant-Slug": "default"}
    )
    assert res.status_code == 200
    assert res.json()["user"]["role"] in ("root-admin", "root_admin")

def test_amazon_token_accessing_acme_api_blocked():
    """A valid Amazon user token calling an Acme tenant route is blocked with 403."""
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == "amazon.hr@calrims.local").first()
        assert user, "amazon.hr@calrims.local user not found"
        token = create_access_token({
            "sub": str(user.id),
            "role": user.role,
            "tenant_id": str(user.tenant_id),
            "tenant_slug": "amazon"
        })

    # Call /api/auth/me with Acme tenant header
    res_me = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}", "X-Tenant-Slug": "acme"}
    )
    assert res_me.status_code == 403
    assert "Access denied" in str(res_me.json())

def test_acme_token_accessing_acme_api_allowed():
    """A valid Acme user token calling an Acme tenant route is allowed."""
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == "acme.hr@calrims.local").first()
        assert user, "acme.hr@calrims.local user not found"
        token = create_access_token({
            "sub": str(user.id),
            "role": user.role,
            "tenant_id": str(user.tenant_id),
            "tenant_slug": "acme"
        })

    res_me = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}", "X-Tenant-Slug": "acme"}
    )
    assert res_me.status_code == 200
    assert res_me.json()["email"] == "acme.hr@calrims.local"

def test_root_admin_accessing_switched_tenant_api_allowed():
    """Root Admin can access any tenant's data when switching tenants (e.g. Amazon, Acme)."""
    with SessionLocal() as db:
        user = db.query(User).filter(User.role.in_(["root-admin", "root_admin"])).first()
        assert user, "root-admin user not found"
        token = create_access_token({
            "sub": str(user.id),
            "role": user.role,
            "tenant_id": str(user.tenant_id) if user.tenant_id else None,
            "tenant_slug": "default"
        })

    # Root Admin switches to Amazon via X-Tenant-Slug
    res_amazon = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}", "X-Tenant-Slug": "amazon"}
    )
    assert res_amazon.status_code == 200

    # Root Admin switches to Acme via X-Tenant-Slug
    res_acme = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}", "X-Tenant-Slug": "acme"}
    )
    assert res_acme.status_code == 200

def test_tenant_super_admin_cannot_access_other_tenants():
    """Tenant Super Admin (e.g. Amazon super_admin) cannot access other tenants like Acme."""
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == "amazon.admin@calrims.local").first()
        assert user, "amazon.admin@calrims.local user not found"
        assert user.role == "super_admin"
        token = create_access_token({
            "sub": str(user.id),
            "role": user.role,
            "tenant_id": str(user.tenant_id),
            "tenant_slug": "amazon"
        })

    # Attempt to switch to Acme
    res = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}", "X-Tenant-Slug": "acme"}
    )
    assert res.status_code == 403
    assert "Access denied" in str(res.json())

def test_tenant_super_admin_tenants_endpoint_returns_only_own_tenant():
    """Tenant Super Admin calling /api/auth/tenants gets only their own tenant, never the full list."""
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == "amazon.admin@calrims.local").first()
        assert user, "amazon.admin@calrims.local not found"
        token = create_access_token({
            "sub": str(user.id),
            "role": user.role,
            "tenant_id": str(user.tenant_id),
            "tenant_slug": "amazon"
        })

    res = client.get(
        "/api/auth/tenants",
        headers={"Authorization": f"Bearer {token}", "X-Tenant-Slug": "amazon"}
    )
    assert res.status_code == 200
    tenants = res.json()
    assert len(tenants) == 1
    assert tenants[0]["slug"] == "amazon"

def test_root_admin_tenants_endpoint_returns_all_tenants():
    """Root Admin on central platform gets the full tenant list for tenant switching."""
    with SessionLocal() as db:
        user = db.query(User).filter(User.role.in_(["root-admin", "root_admin"])).first()
        assert user, "root-admin user not found"
        token = create_access_token({
            "sub": str(user.id),
            "role": user.role,
            "tenant_id": None,
            "tenant_slug": "default"
        })

    res = client.get(
        "/api/auth/tenants",
        headers={"Authorization": f"Bearer {token}", "X-Tenant-Slug": "default"}
    )
    assert res.status_code == 200
    tenants = res.json()
    slugs = [t["slug"] for t in tenants]
    assert "amazon" in slugs
    assert "acme" in slugs
    assert "nexus" in slugs



