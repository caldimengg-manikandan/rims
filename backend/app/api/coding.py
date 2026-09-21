"""
Coding Assessment REST API.
Provides HR management endpoints and Candidate sandbox execution endpoints.

Security guarantees enforced by this module:
- Payload size limits: source code, stdin, and output are bounded server-side (Item 6).
- Language enforcement: csharp and typescript are rejected at schema + API layers (Items 7, 8).
- Coding deadline: derived from coding_started_at + duration; enforced on run/submit/complete (Item 9).
- Tenant isolation: all resource lookups are explicitly scoped to tenant_id (Item 13).
- Problem ownership: cross-tenant problem IDs are rejected when building question sets (Item 14).
- Rate limiting: run and submit endpoints are rate-limited to prevent abuse (Item 15).
- Completion validation: /complete enforces stage, coding-enabled, deadline, and score (Item 11).
"""
import logging
from datetime import datetime, timedelta, timezone as _tz
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_

import json
from app.infrastructure.database import get_db
from app.core.auth import get_current_hr, get_current_interview
from app.core.ownership import get_tenant_context, validate_tenant_ownership
from app.core.tenant_context import TenantContext
from app.core.rate_limiter import limiter
from app.core.timezone import get_ist_now
from app.core.config import get_settings
from app.core.language_registry import get_all_languages_metadata, validate_supported_languages, REMOVED_LANGUAGE_IDS
from app.domain.models import (
    User,
    Job,
    Interview,
    CodingProblem,
    CodingTestCase,
    CodingQuestionSet,
    CodingQuestionSetItem,
    CodingSubmission,
)
from app.domain.schemas import (
    CodingProblemCreate,
    CodingProblemUpdate,
    CodingProblemResponse,
    CodingProblemHRDetail,
    CodingTestCaseResponse,
    ValidateSolutionRequest,
    CodingQuestionSetCreate,
    CodingQuestionSetUpdate,
    CodingQuestionSetResponse,
    CodingQuestionSetItemResponse,
    CodeRunRequest,
    CodeRunResponse,
    CodeSubmitRequest,
    CodeSubmitResponse,
    CodingSessionResponse,
)
from app.execution.service import ExecutionService, SubmissionService

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/api/coding", tags=["Coding Assessment"])


# ============================================================================
# Helpers — Payload limits
# ============================================================================

def _check_source_code_size(source_code: str) -> None:
    """Raise HTTP 413 if source_code exceeds the configured maximum size."""
    encoded = source_code.encode("utf-8", errors="replace")
    if len(encoded) > settings.coding_max_source_code_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Source code exceeds maximum size limit",
        )


def _check_stdin_size(stdin: Optional[str]) -> None:
    """Raise HTTP 413 if custom stdin exceeds the configured maximum size."""
    if stdin is None:
        return
    encoded = stdin.encode("utf-8", errors="replace")
    if len(encoded) > settings.coding_max_stdin_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Custom input (stdin) exceeds maximum size limit",
        )


def _check_removed_language(language: str) -> None:
    """Defense-in-depth: explicitly reject removed languages at the API layer."""
    normalized = (language or "").strip().lower()
    if normalized in REMOVED_LANGUAGE_IDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Language '{normalized}' is no longer supported. Use a supported language.",
        )


# ============================================================================
# Helpers — Coding deadline enforcement
# ============================================================================

def _get_coding_deadline(interview: Interview, job: Job):
    """
    Returns the server-authoritative coding deadline for this interview.
    Deadline = coding_started_at + coding_round_duration_minutes.
    Returns None if coding has not yet started (coding_started_at is None).
    """
    if not interview.coding_started_at:
        return None
    duration = getattr(job, "coding_round_duration_minutes", None) or 60
    return interview.coding_started_at + timedelta(minutes=duration)


def _assert_coding_not_expired(interview: Interview, job: Job) -> None:
    """Raise HTTP 403 if the coding round deadline has passed."""
    deadline = _get_coding_deadline(interview, job)
    if deadline is None:
        return  # Not started yet — no deadline to enforce
    # Use timezone-aware UTC now to compare with the (potentially timezone-aware) deadline
    now = datetime.now(_tz.utc)
    # Normalise deadline to UTC if it is naive (coding_started_at stored without tz)
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=_tz.utc)
    if now > deadline:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Coding round has expired. No further submissions are accepted.",
        )


