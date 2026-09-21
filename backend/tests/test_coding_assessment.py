"""
Regression tests for Batch 1 coding assessment changes:
- Language enforcement: csharp and typescript rejected at schema + API layer
- Payload limits: oversized source code, stdin → HTTP 413
- Server-authoritative coding deadline: run/submit/complete rejected when expired
- Completion validation: stage, enabled, already-completed checks
- Cross-tenant resource access rejected at coding problem and question set levels
"""
import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException

from app.core.language_registry import validate_supported_languages, REMOVED_LANGUAGE_IDS, ALL_LANGUAGE_IDS
from app.domain.schemas import CodeRunRequest, CodeSubmitRequest
from app.core.config import get_settings

settings = get_settings()


# ============================================================================
# LANGUAGE REGISTRY: C# and TypeScript rejection
# ============================================================================

def test_csharp_rejected_by_registry():
    """C# must be rejected with a clear error mentioning 'no longer supported'."""
    with pytest.raises(ValueError, match="no longer supported"):
        validate_supported_languages(["csharp"])


def test_typescript_rejected_by_registry():
    """TypeScript must be rejected with a clear error mentioning 'no longer supported'."""
    with pytest.raises(ValueError, match="no longer supported"):
        validate_supported_languages(["typescript"])


def test_mixed_valid_and_removed_language_rejected():
    """If any removed language is in the list, the whole call must be rejected."""
    with pytest.raises(ValueError, match="no longer supported"):
        validate_supported_languages(["python3", "csharp"])


def test_all_supported_languages_accepted():
    """All 6 remaining languages must pass registry validation."""
    supported = ["python3", "java21", "cpp", "javascript", "golang", "rust"]
    result = validate_supported_languages(supported)
    assert set(result) == set(supported)


def test_removed_language_ids_constant():
    """REMOVED_LANGUAGE_IDS must contain exactly csharp and typescript."""
    assert REMOVED_LANGUAGE_IDS == frozenset({"csharp", "typescript"})
    # Neither should appear in ALL_LANGUAGE_IDS
    assert "csharp" not in ALL_LANGUAGE_IDS
    assert "typescript" not in ALL_LANGUAGE_IDS


# ============================================================================
# SCHEMA VALIDATORS: Language rejection at the Pydantic layer
# ============================================================================

def test_code_run_request_rejects_csharp():
    """CodeRunRequest validator must reject 'csharp' language."""
    with pytest.raises(Exception) as exc_info:
        CodeRunRequest(
            problem_id=1,
            language="csharp",
            source_code="class Program { static void Main() {} }",
        )
    error_text = str(exc_info.value)
    assert "no longer supported" in error_text.lower() or "csharp" in error_text.lower()


def test_code_run_request_rejects_typescript():
    """CodeRunRequest validator must reject 'typescript' language."""
    with pytest.raises(Exception) as exc_info:
        CodeRunRequest(
            problem_id=1,
            language="typescript",
            source_code="const x: number = 1;",
        )
    error_text = str(exc_info.value)
    assert "no longer supported" in error_text.lower() or "typescript" in error_text.lower()


def test_code_submit_request_rejects_csharp():
    """CodeSubmitRequest validator must reject 'csharp' language."""
    with pytest.raises(Exception) as exc_info:
        CodeSubmitRequest(
            problem_id=1,
            language="csharp",
            source_code="class Program { static void Main() {} }",
        )
    error_text = str(exc_info.value)
    assert "no longer supported" in error_text.lower() or "csharp" in error_text.lower()


def test_code_submit_request_accepts_valid_language():
    """CodeSubmitRequest must accept all valid languages."""
    for lang in ["python3", "java21", "cpp", "javascript", "golang", "rust"]:
        req = CodeSubmitRequest(problem_id=1, language=lang, source_code="// code")
        assert req.language == lang


# ============================================================================
# PAYLOAD LIMITS: Source code and stdin size enforcement
# ============================================================================

def test_source_code_size_limit_accepted():
    """Source code exactly at or below the limit should not raise."""
    from app.api.coding import _check_source_code_size
    code = "a" * (settings.coding_max_source_code_bytes - 1)
    # Should not raise
    _check_source_code_size(code)


def test_source_code_size_limit_exceeded():
    """Source code exceeding the limit should raise HTTP 413."""
    from app.api.coding import _check_source_code_size
    code = "a" * (settings.coding_max_source_code_bytes + 1)
    with pytest.raises(HTTPException) as exc_info:
        _check_source_code_size(code)
    assert exc_info.value.status_code == 413
    assert "maximum size" in exc_info.value.detail.lower()


def test_stdin_size_limit_none():
    """None stdin should not raise."""
    from app.api.coding import _check_stdin_size
    _check_stdin_size(None)  # Should not raise


def test_stdin_size_limit_exceeded():
    """stdin exceeding the limit should raise HTTP 413."""
    from app.api.coding import _check_stdin_size
    stdin = "x" * (settings.coding_max_stdin_bytes + 1)
    with pytest.raises(HTTPException) as exc_info:
        _check_stdin_size(stdin)
    assert exc_info.value.status_code == 413
    assert "maximum size" in exc_info.value.detail.lower()


# ============================================================================
# CODING DEADLINE: Server-authoritative enforcement
# ============================================================================

def _make_interview_with_deadline(minutes_ago: int = 0):
    """Helper to create a mock interview with a started-at time."""
    interview = MagicMock()
    interview.coding_started_at = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    return interview


def _make_job_with_duration(duration_minutes: int = 60):
    job = MagicMock()
    job.coding_round_duration_minutes = duration_minutes
    return job


