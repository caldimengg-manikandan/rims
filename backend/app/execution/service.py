"""
ExecutionService and SubmissionService.
Coordinates candidate runs, official submissions, and system-solution validation.
"""
import logging
from typing import List, Optional, Dict, Any
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.timezone import get_ist_now
from app.domain.models import (
    CodingProblem,
    CodingTestCase,
    CodingSubmission,
    CodingQuestionSet,
    CodingQuestionSetItem,
    Interview,
    Job,
)
from app.execution.executor import Executor, ExecutionResult
from app.execution.docker_executor import DockerExecutor
from app.execution.judge import Judge, JudgeVerdict

logger = logging.getLogger(__name__)


class ExecutionService:
    """
    Orchestrates sandboxed execution and judging without coupling to specific frameworks.
    """

    def __init__(self, executor: Optional[Executor] = None, judge: Optional[Judge] = None):
        self.executor = executor or DockerExecutor()
        self.judge = judge or Judge()

    def run_single(
        self,
        language: str,
        source_code: str,
        stdin: str = "",
        time_limit_ms: int = 2000,
        memory_limit_mb: int = 256
    ) -> ExecutionResult:
        """Run code against a single stdin string (e.g. for custom input)."""
        return self.executor.run(
            language=language,
            source_code=source_code,
            stdin=stdin,
            time_limit_ms=time_limit_ms,
            memory_limit_mb=memory_limit_mb,
        )

    def run_test_cases(
        self,
        language: str,
        source_code: str,
        test_cases: List[CodingTestCase],
        time_limit_ms: int = 2000,
        memory_limit_mb: int = 256,
        is_candidate: bool = True
    ) -> JudgeVerdict:
        """Execute source code sequentially across a collection of test cases and evaluate results."""
        results: List[ExecutionResult] = []
        for tc in test_cases:
            res = self.executor.run(
                language=language,
                source_code=source_code,
                stdin=tc.input,
                time_limit_ms=time_limit_ms,
                memory_limit_mb=memory_limit_mb,
            )
            results.append(res)
            # If Java compilation failed, no need to run subsequent test cases
            if res.compilation_failed:
                # Fill remaining test cases with compilation failure
                for _ in range(len(test_cases) - len(results)):
                    results.append(res)
                break

        return self.judge.evaluate(test_cases, results, is_candidate=is_candidate)

    def validate_system_solution(
        self,
        problem: CodingProblem,
        test_cases: List[CodingTestCase],
        language: str = "python3"
    ) -> Dict[str, Any]:
        """
        Executes the reference solution against test cases:
        - If expected_output is empty, generates it from the reference solution.
        - If expected_output already exists, verifies matching without overwriting.
        """
        results_summary = []
        all_passed = True
        generated_count = 0

        for tc in test_cases:
            res = self.executor.run(
                language=language,
                source_code=problem.solution_code,
                stdin=tc.input,
                time_limit_ms=problem.time_limit_ms,
                memory_limit_mb=problem.memory_limit_mb,
            )

            if res.exit_code != 0 or res.timed_out or res.compilation_failed:
                all_passed = False
                results_summary.append({
                    "test_case_id": tc.id,
                    "status": "error",
                    "error": res.stderr or res.compilation_error or "Execution error",
                })
                continue

            ref_output = self.judge.normalize_output(res.stdout)

            if not tc.expected_output or not tc.expected_output.strip():
                # Generate missing expected output
                tc.expected_output = ref_output
                generated_count += 1
                results_summary.append({
                    "test_case_id": tc.id,
                    "status": "generated",
                    "output": ref_output,
                })
            else:
                existing_norm = self.judge.normalize_output(tc.expected_output)
                if ref_output == existing_norm:
                    results_summary.append({
                        "test_case_id": tc.id,
                        "status": "valid",
                    })
                else:
                    all_passed = False
                    results_summary.append({
                        "test_case_id": tc.id,
                        "status": "mismatch",
                        "expected": tc.expected_output,
                        "actual": ref_output,
                    })

        return {
            "all_passed": all_passed,
            "generated_count": generated_count,
            "details": results_summary,
        }


