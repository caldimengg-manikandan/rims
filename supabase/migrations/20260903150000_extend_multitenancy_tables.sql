-- ============================================================================
-- CALRIMS Multi-Tenancy Extension Migration
-- 20260903150000_extend_multitenancy_tables.sql
--
-- Extends tenant isolation to users and question_sets.
-- ============================================================================

BEGIN;

DO $$
DECLARE
    _default_id UUID;
    _acme_id UUID;
    _nexus_id UUID;
    _amazon_id UUID;
BEGIN
    SELECT id INTO _default_id FROM public.tenants WHERE slug = 'default' LIMIT 1;
    IF _default_id IS NULL THEN
        _default_id := md5('calrims-default-tenant')::UUID;
    END IF;

    SELECT id INTO _acme_id FROM public.tenants WHERE slug = 'acme' LIMIT 1;
    SELECT id INTO _nexus_id FROM public.tenants WHERE slug = 'nexus' LIMIT 1;
    SELECT id INTO _amazon_id FROM public.tenants WHERE slug = 'amazon' LIMIT 1;

    -- 1. USERS TABLE
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'tenant_id'
    ) THEN
        ALTER TABLE public.users
            ADD COLUMN tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON public.users(tenant_id);

        -- Backfill existing users
        UPDATE public.users SET tenant_id = _default_id WHERE tenant_id IS NULL;
        IF _acme_id IS NOT NULL THEN
            UPDATE public.users SET tenant_id = _acme_id WHERE email ILIKE '%acme%';
        END IF;
        IF _nexus_id IS NOT NULL THEN
            UPDATE public.users SET tenant_id = _nexus_id WHERE email ILIKE '%nexus%';
        END IF;
        IF _amazon_id IS NOT NULL THEN
            UPDATE public.users SET tenant_id = _amazon_id WHERE email ILIKE '%amazon%';
        END IF;
    END IF;

    -- 2. QUESTION_SETS TABLE
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'question_sets' AND column_name = 'tenant_id'
    ) THEN
        ALTER TABLE public.question_sets
            ADD COLUMN tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;
        CREATE INDEX IF NOT EXISTS idx_question_sets_tenant_id ON public.question_sets(tenant_id);

        UPDATE public.question_sets SET tenant_id = _default_id WHERE tenant_id IS NULL;
    END IF;

END $$;

-- 3. ROW LEVEL SECURITY POLICIES FOR QUESTION_SETS
ALTER TABLE public.question_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_sets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_policy" ON public.question_sets;
CREATE POLICY tenant_isolation_policy ON public.question_sets
    AS RESTRICTIVE FOR ALL
    USING (tenant_id = public.current_tenant_id())
    WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "service_role_bypass" ON public.question_sets;
CREATE POLICY service_role_bypass ON public.question_sets
    AS PERMISSIVE FOR ALL TO service_role
    USING (true) WITH CHECK (true);

COMMIT;
