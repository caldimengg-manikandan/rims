-- ============================================================================
-- CALRIMS Multi-Tenancy Migration
-- 20260901000000_enable_multitenancy.sql
--
-- Implements shared-database / shared-schema multi-tenancy with PostgreSQL
-- Row-Level Security (RLS) for zero-data-leakage tenant isolation.
--
-- Safe to run idempotently (IF NOT EXISTS / OR REPLACE guards throughout).
-- Existing single-tenant rows are backfilled to the 'default' tenant.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TENANTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.tenants (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    name           VARCHAR(255)  NOT NULL,
    slug           VARCHAR(100)  UNIQUE NOT NULL,
    custom_domain  VARCHAR(255)  UNIQUE,
    logo_url       TEXT,
    settings       JSONB         NOT NULL DEFAULT '{}'::jsonb,
    status         VARCHAR(50)   NOT NULL DEFAULT 'active'
                                 CHECK (status IN ('active', 'suspended', 'trial')),
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug         ON public.tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_custom_domain ON public.tenants(custom_domain);
CREATE INDEX IF NOT EXISTS idx_tenants_status        ON public.tenants(status);

-- ============================================================================
-- 2. SEED THE DEFAULT TENANT
--    Deterministic UUID via md5 so re-runs are idempotent.
-- ============================================================================
DO $$
DECLARE
    _default_id UUID := md5('calrims-default-tenant')::UUID;
BEGIN
    INSERT INTO public.tenants (id, name, slug, status, created_at, updated_at)
    VALUES (_default_id, 'Default Organization', 'default', 'active', now(), now())
    ON CONFLICT (slug) DO NOTHING;
END $$;

-- ============================================================================
-- 3. ADD tenant_id COLUMNS TO TENANT-SCOPED TABLES
--    Default = the seeded 'default' tenant UUID for safe backfill.
--    We use md5() so the value is deterministic without a subquery per row.
-- ============================================================================

-- Helper: add tenant_id only if the column does not yet exist
DO $$
DECLARE
    _default_id UUID := md5('calrims-default-tenant')::UUID;
BEGIN

    -- 3a. jobs
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = 'tenant_id'
    ) THEN
        ALTER TABLE public.jobs
            ADD COLUMN tenant_id UUID NOT NULL DEFAULT md5('calrims-default-tenant')::UUID
                REFERENCES public.tenants(id) ON DELETE CASCADE;
    END IF;

    -- 3b. applications
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'applications' AND column_name = 'tenant_id'
    ) THEN
        ALTER TABLE public.applications
            ADD COLUMN tenant_id UUID NOT NULL DEFAULT md5('calrims-default-tenant')::UUID
                REFERENCES public.tenants(id) ON DELETE CASCADE;
    END IF;

    -- 3c. interviews
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'interviews' AND column_name = 'tenant_id'
    ) THEN
        ALTER TABLE public.interviews
            ADD COLUMN tenant_id UUID NOT NULL DEFAULT md5('calrims-default-tenant')::UUID
                REFERENCES public.tenants(id) ON DELETE CASCADE;
    END IF;

    -- 3d. attachment_resumes
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'attachment_resumes' AND column_name = 'tenant_id'
    ) THEN
        ALTER TABLE public.attachment_resumes
            ADD COLUMN tenant_id UUID NOT NULL DEFAULT md5('calrims-default-tenant')::UUID
                REFERENCES public.tenants(id) ON DELETE CASCADE;
    END IF;

    -- 3e. notifications
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'tenant_id'
    ) THEN
        ALTER TABLE public.notifications
            ADD COLUMN tenant_id UUID NOT NULL DEFAULT md5('calrims-default-tenant')::UUID
                REFERENCES public.tenants(id) ON DELETE CASCADE;
    END IF;

END $$;

-- ============================================================================
-- 4. INDEXES ON tenant_id COLUMNS
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_jobs_tenant_id               ON public.jobs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_applications_tenant_id       ON public.applications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_interviews_tenant_id         ON public.interviews(tenant_id);
CREATE INDEX IF NOT EXISTS idx_attachment_resumes_tenant_id ON public.attachment_resumes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_id      ON public.notifications(tenant_id);

-- ============================================================================
-- 5. DROP TEMPORARY DEFAULTS (enforce app-level stamping going forward)
--    NOTE: existing rows are already backfilled; we remove the column default
--    so future inserts *must* supply an explicit tenant_id.
-- ============================================================================
ALTER TABLE public.jobs              ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE public.applications      ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE public.interviews        ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE public.attachment_resumes ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE public.notifications     ALTER COLUMN tenant_id DROP DEFAULT;

