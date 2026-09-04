"""
DockerExecutor — Sandboxed container execution implementation of Executor.
Executes code with memory, CPU, PID, network, and capability isolation.
"""
import logging
import os
import shutil
import tempfile
import time
from typing import Optional

from app.core.language_registry import SUPPORTED_LANGUAGES, LanguageConfig
from app.execution.executor import ExecutionResult, Executor

logger = logging.getLogger(__name__)

try:
    import docker
    from docker.errors import ContainerError, ImageNotFound, APIError
except ImportError:
    docker = None  # Handled gracefully if docker library is missing in certain test runs


class DockerExecutor(Executor):
    """
    Executes candidate/system code inside isolated Docker containers.
    """

    def __init__(self, client: Optional[object] = None):
        if client is not None:
            self.client = client
        elif docker is not None:
            try:
                self.client = docker.from_env()
            except Exception as e:
                logger.warning("Could not initialize Docker client from environment: %s", e)
                self.client = None
        else:
            self.client = None

    def _ensure_client(self):
        if self.client is None:
            if docker is None:
                raise RuntimeError("The 'docker' Python package is not installed. Please install docker>=7.0.0.")
            try:
                self.client = docker.from_env()
            except Exception as exc:
                raise RuntimeError(
                    f"Docker daemon is not accessible. Ensure Docker is running. Error: {exc}"
                )

    def run(
        self,
        language: str,
        source_code: str,
        stdin: str = "",
        time_limit_ms: int = 2000,
        memory_limit_mb: int = 256
    ) -> ExecutionResult:
        if language not in SUPPORTED_LANGUAGES:
            raise ValueError(f"Language '{language}' is not registered in the language registry.")

        lang_config: LanguageConfig = SUPPORTED_LANGUAGES[language]
        self._ensure_client()

        temp_dir = tempfile.mkdtemp(prefix="calrims_exec_")
        try:
            # 1. Write source file to workspace
            src_path = os.path.join(temp_dir, lang_config.source_filename)
            with open(src_path, "w", encoding="utf-8") as f:
                f.write(source_code)

            # 2. Write stdin file to workspace
            stdin_path = os.path.join(temp_dir, "stdin.txt")
            with open(stdin_path, "w", encoding="utf-8") as f:
                f.write(stdin or "")

            # Set permissive permissions on temp files so container runner can read
            os.chmod(temp_dir, 0o777)
            os.chmod(src_path, 0o666)
            os.chmod(stdin_path, 0o666)

            # 3. Assemble command
            if lang_config.compile_cmd:
                compile_str = " ".join(lang_config.compile_cmd)
                run_str = " ".join(lang_config.run_cmd)
                cmd = (
                    f"sh -c \"{compile_str} 2> compile_err.txt && "
                    f"{run_str} < stdin.txt || "
                    "{ exit_c=$?; if [ -s compile_err.txt ]; then cat compile_err.txt >&2; exit 2; else exit $exit_c; fi; }\""
                )
            else:
                run_str = " ".join(lang_config.run_cmd)
                cmd = f"sh -c \"{run_str} < stdin.txt\""

            # 4. Prepare container constraints
            wall_timeout_seconds = max(int(time_limit_ms / 1000) + 2, 4)
            cpu_quota = 50000  # 0.5 core out of 100000 period
            mem_limit = f"{max(memory_limit_mb, 64)}m"

            container_kwargs = {
                "image": lang_config.docker_image,
                "command": cmd,
                "volumes": {temp_dir: {"bind": "/workspace", "mode": "rw"}},
                "working_dir": "/workspace",
                "network_disabled": True,
                "mem_limit": mem_limit,
                "cpu_period": 100000,
                "cpu_quota": cpu_quota,
                "pids_limit": 64,
                "cap_drop": ["ALL"],
                "security_opt": ["no-new-privileges:true"],
                "remove": True,
                "stdout": True,
                "stderr": True,
            }

            start_time = time.perf_counter()
            timed_out = False

            try:
                # Run container synchronously
                # docker.containers.run() with remove=True returns container output bytes
                output = self.client.containers.run(**container_kwargs)
                elapsed_ms = int((time.perf_counter() - start_time) * 1000)
                stdout = output.decode("utf-8", errors="replace") if isinstance(output, bytes) else str(output)
                return ExecutionResult(
                    stdout=stdout,
                    stderr="",
                    exit_code=0,
                    time_ms=elapsed_ms,
                    memory_kb=0,
                    timed_out=False,
                )

            except ContainerError as ce:
                elapsed_ms = int((time.perf_counter() - start_time) * 1000)
                ce_stderr = getattr(ce, "stderr", None)
                ce_stdout = getattr(ce, "stdout", None)
                stderr_text = ce_stderr.decode("utf-8", errors="replace") if isinstance(ce_stderr, bytes) else str(ce_stderr or "")
                stdout_text = ce_stdout.decode("utf-8", errors="replace") if isinstance(ce_stdout, bytes) else str(ce_stdout or "")

                is_compilation = (
                    (ce.exit_status == 2 and lang_config.compile_cmd is not None)
                    or "javac" in stderr_text
                    or "compilation" in stderr_text.lower()
                    or "error:" in stderr_text.lower()
                )
                return ExecutionResult(
                    stdout=stdout_text,
                    stderr=stderr_text,
                    exit_code=ce.exit_status,
                    time_ms=elapsed_ms,
                    memory_kb=0,
                    timed_out=False,
                    compilation_failed=is_compilation,
                    compilation_error=stderr_text if is_compilation else None,
                )

            except Exception as exc:
                elapsed_ms = int((time.perf_counter() - start_time) * 1000)
                err_msg = str(exc).lower()
                is_timeout = "timeout" in err_msg or "timed out" in err_msg or elapsed_ms >= (time_limit_ms + 1000)

                return ExecutionResult(
                    stdout="",
                    stderr=str(exc),
                    exit_code=124 if is_timeout else 1,
                    time_ms=elapsed_ms,
                    memory_kb=0,
                    timed_out=is_timeout,
                )

        finally:
            # 5. Clean up host temp directory
            shutil.rmtree(temp_dir, ignore_errors=True)
