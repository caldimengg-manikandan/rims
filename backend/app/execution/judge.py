"""
Judge subsystem for evaluating execution results against test cases.
Performs whitespace/newline normalization, weighted scoring, and hidden-test protection.
"""
from dataclasses import dataclass
from typing import List, Optional
from app.execution.executor import ExecutionResult
from app.domain.models import CodingTestCase


@dataclass
class TestCaseResult:
    test_case_id: int
    is_hidden: bool
    passed: bool
    weight: float
    actual_stdout: Optional[str]
    expected_stdout: Optional[str]
    execution_time_ms: int
    error: Optional[str] = None


@dataclass
class JudgeVerdict:
    verdict: str  # "accepted", "wrong_answer", "time_limit_exceeded", "compilation_error", "runtime_error"
    score: float  # 0.0 - 100.0
    passed_tests: int
    total_tests: int
    results: List[TestCaseResult]


class Judge:
    """
    Evaluates candidate execution results against stored problem test cases.
    """

    @staticmethod
    def normalize_output(text: Optional[str]) -> str:
        """
        Normalize text by converting CRLF to LF, stripping trailing line whitespace,
        and stripping surrounding whitespace.
        """
        if text is None:
            return ""
        lines = text.replace("\r\n", "\n").strip().splitlines()
        return "\n".join(line.rstrip() for line in lines).strip()

    def evaluate(
        self,
        test_cases: List[CodingTestCase],
        results: List[ExecutionResult],
        is_candidate: bool = True
    ) -> JudgeVerdict:
        """
        Compare ExecutionResult outputs against CodingTestCase expected outputs.
        """
        passed_count = 0
        total_weight = sum(tc.weight for tc in test_cases) or 1.0
        earned_weight = 0.0
        case_results: List[TestCaseResult] = []
        overall_verdict = "accepted"

        for tc, res in zip(test_cases, results):
            # 1. Check for compilation error
            if res.compilation_failed:
                overall_verdict = "compilation_error"
                case_results.append(TestCaseResult(
                    test_case_id=tc.id,
                    is_hidden=tc.is_hidden,
                    passed=False,
                    weight=tc.weight,
                    actual_stdout=None,
                    expected_stdout=None if (is_candidate and tc.is_hidden) else tc.expected_output,
                    execution_time_ms=0,
                    error=res.compilation_error or "Compilation failed",
                ))
                continue

            # 2. Check for timeout
            if res.timed_out:
                if overall_verdict == "accepted":
                    overall_verdict = "time_limit_exceeded"
                case_results.append(TestCaseResult(
                    test_case_id=tc.id,
                    is_hidden=tc.is_hidden,
                    passed=False,
                    weight=tc.weight,
                    actual_stdout=None,
                    expected_stdout=None if (is_candidate and tc.is_hidden) else tc.expected_output,
                    execution_time_ms=res.time_ms,
                    error="Time Limit Exceeded",
                ))
                continue

            # 3. Check for runtime crash / non-zero exit
            if res.exit_code != 0:
                if overall_verdict == "accepted":
                    overall_verdict = "runtime_error"
                case_results.append(TestCaseResult(
                    test_case_id=tc.id,
                    is_hidden=tc.is_hidden,
                    passed=False,
                    weight=tc.weight,
                    actual_stdout=None if (is_candidate and tc.is_hidden) else res.stdout,
                    expected_stdout=None if (is_candidate and tc.is_hidden) else tc.expected_output,
                    execution_time_ms=res.time_ms,
                    error=res.stderr or f"Process exited with code {res.exit_code}",
                ))
                continue

            # 4. Compare outputs
            norm_actual = self.normalize_output(res.stdout)
            norm_expected = self.normalize_output(tc.expected_output)
            is_match = (norm_actual == norm_expected)

            if is_match:
                passed_count += 1
                earned_weight += tc.weight
            else:
                if overall_verdict == "accepted":
                    overall_verdict = "wrong_answer"

            case_results.append(TestCaseResult(
                test_case_id=tc.id,
                is_hidden=tc.is_hidden,
                passed=is_match,
                weight=tc.weight,
                actual_stdout=None if (is_candidate and tc.is_hidden) else res.stdout,
                expected_stdout=None if (is_candidate and tc.is_hidden) else tc.expected_output,
                execution_time_ms=res.time_ms,
                error=None if is_match else "Output mismatch",
            ))

        score = round((earned_weight / total_weight) * 100.0, 2)

        return JudgeVerdict(
            verdict=overall_verdict,
            score=score,
            passed_tests=passed_count,
            total_tests=len(test_cases),
            results=case_results,
        )
