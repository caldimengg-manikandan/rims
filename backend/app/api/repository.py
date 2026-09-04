"""
Repository API — manages reusable question sets for interview rounds.
Each set belongs to a round_type (aptitude | technical | behavioural) and
can be tagged with one or more job_roles for auto-matching.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
from pydantic import BaseModel, ConfigDict
import json
import logging

from app.infrastructure.database import get_db
from app.domain.models import QuestionSet
from app.core.auth import get_current_hr
from app.core.ownership import get_tenant_context, validate_tenant_ownership
from app.core.tenant_context import TenantContext

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/repository", tags=["Repository"])
from fastapi import Request
from app.core.rate_limiter import limiter


def _ensure_question_sets_table(db: Session) -> None:
    """
    No-op. Table creation is handled by startup migrations.
    """
    pass


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class QuestionSetCreate(BaseModel):
    title: str
    round_type: str          # "aptitude" | "technical" | "behavioural"
    job_roles: List[str] = []
    questions: List[dict] = []
    topic_tags: List[str] = []


class QuestionSetResponse(BaseModel):
    id: int
    title: str
    round_type: str
    job_roles: List[str]
    question_count: int
    topic_tags: List[str]

    model_config = ConfigDict(from_attributes=True)


class QuestionSetDetail(QuestionSetResponse):
    questions: List[dict]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_json_field(value, default):
    """
    Harden JSON parsing to handle:
    1. Null database values -> return default
    2. Stringified "null" -> return default
    3. Already parsed lists/dicts -> return as-is
    4. Invalid JSON strings -> return default
    """
    if value is None:
        return default
    if isinstance(value, (list, dict)):
        return value
    try:
        parsed = json.loads(value)
        if parsed is None:
            return default
        # If we expect a list (default is []), ensure we return a list
        if isinstance(default, list) and not isinstance(parsed, list):
             return default
        return parsed
    except Exception:
        return default


def _fuzzy_match(role_name: str, job_roles: List[str]) -> bool:
    """
    Return True if role_name loosely matches any tag in job_roles.
    Tiers (first match wins):
      1. Exact case-insensitive match
      2. Substring match in either direction
      3. Word-token overlap — if ≥50% of the shorter string's words appear in the longer
         (hyphens and underscores are treated as word separators)
    """
    if not role_name:
        return False

    import re as _re

    def _tokenize(s: str) -> set:
        # Split on spaces, hyphens, underscores; lowercase; drop empty tokens
        return {t for t in _re.split(r'[\s\-_]+', s.lower().strip()) if t}

    needle = role_name.lower().strip()
    needle_words = _tokenize(role_name)

    for tag in job_roles:
        tag_lower = tag.lower().strip()
        tag_words = _tokenize(tag)

        # Tier 1: exact
        if tag_lower == needle:
            return True
        # Tier 2: substring (normalise hyphens to spaces for comparison)
        needle_norm = _re.sub(r'[\-_]', ' ', needle)
        tag_norm = _re.sub(r'[\-_]', ' ', tag_lower)
        if tag_norm in needle_norm or needle_norm in tag_norm:
            return True
        # Tier 3: word-token overlap (≥50% of shorter set's words present in longer)
        if needle_words and tag_words:
            shorter = needle_words if len(needle_words) <= len(tag_words) else tag_words
            longer = tag_words if shorter is needle_words else needle_words
            overlap = shorter & longer
            if len(overlap) / len(shorter) >= 0.5:
                return True
    return False


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/sets", response_model=List[QuestionSetResponse])
@limiter.limit("60/minute")
def list_question_sets(
    request: Request, round_type: Optional[str] = Query(None, description="Filter by round_type"),
    job_role: Optional[str] = Query(None, description="Fuzzy-match against job_roles tags"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_hr),
    tenant_ctx: TenantContext = Depends(get_tenant_context),
):
    """List all question sets, optionally filtered by round_type and/or job_role, scoped to active tenant."""
    try:
        _ensure_question_sets_table(db)
        
        # Initialize the query object scoped to active tenant or shared system sets
        qs = db.query(QuestionSet).filter(
            or_(QuestionSet.tenant_id == tenant_ctx.id, QuestionSet.tenant_id == None)
        )
        
        if round_type:
            qs = qs.filter(QuestionSet.round_type == round_type)
        sets = qs.order_by(QuestionSet.created_at.desc()).all()

        logger.info(
            f"[Repository] list_question_sets: round_type={round_type!r} job_role={job_role!r} "
            f"total_before_role_filter={len(sets)}"
        )

        if job_role:
            sets = [
                s for s in sets
                if _fuzzy_match(job_role, _parse_json_field(s.job_roles, []))
            ]
            logger.info(f"[Repository] after fuzzy role filter: {len(sets)} set(s) matched")

        result = []
        for s in sets:
            try:
                questions = _parse_json_field(s.questions, [])
                result.append(QuestionSetResponse(
                    id=s.id,
                    title=s.title,
                    round_type=s.round_type,
                    job_roles=_parse_json_field(s.job_roles, []),
                    question_count=len(questions),
                    topic_tags=_parse_json_field(s.topic_tags, []),
                ))
            except Exception as row_err:
                logger.warning(f"[Repository] Skipping corrupt question set ID={s.id}: {row_err}")

        logger.info(f"[Repository] returning {len(result)} set(s) to client")
        return result

    except Exception as e:
        import traceback
        error_msg = f"[Repository] CRITICAL: Error in list_question_sets: {str(e)}\n{traceback.format_exc()}"
        logger.error(error_msg)
        raise HTTPException(
            status_code=500, 
            detail="Failed to load question sets due to an internal server error. Please try again later."
        )




@router.get("/sets/{set_id}", response_model=QuestionSetDetail)
@limiter.limit("60/minute")
def get_question_set(
    request: Request, set_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_hr),
    tenant_ctx: TenantContext = Depends(get_tenant_context),
):
    _ensure_question_sets_table(db)
    s = db.query(QuestionSet).filter(QuestionSet.id == set_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Question set not found.")
    validate_tenant_ownership(s, tenant_ctx, resource_name="question set")
    return QuestionSetDetail(
        id=s.id,
        title=s.title,
        round_type=s.round_type,
        job_roles=_parse_json_field(s.job_roles, []),
        question_count=len(_parse_json_field(s.questions, [])),
        topic_tags=_parse_json_field(s.topic_tags, []),
        questions=_parse_json_field(s.questions, []),
    )


@router.post("/sets", response_model=QuestionSetResponse, status_code=201)
@limiter.limit("30/minute")
def create_question_set(
    request: Request, payload: QuestionSetCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_hr),
    tenant_ctx: TenantContext = Depends(get_tenant_context),
):
    if payload.round_type not in ("aptitude", "technical", "behavioural"):
        raise HTTPException(status_code=400, detail="round_type must be aptitude, technical, or behavioural.")
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="title is required.")
    if not payload.questions:
        raise HTTPException(status_code=400, detail="questions list cannot be empty.")

    _ensure_question_sets_table(db)

    from sqlalchemy import func
    
    # Check for duplicate title within the active tenant
    existing = db.query(QuestionSet).filter(
        func.lower(QuestionSet.title) == payload.title.strip().lower(),
        QuestionSet.tenant_id == tenant_ctx.id
    ).first()
    if existing:
        raise HTTPException(
            status_code=400, 
            detail=f"A question set with title '{payload.title.strip()}' already exists (as {existing.round_type} set)."
        )


    s = QuestionSet(
        title=payload.title.strip(),
        round_type=payload.round_type,
        job_roles=json.dumps(payload.job_roles),
        questions=json.dumps(payload.questions),
        topic_tags=json.dumps(payload.topic_tags),
        hr_id=current_user.id,
        tenant_id=tenant_ctx.id,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return QuestionSetResponse(
        id=s.id,
        title=s.title,
        round_type=s.round_type,
        job_roles=payload.job_roles,
        question_count=len(payload.questions),
        topic_tags=payload.topic_tags,
    )


@router.put("/sets/{set_id}", response_model=QuestionSetResponse)
@limiter.limit("60/minute")
def update_question_set(
    request: Request, set_id: int,
    payload: QuestionSetCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_hr),
    tenant_ctx: TenantContext = Depends(get_tenant_context),
):
    query = db.query(QuestionSet).filter(QuestionSet.id == set_id)
    s = query.first()
    if not s:
        raise HTTPException(status_code=404, detail="Question set not found.")
    validate_tenant_ownership(s, tenant_ctx, resource_name="question set")
    if payload.round_type not in ("aptitude", "technical", "behavioural"):
        raise HTTPException(status_code=400, detail="round_type must be aptitude, technical, or behavioural.")

    _ensure_question_sets_table(db)
    
    from sqlalchemy import func

    # Check for duplicate title within the active tenant
    existing = db.query(QuestionSet).filter(
        func.lower(QuestionSet.title) == payload.title.strip().lower(),
        QuestionSet.tenant_id == tenant_ctx.id,
        QuestionSet.id != set_id
    ).first()
    if existing:
        raise HTTPException(
            status_code=400, 
            detail=f"Another question set with title '{payload.title.strip()}' already exists (as {existing.round_type} set)."
        )

    s.title = payload.title.strip()
    s.round_type = payload.round_type
    s.job_roles = json.dumps(payload.job_roles)
    s.questions = json.dumps(payload.questions)
    s.topic_tags = json.dumps(payload.topic_tags)
    db.commit()
    db.refresh(s)
    questions = _parse_json_field(s.questions, [])
    return QuestionSetResponse(
        id=s.id,
        title=s.title,
        round_type=s.round_type,
        job_roles=payload.job_roles,
        question_count=len(questions),
        topic_tags=payload.topic_tags,
    )


@router.delete("/sets/{set_id}", status_code=204)
@limiter.limit("60/minute")
def delete_question_set(
    request: Request, set_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_hr),
    tenant_ctx: TenantContext = Depends(get_tenant_context),
):
    query = db.query(QuestionSet).filter(QuestionSet.id == set_id)
    s = query.first()
    if not s:
        raise HTTPException(status_code=404, detail="Question set not found.")
    validate_tenant_ownership(s, tenant_ctx, resource_name="question set")
    db.delete(s)
    db.commit()