# ============================================================================
# General / Language Registry Endpoints
# ============================================================================

@router.get("/languages")
def get_supported_languages():
    """List all supported programming languages with boilerplate templates."""
    return get_all_languages_metadata()


# ============================================================================
# HR Endpoints — Problems Management
# ============================================================================

def _format_problem_hr_detail(problem: CodingProblem) -> CodingProblemHRDetail:
    solution_dict = problem.get_solution_codes()
    return CodingProblemHRDetail(
        id=problem.id,
        title=problem.title,
        description=problem.description,
        input_format=problem.input_format,
        output_format=problem.output_format,
        constraints=problem.constraints,
        supported_languages=problem.supported_languages or list(solution_dict.keys()) or ["python3"],
        starter_code=problem.starter_code or {},
        solution_code=solution_dict,
        solution_codes=solution_dict,
        difficulty=problem.difficulty,
        time_limit_ms=problem.time_limit_ms,
        memory_limit_mb=problem.memory_limit_mb,
        test_cases=[
            CodingTestCaseResponse(
                id=tc.id,
                problem_id=tc.problem_id,
                input=tc.input,
                expected_output=tc.expected_output,
                weight=tc.weight,
                is_hidden=tc.is_hidden,
                display_order=tc.display_order,
            )
            for tc in problem.test_cases
        ],
        created_at=problem.created_at,
    )


@router.get("/problems", response_model=List[CodingProblemResponse])
def list_coding_problems(
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db),
    tenant_ctx: TenantContext = Depends(get_tenant_context),
):
    """List coding problems scoped to the active tenant only."""
    query = db.query(CodingProblem)
    if tenant_ctx.id:
        # Tenant isolation: only return problems owned by this tenant.
        # Intentionally exclude NULL-tenant (global) problems unless no tenant is set.
        query = query.filter(CodingProblem.tenant_id == tenant_ctx.id)
    return query.order_by(CodingProblem.id.desc()).all()


@router.post("/problems", response_model=CodingProblemHRDetail, status_code=status.HTTP_201_CREATED)
def create_coding_problem(
    problem_data: CodingProblemCreate,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db),
    tenant_ctx: TenantContext = Depends(get_tenant_context),
):
    """Create a new coding problem with test cases and reference solution."""
    # Format solution code as JSON string if passed as dictionary
    raw_sol = problem_data.solution_codes or problem_data.solution_code
    if isinstance(raw_sol, dict):
        sol_code_str = json.dumps(raw_sol)
    elif raw_sol:
        sol_code_str = str(raw_sol).strip()
    else:
        sol_code_str = ""

    # Determine supported languages
    supported = problem_data.supported_languages
    if not supported:
        if isinstance(raw_sol, dict):
            supported = list(raw_sol.keys())
        elif problem_data.starter_code:
            supported = list(problem_data.starter_code.keys())
        else:
            supported = ["python3"]

    new_problem = CodingProblem(
        tenant_id=tenant_ctx.id,
        title=problem_data.title.strip(),
        description=problem_data.description.strip(),
        input_format=problem_data.input_format,
        output_format=problem_data.output_format,
        constraints=problem_data.constraints,
        supported_languages=supported,
        starter_code=problem_data.starter_code or {},
        solution_code=sol_code_str,
        difficulty=problem_data.difficulty or "medium",
        time_limit_ms=problem_data.time_limit_ms or 2000,
        memory_limit_mb=problem_data.memory_limit_mb or 256,
        hr_id=current_user.id,
    )
    db.add(new_problem)
    db.flush()

    if problem_data.test_cases:
        for idx, tc in enumerate(problem_data.test_cases):
            test_case = CodingTestCase(
                problem_id=new_problem.id,
                input=tc.input,
                expected_output=tc.expected_output,
                weight=tc.weight or 1.0,
                is_hidden=tc.is_hidden,
                display_order=tc.display_order or (idx + 1),
            )
            db.add(test_case)

    db.commit()
    db.refresh(new_problem)
    return _format_problem_hr_detail(new_problem)


