"""
Coding Assessment REST API.
Provides HR management endpoints and Candidate sandbox execution endpoints.
"""
import logging
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_

import json
from app.infrastructure.database import get_db
from app.core.auth import get_current_hr, get_current_interview
from app.core.ownership import get_tenant_context
from app.core.tenant_context import TenantContext
from app.core.rate_limiter import limiter
from app.core.timezone import get_ist_now
from app.core.language_registry import get_all_languages_metadata, validate_supported_languages
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

router = APIRouter(prefix="/api/coding", tags=["Coding Assessment"])


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
    """List all coding problems for the active tenant."""
    query = db.query(CodingProblem)
    if tenant_ctx.id:
        query = query.filter(or_(CodingProblem.tenant_id == tenant_ctx.id, CodingProblem.tenant_id.is_(None)))
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
    problem = db.query(CodingProblem).filter(CodingProblem.id == problem_id).first()
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
    problem = db.query(CodingProblem).filter(CodingProblem.id == problem_id).first()
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
    """Delete a coding problem."""
    problem = db.query(CodingProblem).filter(CodingProblem.id == problem_id).first()
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
    problem = db.query(CodingProblem).filter(CodingProblem.id == problem_id).first()
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

@router.get("/question-sets", response_model=List[CodingQuestionSetResponse])
def list_coding_question_sets(
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db),
    tenant_ctx: TenantContext = Depends(get_tenant_context),
):
    """List all coding question sets for the active tenant."""
    query = db.query(CodingQuestionSet)
    if tenant_ctx.id:
        query = query.filter(or_(CodingQuestionSet.tenant_id == tenant_ctx.id, CodingQuestionSet.tenant_id.is_(None)))
    return query.order_by(CodingQuestionSet.id.desc()).all()


@router.post("/question-sets", response_model=CodingQuestionSetResponse, status_code=status.HTTP_201_CREATED)
def create_coding_question_set(
    data: CodingQuestionSetCreate,
    current_user: User = Depends(get_current_hr),
    db: Session = Depends(get_db),
    tenant_ctx: TenantContext = Depends(get_tenant_context),
):
    """Create a new coding question set defining supported languages and ordered problems."""
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
    """Get a question set by ID."""
    q_set = db.query(CodingQuestionSet).filter(CodingQuestionSet.id == set_id).first()
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
    """
    q_set = db.query(CodingQuestionSet).filter(CodingQuestionSet.id == set_id).first()
    if not q_set:
        raise HTTPException(status_code=404, detail="Coding question set not found.")

    if data.supported_languages is not None:
        new_langs = set(data.supported_languages)
        old_langs = set(q_set.supported_languages or [])
        removed_langs = old_langs - new_langs

        if removed_langs:
            # Check for active open jobs referencing this question set
            active_jobs = db.query(Job).filter(Job.coding_repo_set_id == set_id, Job.status == "open").all()
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
    """Delete a coding question set."""
    q_set = db.query(CodingQuestionSet).filter(CodingQuestionSet.id == set_id).first()
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
    """HR inspects all coding submissions and execution details for an interview."""
    submissions = (
        db.query(CodingSubmission)
        .filter(CodingSubmission.interview_id == interview_id)
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
    Candidate workspace setup:
    Resolves Interview -> Application -> Job -> CodingQuestionSet.
    Returns allowed languages, ordered problems, and starter code strictly filtered
    to Job.coding_allowed_languages. Never exposes solution_code.
    """
    if not current_interview.application or not current_interview.application.job:
        raise HTTPException(status_code=404, detail="Interview is not linked to an active job posting.")

    job = current_interview.application.job
    if not job.coding_round_enabled or not job.coding_repo_set_id:
        raise HTTPException(status_code=400, detail="Coding round is not enabled for this job.")

    q_set = db.query(CodingQuestionSet).filter(CodingQuestionSet.id == job.coding_repo_set_id).first()
    if not q_set:
        raise HTTPException(status_code=404, detail="Coding question set assigned to this job not found.")

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

        # Public test cases only
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

    return CodingSessionResponse(
        allowed_languages=allowed_languages,
        duration_minutes=job.coding_round_duration_minutes or 60,
        coding_score=current_interview.coding_score,
        coding_completed=current_interview.coding_completed or False,
        problems=problems_response,
        submissions_summary=submissions_summary,
    )


@router.post("/run", response_model=CodeRunResponse)
def candidate_run_code(
    payload: CodeRunRequest,
    current_interview: Interview = Depends(get_current_interview),
    db: Session = Depends(get_db),
):
    """
    Run candidate code against public/sample test cases or custom stdin.
    Enforces Job.coding_allowed_languages. Never exposes hidden tests.
    """
    submission_service = SubmissionService(db)
    result = submission_service.handle_run(
        interview=current_interview,
        problem_id=payload.problem_id,
        language=payload.language,
        source_code=payload.source_code,
        custom_stdin=payload.custom_stdin,
    )
    return result


@router.post("/submit", response_model=CodeSubmitResponse)
def candidate_submit_code(
    payload: CodeSubmitRequest,
    current_interview: Interview = Depends(get_current_interview),
    db: Session = Depends(get_db),
):
    """
    Submit candidate code for evaluation against all test cases.
    Records submission, updates Interview.coding_score, and updates ApplicationStage.
    """
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
    Advances interview pipeline or triggers final interview completion.
    """
    current_interview.coding_completed = True
    current_interview.coding_completed_at = get_ist_now()

    # Determine if next stage exists
    from app.api.interviews import get_next_interview_stage, STAGE_COMPLETED
    job = current_interview.application.job if current_interview.application else None
    next_stage = get_next_interview_stage(job, "coding") if job else None

    if next_stage:
        current_interview.interview_stage = next_stage
        db.commit()
        return {"success": True, "message": f"Coding round completed. Next stage: {next_stage}.", "completed": False}
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
        return {"success": True, "message": "Interview and coding round completed successfully.", "completed": True}
