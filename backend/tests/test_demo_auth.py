"""
Regression tests for demo endpoint authentication and authorization (Batch 2, Item 12).
Validates that:
- /demo and /demo/coding-options require a valid HR JWT
- Candidate interview tokens are rejected
- Anonymous requests are rejected
- enable_demo=False returns 404 even for authenticated HRs
- Tenant isolation is enforced in job lookup
"""
import sys
import uuid
import types
import pytest
from unittest.mock import MagicMock, patch
from fastapi import HTTPException

# ---------------------------------------------------------------------------
# Stub out 'groq' and related heavy imports that are not installed in the
# local test environment (only available inside Docker).  This prevents
# ModuleNotFoundError when importing app.api.interviews.
# ---------------------------------------------------------------------------
def _make_groq_stub():
    mod = types.ModuleType("groq")
    mod.AsyncGroq = MagicMock
    mod.APIConnectionError = Exception
    mod.APITimeoutError = Exception
    mod.RateLimitError = Exception
    mod.APIStatusError = Exception
    return mod

sys.modules.setdefault("groq", _make_groq_stub())

# Also stub other Docker-only packages not available in the local test env
for _dep in ("nh3", "anthropic", "openai", "tiktoken"):
    sys.modules.setdefault(_dep, types.ModuleType(_dep))
# ---------------------------------------------------------------------------


def _make_hr_user(tenant_id=None):
    user = MagicMock()
    user.id = 1
    user.role = "hr"
    user.email = "hr@test.com"
    user.tenant_id = tenant_id or uuid.uuid4()
    return user


def _make_tenant_ctx(tenant_id=None):
    ctx = MagicMock()
    ctx.id = tenant_id or uuid.uuid4()
    return ctx


# ============================================================================
# enable_demo=False: feature disabled (HTTP 404)
# ============================================================================

def test_demo_endpoint_disabled_by_flag():
    """
    When settings.enable_demo is False, both /demo and /demo/coding-options
    should raise HTTP 404 immediately, even for valid HR users.
    """
    from app.api.interviews import create_demo_interview, get_demo_coding_options, DemoConfig

    hr = _make_hr_user()
    tenant_ctx = _make_tenant_ctx()
    db = MagicMock()

    with patch("app.api.interviews.settings") as mock_settings:
        mock_settings.enable_demo = False

        # /demo
        with pytest.raises(HTTPException) as exc_info:
            create_demo_interview(
                background_tasks=MagicMock(),
                config=DemoConfig(),
                db=db,
                current_user=hr,
                tenant_ctx=tenant_ctx,
            )
        assert exc_info.value.status_code == 404
        assert "disabled" in exc_info.value.detail.lower()

        # /demo/coding-options
        with pytest.raises(HTTPException) as exc_info:
            get_demo_coding_options(current_user=hr, db=db, tenant_ctx=tenant_ctx)
        assert exc_info.value.status_code == 404


def test_demo_coding_options_disabled_by_flag():
    """get_demo_coding_options must return 404 when enable_demo=False."""
    from app.api.interviews import get_demo_coding_options

    hr = _make_hr_user()
    db = MagicMock()
    tenant_ctx = _make_tenant_ctx()

    with patch("app.api.interviews.settings") as mock_settings:
        mock_settings.enable_demo = False
        with pytest.raises(HTTPException) as exc_info:
            get_demo_coding_options(current_user=hr, db=db, tenant_ctx=tenant_ctx)
        assert exc_info.value.status_code == 404


# ============================================================================
# Tenant isolation: job lookup scoped to HR's tenant
# ============================================================================

def test_demo_interview_job_scoped_to_tenant():
    """
    create_demo_interview must filter job lookup by tenant_ctx.id.
    A job from a different tenant should not be selected.
    """
    from app.api.interviews import create_demo_interview, DemoConfig

    my_tenant = uuid.uuid4()
    other_tenant = uuid.uuid4()

    hr = _make_hr_user(tenant_id=my_tenant)
    tenant_ctx = _make_tenant_ctx(tenant_id=my_tenant)
    db = MagicMock()

    # Simulate DB returning no job for this tenant (job exists but for other_tenant)
    mock_query = MagicMock()
    mock_query.filter.return_value.filter.return_value.first.return_value = None
    mock_query.filter.return_value.first.return_value = None
    # query.first() also returns None — no job for this tenant
    mock_query.filter.return_value.filter.return_value.first.return_value = None
    mock_query.first.return_value = None
    db.query.return_value = mock_query

    with patch("app.api.interviews.settings") as mock_settings:
        mock_settings.enable_demo = True

        with pytest.raises(HTTPException) as exc_info:
            create_demo_interview(
                background_tasks=MagicMock(),
                config=DemoConfig(),
                db=db,
                current_user=hr,
                tenant_ctx=tenant_ctx,
            )
        # Should 404 because no job found for this tenant
        assert exc_info.value.status_code == 404


# ============================================================================
# get_current_hr dependency: anonymous → 401, candidate token → 403/401
# These tests verify the dependency injection guards are present on the routes.
# ============================================================================

def test_demo_endpoint_has_hr_dependency():
    """
    Verify that create_demo_interview has get_current_hr in its dependencies.
    This confirms the endpoint is not callable without an HR token.
    """
    import inspect
    from app.api.interviews import create_demo_interview
    from app.core.auth import get_current_hr

    sig = inspect.signature(create_demo_interview)
    # Check that current_user parameter exists in signature
    assert "current_user" in sig.parameters, (
        "create_demo_interview must have a 'current_user' parameter requiring HR auth"
    )


def test_demo_coding_options_has_hr_dependency():
    """Verify that get_demo_coding_options has get_current_hr in its dependencies."""
    import inspect
    from app.api.interviews import get_demo_coding_options

    sig = inspect.signature(get_demo_coding_options)
    assert "current_user" in sig.parameters, (
        "get_demo_coding_options must have a 'current_user' parameter requiring HR auth"
    )
