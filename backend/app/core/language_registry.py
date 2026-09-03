"""
Central Language Registry for CALRIMS Coding Assessment Module.
Defines supported programming languages, docker images, and execution commands for V1.
"""
from dataclasses import dataclass
from typing import Dict, List, Optional


@dataclass(frozen=True)
class LanguageConfig:
    id: str                 # Unique language identifier: e.g. "python3", "java21"
    display_name: str       # Human-readable name: e.g. "Python 3", "Java 21"
    docker_image: str       # Base container image for sandbox execution
    source_filename: str    # Filename inside the container workspace
    compile_cmd: Optional[List[str]] # Compilation command or None if interpreted
    run_cmd: List[str]      # Execution command
    monaco_language: str    # Language identifier for Monaco code editor (e.g. "python", "java")


SUPPORTED_LANGUAGES: Dict[str, LanguageConfig] = {
    "python3": LanguageConfig(
        id="python3",
        display_name="Python 3",
        docker_image="python:3.11-slim",
        source_filename="solution.py",
        compile_cmd=None,
        run_cmd=["python3", "solution.py"],
        monaco_language="python",
    ),
    "java21": LanguageConfig(
        id="java21",
        display_name="Java 21",
        docker_image="eclipse-temurin:21-jdk-alpine",
        source_filename="Solution.java",
        compile_cmd=["javac", "Solution.java"],
        run_cmd=["java", "-Xmx256m", "Solution"],
        monaco_language="java",
    ),
}

V1_LANGUAGE_IDS = frozenset(SUPPORTED_LANGUAGES.keys())


def validate_supported_languages(languages: List[str]) -> List[str]:
    """
    Validates that the provided list of language IDs is non-empty
    and only contains supported V1 language identifiers.
    Returns normalized lowercase language list or raises ValueError.
    """
    if not languages:
        raise ValueError("At least one supported language must be specified.")

    normalized = [str(lang).strip().lower() for lang in languages if lang and str(lang).strip()]
    if not normalized:
        raise ValueError("At least one valid supported language must be specified.")

    invalid = [lang for lang in normalized if lang not in V1_LANGUAGE_IDS]
    if invalid:
        raise ValueError(
            f"Unsupported language(s): {', '.join(invalid)}. Supported languages for V1: {', '.join(sorted(V1_LANGUAGE_IDS))}."
        )

    # Return unique preserved order
    return list(dict.fromkeys(normalized))