@router.get("/problems/{problem_id}", response_model=CodingProblemHRDetail)
def get_coding_problem_detail(
    problem_id: int,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db),
    tenant_ctx: TenantContext = Depends(get_tenant_context),
):
    """Get problem detail including reference solution code (HR only)."""
    # Tenant isolation: scope lookup to current tenant
    problem = db.query(CodingProblem).filter(
        CodingProblem.id == problem_id,
        CodingProblem.tenant_id == tenant_ctx.id,
    ).first()
    if not problem:
        raise HTTPException(status_code=404, detail="Coding problem not found.")
    return _format_problem_hr_detail(problem)


@router.put("/problems/{problem_id}", response_model=CodingProblemHRDetail)
def update_coding_problem(
    problem_id: int,
    data: CodingProblemUpdate,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db),
    tenant_ctx: TenantContext = Depends(get_tenant_context),
):
    """Update coding problem and replace test cases if supplied."""
    # Tenant isolation: scope lookup to current tenant
    problem = db.query(CodingProblem).filter(
        CodingProblem.id == problem_id,
        CodingProblem.tenant_id == tenant_ctx.id,
    ).first()
    if not problem:
        raise HTTPException(status_code=404, detail="Coding problem not found.")

    if data.title is not None:
        problem.title = data.title.strip()
    if data.description is not None:
        problem.description = data.description.strip()
    if data.input_format is not None:
        problem.input_format = data.input_format
    if data.output_format is not None:
        problem.output_format = data.output_format
    if data.constraints is not None:
        problem.constraints = data.constraints
    if data.supported_languages is not None:
        problem.supported_languages = data.supported_languages
    if data.starter_code is not None:
        problem.starter_code = data.starter_code
    if data.solution_code is not None:
        if isinstance(data.solution_code, dict):
            problem.solution_code = json.dumps(data.solution_code)
        else:
            problem.solution_code = data.solution_code.strip()
    if data.difficulty is not None:
        problem.difficulty = data.difficulty
    if data.time_limit_ms is not None:
        problem.time_limit_ms = data.time_limit_ms
    if data.memory_limit_mb is not None:
        problem.memory_limit_mb = data.memory_limit_mb

    if data.test_cases is not None:
        # Replace existing test cases
        db.query(CodingTestCase).filter(CodingTestCase.problem_id == problem_id).delete()
        for idx, tc in enumerate(data.test_cases):
            test_case = CodingTestCase(
                problem_id=problem.id,
                input=tc.input,
                expected_output=tc.expected_output,
                weight=tc.weight or 1.0,
                is_hidden=tc.is_hidden,
                display_order=tc.display_order or (idx + 1),
            )
            db.add(test_case)

    db.commit()
    db.refresh(problem)
    return _format_problem_hr_detail(problem)


@router.delete("/problems/{problem_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_coding_problem(
    problem_id: int,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db),
    tenant_ctx: TenantContext = Depends(get_tenant_context),
):
    """Delete a coding problem owned by the current tenant."""
    # Tenant isolation: scope lookup to current tenant
    problem = db.query(CodingProblem).filter(
        CodingProblem.id == problem_id,
        CodingProblem.tenant_id == tenant_ctx.id,
    ).first()
    if not problem:
        raise HTTPException(status_code=404, detail="Coding problem not found.")
    db.delete(problem)
    db.commit()
    return None


@router.post("/problems/{problem_id}/validate-solution")
def validate_problem_solution(
    problem_id: int,
    body: Optional[ValidateSolutionRequest] = None,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db),
    tenant_ctx: TenantContext = Depends(get_tenant_context),
):
    """
    Executes the reference solution against test cases:
    - If body.language is provided, executes that language's solution.
    - If not provided, executes across all configured reference solutions for the problem.
    - Generates and stores missing expected outputs.
    - Verifies existing outputs without silently overwriting.
    """
    # Tenant isolation
    problem = db.query(CodingProblem).filter(
        CodingProblem.id == problem_id,
        CodingProblem.tenant_id == tenant_ctx.id,
    ).first()
    if not problem:
        raise HTTPException(status_code=404, detail="Coding problem not found.")

    test_cases = db.query(CodingTestCase).filter(CodingTestCase.problem_id == problem_id).order_by(CodingTestCase.display_order).all()
    if not test_cases:
        raise HTTPException(status_code=400, detail="No test cases found for this problem to validate.")

    target_lang = body.language if body and body.language else None

    exec_service = ExecutionService()
    report = exec_service.validate_system_solution(problem, test_cases, language=target_lang)
    db.commit()
    return report


