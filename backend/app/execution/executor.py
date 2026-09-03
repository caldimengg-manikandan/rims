"""
Abstract Executor Interface and ExecutionResult DTO.
Allows decoupling the sandboxed code execution mechanism (e.g. Docker) from business logic.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class ExecutionResult:
    stdout: str
    stderr: str
    exit_code: int
    time_ms: int
    memory_kb: int
    timed_out: bool
    compilation_failed: bool = False
    compilation_error: Optional[str] = None


class Executor(ABC):
    """
    Abstract interface for executing candidate or reference code in a secure sandbox.
    """

    @abstractmethod
    def run(
        self,
        language: str,
        source_code: str,
        stdin: str = "",
        time_limit_ms: int = 2000,
        memory_limit_mb: int = 256
    ) -> ExecutionResult:
        """
        Execute source code within an isolated sandbox.

        Args:
            language: Language identifier (e.g. "python3", "java21")
            source_code: Complete source code string
            stdin: Standard input string provided to the process
            time_limit_ms: Maximum execution time in milliseconds
            memory_limit_mb: Maximum memory allocation in megabytes

        Returns:
            ExecutionResult containing stdout, stderr, exit code, execution metrics, and error flags.
        """
        pass
