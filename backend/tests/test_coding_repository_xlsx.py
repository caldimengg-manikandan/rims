"""Tests for coding repository .xlsx / .json import and export."""
from __future__ import annotations

from pathlib import Path

from app.services.coding_repository_io import (
    build_repository_xlsx,
    parse_language_list,
    parse_repository_xlsx,
)


def test_parse_language_list_normalizes_display_names_and_aliases():
    langs = parse_language_list("Python 3, Java 21, C++, javascript, go")
    assert langs == ["python3", "java21", "cpp", "javascript", "golang"]


def test_xlsx_round_trip_with_question_sets_and_problems():
    problems = [
        {
            "id": 101,
            "title": "Sum Two Numbers",
            "difficulty": "easy",
            "description": "Return a + b.",
            "input_format": "Two integers",
            "output_format": "One integer",
            "constraints": "0 <= a, b <= 10^9",
            "supported_languages": ["python3", "cpp"],
            "time_limit_ms": 1500,
            "memory_limit_mb": 128,
            "starter_code": {
                "python3": "def solve():\n    pass\n",
                "cpp": "int main() { return 0; }\n",
            },
            "solution_codes": {
                "python3": "a, b = map(int, input().split()); print(a + b)",
                "cpp": "#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b;}\n",
            },
            "test_cases": [
                {"input": "2 3", "expected_output": "5", "is_hidden": False, "weight": 40, "display_order": 1},
                {"input": "10 20", "expected_output": "30", "is_hidden": True, "weight": 60, "display_order": 2},
            ],
        }
    ]
    question_sets = [
        {
            "title": "Core Algorithms",
            "description": "Starter round",
            "supported_languages": ["python3", "cpp"],
            "problems": problems,
        }
    ]

    xlsx_bytes = build_repository_xlsx(question_sets, [])
    parsed = parse_repository_xlsx(xlsx_bytes)

    assert len(parsed["question_sets"]) == 1
    assert parsed["question_sets"][0]["title"] == "Core Algorithms"
    assert parsed["question_sets"][0]["supported_languages"] == ["python3", "cpp"]
    assert len(parsed["question_sets"][0]["problems"]) == 1

    p = parsed["question_sets"][0]["problems"][0]
    assert p["title"] == "Sum Two Numbers"
    assert p["difficulty"] == "easy"
    assert p["time_limit_ms"] == 1500
    assert p["memory_limit_mb"] == 128
    assert p["supported_languages"] == ["python3", "cpp"]
    assert "def solve()" in p["starter_code"]["python3"]
    assert "std::cin" in p["solution_codes"]["cpp"]
    assert len(p["test_cases"]) == 2
    assert p["test_cases"][0]["is_hidden"] is False
    assert p["test_cases"][1]["is_hidden"] is True
    assert p["test_cases"][1]["expected_output"] == "30"


def test_parse_generated_coding_repo_questions_xlsx():
    sample_xlsx = Path(__file__).resolve().parents[2] / "coding_repo_questions.xlsx"
    if not sample_xlsx.exists():
        return

    parsed = parse_repository_xlsx(sample_xlsx.read_bytes())
    assert parsed["question_sets"] == []
    assert len(parsed["problems"]) == 10
    for prob in parsed["problems"]:
        assert prob["supported_languages"] == ["python3", "java21", "cpp", "javascript"]
        assert len(prob["starter_code"]) == 4
        assert len(prob["solution_codes"]) == 4
        assert len(prob["test_cases"]) == 2