# ============================================================================
# HR Endpoints — Question Sets Management
# ============================================================================

def _validate_problem_ownership(problem_ids: List[int], tenant_ctx: TenantContext, db: Session) -> None:
    """
    Validates that every problem_id in the list belongs to the current tenant.
    Raises HTTP 400 if any problem is missing or belongs to another tenant.
    This prevents cross-tenant join records in CodingQuestionSetItem.
    """
    if not problem_ids:
        return
    if not tenant_ctx.id:
        return  # No tenant context — skip (dev/root-admin scenarios)

    # Fetch all problems that belong to this tenant
    owned_problems = db.query(CodingProblem.id).filter(
        CodingProblem.id.in_(problem_ids),
        CodingProblem.tenant_id == tenant_ctx.id,
    ).all()
    owned_ids = {row[0] for row in owned_problems}

    not_owned = [pid for pid in problem_ids if pid not in owned_ids]
    if not_owned:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Problem ID(s) {not_owned} do not exist or belong to a different tenant. "
                "All problems must be owned by the current tenant."
            ),
        )


@router.get("/question-sets", response_model=List[CodingQuestionSetResponse])
def list_coding_question_sets(
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db),
    tenant_ctx: TenantContext = Depends(get_tenant_context),
):
    """List coding question sets scoped to the active tenant."""
    query = db.query(CodingQuestionSet)
    if tenant_ctx.id:
        query = query.filter(CodingQuestionSet.tenant_id == tenant_ctx.id)
    return query.order_by(CodingQuestionSet.id.desc()).all()


@router.post("/question-sets", response_model=CodingQuestionSetResponse, status_code=status.HTTP_201_CREATED)
def create_coding_question_set(
    data: CodingQuestionSetCreate,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db),
    tenant_ctx: TenantContext = Depends(get_tenant_context),
):
    """Create a new coding question set. Validates that all problem IDs belong to this tenant."""
    # Cross-tenant problem ownership validation (Item 14)
    if data.problem_ids:
        _validate_problem_ownership(data.problem_ids, tenant_ctx, db)

    new_set = CodingQuestionSet(
        tenant_id=tenant_ctx.id,
        title=data.title.strip(),
        description=data.description.strip() if data.description else None,
        supported_languages=data.supported_languages,
        hr_id=current_user.id,
    )
    db.add(new_set)
    db.flush()

    if data.problem_ids:
        for order, pid in enumerate(data.problem_ids, start=1):
            item = CodingQuestionSetItem(
                question_set_id=new_set.id,
                problem_id=pid,
                display_order=order,
            )
            db.add(item)

    db.commit()
    db.refresh(new_set)
    return new_set


@router.get("/question-sets/{set_id}", response_model=CodingQuestionSetResponse)
def get_coding_question_set(
    set_id: int,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db),
    tenant_ctx: TenantContext = Depends(get_tenant_context),
):
    """Get a question set by ID (tenant-scoped)."""
    q_set = db.query(CodingQuestionSet).filter(
        CodingQuestionSet.id == set_id,
        CodingQuestionSet.tenant_id == tenant_ctx.id,
    ).first()
    if not q_set:
        raise HTTPException(status_code=404, detail="Coding question set not found.")
    return q_set


