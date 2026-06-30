-- setup/production_schema.sql
-- CALRIMS production bootstrap schema (PostgreSQL / Supabase)
-- Aligned with app.domain.models and backend/app/migrations.py (2026-05)
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHEN TO USE THIS FILE
-- ═══════════════════════════════════════════════════════════════════════════
-- ✅ NEW empty Supabase project — paste once in SQL Editor, then deploy backend.
-- ❌ EXISTING live database — do NOT re-run. Use supabase/migrations/ or targeted
--    ALTER statements; backend startup migrations patch missing columns safely.
--
-- After running: deploy the backend once (migrations.py validates on startup).
-- Storage buckets: see CLIENT_SETUP_GUIDE.md §2.3.
-- Kept in sync with: supabase/migrations/20260408204544_initial_schema.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ============================================================================
-- 1. USERS & AUTH
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'candidate',
    is_active BOOLEAN DEFAULT FALSE,
    is_verified BOOLEAN DEFAULT FALSE,
    approval_status VARCHAR(20) DEFAULT 'pending',
    profile_image_url VARCHAR(500),
    otp_code VARCHAR(255),
    otp_expiry TIMESTAMP WITH TIME ZONE,
    login_attempt_count INTEGER NOT NULL DEFAULT 0,
    login_locked_until TIMESTAMP,
    otp_attempt_count INTEGER NOT NULL DEFAULT 0,
    otp_locked_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    password_changed_at TIMESTAMP,
    imap_email VARCHAR(255),
    imap_password TEXT,
    auto_sync_enabled BOOLEAN DEFAULT FALSE,
    CONSTRAINT check_users_role CHECK (
        role IN ('super_admin', 'hr', 'pending_hr', 'candidate')
    ),
    CONSTRAINT check_users_approval_status CHECK (
        approval_status IN ('pending', 'approved', 'rejected')
    )
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_approval_status ON users(approval_status);

-- ============================================================================
-- 2. QUESTION REPOSITORY (before jobs — FK references)
-- ============================================================================
CREATE TABLE IF NOT EXISTS question_bank (
    id SERIAL PRIMARY KEY,
    domain VARCHAR(100),
    role VARCHAR(100),
    difficulty VARCHAR(50),
    question_text TEXT NOT NULL,
    expected_key_points TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_question_bank_domain ON question_bank(domain);
CREATE INDEX IF NOT EXISTS idx_question_bank_role ON question_bank(role);

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
);

CREATE INDEX IF NOT EXISTS idx_question_sets_round_type ON question_sets(round_type);
CREATE INDEX IF NOT EXISTS idx_question_sets_hr_id ON question_sets(hr_id);

