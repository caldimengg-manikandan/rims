"""
Database session factory and utilities.

Provides:
  - SQLAlchemy engine + SessionLocal factory
  - get_db()           : FastAPI dependency that yields a session with tenant GUC set
  - set_db_identity()  : Sets app.current_user_id PostgreSQL session variable (existing)
  - set_tenant_context(): Sets app.current_tenant_id PostgreSQL session variable (new)

Multi-tenancy note
------------------
Every database session checks out from the pool must broadcast the active
tenant UUID to PostgreSQL before any DML/DQL, so that the RLS policy
``current_tenant_id()`` can filter rows correctly.

We use ``SET LOCAL`` (``is_local=True`` in psycopg parlance), which scopes
the GUC to the current *transaction* and automatically resets it when the
transaction ends.  This prevents stale tenant IDs from leaking across
connection-pool reuse — a critical correctness guarantee for shared-schema
multi-tenancy.
"""
from __future__ import annotations

import logging
from typing import Optional
import uuid

from sqlalchemy import create_engine, event, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session

from app.core.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------
db_echo = False if settings.env == "production" else settings.debug

db_url = settings.database_url or "sqlite:///./rims.db"

if db_url.startswith("sqlite"):
    engine = create_engine(
        db_url,
        connect_args={"check_same_thread": False} if "sqlite" in db_url else {},
        echo=db_echo,
    )
else:
    # PgBouncer detection: standard port is 6543 or we can check port/key in URL
    is_pgbouncer = "6543" in db_url or "pgbouncer" in db_url.lower()
    if is_pgbouncer:
        p_size = settings.db_pool_size if settings.db_pool_size is not None else 5
        m_overflow = settings.db_max_overflow if settings.db_max_overflow is not None else 10
    else:
        p_size = settings.db_pool_size if settings.db_pool_size is not None else 10
        m_overflow = settings.db_max_overflow if settings.db_max_overflow is not None else 20

    engine = create_engine(
        db_url,
        pool_pre_ping=True,
        pool_size=p_size,
        max_overflow=m_overflow,
        pool_recycle=300,    # Recycle connections every 5 minutes (ideal for Supabase/PG poolers)
        echo=db_echo,
    )

# ---------------------------------------------------------------------------
# Session factory + Base
# ---------------------------------------------------------------------------
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


# ---------------------------------------------------------------------------
# RLS helper: set current user id (pre-existing, unchanged)
# ---------------------------------------------------------------------------
def set_db_identity(db: Session, user_id: int) -> None:
    """
    Set PostgreSQL session variable for Row Level Security (RLS).
    Policies in Phase 2 rely on 'app.current_user_id'. (Phase 2 Fix)
    """
    try:
        # RLS is only supported/needed on PostgreSQL (Phase 2 Fix)
        if "postgresql" in str(db.get_bind().url).lower():
            db.execute(text("SET LOCAL app.current_user_id = :uid"), {"uid": str(user_id)})
    except Exception as e:
        logging.getLogger(__name__).warning(f"Failed to set RLS identity: {e}")


# ---------------------------------------------------------------------------
# RLS helper: set tenant context GUC (new)
# ---------------------------------------------------------------------------
def set_tenant_context(db: Session, tenant_id: Optional[uuid.UUID]) -> None:
    """
    Broadcast the active tenant UUID as a transaction-local PostgreSQL GUC.

    The RLS policy ``current_tenant_id()`` reads ``app.current_tenant_id`` to
    decide which rows a connection is allowed to see/write.

    Using ``SET LOCAL`` (transaction-scoped) means the GUC resets automatically
    when the transaction commits or rolls back, preventing stale IDs from
    contaminating the next connection-pool checkout.

    Safe on SQLite (non-op guard) so unit tests using SQLite pass without
    modification.
    """
    try:
        if "postgresql" not in str(db.get_bind().url).lower():
            return   # SQLite / test environments — skip silently
        tid_str = str(tenant_id) if tenant_id else ""
        db.execute(
            text("SELECT set_config('app.current_tenant_id', :tid, true)"),
            {"tid": tid_str},
        )
    except Exception as exc:
        logger.warning("Failed to set tenant GUC: %s", exc)


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------
def get_db():
    """
    Dependency that yields a SQLAlchemy session.

    For PostgreSQL databases, also injects the active tenant UUID as the
    transaction-local GUC ``app.current_tenant_id`` so that RLS policies
    fire correctly for every query executed within this session.
    """
    db = SessionLocal()
    try:
        # Inject tenant GUC at the start of every DB session
        from app.core.tenant_context import get_current_tenant_id
        tid = get_current_tenant_id()
        set_tenant_context(db, tid)
        yield db
    finally:
        db.close()
