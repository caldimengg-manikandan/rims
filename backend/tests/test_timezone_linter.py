import os
import re

def test_no_legacy_utcnow_in_codebase():
    """
    Linter test: Asserts that no python source file (outside timezone.py)
    directly calls datetime.utcnow() or utcnow(), enforcing timezone-aware UTC or unified naive IST patterns.
    """
    app_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "app"))
    
    # We exclude app/core/timezone.py since it acts as our timezone utility boundary.
    exclude_paths = {
        os.path.abspath(os.path.join(app_dir, "core", "timezone.py"))
    }
    
    pattern = re.compile(r"\butcnow\s*\(")
    violations = []
    
    for root, _, files in os.walk(app_dir):
        for file in files:
            if not file.endswith(".py"):
                continue
            
            file_path = os.path.abspath(os.path.join(root, file))
            if file_path in exclude_paths:
                continue
                
            with open(file_path, "r", encoding="utf-8") as f:
                for line_num, line in enumerate(f, 1):
                    # Strip comments to prevent flagging inline explanations/documentation
                    clean_line = line.split("#")[0]
                    if pattern.search(clean_line):
                        violations.append(f"{os.path.relpath(file_path, app_dir)}:{line_num} -> {line.strip()}")
                        
    assert not violations, (
        f"Found {len(violations)} utcnow() violation(s) in codebase. "
        "Use timezone-aware datetime.now(timezone.utc) or timezone.get_ist_now() instead:\n"
        + "\n".join(violations)
    )