@router.put("/question-sets/{set_id}", response_model=CodingQuestionSetResponse)
def update_coding_question_set(
    set_id: int,
    data: CodingQuestionSetUpdate,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db),
    tenant_ctx: TenantContext = Depends(get_tenant_context),
):
    """
    Update a question set.
    Enforces language change protection for active jobs.
    Validates problem ownership before creating join records.
    """
    q_set = db.query(CodingQuestionSet).filter(
        CodingQuestionSet.id == set_id,
        CodingQuestionSet.tenant_id == tenant_ctx.id,
    ).first()
    if not q_set:
        raise HTTPException(status_code=404, detail="Coding question set not found.")

    if data.supported_languages is not None:
        new_langs = set(data.supported_languages)
        old_langs = set(q_set.supported_languages or [])
        removed_langs = old_langs - new_langs

        if removed_langs:
            # Check for active open jobs referencing this question set (tenant-scoped)
            active_jobs = db.query(Job).filter(
                Job.coding_repo_set_id == set_id,
                Job.status == "open",
                Job.tenant_id == tenant_ctx.id,
            ).all()
            for job in active_jobs:
                job_langs = set(job.coding_allowed_languages or [])
                conflict = removed_langs.intersection(job_langs)
                if conflict:
                    conflict_names = ", ".join(sorted(conflict))
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=(
                            f"Cannot remove language(s) '{conflict_names}' from Question Set: "
                            f"Active Job '{job.job_id or job.title}' relies on them. Update or close affected jobs first."
                        ),
                    )
        q_set.supported_languages = data.supported_languages

    if data.title is not None:
        q_set.title = data.title.strip()
    if data.description is not None:
        q_set.description = data.description.strip() if data.description else None

    if data.problem_ids is not None:
        # Cross-tenant problem ownership validation (Item 14)
        _validate_problem_ownership(data.problem_ids, tenant_ctx, db)
        db.query(CodingQuestionSetItem).filter(CodingQuestionSetItem.question_set_id == set_id).delete()
        for order, pid in enumerate(data.problem_ids, start=1):
            item = CodingQuestionSetItem(
                question_set_id=set_id,
                problem_id=pid,
                display_order=order,
            )
            db.add(item)

    db.commit()
    db.refresh(q_set)
    return q_set


@router.delete("/question-sets/{set_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_coding_question_set(
    set_id: int,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db),
    tenant_ctx: TenantContext = Depends(get_tenant_context),
):
    """Delete a coding question set (tenant-scoped)."""
    q_set = db.query(CodingQuestionSet).filter(
        CodingQuestionSet.id == set_id,
        CodingQuestionSet.tenant_id == tenant_ctx.id,
    ).first()
    if not q_set:
        raise HTTPException(status_code=404, detail="Coding question set not found.")
    db.delete(q_set)
    db.commit()
    return None


@router.get("/interviews/{interview_id}/submissions")
def get_interview_coding_submissions(
    interview_id: int,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db),
    tenant_ctx: TenantContext = Depends(get_tenant_context),
):
    """HR inspects all coding submissions for an interview (tenant-scoped)."""
    # Verify the interview belongs to this tenant before returning submissions
    interview = db.query(Interview).filter(
        Interview.id == interview_id,
        Interview.tenant_id == tenant_ctx.id,
    ).first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found.")

    submissions = (
        db.query(CodingSubmission)
        .filter(
            CodingSubmission.interview_id == interview_id,
            CodingSubmission.tenant_id == tenant_ctx.id,
        )
        .order_by(CodingSubmission.submitted_at.desc())
        .all()
    )
    return [
        {
            "id": s.id,
            "problem_id": s.problem_id,
            "problem_title": s.problem.title if s.problem else None,
            "language": s.language,
            "source_code": s.source_code,
            "verdict": s.verdict,
            "passed_tests": s.passed_tests,
            "total_tests": s.total_tests,
            "score": s.score,
            "execution_time_ms": s.execution_time_ms,
            "submitted_at": s.submitted_at,
        }
        for s in submissions
    ]


# ============================================================================
# Candidate Endpoints — Execution & Submission Workspace
# ============================================================================

