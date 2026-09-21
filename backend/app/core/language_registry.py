"""
Central Language Registry for CALRIMS Coding Assessment Module.
Defines supported programming languages, docker images, execution commands, and templates.

Supported languages: python3, java21, cpp, javascript, golang, rust
Removed (server-side rejected): csharp, typescript
"""
from dataclasses import dataclass
from typing import Dict, List, Optional, Any


@dataclass(frozen=True)
class LanguageConfig:
    id: str                         # Unique identifier: e.g. "python3", "java21", "cpp", "javascript"
    display_name: str               # Human-readable name: e.g. "Python 3", "Java 21"
    docker_image: str               # Base container image for sandbox execution
    source_filename: str            # Filename inside the container workspace
    compile_cmd: Optional[List[str]]# Compilation command or None if interpreted
    run_cmd: List[str]              # Execution command
    monaco_language: str            # Monaco editor language id (e.g. "python", "java", "cpp")
    extension: str                  # File extension (e.g. "py", "java", "cpp")
    default_starter_code: str       # Default boilerplate starter code
    default_solution_template: str  # Default solution template for reference solutions


SUPPORTED_LANGUAGES: Dict[str, LanguageConfig] = {
    "python3": LanguageConfig(
        id="python3",
        display_name="Python 3",
        docker_image="python:3.11-slim",
        source_filename="solution.py",
        compile_cmd=None,
        run_cmd=["python3", "solution.py"],
        monaco_language="python",
        extension="py",
        default_starter_code=(
            "import sys\n\n"
            "def solve():\n"
            "    # Read from sys.stdin or input()\n"
            "    pass\n\n"
            "if __name__ == '__main__':\n"
            "    solve()\n"
        ),
        default_solution_template=(
            "import sys\n\n"
            "def solve():\n"
            "    # Reference solution logic\n"
            "    pass\n\n"
            "if __name__ == '__main__':\n"
            "    solve()\n"
        ),
    ),
    "java21": LanguageConfig(
        id="java21",
        display_name="Java 21",
        docker_image="eclipse-temurin:21-jdk-alpine",
        source_filename="Solution.java",
        compile_cmd=["javac", "Solution.java"],
        run_cmd=["java", "-Xmx256m", "Solution"],
        monaco_language="java",
        extension="java",
        default_starter_code=(
            "import java.util.Scanner;\n\n"
            "public class Solution {\n"
            "    public static void main(String[] args) {\n"
            "        Scanner scanner = new Scanner(System.in);\n"
            "        // Implement solution here\n"
            "    }\n"
            "}\n"
        ),
        default_solution_template=(
            "import java.util.Scanner;\n\n"
            "public class Solution {\n"
            "    public static void main(String[] args) {\n"
            "        Scanner scanner = new Scanner(System.in);\n"
            "        // Reference solution logic\n"
            "    }\n"
            "}\n"
        ),
    ),
    "cpp": LanguageConfig(
        id="cpp",
        display_name="C++ (GCC 13)",
        docker_image="gcc:13-alpine",
        source_filename="solution.cpp",
        compile_cmd=["g++", "-O2", "-std=c++17", "-o", "solution", "solution.cpp"],
        run_cmd=["./solution"],
        monaco_language="cpp",
        extension="cpp",
        default_starter_code=(
            "#include <iostream>\n"
            "using namespace std;\n\n"
            "int main() {\n"
            "    // Read standard input\n"
            "    return 0;\n"
            "}\n"
        ),
        default_solution_template=(
            "#include <iostream>\n"
            "using namespace std;\n\n"
            "int main() {\n"
            "    // Reference solution logic\n"
            "    return 0;\n"
            "}\n"
        ),
    ),
    "javascript": LanguageConfig(
        id="javascript",
        display_name="JavaScript (Node.js 20)",
        docker_image="node:20-alpine",
        source_filename="solution.js",
        compile_cmd=None,
        run_cmd=["node", "solution.js"],
        monaco_language="javascript",
        extension="js",
        default_starter_code=(
            "const fs = require('fs');\n\n"
            "function solve() {\n"
            "    const input = fs.readFileSync(0, 'utf-8');\n"
            "    // Implement solution\n"
            "}\n\n"
            "solve();\n"
        ),
        default_solution_template=(
            "const fs = require('fs');\n\n"
            "function solve() {\n"
            "    const input = fs.readFileSync(0, 'utf-8');\n"
            "    // Reference solution logic\n"
            "}\n\n"
            "solve();\n"
        ),
    ),
    # NOTE: TypeScript is intentionally NOT supported. Use javascript instead.
    # TypeScript submissions are rejected server-side.
    "golang": LanguageConfig(
        id="golang",
        display_name="Go 1.22",
        docker_image="golang:1.22-alpine",
        source_filename="solution.go",
        compile_cmd=["go", "build", "-o", "solution", "solution.go"],
        run_cmd=["./solution"],
        monaco_language="go",
        extension="go",
        default_starter_code=(
            "package main\n\n"
            "import \"fmt\"\n\n"
            "func main() {\n"
            "    // Implement solution\n"
            "}\n"
        ),
        default_solution_template=(
            "package main\n\n"
            "import \"fmt\"\n\n"
            "func main() {\n"
            "    // Reference solution logic\n"
            "}\n"
        ),
    ),
    # NOTE: C# is intentionally NOT supported. C# submissions are rejected server-side.
    "rust": LanguageConfig(
        id="rust",
        display_name="Rust 1.77",
        docker_image="rust:1.77-alpine",
        source_filename="solution.rs",
        compile_cmd=["rustc", "-O", "-o", "solution", "solution.rs"],
        run_cmd=["./solution"],
        monaco_language="rust",
        extension="rs",
        default_starter_code=(
            "use std::io::{self, Read};\n\n"
            "fn main() {\n"
            "    // Implement solution\n"
            "}\n"
        ),
        default_solution_template=(
            "use std::io::{self, Read};\n\n"
            "fn main() {\n"
            "    // Reference solution logic\n"
            "}\n"
        ),
    ),
}

