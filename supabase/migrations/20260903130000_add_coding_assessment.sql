-- ============================================================================
-- CALRIMS Coding Assessment Module Migration
-- 20260903130000_add_coding_assessment.sql
--
-- Creates tables for coding problems, test cases, question sets, ordered set items,
-- and candidate submissions, along with Job and Interview column extensions.
--
-- Applies shared-schema multi-tenancy and Row-Level Security (RLS).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. EXTEND JOBS TABLE
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = 'coding_round_enabled') THEN
        ALTER TABLE public.jobs ADD COLUMN coding_round_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = 'coding_round_duration_minutes') THEN
        ALTER TABLE public.jobs ADD COLUMN coding_round_duration_minutes INTEGER NOT NULL DEFAULT 60;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = 'coding_repo_set_id') THEN
        ALTER TABLE public.jobs ADD COLUMN coding_repo_set_id INTEGER;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = 'coding_allowed_languages') THEN
        ALTER TABLE public.jobs ADD COLUMN coding_allowed_languages JSONB;
    END IF;
END $$;

-- ============================================================================
-- 2. EXTEND INTERVIEWS TABLE
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'interviews' AND column_name = 'coding_completed') THEN
        ALTER TABLE public.interviews ADD COLUMN coding_completed BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'interviews' AND column_name = 'coding_score') THEN
        ALTER TABLE public.interviews ADD COLUMN coding_score DOUBLE PRECISION;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'interviews' AND column_name = 'coding_completed_at') THEN
        ALTER TABLE public.interviews ADD COLUMN coding_completed_at TIMESTAMPTZ;
    END IF;
END $$;

-- ============================================================================
-- 3. CODING PROBLEMS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.coding_problems (
    id               SERIAL PRIMARY KEY,
    tenant_id        UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    title            VARCHAR(255) NOT NULL,
    description      TEXT NOT NULL,
    input_format     TEXT,
    output_format    TEXT,
    constraints      TEXT,
    starter_code     JSONB,
    solution_code    TEXT NOT NULL,
    difficulty       VARCHAR(50) NOT NULL DEFAULT 'medium',
    time_limit_ms    INTEGER NOT NULL DEFAULT 2000,
    memory_limit_mb  INTEGER NOT NULL DEFAULT 256,
    hr_id            INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coding_problems_tenant_id   ON public.coding_problems(tenant_id);
CREATE INDEX IF NOT EXISTS idx_coding_problems_difficulty  ON public.coding_problems(difficulty);
CREATE INDEX IF NOT EXISTS idx_coding_problems_hr_id       ON public.coding_problems(hr_id);

-- ============================================================================
-- 4. CODING TEST CASES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.coding_test_cases (
    id               SERIAL PRIMARY KEY,
    problem_id       INTEGER NOT NULL REFERENCES public.coding_problems(id) ON DELETE CASCADE,
    input            TEXT NOT NULL,
    expected_output  TEXT NOT NULL,
    weight           DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    is_hidden        BOOLEAN NOT NULL DEFAULT FALSE,
    display_order    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_coding_test_cases_problem_id ON public.coding_test_cases(problem_id);
CREATE INDEX IF NOT EXISTS idx_coding_test_cases_order      ON public.coding_test_cases(problem_id, display_order);

-- ============================================================================
-- 5. CODING QUESTION SETS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.coding_question_sets (
    id                  SERIAL PRIMARY KEY,
    tenant_id           UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    title               VARCHAR(255) NOT NULL,
    description         TEXT,
    supported_languages JSONB NOT NULL,
    hr_id               INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coding_question_sets_tenant_id ON public.coding_question_sets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_coding_question_sets_hr_id     ON public.coding_question_sets(hr_id);

-- Add foreign key from jobs to coding_question_sets
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_jobs_coding_repo_set_id' AND table_name = 'jobs'
    ) THEN
        ALTER TABLE public.jobs
            ADD CONSTRAINT fk_jobs_coding_repo_set_id
            FOREIGN KEY (coding_repo_set_id)
            REFERENCES public.coding_question_sets(id)
            ON DELETE SET NULL;
    END IF;
END $$;

-- ============================================================================
-- 6. CODING QUESTION SET ITEMS (JOIN TABLE PRESERVING ORDER)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.coding_question_set_items (
    id               SERIAL PRIMARY KEY,
    question_set_id  INTEGER NOT NULL REFERENCES public.coding_question_sets(id) ON DELETE CASCADE,
    problem_id       INTEGER NOT NULL REFERENCES public.coding_problems(id) ON DELETE CASCADE,
    display_order    INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_coding_set_problem UNIQUE (question_set_id, problem_id)
);

CREATE INDEX IF NOT EXISTS idx_coding_set_items_order ON public.coding_question_set_items(question_set_id, display_order);

-- ============================================================================
-- 7. CODING SUBMISSIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.coding_submissions (
    id                SERIAL PRIMARY KEY,
    tenant_id         UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    interview_id      INTEGER NOT NULL REFERENCES public.interviews(id) ON DELETE CASCADE,
    problem_id        INTEGER NOT NULL REFERENCES public.coding_problems(id) ON DELETE CASCADE,
    language          VARCHAR(50) NOT NULL,
    source_code       TEXT NOT NULL,
    status            VARCHAR(50) NOT NULL DEFAULT 'running',
    verdict           VARCHAR(50),
    passed_tests      INTEGER NOT NULL DEFAULT 0,
    total_tests       INTEGER NOT NULL DEFAULT 0,
    score             DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    execution_time_ms INTEGER,
    memory_used_kb    INTEGER,
    error_output      TEXT,
    submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coding_submissions_tenant_id    ON public.coding_submissions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_coding_submissions_interview_id ON public.coding_submissions(interview_id);
CREATE INDEX IF NOT EXISTS idx_coding_submissions_problem_id   ON public.coding_submissions(problem_id);

-- ============================================================================
-- 8. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- ── coding_problems ──
ALTER TABLE public.coding_problems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coding_problems FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_policy" ON public.coding_problems;
CREATE POLICY tenant_isolation_policy ON public.coding_problems
    AS RESTRICTIVE
    FOR ALL
    USING (
        tenant_id = public.current_tenant_id()
        OR tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID
    )
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        OR tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID
    );

DROP POLICY IF EXISTS "service_role_bypass" ON public.coding_problems;
CREATE POLICY service_role_bypass ON public.coding_problems
    AS PERMISSIVE FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ── coding_question_sets ──
ALTER TABLE public.coding_question_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coding_question_sets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_policy" ON public.coding_question_sets;
CREATE POLICY tenant_isolation_policy ON public.coding_question_sets
    AS RESTRICTIVE
    FOR ALL
    USING (
        tenant_id = public.current_tenant_id()
        OR tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID
    )
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        OR tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID
    );

DROP POLICY IF EXISTS "service_role_bypass" ON public.coding_question_sets;
CREATE POLICY service_role_bypass ON public.coding_question_sets
    AS PERMISSIVE FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ── coding_submissions ──
ALTER TABLE public.coding_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coding_submissions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_policy" ON public.coding_submissions;
CREATE POLICY tenant_isolation_policy ON public.coding_submissions
    AS RESTRICTIVE
    FOR ALL
    USING (
        tenant_id = public.current_tenant_id()
        OR tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID
    )
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        OR tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID
    );

DROP POLICY IF EXISTS "service_role_bypass" ON public.coding_submissions;
CREATE POLICY service_role_bypass ON public.coding_submissions
    AS PERMISSIVE FOR ALL TO service_role
    USING (true) WITH CHECK (true);

COMMIT;
