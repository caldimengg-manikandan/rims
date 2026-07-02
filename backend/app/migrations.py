"""
Startup migration helper - safely adds missing columns to existing tables.
Works with both SQLite and PostgreSQL.
Called from main.py AFTER Base.metadata.create_all().
"""
import logging
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.domain.constants import CandidateState
from app.infrastructure.database import Base

logger = logging.getLogger(__name__)


_REQUIRED_COLUMNS = [
    ("users", "imap_email", "VARCHAR(255)"),
    ("users", "imap_password", "TEXT"),
    ("users", "auto_sync_enabled", "BOOLEAN DEFAULT FALSE"),
    ("attachment_resumes", "hr_id", "INTEGER REFERENCES users(id) ON DELETE CASCADE"),
    ("jobs", "aptitude_questions_file", "VARCHAR(500)"),
    ("applications", "resume_file_path", "VARCHAR(500)"),
    ("jobs", "job_id", "VARCHAR(50)"),
    ("interview_questions", "question_options", "TEXT"),
    ("interview_questions", "correct_option", "INTEGER"),
    ("resume_extractions", "summary", "TEXT"),
    ("jobs", "interview_token", "VARCHAR(50)"),
    ("interviews", "test_id", "VARCHAR(50)"),
    # Resume parsing lifecycle tracking (HR gating + retry UI)
    ("applications", "resume_status", "VARCHAR(32) DEFAULT 'pending'"),
    ("applications", "resume_score", "FLOAT"),
    ("applications", "aptitude_score", "FLOAT"),
    ("applications", "interview_score", "FLOAT"),
    ("applications", "composite_score", "FLOAT"),
    ("applications", "recommendation", "VARCHAR(50)"),
    # Resume parsing persistence fields (may be missing on legacy DBs)
    ("applications", "candidate_phone_raw", "TEXT"),
    ("applications", "resume_file_name", "VARCHAR(255)"),
    ("applications", "candidate_photo_path", "TEXT"),
    ("applications", "hr_notes", "TEXT"),
    ("applications", "hr_id", "INTEGER REFERENCES users(id)"),
    ("interview_answers", "ai_used", "BOOLEAN DEFAULT FALSE"),
    ("interview_answers", "fallback_used", "BOOLEAN DEFAULT FALSE"),
    ("interview_answers", "confidence_score", "FLOAT"),
    ("interview_reports", "ai_used", "BOOLEAN DEFAULT FALSE"),
    ("interview_reports", "fallback_used", "BOOLEAN DEFAULT FALSE"),
    ("interview_reports", "confidence_score", "FLOAT"),
    # Onboarding
    ("applications", "notification_sent", "BOOLEAN DEFAULT FALSE"),
    ("applications", "email_sent_at", "TIMESTAMP"),
    ("applications", "email_status", "VARCHAR(20) DEFAULT 'pending'"),
    # Missing ResumeExtraction columns
    ("resume_extractions", "candidate_name", "VARCHAR(255)"),
    ("resume_extractions", "email", "VARCHAR(255)"),
    ("resume_extractions", "phone_number", "VARCHAR(50)"),
    ("resume_extractions", "reasoning", "TEXT"), # Cast to JSONB happens in models/postgres if column exists
    # Missing Interview columns
    ("interviews", "current_difficulty", "VARCHAR(20) DEFAULT 'medium'"),
    ("users", "password_changed_at", "TIMESTAMP"),
    ("interviews", "questions_asked", "INTEGER DEFAULT 0"),
    ("interviews", "total_questions", "INTEGER DEFAULT 20"),
    ("interviews", "locked_skill", "VARCHAR(50)"),
    ("interviews", "started_at", "TIMESTAMP"),
    ("interviews", "completed_at", "TIMESTAMP"),
    ("interviews", "termination_reason", "VARCHAR(100)"),
    ("interviews", "report_generated", "BOOLEAN DEFAULT FALSE"),
    ("interviews", "candidate_id", "INTEGER REFERENCES users(id)"),
    # Repository question set FK columns on jobs — plain INTEGER first, FK added after table exists
    ("jobs", "aptitude_repo_set_id", "INTEGER"),
    ("jobs", "technical_repo_set_id", "INTEGER"),
    ("jobs", "behavioural_repo_set_id", "INTEGER"),
    # Email inbox edge cases fix - retry tracking
    ("attachment_resumes", "retry_count", "INTEGER DEFAULT 0"),
    ("attachment_resumes", "last_error", "TEXT"),
    ("attachment_resumes", "mapping_failed", "BOOLEAN DEFAULT FALSE"),
    # OTP brute-force protection (added after initial schema)
    ("users", "otp_attempt_count", "INTEGER NOT NULL DEFAULT 0"),
    ("users", "otp_locked_until", "TIMESTAMP WITH TIME ZONE"),
    # Disposable email detection
    ("applications", "is_disposable_email", "BOOLEAN DEFAULT FALSE"),
    # Enterprise Proctoring Extensions
    ("interview_monitoring_events", "is_false_positive", "BOOLEAN DEFAULT FALSE"),
    ("interview_monitoring_events", "details", "TEXT"),
    ("interviews", "risk_score", "FLOAT DEFAULT 0.0"),
    ("interviews", "is_terminated_by_violations", "BOOLEAN DEFAULT FALSE"),
    ("interviews", "active_session_jti", "VARCHAR(50)"),
    # Demo-mode provisional flag — deleted on failure, persisted on success
    ("interviews", "is_demo", "BOOLEAN DEFAULT FALSE"),
]


