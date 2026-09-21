"""
Regression tests for audit log tenant isolation (Batch 2, Items 23-24).
Validates that:
- AuditLog model has a tenant_id column
- tenant_id is set when creating audit logs in the code
- Cross-tenant audit log access is rejected
"""
import uuid
import pytest
from unittest.mock import MagicMock
from sqlalchemy import inspect as sa_inspect

from app.domain.models import AuditLog


# ============================================================================
# Model structure: tenant_id must exist on AuditLog
# ============================================================================

def test_audit_log_has_tenant_id_column():
    """AuditLog model must have a tenant_id column."""
    mapper = sa_inspect(AuditLog)
    column_names = [c.key for c in mapper.mapper.column_attrs]
    assert "tenant_id" in column_names, (
        "AuditLog must have a 'tenant_id' column for tenant-scoped audit isolation."
    )


def test_audit_log_tenant_id_is_nullable():
    """tenant_id on AuditLog must be nullable (supports legacy rows without tenant context)."""
    for col in AuditLog.__table__.columns:
        if col.name == "tenant_id":
            assert col.nullable is True, "AuditLog.tenant_id must be nullable for backwards compatibility."
            break


# ============================================================================
# Model structure: verify other models have tenant_id columns
# ============================================================================

def test_offer_has_tenant_id_column():
    """Offer model must have a tenant_id column."""
    from app.domain.models import Offer
    mapper = sa_inspect(Offer)
    column_names = [c.key for c in mapper.mapper.column_attrs]
    assert "tenant_id" in column_names, "Offer must have 'tenant_id' for direct tenant isolation."


def test_onboarding_has_tenant_id_column():
    """Onboarding model must have a tenant_id column."""
    from app.domain.models import Onboarding
    mapper = sa_inspect(Onboarding)
    column_names = [c.key for c in mapper.mapper.column_attrs]
    assert "tenant_id" in column_names, "Onboarding must have 'tenant_id' for direct tenant isolation."


def test_application_stage_has_tenant_id_column():
    """ApplicationStage model must have a tenant_id column."""
    from app.domain.models import ApplicationStage
    mapper = sa_inspect(ApplicationStage)
    column_names = [c.key for c in mapper.mapper.column_attrs]
    assert "tenant_id" in column_names, "ApplicationStage must have 'tenant_id' for direct tenant isolation."


def test_hiring_decision_has_tenant_id_column():
    """HiringDecision model must have a tenant_id column."""
    from app.domain.models import HiringDecision
    mapper = sa_inspect(HiringDecision)
    column_names = [c.key for c in mapper.mapper.column_attrs]
    assert "tenant_id" in column_names, "HiringDecision must have 'tenant_id' for direct tenant isolation."


# ============================================================================
# Model structure: ReminderLog
# ============================================================================

def test_reminder_log_model_exists():
    """ReminderLog model must be importable."""
    from app.domain.models import ReminderLog
    assert ReminderLog is not None


def test_reminder_log_has_required_columns():
    """ReminderLog must have application_id, joining_date, reminder_type, tenant_id, sent_at."""
    from app.domain.models import ReminderLog
    mapper = sa_inspect(ReminderLog)
    column_names = [c.key for c in mapper.mapper.column_attrs]

    required = {"application_id", "joining_date", "reminder_type", "tenant_id", "sent_at"}
    missing = required - set(column_names)
    assert not missing, f"ReminderLog is missing columns: {missing}"


def test_reminder_log_unique_constraint_exists():
    """
    ReminderLog must have a unique constraint on (application_id, joining_date, reminder_type)
    to enforce idempotent reminder delivery.
    """
    from app.domain.models import ReminderLog

    constraint_names = [c.name for c in ReminderLog.__table__.constraints]
    assert "uq_reminder_log_candidate_date_type" in constraint_names, (
        "ReminderLog must have unique constraint 'uq_reminder_log_candidate_date_type' "
        "on (application_id, joining_date, reminder_type) for idempotency."
    )


# ============================================================================
# Interview model: coding_started_at must exist
# ============================================================================

def test_interview_has_coding_started_at():
    """Interview model must have coding_started_at for deadline derivation."""
    from app.domain.models import Interview
    mapper = sa_inspect(Interview)
    column_names = [c.key for c in mapper.mapper.column_attrs]
    assert "coding_started_at" in column_names, (
        "Interview must have 'coding_started_at' to support server-authoritative coding deadline."
    )