CREATE TABLE IF NOT EXISTS global_settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 3. JOBS
-- ============================================================================
CREATE TABLE IF NOT EXISTS jobs (
    id SERIAL PRIMARY KEY,
    job_id VARCHAR(50) UNIQUE,
    interview_token VARCHAR(50) UNIQUE,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    experience_level VARCHAR(50) NOT NULL,
    location VARCHAR(255) DEFAULT 'Remote',
    mode_of_work VARCHAR(50) DEFAULT 'Remote',
    job_type VARCHAR(50) DEFAULT 'Full-Time',
    domain VARCHAR(100) DEFAULT 'Engineering',
    status VARCHAR(50) DEFAULT 'open',
    primary_evaluated_skills TEXT,
    aptitude_enabled BOOLEAN DEFAULT FALSE,
    aptitude_mode VARCHAR(50) DEFAULT 'ai',
    first_level_enabled BOOLEAN DEFAULT FALSE,
    interview_mode VARCHAR(50),
    behavioral_role VARCHAR(50) DEFAULT 'general',
    uploaded_question_file VARCHAR(500),
    aptitude_config TEXT,
    aptitude_questions_file VARCHAR(500),
    aptitude_repo_set_id INTEGER REFERENCES question_sets(id) ON DELETE SET NULL,
    technical_repo_set_id INTEGER REFERENCES question_sets(id) ON DELETE SET NULL,
    behavioural_repo_set_id INTEGER REFERENCES question_sets(id) ON DELETE SET NULL,
    duration_minutes INTEGER DEFAULT 60,
    hr_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP,
    CONSTRAINT check_jobs_status CHECK (status IN ('open', 'closed', 'on_hold'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_hr_id ON jobs(hr_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_title ON jobs(title);

-- ============================================================================
-- 4. APPLICATIONS (core; offer/onboarding data in separate tables)
-- ============================================================================
CREATE TABLE IF NOT EXISTS applications (
    id SERIAL PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    hr_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    candidate_name VARCHAR(255) NOT NULL,
    candidate_email VARCHAR(255),
    candidate_phone TEXT,
    candidate_phone_hash VARCHAR(64),
    candidate_phone_normalized VARCHAR(50),
    candidate_phone_raw TEXT,
    resume_file_path VARCHAR(500),
    resume_file_name VARCHAR(255),
    resume_hash VARCHAR(64),
    candidate_photo_path VARCHAR(500),
    status VARCHAR(50) DEFAULT 'applied',
    resume_status VARCHAR(32) DEFAULT 'pending',
    hr_notes TEXT,
    resume_score FLOAT DEFAULT 0,
    aptitude_score FLOAT DEFAULT 0,
    interview_score FLOAT DEFAULT 0,
    composite_score FLOAT DEFAULT 0,
    recommendation VARCHAR(50),
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    parsing_started_at TIMESTAMP,
    file_status VARCHAR(20) DEFAULT 'active',
    retry_count INTEGER DEFAULT 0,
    failure_reason VARCHAR(1000),
    last_attempt_at TIMESTAMP,
    background_task_id VARCHAR(100),
    scoring_metadata JSONB,
    email_sent_at TIMESTAMP,
    email_status VARCHAR(20) DEFAULT 'pending',
    is_disposable_email BOOLEAN DEFAULT FALSE,
    CONSTRAINT uq_application_job_email UNIQUE (job_id, candidate_email),
    CONSTRAINT uq_application_job_phone_hash UNIQUE (job_id, candidate_phone_hash),
    CONSTRAINT check_applications_status CHECK (
        status IN (
            'applied', 'screened', 'interview_scheduled', 'interview_completed',
            'review_later', 'physical_interview', 'offer_sent', 'offer_accepted',
            'offer_rejected', 'onboarded', 'rejected'
        )
    )
);

CREATE INDEX IF NOT EXISTS idx_applications_job_id ON applications(job_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_resume_status ON applications(resume_status);
CREATE INDEX IF NOT EXISTS idx_applications_job_status ON applications(job_id, status);

-- ============================================================================
-- 5. OFFERS & ONBOARDING (normalized tables)
-- ============================================================================
CREATE TABLE IF NOT EXISTS offers (
    id SERIAL PRIMARY KEY,
    application_id INTEGER NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
    offer_sent BOOLEAN DEFAULT FALSE,
    offer_sent_date TIMESTAMP,
    offer_approval_status VARCHAR(20) DEFAULT 'pending',
    offer_approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    offer_approved_at TIMESTAMP,
    offer_response_status VARCHAR(20) DEFAULT 'pending',
    offer_response_date TIMESTAMP,
    offer_token VARCHAR(100) UNIQUE,
    offer_short_id VARCHAR(20) UNIQUE,
    offer_token_expiry TIMESTAMP WITH TIME ZONE,
    offer_token_used BOOLEAN DEFAULT FALSE,
    offer_template_snapshot TEXT,
    offer_pdf_path VARCHAR(500),
    offer_accepted_ip VARCHAR(50),
    offer_accepted_user_agent TEXT,
    offer_email_status VARCHAR(20) DEFAULT 'pending',
    offer_email_retry_count INTEGER DEFAULT 0,
    reminder_sent_at TIMESTAMP,
    offer_preview_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_offers_application_id ON offers(application_id);

CREATE TABLE IF NOT EXISTS onboardings (
    id SERIAL PRIMARY KEY,
    application_id INTEGER NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
    joining_date TIMESTAMP,
    employee_id VARCHAR(50) UNIQUE,
    id_card_url VARCHAR(500),
    onboarded_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_onboardings_application_id ON onboardings(application_id);

-- ============================================================================
-- 6. PIPELINE & RESUME
-- ============================================================================
CREATE TABLE IF NOT EXISTS application_stages (
    id SERIAL PRIMARY KEY,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    stage_name VARCHAR(100) NOT NULL,
    stage_status VARCHAR(50) DEFAULT 'pending',
    score FLOAT,
    evaluation_notes TEXT,
    evaluator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_application_stages_application_id ON application_stages(application_id);

CREATE TABLE IF NOT EXISTS resume_extractions (
    id SERIAL PRIMARY KEY,
    application_id INTEGER NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
    extracted_text TEXT,
    summary TEXT,
    extracted_skills TEXT,
    years_of_experience FLOAT,
    education TEXT,
    previous_roles TEXT,
    experience_level VARCHAR(50),
    resume_score FLOAT DEFAULT 0,
    skill_match_percentage FLOAT DEFAULT 0,
    candidate_name VARCHAR(255),
    email VARCHAR(255),
    phone_number VARCHAR(50),
    reasoning JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 7. INTERVIEWS
-- ============================================================================
CREATE TABLE IF NOT EXISTS interviews (
    id SERIAL PRIMARY KEY,
    test_id VARCHAR(50) UNIQUE,
    application_id INTEGER NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'not_started',
    locked_skill VARCHAR(50),
    total_questions INTEGER DEFAULT 20,
    questions_asked INTEGER DEFAULT 0,
    current_difficulty VARCHAR(20) DEFAULT 'medium',
    overall_score FLOAT,
    started_at TIMESTAMP,
    ended_at TIMESTAMP,
    access_key_hash VARCHAR(255),
    expires_at TIMESTAMP,
    is_used BOOLEAN DEFAULT FALSE,
    used_at TIMESTAMP,
    interview_stage VARCHAR(50) DEFAULT 'first_level',
    aptitude_score FLOAT,
    aptitude_completed_at TIMESTAMP,
    duration_minutes INTEGER DEFAULT 60,
    aptitude_completed BOOLEAN DEFAULT FALSE,
    first_level_completed BOOLEAN DEFAULT FALSE,
    first_level_score FLOAT,
    video_recording_path VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_interviews_application_id ON interviews(application_id);
CREATE INDEX IF NOT EXISTS idx_interviews_test_id ON interviews(test_id);

CREATE TABLE IF NOT EXISTS interview_questions (
    id SERIAL PRIMARY KEY,
    interview_id INTEGER NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
    question_number INTEGER NOT NULL,
    question_text TEXT NOT NULL,
    question_type VARCHAR(100),
    expected_points JSONB,
    options TEXT,
    correct_answer TEXT,
    question_options TEXT,
    correct_option INTEGER,
    ai_generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_interview_question_number UNIQUE (interview_id, question_number)
);

CREATE TABLE IF NOT EXISTS interview_answers (
    id SERIAL PRIMARY KEY,
    question_id INTEGER NOT NULL REFERENCES interview_questions(id) ON DELETE CASCADE,
    interview_id INTEGER NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
    answer_text TEXT NOT NULL,
    answer_score FLOAT,
    answer_evaluation TEXT,
    skill_relevance_score FLOAT,
    technical_score FLOAT,
    completeness_score FLOAT,
    depth_score FLOAT,
    ai_used BOOLEAN DEFAULT FALSE,
    fallback_used BOOLEAN DEFAULT FALSE,
    confidence_score FLOAT,
    reasoning JSONB,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    evaluated_at TIMESTAMP,
    CONSTRAINT uq_answer_per_question UNIQUE (interview_id, question_id)
);

CREATE TABLE IF NOT EXISTS interview_answer_versions (
    id SERIAL PRIMARY KEY,
    answer_id INTEGER NOT NULL REFERENCES interview_answers(id) ON DELETE CASCADE,
    answer_text TEXT NOT NULL,
    answer_score FLOAT,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    version_number INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_interview_answer_versions_answer_id ON interview_answer_versions(answer_id);

CREATE TABLE IF NOT EXISTS interview_reports (
    id SERIAL PRIMARY KEY,
    interview_id INTEGER NOT NULL UNIQUE REFERENCES interviews(id) ON DELETE CASCADE,
    application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
    job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
    overall_score FLOAT,
    technical_skills_score FLOAT,
    communication_score FLOAT,
    problem_solving_score FLOAT,
    candidate_name VARCHAR(255),
    candidate_email VARCHAR(255),
    applied_role VARCHAR(255),
    summary TEXT,
    strengths TEXT,
    weaknesses TEXT,
    recommendation VARCHAR(50),
    detailed_feedback TEXT,
    aptitude_score FLOAT,
    behavioral_score FLOAT,
    combined_score FLOAT,
    evaluated_skills TEXT,
    termination_reason VARCHAR(255),
    ai_used BOOLEAN DEFAULT FALSE,
    fallback_used BOOLEAN DEFAULT FALSE,
    confidence_score FLOAT,
    reasoning JSONB,
    retry_count INTEGER DEFAULT 0,
    failure_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS interview_issues (
    id SERIAL PRIMARY KEY,
    interview_id INTEGER REFERENCES interviews(id) ON DELETE CASCADE,
    application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
    candidate_name VARCHAR(255),
    candidate_email VARCHAR(255),
    issue_type VARCHAR(100),
    description TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    hr_response TEXT,
    is_reissue_granted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP,
    CONSTRAINT check_issue_status CHECK (status IN ('pending', 'resolved', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS idx_interview_issues_status ON interview_issues(status);

CREATE TABLE IF NOT EXISTS interview_feedbacks (
    id SERIAL PRIMARY KEY,
    interview_id INTEGER NOT NULL UNIQUE REFERENCES interviews(id) ON DELETE CASCADE,
    ui_ux_rating INTEGER,
    feedback_text TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS interview_monitoring_events (
    id SERIAL PRIMARY KEY,
    interview_id INTEGER NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    confidence_score FLOAT,
    frame_image_path VARCHAR(500),
    video_reference VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_interview_monitoring_interview_id ON interview_monitoring_events(interview_id);

-- ============================================================================
-- 8. HIRING & LEGACY SESSION TABLES
-- ============================================================================
CREATE TABLE IF NOT EXISTS hiring_decisions (
    id SERIAL PRIMARY KEY,
    application_id INTEGER NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
    hr_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decision VARCHAR(20) NOT NULL,
    decision_comments TEXT,
    joining_date TIMESTAMP,
    offer_letter_path VARCHAR(500),
    decided_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_hiring_decision CHECK (decision IN ('hired', 'rejected'))
);

CREATE TABLE IF NOT EXISTS interview_sessions (
    id SERIAL PRIMARY KEY,
    candidate_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
    start_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) DEFAULT 'pending',
    final_score FLOAT,
    difficulty_level VARCHAR(50) DEFAULT 'medium'
);

CREATE TABLE IF NOT EXISTS interview_events (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    payload TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 9. EVALUATION & SKILLS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_evaluations (
    id SERIAL PRIMARY KEY,
    answer_id INTEGER NOT NULL REFERENCES interview_answers(id) ON DELETE CASCADE,
    technical_score FLOAT,
    communication_score FLOAT,
    reasoning_score FLOAT,
    feedback_text TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS candidate_skills (
    id SERIAL PRIMARY KEY,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    skill_name VARCHAR(100) NOT NULL,
    proficiency_score FLOAT,
    years_experience FLOAT
);

CREATE INDEX IF NOT EXISTS idx_candidate_skills_application_id ON candidate_skills(application_id);

-- ============================================================================
-- 10. VERSIONING
-- ============================================================================
CREATE TABLE IF NOT EXISTS job_versions (
    id SERIAL PRIMARY KEY,
    job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    primary_evaluated_skills TEXT,
    experience_level VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(job_id, version_number)
);

CREATE TABLE IF NOT EXISTS resume_extraction_versions (
    id SERIAL PRIMARY KEY,
    application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    extracted_text TEXT,
    extracted_skills TEXT,
    resume_score FLOAT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(application_id, version_number)
);

CREATE TABLE IF NOT EXISTS interview_report_versions (
    id SERIAL PRIMARY KEY,
    interview_id INTEGER REFERENCES interviews(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    overall_score FLOAT,
    summary TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(interview_id, version_number)
);

-- ============================================================================
-- 11. EMAIL INGESTION & AUDIT
-- ============================================================================
CREATE TABLE IF NOT EXISTS attachment_resumes (
    id SERIAL PRIMARY KEY,
    message_id VARCHAR(255) UNIQUE,
    sender_email VARCHAR(255),
    subject VARCHAR(500),
    file_name VARCHAR(255),
    file_data BYTEA,
    file_url VARCHAR(1000),
    email_body TEXT,
    mime_type VARCHAR(100),
    received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed BOOLEAN DEFAULT FALSE,
    hr_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    retry_count INTEGER DEFAULT 0,
    last_error TEXT,
    mapping_failed BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_attachment_resumes_sender ON attachment_resumes(sender_email);
CREATE INDEX IF NOT EXISTS idx_attachment_resumes_processed ON attachment_resumes(processed);

CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(255) NOT NULL,
    resource_type VARCHAR(100),
    resource_id INTEGER,
    details TEXT,
    ip_address VARCHAR(50),
    is_critical BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    related_application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
    related_interview_id INTEGER REFERENCES interviews(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
