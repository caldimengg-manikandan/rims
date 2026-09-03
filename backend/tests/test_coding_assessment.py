"""
Comprehensive Unit Tests for CALRIMS Coding Assessment Module:
- Language Registry validation
- Judge scoring, output normalization, and hidden-test shielding
- Job pipeline validation (coding_allowed_languages ⊆ question_set.supported_languages)
"""
import pytest
from unittest.mock import MagicMock
from fastapi import HTTPException

from app.core.language_registry import validate_supported_languages, SUPPORTED_LANGUAGES
from app.execution.judge import Judge, JudgeVerdict
from app.execution.executor import ExecutionResult
from app.domain.models import CodingTestCase, CodingQuestionSet, Job
from app.api.jobs import _validate_interview_pipeline


def test_language_registry_validation():
    # Valid single language
    assert validate_supported_languages(["python3"]) == ["python3"]
    # Valid multiple languages
    assert sorted(validate_supported_languages(["python3", "java21"])) == ["java21", "python3"]

    # Empty list raises ValueError
    with pytest.raises(ValueError, match="At least one supported language must be specified"):
        validate_supported_languages([])

    # Unsupported language raises ValueError
    with pytest.raises(ValueError, match="Unsupported language"):
        validate_supported_languages(["python3", "cpp"])


def test_judge_normalize_output():
    # CRLF conversion, trailing spaces per line stripped, leading/trailing trimmed
    raw = "  hello world  \r\n42   \r\n\r\n"
    normalized = Judge.normalize_output(raw)
    assert normalized == "hello world\n42"

    # None handling
    assert Judge.normalize_output(None) == ""


def test_judge_weighted_scoring():
    judge = Judge()

    # 3 test cases with weights: 1.0, 2.0, 1.0 (Total weight: 4.0)
    tc1 = CodingTestCase(id=1, input="1", expected_output="10", weight=1.0, is_hidden=False)
    tc2 = CodingTestCase(id=2, input="2", expected_output="20", weight=2.0, is_hidden=True)
    tc3 = CodingTestCase(id=3, input="3", expected_output="30", weight=1.0, is_hidden=False)

    # Candidate passes tc1 and tc2, fails tc3 -> earned weight = 3.0 out of 4.0 = 75.0%
    results = [
        ExecutionResult(stdout="10\n", stderr="", exit_code=0, time_ms=50, memory_kb=0, timed_out=False),
        ExecutionResult(stdout="20\n", stderr="", exit_code=0, time_ms=60, memory_kb=0, timed_out=False),
        ExecutionResult(stdout="wrong\n", stderr="", exit_code=0, time_ms=45, memory_kb=0, timed_out=False),
    ]

    verdict: JudgeVerdict = judge.evaluate([tc1, tc2, tc3], results, is_candidate=True)

    assert verdict.score == 75.0
    assert verdict.passed_tests == 2
    assert verdict.total_tests == 3
    assert verdict.verdict == "wrong_answer"

    # Hidden test case outputs must be shielded for candidate
    hidden_res = verdict.results[1]
    assert hidden_res.is_hidden is True
    assert hidden_res.actual_stdout is None
    assert hidden_res.expected_stdout is None

    # Public test case outputs visible
    public_res = verdict.results[0]
    assert public_res.is_hidden is False
    assert public_res.actual_stdout == "10\n"
    assert public_res.expected_stdout == "10"


def test_judge_compilation_and_timeout():
    judge = Judge()
    tc1 = CodingTestCase(id=1, input="1", expected_output="10", weight=1.0, is_hidden=False)

    # Compilation failure
    compile_fail = [
        ExecutionResult(
            stdout="", stderr="javac Solution.java: line 5: error", exit_code=2,
            time_ms=100, memory_kb=0, timed_out=False,
            compilation_failed=True, compilation_error="javac Solution.java: line 5: error"
        )
    ]
    v_comp = judge.evaluate([tc1], compile_fail, is_candidate=True)
    assert v_comp.verdict == "compilation_error"
    assert v_comp.score == 0.0

    # Timeout
    timeout_res = [
        ExecutionResult(
            stdout="", stderr="Time limit exceeded", exit_code=124,
            time_ms=2500, memory_kb=0, timed_out=True
        )
    ]
    v_time = judge.evaluate([tc1], timeout_res, is_candidate=True)
    assert v_time.verdict == "time_limit_exceeded"
    assert v_time.score == 0.0


def test_job_pipeline_language_subset_validation():
    # Mock DB and Question Set
    mock_db = MagicMock()
    mock_q_set = CodingQuestionSet(
        id=10,
        title="Backend Test",
        supported_languages=["python3"]
    )
    mock_db.query.return_value.filter.return_value.first.return_value = mock_q_set

    # Job allows python3 (subset of ["python3"]) -> Valid
    job_valid = MagicMock()
    job_valid.aptitude_enabled = False
    job_valid.first_level_enabled = True
    job_valid.interview_mode = "ai"
    job_valid.coding_round_enabled = True
    job_valid.coding_repo_set_id = 10
    job_valid.coding_allowed_languages = ["python3"]
    job_valid.coding_round_duration_minutes = 60

    result = _validate_interview_pipeline(job_valid, "senior", db=mock_db)
    assert result["coding_round_enabled"] is True
    assert result["coding_allowed_languages"] == ["python3"]

    # Job allows java21 which is NOT in ["python3"] -> Must raise HTTPException(400)
    job_invalid = MagicMock()
    job_invalid.aptitude_enabled = False
    job_invalid.first_level_enabled = True
    job_invalid.interview_mode = "ai"
    job_invalid.coding_round_enabled = True
    job_invalid.coding_repo_set_id = 10
    job_invalid.coding_allowed_languages = ["python3", "java21"]
    job_invalid.coding_round_duration_minutes = 60

    with pytest.raises(HTTPException) as exc_info:
        _validate_interview_pipeline(job_invalid, "senior", db=mock_db)
    assert exc_info.value.status_code == 400
    assert "must be a subset" in exc_info.value.detail
