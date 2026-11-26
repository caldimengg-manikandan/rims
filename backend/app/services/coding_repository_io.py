"""
Import / Export serialization helpers for the CALRIMS Coding Repository.
Supports both structured JSON bundles and multi-sheet Excel (.xlsx) workbooks.
"""
from __future__ import annotations

import io
import json
import re
from typing import Any, Dict, List, Optional, Tuple

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from app.core.language_registry import ALL_LANGUAGE_IDS, SUPPORTED_LANGUAGES


_LANGUAGE_LABELS: Dict[str, str] = {
    "python3": "Python 3",
    "java21": "Java 21",
    "cpp": "C++",
    "javascript": "JavaScript",
    "golang": "Go",
    "rust": "Rust",
}

_LANGUAGE_ALIASES: Dict[str, str] = {
    "python3": "python3",
    "python 3": "python3",
    "python": "python3",
    "py": "python3",
    "java21": "java21",
    "java 21": "java21",
    "java": "java21",
    "cpp": "cpp",
    "c++": "cpp",
    "c++ (gcc 13)": "cpp",
    "javascript": "javascript",
    "javascript (node.js 20)": "javascript",
    "js": "javascript",
    "node": "javascript",
    "golang": "golang",
    "go": "golang",
    "go 1.22": "golang",
    "rust": "rust",
    "rust 1.77": "rust",
}

_CORE_EXPORT_LANGUAGES = ["python3", "java21", "cpp", "javascript", "golang", "rust"]


def normalize_language_id(raw: str) -> Optional[str]:
    key = (raw or "").strip().lower()
    if key in _LANGUAGE_ALIASES:
        return _LANGUAGE_ALIASES[key]
    if key in ALL_LANGUAGE_IDS:
        return key
    return None


def parse_language_list(raw: Any) -> List[str]:
    if isinstance(raw, list):
        tokens = [str(item) for item in raw]
    elif raw is None:
        tokens = []
    else:
        tokens = re.split(r"[,;\n]+", str(raw))

    result: List[str] = []
    for tok in tokens:
        lang_id = normalize_language_id(tok)
        if lang_id and lang_id not in result:
            result.append(lang_id)
    return result


def serialize_problem_for_export(problem) -> Dict[str, Any]:
    solution_dict = problem.get_solution_codes()
    return {
        "id": problem.id,
        "title": problem.title,
        "description": problem.description,
        "input_format": problem.input_format,
        "output_format": problem.output_format,
        "constraints": problem.constraints,
        "difficulty": problem.difficulty or "medium",
        "time_limit_ms": problem.time_limit_ms or 2000,
        "memory_limit_mb": problem.memory_limit_mb or 256,
        "supported_languages": problem.supported_languages or list(solution_dict.keys()) or ["python3"],
        "starter_code": problem.starter_code or {},
        "solution_codes": solution_dict,
        "test_cases": [
            {
                "input": tc.input,
                "expected_output": tc.expected_output,
                "weight": tc.weight,
                "is_hidden": tc.is_hidden,
                "display_order": tc.display_order,
            }
            for tc in sorted(problem.test_cases, key=lambda x: x.display_order or 0)
        ],
    }


def serialize_set_for_export(question_set) -> Dict[str, Any]:
    sorted_items = sorted(question_set.items, key=lambda x: x.display_order or 0)
    problems = [serialize_problem_for_export(item.problem) for item in sorted_items if item.problem]
    return {
        "title": question_set.title,
        "description": question_set.description,
        "supported_languages": question_set.supported_languages or ["python3"],
        "problems": problems,
    }


