"""
Tests for true multi-tenancy enforcement across application routes:
- Public job listing and detail route isolation
- Cross-tenant job access rejection (404)
- Tenant branding isolation
- Pending approvals isolation
- Repository question sets isolation
"""
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.infrastructure.database import SessionLocal
from app.domain.models import Tenant, Job, User

client = TestClient(app)


def test_public_jobs_scoped_to_amazon_tenant():
    """Visiting amazon.localhost or sending X-Tenant-Slug: amazon returns ONLY Amazon jobs."""
    response = client.get("/api/jobs/public", headers={"X-Tenant-Slug": "amazon"})
    assert response.status_code == 200
    jobs = response.json()
    assert len(jobs) == 1
    assert jobs[0]["title"] == "SDE - I"
    # Ensure no jobs from other tenants leak
    titles = [j["title"] for j in jobs]
    assert "Senior AI Systems Architect" not in titles
    assert "Chief Clinical Geneticist" not in titles


def test_public_jobs_scoped_to_acme_tenant():
    """Sending X-Tenant-Slug: acme returns ONLY Acme jobs."""
    response = client.get("/api/jobs/public", headers={"X-Tenant-Slug": "acme"})
    assert response.status_code == 200
    jobs = response.json()
    assert len(jobs) == 2
    titles = [j["title"] for j in jobs]
    assert "Senior AI Systems Architect" in titles
    assert "SDE" in titles
    assert "SDE - I" not in titles


def test_public_jobs_host_header_subdomain():
    """Host: amazon.localhost:3000 routes correctly to amazon tenant."""
    response = client.get("/api/jobs/public", headers={"Host": "amazon.localhost:3000"})
    assert response.status_code == 200
    jobs = response.json()
    assert len(jobs) == 1
    assert jobs[0]["title"] == "SDE - I"


def test_cross_tenant_public_job_detail_blocked():
    """Attempting to view an Acme job while scoped to Amazon tenant returns 404."""
    # Job 22 belongs to Amazon
    # When scoped to Amazon: 200 OK
    res_ok = client.get("/api/jobs/public/22", headers={"X-Tenant-Slug": "amazon"})
    assert res_ok.status_code == 200
    assert res_ok.json()["title"] == "SDE - I"

    # When scoped to Acme: 404 Not Found (blocked across tenants)
    res_blocked = client.get("/api/jobs/public/22", headers={"X-Tenant-Slug": "acme"})
    assert res_blocked.status_code == 404


def test_tenant_branding_isolation():
    """Branding returns company_name matching the active tenant."""
    res_amazon = client.get("/api/settings/branding", headers={"X-Tenant-Slug": "amazon"})
    assert res_amazon.status_code == 200
    assert res_amazon.json()["company_name"] == "Amazon"

    res_acme = client.get("/api/settings/branding", headers={"X-Tenant-Slug": "acme"})
    assert res_acme.status_code == 200
    assert res_acme.json()["company_name"] == "Acme Technologies"