def _safe_rollback(conn) -> None:
    """Clear aborted transactions so later migrations can continue."""
    try:
        conn.rollback()
    except Exception:
        pass


def column_exists(conn, table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table (PostgreSQL/SQLite compatible)."""
    # Use inspector for broad compatibility
    from sqlalchemy import inspect
    inspector = inspect(conn)
    if table_name not in inspector.get_table_names():
        return False
    columns = [c["name"] for c in inspector.get_columns(table_name)]
    return column_name in columns


def update_role_constraint(conn):
    """Safely update the role constraint to include 'pending_hr', 'super_admin' and 'candidate'."""
    try:
        # Check if we are on PostgreSQL
        if "postgresql" in str(conn.engine.url):
            conn.execute(text("ALTER TABLE users DROP CONSTRAINT IF EXISTS check_users_role"))
            conn.execute(text("""
                ALTER TABLE users ADD CONSTRAINT check_users_role 
                CHECK (role IN ('super_admin', 'hr', 'pending_hr', 'candidate'))
            """))
            logger.info("Migration completed: updated check_users_role constraint")
        else:
            logger.info("Skipping constraint update: not on PostgreSQL")
    except Exception as exc:
        logger.warning(f"Migration failed to update role constraint: {exc}")


def run_startup_migrations(engine: Engine):
    """Check for missing columns and add them safely using PostgreSQL-friendly DDL."""
    inspector = inspect(engine)

    # 0. Create question_sets table FIRST — must exist before FK columns on jobs are added
    with engine.connect() as conn:
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS question_sets (
                    id SERIAL PRIMARY KEY,
                    title VARCHAR(255) NOT NULL,
                    round_type VARCHAR(50) NOT NULL,
                    job_roles TEXT,
                    questions TEXT NOT NULL DEFAULT '[]',
                    topic_tags TEXT,
                    hr_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.commit()
            logger.info("Ensured question_sets table exists")
        except Exception as e:
            _safe_rollback(conn)
            logger.warning(f"Failed to create question_sets table: {e}")

    # 0b. Create revoked_tokens table
    with engine.connect() as conn:
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS revoked_tokens (
                    id SERIAL PRIMARY KEY,
                    jti VARCHAR(255) UNIQUE NOT NULL,
                    expires_at TIMESTAMP NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.commit()
            
            # Create explicit index on jti
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_revoked_tokens_jti ON revoked_tokens(jti)"))
            conn.commit()
            
            # Clean up expired revoked tokens from the database on startup
            from app.core.timezone import get_ist_now
            conn.execute(
                text("DELETE FROM revoked_tokens WHERE expires_at < :now"),
                {"now": get_ist_now()}
            )
            conn.commit()
            logger.info("Ensured revoked_tokens table exists with index and cleaned up expired tokens")
        except Exception as e:
            _safe_rollback(conn)
            logger.warning(f"Failed to setup/cleanup revoked_tokens table: {e}")

    # Refresh inspector after table creation
    inspector = inspect(engine)

    # 1. Ensure columns exist first
    with engine.connect() as conn:
        for table, column, col_type in _REQUIRED_COLUMNS:
            if table not in inspector.get_table_names():
                logger.info(f"Skipping column {column} — table {table} does not exist yet.")
                continue
            
            try:
                # Check existence to provide better logging
                if not column_exists(conn, table, column):
                    logger.info(f"Applying migration: Adding column {table}.{column} ({col_type})...")
                    # PostgreSQL supports 'IF NOT EXISTS' for columns, but SQLite does not.
                    if "postgresql" in str(conn.engine.url):
                        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {col_type}"))
                    else:
                        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))
                    conn.commit()
                    logger.info(f"Migration SUCCESS: Column {table}.{column} added.")
                else:
                    logger.debug(f"Column {table}.{column} already exists.")
            except Exception as e:
                _safe_rollback(conn)
                logger.error(f"Migration FAILED for {table}.{column}: {e}")
                # For critical updates, we might want to raise, but for baseline, we log and continue
                # unless it's a manual migration script.

        # Ensure approval_status exists on users (crucial for HR flow)
        try:
            if not column_exists(conn, "users", "approval_status"):
                if "postgresql" in str(engine.url):
                    conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) DEFAULT 'pending'"))
                else:
                    conn.execute(text("ALTER TABLE users ADD COLUMN approval_status VARCHAR(20) DEFAULT 'pending'"))
                conn.commit()
                logger.info("Ensured users.approval_status exists")
        except Exception as e:
            _safe_rollback(conn)
            logger.warning(f"Failed to add users.approval_status: {e}")

        # Backfill resume_status from existing resume_extractions (metadata sync)
        try:
            if (
                column_exists(conn, "applications", "resume_status")
                and "resume_extractions" in inspector.get_table_names()
            ):
                conn.execute(text("""
                    UPDATE applications
                    SET resume_status = 'parsed'
                    WHERE (resume_status = 'pending' OR resume_status IS NULL)
                      AND EXISTS (
                        SELECT 1
                        FROM resume_extractions re
                        WHERE re.application_id = applications.id
                      )
                """))
                conn.commit()
                logger.info("Backfilled applications.resume_status from resume_extractions")
        except Exception as e:
            _safe_rollback(conn)
            logger.warning(f"Failed to backfill applications.resume_status: {e}")

        # 1c. Data migration for legacy states
        try:
            conn.execute(text("""
                UPDATE applications SET status = 
                    CASE 
                        WHEN status = 'accepted' THEN 'offer_accepted'
                        WHEN status IN ('hired', 'pending_approval') THEN 'interview_completed'
                        WHEN status IN ('aptitude_round', 'ai_interview', 'in_progress') THEN 'interview_scheduled'
                        WHEN status = 'permanent_failure' THEN 'rejected'
                        ELSE status 
                    END
                WHERE status IN ('accepted', 'hired', 'pending_approval', 'aptitude_round', 'ai_interview', 'in_progress', 'permanent_failure')
            """))
            conn.commit()
            logger.info("Migrated legacy application states to canonical states")
        except Exception as e:
            _safe_rollback(conn)
            logger.warning(f"Failed to migrate legacy states: {e}")

        # 1d. Ensure status constraint strictly enforces the 11 canonical states
        try:
            if "postgresql" in str(engine.url):
                conn.execute(text("ALTER TABLE applications DROP CONSTRAINT IF EXISTS check_applications_status"))
                conn.execute(text("""
                    ALTER TABLE applications ADD CONSTRAINT check_applications_status 
                    CHECK (status IN ('applied', 'screened', 'interview_scheduled', 'interview_completed', 'review_later', 'physical_interview', 'offer_sent', 'offer_accepted', 'offer_rejected', 'onboarded', 'rejected'))
                """))
                conn.commit()
                logger.info("Updated check_applications_status constraint")
        except Exception as e:
            _safe_rollback(conn)
            logger.warning(f"Failed to update application status constraint: {e}")

        # 1cd. CRIT-03 Migration: set candidate_phone_normalized and candidate_phone_raw to NULL for privacy/data minimization
        try:
            if column_exists(conn, "applications", "candidate_phone_normalized"):
                conn.execute(text("UPDATE applications SET candidate_phone_normalized = NULL WHERE candidate_phone_normalized IS NOT NULL"))
                conn.commit()
                logger.info("Cleared candidate_phone_normalized from all applications (CRIT-03 data minimization).")
            if column_exists(conn, "applications", "candidate_phone_raw"):
                conn.execute(text("UPDATE applications SET candidate_phone_raw = NULL WHERE candidate_phone_raw IS NOT NULL"))
                conn.commit()
                logger.info("Cleared candidate_phone_raw from all applications (MED-06 data minimization).")
        except Exception as e:
            _safe_rollback(conn)
            logger.warning(f"Failed to clear plaintext phone numbers: {e}")

        # 1d. Create global_settings table if not exists
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS global_settings (
                    id SERIAL PRIMARY KEY,
                    key VARCHAR(100) UNIQUE NOT NULL,
                    value TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.commit()
            logger.info("Ensured global_settings table exists")
            
            # 0.1 Clean up deprecated columns
            if "postgresql" in str(conn.engine.url):
                try:
                    conn.execute(text("ALTER TABLE interview_answers DROP COLUMN IF EXISTS clarity_score"))
                    conn.execute(text("ALTER TABLE interview_answers DROP COLUMN IF EXISTS practicality_score"))
                    logger.info("Migration completed: dropped deprecated columns clarity_score, practicality_score")
                except Exception as e:
                    logger.warning(f"Failed to drop deprecated columns: {e}")
        except Exception as e:
            _safe_rollback(conn)
            logger.warning(f"Failed to create global_settings table: {e}")

        # 1.1 Extract Offers and Onboarding (Issue 5.1 Migration)
        # IDEMPOTENT: checks whether legacy offer columns still exist in `applications`
        # before attempting the data-copy. On subsequent deploys the columns are already
        # gone, so this block is a no-op (safe to run every startup).
        if "postgresql" in str(conn.engine.url):
            try:
                # Only run the data-copy if the legacy `offer_sent` column is still
                # present in `applications` (i.e. the migration hasn't run yet).
                if column_exists(conn, "applications", "offer_sent"):
                    logger.info("Migration 5.1: legacy offer columns found in applications — running normalization.")
                    
                    offer_cols = [
                        ("offer_sent", "FALSE::boolean"),
                        ("offer_sent_date", "NULL::timestamp"),
                        ("offer_approval_status", "'pending'::varchar(20)"),
                        ("offer_approved_by", "NULL::integer"),
                        ("offer_approved_at", "NULL::timestamp"),
                        ("offer_response_status", "'pending'::varchar(20)"),
                        ("offer_response_date", "NULL::timestamp"),
                        ("offer_token", "NULL::varchar(100)"),
                        ("offer_short_id", "NULL::varchar(20)"),
                        ("offer_token_expiry", "NULL::timestamp with time zone"),
                        ("offer_token_used", "FALSE::boolean"),
                        ("offer_template_snapshot", "NULL::text"),
                        ("offer_pdf_path", "NULL::varchar(500)"),
                        ("offer_accepted_ip", "NULL::varchar(50)"),
                        ("offer_accepted_user_agent", "NULL::text"),
                        ("offer_email_status", "'pending'::varchar(20)"),
                        ("offer_email_retry_count", "0::integer"),
                        ("reminder_sent_at", "NULL::timestamp"),
                    ]
                    
                    select_exprs = ["id"]
                    for col, default_sql in offer_cols:
                        if column_exists(conn, "applications", col):
                            select_exprs.append(col)
                        else:
                            select_exprs.append(f"{default_sql} as {col}")
                    
                    cols_list = ", ".join([col for col, _ in offer_cols])
                    select_list = ", ".join(select_exprs)
                    
                    # Insert missing Offer records for all Applications
                    conn.execute(text(f"""
                        INSERT INTO offers (application_id, {cols_list})
                        SELECT {select_list}
                        FROM applications
                        ON CONFLICT (application_id) DO NOTHING
                    """))

                    # Insert missing Onboarding records for all Applications
                    if column_exists(conn, "applications", "joining_date"):
                        emp_col = "employee_id" if column_exists(conn, "applications", "employee_id") else "NULL::varchar(50) as employee_id"
                        card_col = "id_card_url" if column_exists(conn, "applications", "id_card_url") else "NULL::varchar(500) as id_card_url"
                        onb_col = "onboarded_at" if column_exists(conn, "applications", "onboarded_at") else "NULL::timestamp as onboarded_at"
                        
                        conn.execute(text(f"""
                            INSERT INTO onboardings (application_id, joining_date, employee_id, id_card_url, onboarded_at)
                            SELECT id, joining_date, {emp_col}, {card_col}, {onb_col}
                            FROM applications
                            ON CONFLICT (application_id) DO NOTHING
                        """))

                    # Drop legacy columns from applications
                    cols_to_drop = [
                        "offer_sent", "offer_sent_date", "offer_approval_status", "offer_approved_by", "offer_approved_at",
                        "offer_response_status", "offer_response_date", "offer_token", "offer_short_id", "offer_token_expiry",
                        "offer_token_used", "offer_template_snapshot", "offer_pdf_path", "offer_accepted_ip", "offer_accepted_user_agent",
                        "offer_email_status", "offer_email_retry_count", "reminder_sent_at",
                        "joining_date", "employee_id", "id_card_url", "onboarded_at", "onboarding_approval_status"
                    ]
                    for col in cols_to_drop:
                        conn.execute(text(f"ALTER TABLE applications DROP COLUMN IF EXISTS {col}"))
                    conn.commit()
                    logger.info("Migration completed: 5.1 Application table normalization successful")
                else:
                    logger.debug("Migration 5.1: skipped (already applied — offer columns not in applications).")
            except Exception as e:
                _safe_rollback(conn)
                logger.error(f"Migration error during 5.1 table normalization: {e}")

        # 1.2 Ensure offers.offer_preview_count exists (added to model after initial SQL schema)
        if "postgresql" in str(conn.engine.url):
            try:
                conn.execute(text(
                    "ALTER TABLE offers ADD COLUMN IF NOT EXISTS offer_preview_count INTEGER NOT NULL DEFAULT 0"
                ))
                conn.commit()
                logger.debug("Ensured offers.offer_preview_count column exists")
            except Exception as e:
                _safe_rollback(conn)
                logger.warning(f"Failed to add offers.offer_preview_count: {e}")

        # 1e. (question_sets table is created in step 0 above)

        # 1f. Ensure interview_feedbacks table exists (added after initial DB creation)
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS interview_feedbacks (
                    id SERIAL PRIMARY KEY,
                    interview_id INTEGER NOT NULL UNIQUE REFERENCES interviews(id) ON DELETE CASCADE,
                    ui_ux_rating INTEGER,
                    feedback_text TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.commit()
            logger.info("Ensured interview_feedbacks table exists")
        except Exception as e:
            _safe_rollback(conn)
            logger.warning(f"Failed to create interview_feedbacks table: {e}")

    # 2. Update Role Constraints
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE users DROP CONSTRAINT IF EXISTS check_users_role"))
            conn.execute(text("""
                ALTER TABLE users ADD CONSTRAINT check_users_role 
                CHECK (role IN ('super_admin', 'hr', 'pending_hr', 'candidate'))
            """))
            conn.commit()
            logger.info("Updated check_users_role constraint")
        except Exception as exc:
            _safe_rollback(conn)
            logger.warning(f"Error updating role constraint: {exc}")

    # 3. Data normalization and Super Admin promotion
    with engine.connect() as conn:
        if column_exists(conn, "users", "approval_status"):
            try:
                # Normalize legacy roles
                conn.execute(text("""
                    UPDATE users
                    SET role = CASE
                        WHEN role IN ('admin', 'hr_manager', 'recruiter') AND approval_status = 'approved' THEN 'hr'
                        WHEN role IN ('admin', 'hr_manager', 'recruiter', 'hr') AND approval_status != 'approved' THEN 'pending_hr'
                        ELSE role
                    END
                    WHERE role NOT IN ('super_admin', 'candidate')
                """))
                
                # Promote specific user to super_admin
                from app.core.config import get_settings
                settings = get_settings()
                admin_email = (settings.super_admin_email or '').lower().strip()
                if admin_email:
                    conn.execute(text("""
                        UPDATE users 
                        SET role = 'super_admin', approval_status = 'approved'
                        WHERE email = :email
                    """), {"email": admin_email})
                else:
                    logger.warning("No super_admin_email configured. Skipping database super_admin role promotion.")
                
                # Ensure existing staff are approved
                conn.execute(text("""
                    UPDATE users 
                    SET approval_status = 'approved' 
                    WHERE role IN ('super_admin', 'hr') AND approval_status IS NULL
                """))
                
                conn.commit()
                logger.info("Migration completed: normalized roles and promoted super admin")
            except Exception as exc:
                _safe_rollback(conn)
                logger.warning(f"Migration failed to normalize roles: {exc}")
        
        # Populate Application.hr_id
        try:
            if column_exists(conn, "applications", "hr_id") and column_exists(conn, "jobs", "hr_id"):
                conn.execute(text("""
                    UPDATE applications
                    SET hr_id = (SELECT hr_id FROM jobs WHERE jobs.id = applications.job_id)
                    WHERE hr_id IS NULL
                """))
                conn.commit()
                logger.info("Migration completed: populated Application.hr_id")
        except Exception as exc:
            _safe_rollback(conn)
            logger.warning(f"Migration failed to populate hr_id: {exc}")

    # 4. Constraints/Indexes
    required_constraints = [
        (
            "applications",
            "uq_application_job_email",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_application_job_email ON applications(job_id, candidate_email)",
        ),
        (
            "interview_answers",
            "uq_answer_per_question",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_answer_per_question ON interview_answers(question_id)",
        ),
        (
            "interviews",
            "uq_interview_application_id",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_interview_application_id ON interviews(application_id)",
        ),
        (
            "applications",
            "ix_applications_candidate_email",
            "CREATE INDEX IF NOT EXISTS ix_applications_candidate_email ON applications(candidate_email)",
        ),
    ]

    with engine.connect() as conn:
        try:
            if "postgresql" in str(engine.url):
                conn.execute(text("ALTER TABLE applications ALTER COLUMN candidate_email SET NOT NULL"))
                conn.commit()
                logger.info("Migration completed: applications.candidate_email set to NOT NULL")
        except Exception as exc:
            _safe_rollback(conn)
            logger.warning(f"Error setting candidate_email NOT NULL: {exc}")

    with engine.connect() as conn:
        for table, constraint_name, create_sql in required_constraints:
            if table not in inspector.get_table_names():
                continue
            try:
                conn.execute(text(create_sql))
                conn.commit()
                logger.info(f"Migration completed: ensured index {constraint_name}")
            except Exception as exc:
                _safe_rollback(conn)
                logger.warning(f"Migration skipped index {constraint_name}: {exc}")

    # 5. Encrypt legacy plaintext values and enforce decryption checks
    try:
        encrypt_existing_plaintext_data(engine)
    except Exception as exc:
        logger.error(f"Failed to encrypt existing plaintext values: {exc}")


def encrypt_existing_plaintext_data(engine: Engine):
    """
    Finds all columns in the DB defined with EncryptedText and encrypts them
    if they contain plaintext data. Bypasses SQLAlchemy ORM decryption to prevent
    redundant updates and infinite migration loops on startup.
    """
    from app.core.encryption import is_encrypted, encrypt_field
    from app.infrastructure.database import Base
    from sqlalchemy import text
    
    with engine.connect() as conn:
        for mapper in Base.registry.mappers:
            cls = mapper.class_
            if not hasattr(cls, '__tablename__'):
                continue
            tablename = cls.__tablename__
            encrypted_cols = []
            for col in mapper.columns:
                if hasattr(col.type, '__class__') and col.type.__class__.__name__ == 'EncryptedText':
                    encrypted_cols.append(col.name)
            
            if not encrypted_cols:
                continue
                
            # C-10: Sanitize SQL by validating against known metadata to prevent injection
            if tablename not in Base.metadata.tables:
                logger.warning(f"Skipping unknown table '{tablename}' during encryption migration.")
                continue

            logger.info(f"Checking table '{tablename}' for legacy plaintext values in columns: {encrypted_cols}")
            for col_name in encrypted_cols:
                # Double check col_name is valid for this table
                if col_name not in Base.metadata.tables[tablename].columns:
                    logger.warning(f"Skipping unknown column '{col_name}' in table '{tablename}'.")
                    continue
                
                try:
                    # Select raw database values without ORM decryption
                    # SQL interpolation is safe here because both tablename and col_name are verified against metadata
                    result = conn.execute(text(f"SELECT id, {col_name} FROM {tablename} WHERE {col_name} IS NOT NULL"))
                    rows = result.fetchall()
                    
                    updates = []
                    for row_id, raw_val in rows:
                        if raw_val and not is_encrypted(raw_val):
                            logger.info(f"Encrypting legacy plaintext value for {tablename}.{col_name} (id={row_id})")
                            encrypted_val = encrypt_field(raw_val)
                            updates.append((encrypted_val, row_id))
                    
                    if updates:
                        # Perform bulk update
                        # SQL interpolation is safe here because both tablename and col_name are verified against metadata
                        for encrypted_val, row_id in updates:
                            conn.execute(
                                text(f"UPDATE {tablename} SET {col_name} = :val WHERE id = :id"),
                                {"val": encrypted_val, "id": row_id}
                            )
                        conn.commit()
                        logger.info(f"Successfully migrated {len(updates)} legacy plaintext rows in '{tablename}.{col_name}'")
                except Exception as table_err:
                    conn.rollback()
                    logger.error(f"Error checking/migrating table '{tablename}.{col_name}': {table_err}")
        
    # Enforcement of strict encryption on read is controlled by the ENFORCE_ENCRYPTION
    # setting in app config (get_settings().enforce_encryption). The old pattern of
    # mutating 'encryption.ENFORCE_ENCRYPTION = True' here was removed in the hardening
    # refactor because each gunicorn worker has independent memory, so only worker-0
    # ever saw the effect. Now all workers read consistently from settings.
    logger.info("EncryptedText column validation/migration complete.")


def validate_enum_parity(engine: Engine):
    """
    Verify that the CandidateState enum in code matches the DB constraint.
    """
    from sqlalchemy import inspect, text
    inspector = inspect(engine)
    
    # We only check this on PostgreSQL
    if "postgresql" not in str(engine.url):
        return

    expected_states = {s.value for s in CandidateState}
    
    with engine.connect() as conn:
        try:
            # Query the constraint from PG catalog
            result = conn.execute(text("""
                SELECT conkey, pg_get_constraintdef(oid) 
                FROM pg_constraint 
                WHERE conname = 'check_applications_status'
            """)).fetchone()
            
            if result:
                def_str = result[1]
                # Extract values from "CHECK (status IN ('state1', 'state2'))"
                import re
                found_states = set(re.findall(f"'(.*?)'", def_str))
                
                missing = expected_states - found_states
                if missing:
                    error_msg = f"CRITICAL ENUM MISMATCH: Database constraint 'check_applications_status' is missing states: {missing}"
                    logger.warning(error_msg)
            else:
                logger.warning("Constraint 'check_applications_status' not found for verification.")
        except Exception as e:
            logger.warning(f"Enum parity check skipped/failed: {e}")

def validate_required_columns(engine: Engine):
    """
    Validation-only check that stops app startup if critical columns are missing.
    Does NOT attempt to migrate.
    """
    from sqlalchemy import inspect
    inspector = inspect(engine)
    
    # Critical columns that MUST exist for the app to function safely
    CRITICAL = [
        ("applications", "email_sent_at"),
        ("applications", "email_status"),
        ("applications", "resume_status"),
        ("interviews", "test_id"),
    ]
    
    missing = []
    with engine.connect() as conn:
        for table, col in CRITICAL:
            if not column_exists(conn, table, col):
                missing.append(f"{table}.{col}")
    
    if missing:
        error_msg = (
            f"CRITICAL DATABASE ERROR: The following columns are missing from the database: {', '.join(missing)}. "
            "Apply the latest SQL from supabase/migrations/ in the Supabase SQL Editor "
            "(see CLIENT_SETUP_GUIDE.md and setup/production_schema.sql for new projects)."
        )
        logger.critical(error_msg)
        raise RuntimeError(error_msg)
    
    # Run enum parity check
    validate_enum_parity(engine)
    
    logger.info("Database schema and Enum validation passed.")