@router.get("/session", response_model=CodingSessionResponse)
def get_candidate_coding_session(
    current_interview: Interview = Depends(get_current_interview),
    db: Session = Depends(get_db),
):
    """
    Candidate workspace setup.
    Resolves Interview -> Application -> Job -> CodingQuestionSet.
    Returns allowed languages, ordered problems, server-authoritative deadline,
    and starter code strictly filtered to Job.coding_allowed_languages.
    Never exposes solution_code.

    Sets coding_started_at on first call so the server-authoritative deadline
    can be derived: deadline = coding_started_at + coding_round_duration_minutes.
    """
    if not current_interview.application or not current_interview.application.job:
        raise HTTPException(status_code=404, detail="Interview is not linked to an active job posting.")

    job = current_interview.application.job
    if not job.coding_round_enabled or not job.coding_repo_set_id:
        raise HTTPException(status_code=400, detail="Coding round is not enabled for this job.")

    q_set = db.query(CodingQuestionSet).filter(CodingQuestionSet.id == job.coding_repo_set_id).first()
    if not q_set:
        raise HTTPException(status_code=404, detail="Coding question set assigned to this job not found.")

    # Record coding start time on first access (server-authoritative deadline anchor)
    if not current_interview.coding_started_at:
        current_interview.coding_started_at = get_ist_now()
        db.flush()

    allowed_languages = job.coding_allowed_languages or q_set.supported_languages or []

    # Retrieve ordered set items
    set_items = (
        db.query(CodingQuestionSetItem)
        .filter(CodingQuestionSetItem.question_set_id == q_set.id)
        .order_by(CodingQuestionSetItem.display_order)
        .all()
    )

    # Honor job.coding_problem_count if set
    if job.coding_problem_count and job.coding_problem_count > 0:
        set_items = set_items[:job.coding_problem_count]

    problems_response = []
    for item in set_items:
        p = item.problem
        if not p:
            continue

        # Filter starter code to only allowed languages
        raw_starter = p.starter_code or {}
        filtered_starter = {lang: code for lang, code in raw_starter.items() if lang in allowed_languages}

        # Public test cases only — never expose hidden test cases to candidates
        public_test_cases = [
            CodingTestCaseResponse(
                id=tc.id,
                problem_id=tc.problem_id,
                input=tc.input,
                expected_output=tc.expected_output,
                weight=tc.weight,
                is_hidden=False,
                display_order=tc.display_order,
            )
            for tc in p.test_cases
            if not tc.is_hidden
        ]

        problems_response.append(
            CodingProblemResponse(
                id=p.id,
                title=p.title,
                description=p.description,
                input_format=p.input_format,
                output_format=p.output_format,
                constraints=p.constraints,
                starter_code=filtered_starter,
                difficulty=p.difficulty,
                time_limit_ms=p.time_limit_ms,
                memory_limit_mb=p.memory_limit_mb,
                test_cases=public_test_cases,
                created_at=p.created_at,
            )
        )

    # Submissions summary
    subs = (
        db.query(CodingSubmission)
        .filter(CodingSubmission.interview_id == current_interview.id)
        .order_by(CodingSubmission.submitted_at.desc())
        .all()
    )
    submissions_summary = [
        {
            "problem_id": s.problem_id,
            "verdict": s.verdict,
            "score": s.score,
            "submitted_at": s.submitted_at,
        }
        for s in subs
    ]

    # Compute server-authoritative deadline
    coding_deadline = _get_coding_deadline(current_interview, job)

    db.commit()

    return CodingSessionResponse(
        allowed_languages=allowed_languages,
        duration_minutes=job.coding_round_duration_minutes or 60,
        coding_score=current_interview.coding_score,
        coding_completed=current_interview.coding_completed or False,
        coding_deadline=coding_deadline,
        problems=problems_response,
        submissions_summary=submissions_summary,
    )