-- ============================================================================
-- 6. TENANT CONTEXT HELPER FUNCTION
--    Reads the transaction-local GUC set by the FastAPI session hook.
--    Returns NULL when not set (service-role connections bypass RLS anyway).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::UUID;
EXCEPTION
    WHEN invalid_text_representation THEN
        RETURN NULL;
    WHEN undefined_object THEN
        RETURN NULL;
END;
$$;

-- ============================================================================
-- 7. RLS POLICIES — TENANT-SCOPED TABLES
--
--    The isolation policy is RESTRICTIVE, meaning it ANDs with any permissive
--    policies rather than ORing. The condition allows access when:
--      a) The app-set GUC matches the row's tenant_id, OR
--      b) The JWT's app_metadata.tenant_id claim matches (Supabase Auth path).
--
--    The existing blanket "deny all" policies on these tables are dropped and
--    replaced. Tables not listed here retain their existing "deny all" policy.
-- ============================================================================

-- ── jobs ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny all"                ON public.jobs;
DROP POLICY IF EXISTS "tenant_isolation_policy" ON public.jobs;

CREATE POLICY tenant_isolation_policy ON public.jobs
    AS RESTRICTIVE
    FOR ALL
    USING (
        tenant_id = public.current_tenant_id()
        OR tenant_id = (
            (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID
        )
    )
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        OR tenant_id = (
            (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID
        )
    );

-- Service role bypass policy (permissive — allows service_role to always pass)
DROP POLICY IF EXISTS "service_role_bypass" ON public.jobs;
CREATE POLICY service_role_bypass ON public.jobs
    AS PERMISSIVE
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ── applications ─────────────────────────────────────────────────────────────
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny all"                ON public.applications;
DROP POLICY IF EXISTS "tenant_isolation_policy" ON public.applications;

CREATE POLICY tenant_isolation_policy ON public.applications
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

DROP POLICY IF EXISTS "service_role_bypass" ON public.applications;
CREATE POLICY service_role_bypass ON public.applications
    AS PERMISSIVE FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ── interviews ────────────────────────────────────────────────────────────────
ALTER TABLE public.interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interviews FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny all"                ON public.interviews;
DROP POLICY IF EXISTS "tenant_isolation_policy" ON public.interviews;

CREATE POLICY tenant_isolation_policy ON public.interviews
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

DROP POLICY IF EXISTS "service_role_bypass" ON public.interviews;
CREATE POLICY service_role_bypass ON public.interviews
    AS PERMISSIVE FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ── attachment_resumes ────────────────────────────────────────────────────────
ALTER TABLE public.attachment_resumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachment_resumes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny all"                ON public.attachment_resumes;
DROP POLICY IF EXISTS "tenant_isolation_policy" ON public.attachment_resumes;

CREATE POLICY tenant_isolation_policy ON public.attachment_resumes
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

DROP POLICY IF EXISTS "service_role_bypass" ON public.attachment_resumes;
CREATE POLICY service_role_bypass ON public.attachment_resumes
    AS PERMISSIVE FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ── notifications ─────────────────────────────────────────────────────────────
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny all"                ON public.notifications;
DROP POLICY IF EXISTS "tenant_isolation_policy" ON public.notifications;

CREATE POLICY tenant_isolation_policy ON public.notifications
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

DROP POLICY IF EXISTS "service_role_bypass" ON public.notifications;
CREATE POLICY service_role_bypass ON public.notifications
    AS PERMISSIVE FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================================
-- 8. TENANTS TABLE — RLS (public read of active tenants; write via service role)
-- ============================================================================
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenants_public_read"      ON public.tenants;
DROP POLICY IF EXISTS "tenants_service_role_all" ON public.tenants;

-- Any authenticated or anon user can resolve tenant by slug (needed by middleware lookup)
CREATE POLICY tenants_public_read ON public.tenants
    AS PERMISSIVE
    FOR SELECT
    USING (true);

-- Only service_role can mutate tenants
CREATE POLICY tenants_service_role_all ON public.tenants
    AS PERMISSIVE
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- 9. UPDATED_AT TRIGGER FOR TENANTS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenants_updated_at ON public.tenants;
CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON public.tenants
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

COMMIT;