class SubmissionService:
    """
    Handles candidate code submissions, language validation against Job settings,
    score aggregation, and stage persistence.
    """

    def __init__(self, db: Session, execution_service: Optional[ExecutionService] = None):
        self.db = db
        self.execution_service = execution_service or ExecutionService()

    def validate_job_language(self, job: Job, language: str) -> None:
        """
        Enforces candidate.language in Job.coding_allowed_languages.
        Raises HTTP 400 if disallowed.
        """
        allowed = getattr(job, "coding_allowed_languages", None) or []
        if isinstance(allowed, str):
            import json
            try:
                allowed = json.loads(allowed)
            except Exception:
                allowed = []

        if not allowed or language not in allowed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Language '{language}' is not permitted for this assessment. Allowed languages: {', '.join(allowed) if allowed else 'None'}."
            )

    def handle_run(
        self,
        interview: Interview,
        problem_id: int,
        language: str,
        source_code: str,
        custom_stdin: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Candidate clicks 'Run Code'.
        Evaluates against custom stdin (if provided) or public/sample test cases only.
        Never evaluates hidden test cases.
        """
        if not interview.application or not interview.application.job:
            raise HTTPException(status_code=404, detail="Job association not found for interview.")

        job = interview.application.job
        self.validate_job_language(job, language)

        problem = self.db.query(CodingProblem).filter(CodingProblem.id == problem_id).first()
        if not problem:
            raise HTTPException(status_code=404, detail="Coding problem not found.")

        # 1. Custom Stdin branch
        if custom_stdin is not None:
            exec_res = self.execution_service.run_single(
                language=language,
                source_code=source_code,
                stdin=custom_stdin,
                time_limit_ms=problem.time_limit_ms,
                memory_limit_mb=problem.memory_limit_mb,
            )
            return {
                "is_custom_input": True,
                "stdout": exec_res.stdout,
                "stderr": exec_res.stderr,
                "exit_code": exec_res.exit_code,
                "time_ms": exec_res.time_ms,
                "timed_out": exec_res.timed_out,
                "compilation_failed": exec_res.compilation_failed,
                "compilation_error": exec_res.compilation_error,
            }

        # 2. Public / Sample test cases branch
        public_test_cases = (
            self.db.query(CodingTestCase)
            .filter(CodingTestCase.problem_id == problem_id, CodingTestCase.is_hidden == False)
            .order_by(CodingTestCase.display_order)
            .all()
        )

        if not public_test_cases:
            # Fallback to empty stdin run if no public test cases
            exec_res = self.execution_service.run_single(
                language=language,
                source_code=source_code,
                stdin="",
                time_limit_ms=problem.time_limit_ms,
                memory_limit_mb=problem.memory_limit_mb,
            )
            return {
                "is_custom_input": True,
                "stdout": exec_res.stdout,
                "stderr": exec_res.stderr,
                "exit_code": exec_res.exit_code,
                "time_ms": exec_res.time_ms,
                "timed_out": exec_res.timed_out,
                "compilation_failed": exec_res.compilation_failed,
                "compilation_error": exec_res.compilation_error,
            }

        verdict: JudgeVerdict = self.execution_service.run_test_cases(
            language=language,
            source_code=source_code,
            test_cases=public_test_cases,
            time_limit_ms=problem.time_limit_ms,
            memory_limit_mb=problem.memory_limit_mb,
            is_candidate=True,
        )

        return {
            "is_custom_input": False,
            "verdict": verdict.verdict,
            "passed_tests": verdict.passed_tests,
            "total_tests": verdict.total_tests,
            "test_results": [
                {
                    "test_case_id": r.test_case_id,
                    "passed": r.passed,
                    "actual_stdout": r.actual_stdout,
                    "expected_stdout": r.expected_stdout,
                    "execution_time_ms": r.execution_time_ms,
                    "error": r.error,
                }
                for r in verdict.results
            ],
        }

    def handle_submit(
        self,
        interview: Interview,
        problem_id: int,
        language: str,
        source_code: str
    ) -> Dict[str, Any]:
        """
        Candidate clicks 'Submit'.
        Evaluates against all official test cases (sample + hidden).
        Records CodingSubmission, updates Interview.coding_score, and updates ApplicationStage.
        """
        if not interview.application or not interview.application.job:
            raise HTTPException(status_code=404, detail="Job association not found for interview.")

        job = interview.application.job
        self.validate_job_language(job, language)

        problem = self.db.query(CodingProblem).filter(CodingProblem.id == problem_id).first()
        if not problem:
            raise HTTPException(status_code=404, detail="Coding problem not found.")

        test_cases = (
            self.db.query(CodingTestCase)
            .filter(CodingTestCase.problem_id == problem_id)
            .order_by(CodingTestCase.display_order)
            .all()
        )

        if not test_cases:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This problem does not have any test cases configured."
            )

        # Run all test cases
        verdict: JudgeVerdict = self.execution_service.run_test_cases(
            language=language,
            source_code=source_code,
            test_cases=test_cases,
            time_limit_ms=problem.time_limit_ms,
            memory_limit_mb=problem.memory_limit_mb,
            is_candidate=True,
        )

        max_exec_time = max((r.execution_time_ms for r in verdict.results), default=0)

        # Record submission
        submission = CodingSubmission(
            tenant_id=interview.tenant_id,
            interview_id=interview.id,
            problem_id=problem.id,
            language=language,
            source_code=source_code,
            status="completed",
            verdict=verdict.verdict,
            passed_tests=verdict.passed_tests,
            total_tests=verdict.total_tests,
            score=verdict.score,
            execution_time_ms=max_exec_time,
            submitted_at=get_ist_now(),
        )
        self.db.add(submission)
        self.db.flush()

        # Update Coding Round aggregate score on Interview
        self._recalculate_interview_coding_score(interview, job)

        return {
            "submission_id": submission.id,
            "verdict": verdict.verdict,
            "score": verdict.score,
            "passed_tests": verdict.passed_tests,
            "total_tests": verdict.total_tests,
            "execution_time_ms": max_exec_time,
            "test_results": [
                {
                    "test_case_id": r.test_case_id,
                    "is_hidden": r.is_hidden,
                    "passed": r.passed,
                    "weight": r.weight,
                    "actual_stdout": r.actual_stdout if not r.is_hidden else None,
                    "expected_stdout": r.expected_stdout if not r.is_hidden else None,
                    "execution_time_ms": r.execution_time_ms,
                    "error": r.error if not r.is_hidden else ("Test failed" if not r.passed else None),
                }
                for r in verdict.results
            ],
        }

    def _recalculate_interview_coding_score(self, interview: Interview, job: Job) -> None:
        """
        Computes the equal-weighted average score across all problems in the assigned Question Set.
        Updates Interview.coding_score and logs ApplicationStage('Coding Round').
        """
        if not job.coding_repo_set_id:
            return

        # Fetch all problem IDs in the Question Set
        set_items = (
            self.db.query(CodingQuestionSetItem)
            .filter(CodingQuestionSetItem.question_set_id == job.coding_repo_set_id)
            .all()
        )
        problem_ids = [item.problem_id for item in set_items]

        if not problem_ids:
            return

        # Get highest score per problem for this interview
        problem_scores = []
        for pid in problem_ids:
            best_sub = (
                self.db.query(CodingSubmission)
                .filter(CodingSubmission.interview_id == interview.id, CodingSubmission.problem_id == pid)
                .order_by(CodingSubmission.score.desc())
                .first()
            )
            problem_scores.append(best_sub.score if best_sub else 0.0)

        aggregate_score = round(sum(problem_scores) / len(problem_scores), 2)
        interview.coding_score = aggregate_score

        # Update ApplicationStage via CandidateService
        from app.services.candidate_service import CandidateService
        cand_service = CandidateService(self.db)
        stage_status = "pass" if aggregate_score >= 50.0 else "fail"
        cand_service.update_stage(
            application_id=interview.application_id,
            stage_name="Coding Round",
            status=stage_status,
            score=aggregate_score,
            notes=f"Coding Assessment score: {aggregate_score}% ({len([s for s in problem_scores if s > 0])}/{len(problem_ids)} problems attempted).",
        )
        self.db.flush()