@router.post("/run", response_model=CodeRunResponse)
@limiter.limit(settings.coding_run_rate_limit)
def candidate_run_code(
    request: Request,
    payload: CodeRunRequest,
    current_interview: Interview = Depends(get_current_interview),
    db: Session = Depends(get_db),
):
    """
    Run candidate code against public/sample test cases or custom stdin.
    Enforces:
    - Language allowlist (Job.coding_allowed_languages)
    - Removed language rejection (csharp, typescript)
    - Payload size limits (source code, stdin)
    - Server-authoritative coding deadline
    Never exposes hidden tests.
    """
    # Defense-in-depth: reject removed languages even if schema validation was bypassed
    _check_removed_language(payload.language)
    # Payload size enforcement
    _check_source_code_size(payload.source_code)
    _check_stdin_size(payload.custom_stdin)

    # Deadline enforcement
    if not current_interview.application or not current_interview.application.job:
        raise HTTPException(status_code=404, detail="Job association not found for interview.")
    _assert_coding_not_expired(current_interview, current_interview.application.job)

    submission_service = SubmissionService(db)
    result = submission_service.handle_run(
        interview=current_interview,
        problem_id=payload.problem_id,
        language=payload.language,
        source_code=payload.source_code,
        custom_stdin=payload.custom_stdin,
    )

    # Output size enforcement
    stdout = result.get("stdout") or ""
    if isinstance(stdout, str) and len(stdout.encode("utf-8", errors="replace")) > settings.coding_max_output_bytes:
        result["stdout"] = stdout[: settings.coding_max_output_bytes // 4] + "\n...[output truncated: exceeds maximum size limit]"

    return result


@router.post("/submit", response_model=CodeSubmitResponse)
@limiter.limit(settings.coding_submit_rate_limit)
def candidate_submit_code(
    request: Request,
    payload: CodeSubmitRequest,
    current_interview: Interview = Depends(get_current_interview),
    db: Session = Depends(get_db),
):
    """
    Submit candidate code for evaluation against all test cases.
    Enforces:
    - Language allowlist
    - Removed language rejection
    - Source code size limit
    - Server-authoritative coding deadline
    Records submission, updates Interview.coding_score, and updates ApplicationStage.
    """
    # Defense-in-depth: reject removed languages
    _check_removed_language(payload.language)
    # Payload size enforcement
    _check_source_code_size(payload.source_code)

    # Deadline enforcement
    if not current_interview.application or not current_interview.application.job:
        raise HTTPException(status_code=404, detail="Job association not found for interview.")
    _assert_coding_not_expired(current_interview, current_interview.application.job)

    submission_service = SubmissionService(db)
    result = submission_service.handle_submit(
        interview=current_interview,
        problem_id=payload.problem_id,
        language=payload.language,
        source_code=payload.source_code,
    )
    db.commit()
    return result


@router.post("/complete")
def candidate_complete_coding_round(
    current_interview: Interview = Depends(get_current_interview),
    db: Session = Depends(get_db),
):
    """
    Mark coding round as completed.

    Server-side validations (Item 11):
    1. Interview must be in the 'coding' stage.
    2. Coding round must be enabled for this job.
    3. Coding deadline must not have expired.
    4. Calculates final coding score from persisted submissions.

    Advances interview pipeline or triggers final interview completion.
    """
    # 1. Verify interview is in coding stage
    if current_interview.interview_stage != "coding":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot complete coding round: interview is in stage '{current_interview.interview_stage}', not 'coding'.",
        )

    # 2. Verify coding is enabled
    if not current_interview.application or not current_interview.application.job:
        raise HTTPException(status_code=404, detail="Job association not found for interview.")
    job = current_interview.application.job

    if not job.coding_round_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Coding round is not enabled for this job.",
        )

    # 3. Verify deadline has not expired
    _assert_coding_not_expired(current_interview, job)

    # 4. Already completed guard
    if current_interview.coding_completed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Coding round has already been completed.",
        )

    # 5. Calculate final coding score from persisted submissions
    if job.coding_repo_set_id:
        set_items = db.query(CodingQuestionSetItem).filter(
            CodingQuestionSetItem.question_set_id == job.coding_repo_set_id
        ).all()
        problem_ids = [item.problem_id for item in set_items]

        if problem_ids:
            problem_scores = []
            for pid in problem_ids:
                best_sub = (
                    db.query(CodingSubmission)
                    .filter(
                        CodingSubmission.interview_id == current_interview.id,
                        CodingSubmission.problem_id == pid,
                    )
                    .order_by(CodingSubmission.score.desc())
                    .first()
                )
                problem_scores.append(best_sub.score if best_sub else 0.0)

            final_score = round(sum(problem_scores) / len(problem_scores), 2)
            current_interview.coding_score = final_score

    current_interview.coding_completed = True
    current_interview.coding_completed_at = get_ist_now()

    # Determine if next stage exists
    from app.api.interviews import get_next_interview_stage, STAGE_COMPLETED
    next_stage = get_next_interview_stage(job, "coding")

    if next_stage:
        current_interview.interview_stage = next_stage
        db.commit()
        return {
            "success": True,
            "message": f"Coding round completed. Next stage: {next_stage}.",
            "completed": False,
            "new_stage": next_stage,
        }
    else:
        # Finalize interview
        current_interview.interview_stage = STAGE_COMPLETED
        current_interview.status = "completed"
        current_interview.ended_at = get_ist_now()

        from app.services.state_machine import CandidateStateMachine, TransitionAction
        fsm = CandidateStateMachine(db)
        try:
            fsm.transition(current_interview.application, TransitionAction.SYSTEM_INTERVIEW_COMPLETE)
        except Exception as e:
            logger.warning("FSM transition failed on coding complete: %s", e)
            if current_interview.application:
                current_interview.application.status = "interview_completed"

        db.commit()
        return {
            "success": True,
            "message": "Interview and coding round completed successfully.",
            "completed": True,
        }