def build_repository_xlsx(
    export_sets: List[Dict[str, Any]],
    export_problems: List[Dict[str, Any]],
) -> bytes:
    """Build a multi-sheet .xlsx workbook for coding problems, test cases, and question sets."""
    # Collect all unique problems across standalone problems and question sets
    all_problems: List[Dict[str, Any]] = []
    seen_keys = set()
    for p in export_problems:
        key = (p.get("id"), p.get("title"))
        if key not in seen_keys:
            seen_keys.add(key)
            all_problems.append(p)
    for qs in export_sets:
        for p in qs.get("problems") or []:
            key = (p.get("id"), p.get("title"))
            if key not in seen_keys:
                seen_keys.add(key)
                all_problems.append(p)

    # Include languages present in exported items plus core 4 languages
    used_langs = set(["python3", "java21", "cpp", "javascript"])
    for p in all_problems:
        used_langs.update(parse_language_list(p.get("supported_languages")))
        used_langs.update((p.get("starter_code") or {}).keys())
        used_langs.update((p.get("solution_codes") or {}).keys())
    lang_cols = [lang for lang in _CORE_EXPORT_LANGUAGES if lang in used_langs and lang in SUPPORTED_LANGUAGES]

    wb = openpyxl.Workbook()
    header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF", size=11)
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )

    def _style_sheet(ws, col_widths: Dict[int, int], row_count: int) -> None:
        for col_idx in range(1, ws.max_column + 1):
            cell = ws.cell(row=1, column=col_idx)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        for row in ws.iter_rows(min_row=2, max_row=row_count + 1):
            for cell in row:
                cell.border = thin_border
                cell.alignment = Alignment(vertical="top", wrap_text=True)
        for col_idx, width in col_widths.items():
            ws.column_dimensions[get_column_letter(col_idx)].width = width
        ws.freeze_panes = "A2"

    # Sheet 1: Problems
    ws_p = wb.active
    ws_p.title = "Problems"
    headers_p = [
        "ID", "Title", "Difficulty", "Description", "Input Format",
        "Output Format", "Constraints", "Supported Languages",
        "Time Limit (ms)", "Memory Limit (MB)",
    ]
    for lang in lang_cols:
        headers_p.append(f"Starter Code ({_LANGUAGE_LABELS.get(lang, lang)})")
    for lang in lang_cols:
        headers_p.append(f"Reference Solution ({_LANGUAGE_LABELS.get(lang, lang)})")
    ws_p.append(headers_p)

    for idx, p in enumerate(all_problems, start=1):
        pid = p.get("id") or idx
        starters = p.get("starter_code") or {}
        solutions = p.get("solution_codes") or {}
        row = [
            pid,
            p.get("title") or "",
            p.get("difficulty") or "medium",
            p.get("description") or "",
            p.get("input_format") or "",
            p.get("output_format") or "",
            p.get("constraints") or "",
            ", ".join(p.get("supported_languages") or ["python3"]),
            int(p.get("time_limit_ms") or 2000),
            int(p.get("memory_limit_mb") or 256),
        ]
        for lang in lang_cols:
            row.append(starters.get(lang, ""))
        for lang in lang_cols:
            row.append(solutions.get(lang, ""))
        ws_p.append(row)

    widths_p: Dict[int, int] = {
        1: 8, 2: 30, 3: 12, 4: 50, 5: 28,
        6: 28, 7: 28, 8: 30, 9: 16, 10: 18,
    }
    for col_idx in range(11, len(headers_p) + 1):
        widths_p[col_idx] = 44
    _style_sheet(ws_p, widths_p, len(all_problems))

    # Sheet 2: Test Cases
    ws_tc = wb.create_sheet(title="Test Cases")
    ws_tc.append(["Problem ID", "Problem Title", "Test Case #", "Input", "Expected Output", "Is Hidden", "Weight"])
    tc_rows = 0
    for idx, p in enumerate(all_problems, start=1):
        pid = p.get("id") or idx
        for tc_idx, tc in enumerate(p.get("test_cases") or [], start=1):
            ws_tc.append([
                pid,
                p.get("title") or "",
                tc.get("display_order") or tc_idx,
                tc.get("input") or "",
                tc.get("expected_output") or "",
                bool(tc.get("is_hidden", False)),
                float(tc.get("weight", 1.0)),
            ])
            tc_rows += 1
    _style_sheet(ws_tc, {1: 12, 2: 30, 3: 13, 4: 34, 5: 26, 6: 12, 7: 12}, tc_rows)

    # Sheet 3: Question Sets (if any)
    if export_sets:
        ws_qs = wb.create_sheet(title="Question Sets")
        ws_qs.append(["Title", "Description", "Supported Languages", "Problem Titles"])
        for qs in export_sets:
            prob_titles = [str(p.get("title") or "").strip() for p in (qs.get("problems") or []) if p.get("title")]
            ws_qs.append([
                qs.get("title") or "",
                qs.get("description") or "",
                ", ".join(qs.get("supported_languages") or ["python3"]),
                "\n".join(prob_titles),
            ])
        _style_sheet(ws_qs, {1: 30, 2: 45, 3: 30, 4: 40}, len(export_sets))

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()


