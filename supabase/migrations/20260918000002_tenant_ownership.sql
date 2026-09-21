-- Migration: Explicit tenant ownership + audit log tenant scoping + ReminderLog table
-- Batch 2: Multi-tenancy & Auth improvements
-- All new columns are nullable to avoid breaking existing rows.

-- -------------------------------------------------------------------------
-- 1. Offers: add tenant_id for direct isolation
-- -------------------------------------------------------------------------
ALTER TABLE offers
    ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_offers_tenant_id
    ON offers (tenant_id);

-- Backfill from Application -> Job -> tenant_id
UPDATE offers o
SET tenant_id = j.tenant_id
FROM applications a
JOIN jobs j ON a.job_id = j.id
WHERE o.application_id = a.id
  AND o.tenant_id IS NULL
  AND j.tenant_id IS NOT NULL;

-- -------------------------------------------------------------------------
-- 2. Onboardings: add tenant_id
-- -------------------------------------------------------------------------
ALTER TABLE onboardings
    ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_onboardings_tenant_id
    ON onboardings (tenant_id);

-- Backfill
UPDATE onboardings o
SET tenant_id = j.tenant_id
FROM applications a
JOIN jobs j ON a.job_id = j.id
WHERE o.application_id = a.id
  AND o.tenant_id IS NULL
  AND j.tenant_id IS NOT NULL;

-- -------------------------------------------------------------------------
-- 3. Application Stages: add tenant_id
-- -------------------------------------------------------------------------
ALTER TABLE application_stages
    ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_application_stages_tenant_id
    ON application_stages (tenant_id);

-- Backfill
UPDATE application_stages s
SET tenant_id = j.tenant_id
FROM applications a
JOIN jobs j ON a.job_id = j.id
WHERE s.application_id = a.id
  AND s.tenant_id IS NULL
  AND j.tenant_id IS NOT NULL;

-- -------------------------------------------------------------------------
-- 4. Hiring Decisions: add tenant_id
-- -------------------------------------------------------------------------
ALTER TABLE hiring_decisions
    ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_hiring_decisions_tenant_id
    ON hiring_decisions (tenant_id);

-- Backfill
UPDATE hiring_decisions hd
SET tenant_id = j.tenant_id
FROM applications a
JOIN jobs j ON a.job_id = j.id
WHERE hd.application_id = a.id
  AND hd.tenant_id IS NULL
  AND j.tenant_id IS NOT NULL;

-- -------------------------------------------------------------------------
-- 5. Audit Logs: add tenant_id for tenant-aware filtering
-- -------------------------------------------------------------------------
ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_audit_logs_tenant_id
    ON audit_logs (tenant_id);

-- -------------------------------------------------------------------------
-- 6. ReminderLog: new table for idempotent onboarding reminder tracking
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reminder_logs (
    id            SERIAL PRIMARY KEY,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,
    joining_date  TIMESTAMP NOT NULL,
    reminder_type VARCHAR(50) NOT NULL,
    sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Idempotency key: one reminder per (candidate, joining_date, type)
    CONSTRAINT uq_reminder_log_candidate_date_type
        UNIQUE (application_id, joining_date, reminder_type)
);

CREATE INDEX IF NOT EXISTS ix_reminder_logs_application_id
    ON reminder_logs (application_id);

CREATE INDEX IF NOT EXISTS ix_reminder_logs_tenant_id
    ON reminder_logs (tenant_id);

CREATE INDEX IF NOT EXISTS ix_reminder_logs_joining_date
    ON reminder_logs (joining_date);

-- Enable RLS on reminder_logs (consistent with other tenant-scoped tables)
ALTER TABLE reminder_logs ENABLE ROW LEVEL SECURITY;

-- RLS policy: HR and admins can only see reminder logs for their own tenant
CREATE POLICY reminder_logs_tenant_isolation ON reminder_logs
    USING (
        tenant_id IS NULL  -- allow global admins to see all
        OR tenant_id = (
            SELECT tenant_id FROM users WHERE id = auth.uid()::int LIMIT 1
        )
    );
