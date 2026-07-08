-- Migration: Add missing proctoring, monitoring, and demo columns that were previously dynamically added at startup.
-- Safe to re-apply (IF NOT EXISTS guards throughout).
-- Apply via Supabase SQL Editor or CLI.

ALTER TABLE interview_monitoring_events 
    ADD COLUMN IF NOT EXISTS is_false_positive BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS details TEXT;

ALTER TABLE interviews
    ADD COLUMN IF NOT EXISTS risk_score FLOAT DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS is_terminated_by_violations BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS active_session_jti VARCHAR(50),
    ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT FALSE;