def test_coding_deadline_not_started():
    """If coding_started_at is None, deadline is None — no enforcement applied."""
    from app.api.coding import _get_coding_deadline
    interview = MagicMock()
    interview.coding_started_at = None
    job = _make_job_with_duration(60)
    assert _get_coding_deadline(interview, job) is None


def test_coding_deadline_computed_correctly():
    """Deadline = coding_started_at + duration_minutes."""
    from app.api.coding import _get_coding_deadline
    started_at = datetime.now(timezone.utc) - timedelta(minutes=10)
    interview = MagicMock()
    interview.coding_started_at = started_at
    job = _make_job_with_duration(60)
    deadline = _get_coding_deadline(interview, job)
    expected = started_at + timedelta(minutes=60)
    # Allow 1 second tolerance for test execution time
    assert abs((deadline - expected).total_seconds()) < 1


def test_coding_run_rejected_when_expired():
    """Run code endpoint must raise HTTP 403 when deadline has passed."""
    from app.api.coding import _assert_coding_not_expired
    interview = MagicMock()
    # Started 70 minutes ago, duration is 60 minutes → expired 10 minutes ago
    interview.coding_started_at = datetime.now(timezone.utc) - timedelta(minutes=70)
    job = _make_job_with_duration(60)

    with pytest.raises(HTTPException) as exc_info:
        _assert_coding_not_expired(interview, job)
    assert exc_info.value.status_code == 403
    assert "expired" in exc_info.value.detail.lower()


def test_coding_run_allowed_within_deadline():
    """Run code endpoint must not raise when within the deadline."""
    from app.api.coding import _assert_coding_not_expired
    interview = MagicMock()
    # Started 30 minutes ago, duration is 60 minutes → still 30 minutes left
    interview.coding_started_at = datetime.now(timezone.utc) - timedelta(minutes=30)
    job = _make_job_with_duration(60)

    # Should not raise
    _assert_coding_not_expired(interview, job)


# ============================================================================
# COMPLETION VALIDATION: Stage, enabled, deadline, already-completed
# ============================================================================

def test_complete_rejects_wrong_stage():
    """complete endpoint must reject if interview stage is not 'coding'."""
    from app.api.coding import candidate_complete_coding_round

    interview = MagicMock()
    interview.interview_stage = "first_level"  # Wrong stage
    interview.coding_completed = False
    db = MagicMock()

    with pytest.raises(HTTPException) as exc_info:
        candidate_complete_coding_round(
            current_interview=interview,
            db=db,
        )
    assert exc_info.value.status_code == 400
    assert "stage" in exc_info.value.detail.lower()


def test_complete_rejects_already_completed():
    """complete endpoint must reject if coding round is already marked done."""
    from app.api.coding import candidate_complete_coding_round

    interview = MagicMock()
    interview.interview_stage = "coding"
    interview.coding_completed = True  # Already completed
    interview.application.job.coding_round_enabled = True
    # Set coding_started_at to None so deadline check is bypassed
    # (we want to test the already-completed guard, not the deadline guard)
    interview.coding_started_at = None
    interview.application.job.coding_round_duration_minutes = 60
    db = MagicMock()

    with pytest.raises(HTTPException) as exc_info:
        candidate_complete_coding_round(
            current_interview=interview,
            db=db,
        )
    assert exc_info.value.status_code == 400
    assert "already been completed" in exc_info.value.detail.lower()


# ============================================================================
# TENANT ISOLATION: Cross-tenant resource access rejection
# ============================================================================

def test_validate_problem_ownership_rejects_foreign_tenant():
    """
    _validate_problem_ownership must raise HTTP 400 when problem_ids include
    a problem owned by a different tenant.
    """
    import uuid
    from app.api.coding import _validate_problem_ownership
    from app.core.tenant_context import TenantContext

    tenant_a_id = uuid.uuid4()
    tenant_ctx = MagicMock(spec=TenantContext)
    tenant_ctx.id = tenant_a_id

    mock_db = MagicMock()
    # Only problem 1 is owned by tenant A; problem 99 is NOT in the result
    mock_db.query.return_value.filter.return_value.all.return_value = [(1,)]

    # Requesting problem 99 (not owned by tenant A) should be rejected
    with pytest.raises(HTTPException) as exc_info:
        _validate_problem_ownership([1, 99], tenant_ctx, mock_db)
    assert exc_info.value.status_code == 400
    assert "99" in exc_info.value.detail
    assert "different tenant" in exc_info.value.detail.lower()


def test_validate_problem_ownership_accepts_owned_problems():
    """_validate_problem_ownership must pass when all problems belong to current tenant."""
    import uuid
    from app.api.coding import _validate_problem_ownership
    from app.core.tenant_context import TenantContext

    tenant_id = uuid.uuid4()
    tenant_ctx = MagicMock(spec=TenantContext)
    tenant_ctx.id = tenant_id

    mock_db = MagicMock()
    # Both problem 1 and 2 are owned
    mock_db.query.return_value.filter.return_value.all.return_value = [(1,), (2,)]

    # Should not raise
    _validate_problem_ownership([1, 2], tenant_ctx, mock_db)


def test_removed_language_check_helper():
    """_check_removed_language API-layer helper must reject csharp and typescript."""
    from app.api.coding import _check_removed_language

    for lang in ["csharp", "typescript", "CSHARP", "TypeScript"]:
        with pytest.raises(HTTPException) as exc_info:
            _check_removed_language(lang)
        assert exc_info.value.status_code == 400

    # Valid languages should not raise
    for lang in ["python3", "java21", "cpp", "javascript", "golang", "rust"]:
        _check_removed_language(lang)  # Must not raise