ALL_LANGUAGE_IDS = frozenset(SUPPORTED_LANGUAGES.keys())
# Keep backwards-compatible alias
V1_LANGUAGE_IDS = ALL_LANGUAGE_IDS

# Languages that have been explicitly removed and must be rejected server-side
# even if a client manually crafts a request with these identifiers.
REMOVED_LANGUAGE_IDS = frozenset({"csharp", "typescript"})


def validate_supported_languages(languages: List[str]) -> List[str]:
    """
    Validates that the provided list of language IDs is non-empty
    and only contains supported language identifiers.
    Returns normalized lowercase language list or raises ValueError.
    Explicitly rejects removed languages (csharp, typescript) with a clear error.
    """
    if not languages:
        raise ValueError("At least one supported language must be specified.")

    normalized = [str(lang).strip().lower() for lang in languages if lang and str(lang).strip()]
    if not normalized:
        raise ValueError("At least one valid supported language must be specified.")

    # Explicitly reject removed languages first for a clear error message
    removed = [lang for lang in normalized if lang in REMOVED_LANGUAGE_IDS]
    if removed:
        raise ValueError(
            f"Language(s) {', '.join(removed)} are no longer supported. "
            f"Supported languages: {', '.join(sorted(ALL_LANGUAGE_IDS))}."
        )

    invalid = [lang for lang in normalized if lang not in ALL_LANGUAGE_IDS]
    if invalid:
        raise ValueError(
            f"Unsupported language(s): {', '.join(invalid)}. Supported languages: {', '.join(sorted(ALL_LANGUAGE_IDS))}."
        )

    # Return unique preserved order
    return list(dict.fromkeys(normalized))


def get_all_languages_metadata() -> List[Dict[str, Any]]:
    """Returns a list of metadata for all supported languages."""
    return [
        {
            "id": cfg.id,
            "display_name": cfg.display_name,
            "monaco_language": cfg.monaco_language,
            "extension": cfg.extension,
            "default_starter_code": cfg.default_starter_code,
            "default_solution_template": cfg.default_solution_template,
        }
        for cfg in SUPPORTED_LANGUAGES.values()
    ]