def _parse_bool(val: Any) -> bool:
    if isinstance(val, bool):
        return val
    if val is None:
        return False
    return str(val).strip().lower() in ("true", "1", "yes", "y")


def _parse_number(val: Any, default: float) -> float:
    if val is None or val == "":
        return default
    if isinstance(val, (int, float)):
        return float(val)
    cleaned = str(val).strip().rstrip("%").strip()
    try:
        return float(cleaned)
    except ValueError:
        return default


def _sheet_rows_as_dicts(ws) -> List[Dict[str, Any]]:
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    raw_headers = [str(h).strip() if h is not None else "" for h in rows[0]]
    result: List[Dict[str, Any]] = []
    for r in rows[1:]:
        if not any(cell is not None and str(cell).strip() != "" for cell in r):
            continue
        item: Dict[str, Any] = {}
        for col_idx, header in enumerate(raw_headers):
            if header:
                item[header] = r[col_idx] if col_idx < len(r) else None
        result.append(item)
    return result


def _find_sheet(wb: openpyxl.Workbook, candidates: Tuple[str, ...]):
    lower_map = {name.strip().lower(): name for name in wb.sheetnames}
    for cand in candidates:
        if cand in lower_map:
            return wb[lower_map[cand]]
    return None


def parse_repository_xlsx(file_bytes: bytes) -> Dict[str, Any]:
    """
    Parse an Excel (.xlsx) workbook into the normalized repository import structure:
    {"question_sets": [...], "problems": [...]}.
    """
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
    if not wb.sheetnames:
        raise ValueError("Excel workbook contains no sheets.")

    ws_problems = _find_sheet(wb, ("problems", "coding problems", "questions")) or wb[wb.sheetnames[0]]
    problem_rows = _sheet_rows_as_dicts(ws_problems)

    problems_by_id: Dict[str, Dict[str, Any]] = {}
    problems_by_title: Dict[str, Dict[str, Any]] = {}
    parsed_problems: List[Dict[str, Any]] = []

    starter_re = re.compile(r"^starter\s*(?:code)?\s*(?:\(([^)]+)\)|_([a-z0-9_+]+))$", re.IGNORECASE)
    solution_re = re.compile(r"^(?:reference\s*solution|solution(?:\s*code)?)\s*(?:\(([^)]+)\)|_([a-z0-9_+]+))$", re.IGNORECASE)

    for row in problem_rows:
        lower_row = {k.strip().lower(): v for k, v in row.items()}
        title = str(lower_row.get("title") or lower_row.get("problem title") or "").strip()
        if not title:
            continue

        raw_id = lower_row.get("id") or lower_row.get("problem id")
        difficulty = str(lower_row.get("difficulty") or "medium").strip().lower()
        if difficulty not in ("easy", "medium", "hard"):
            difficulty = "medium"

        starter_code: Dict[str, str] = {}
        solution_codes: Dict[str, str] = {}
        for col_name, val in row.items():
            if val is None or str(val).strip() == "":
                continue
            m_start = starter_re.match(col_name.strip())
            if m_start:
                lang_id = normalize_language_id(m_start.group(1) or m_start.group(2) or "")
                if lang_id:
                    starter_code[lang_id] = str(val)
                continue
            m_sol = solution_re.match(col_name.strip())
            if m_sol:
                lang_id = normalize_language_id(m_sol.group(1) or m_sol.group(2) or "")
                if lang_id:
                    solution_codes[lang_id] = str(val)

        supported = parse_language_list(lower_row.get("supported languages") or lower_row.get("supported_languages"))
        if not supported:
            supported = list(dict.fromkeys(list(solution_codes.keys()) + list(starter_code.keys()))) or ["python3"]

        prob_dict: Dict[str, Any] = {
            "title": title,
            "description": str(lower_row.get("description") or ""),
            "input_format": str(lower_row.get("input format") or lower_row.get("input_format") or "") or None,
            "output_format": str(lower_row.get("output format") or lower_row.get("output_format") or "") or None,
            "constraints": str(lower_row.get("constraints") or "") or None,
            "difficulty": difficulty,
            "time_limit_ms": int(_parse_number(lower_row.get("time limit (ms)") or lower_row.get("time_limit_ms"), 2000)),
            "memory_limit_mb": int(_parse_number(lower_row.get("memory limit (mb)") or lower_row.get("memory_limit_mb"), 256)),
            "supported_languages": supported,
            "starter_code": starter_code,
            "solution_codes": solution_codes,
            "test_cases": [],
        }

        parsed_problems.append(prob_dict)
        if raw_id is not None and str(raw_id).strip() != "":
            problems_by_id[str(raw_id).strip()] = prob_dict
        problems_by_title[title.lower()] = prob_dict

    # Attach test cases from "Test Cases" sheet if present
    ws_tc = _find_sheet(wb, ("test cases", "test_cases", "testcases"))
    if ws_tc is not None:
        for row in _sheet_rows_as_dicts(ws_tc):
            lower_row = {k.strip().lower(): v for k, v in row.items()}
            pid_key = str(lower_row.get("problem id") or lower_row.get("problem_id") or "").strip()
            ptitle_key = str(lower_row.get("problem title") or lower_row.get("problem_title") or "").strip().lower()

            target = problems_by_id.get(pid_key) or problems_by_title.get(ptitle_key)
            if not target:
                continue

            tc_order = int(_parse_number(
                lower_row.get("test case #") or lower_row.get("display_order") or lower_row.get("order"),
                len(target["test_cases"]) + 1,
            ))
            tc_weight = _parse_number(lower_row.get("weight (%)") or lower_row.get("weight"), 1.0)
            target["test_cases"].append({
                "input": "" if lower_row.get("input") is None else str(lower_row.get("input")),
                "expected_output": "" if lower_row.get("expected output") is None and lower_row.get("expected_output") is None else str(
                    lower_row.get("expected output") if lower_row.get("expected output") is not None else lower_row.get("expected_output")
                ),
                "is_hidden": _parse_bool(lower_row.get("is hidden") if "is hidden" in lower_row else lower_row.get("is_hidden")),
                "weight": tc_weight,
                "display_order": tc_order,
            })

    # Parse Question Sets sheet if present
    parsed_sets: List[Dict[str, Any]] = []
    linked_titles = set()
    ws_sets = _find_sheet(wb, ("question sets", "question_sets", "sets"))
    if ws_sets is not None:
        for row in _sheet_rows_as_dicts(ws_sets):
            lower_row = {k.strip().lower(): v for k, v in row.items()}
            qs_title = str(lower_row.get("title") or "").strip()
            if not qs_title:
                continue
            raw_titles = lower_row.get("problem titles") or lower_row.get("problem_titles") or ""
            title_list = [t.strip() for t in re.split(r"[\n;]+", str(raw_titles)) if t.strip()]
            qs_problems: List[Dict[str, Any]] = []
            for pt in title_list:
                matched = problems_by_title.get(pt.lower())
                if matched:
                    qs_problems.append(matched)
                    linked_titles.add(pt.lower())
            qs_langs = parse_language_list(lower_row.get("supported languages") or lower_row.get("supported_languages")) or ["python3"]
            parsed_sets.append({
                "title": qs_title,
                "description": str(lower_row.get("description") or "") or None,
                "supported_languages": qs_langs,
                "problems": qs_problems,
            })

    standalone = [p for p in parsed_problems if p["title"].lower() not in linked_titles] if parsed_sets else parsed_problems
    return {
        "question_sets": parsed_sets,
        "problems": standalone,
    }
