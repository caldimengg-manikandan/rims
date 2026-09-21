-- Migration: Add coding_started_at to interviews table
-- coding_started_at: set when the candidate first hits /api/coding/session.
-- Coding deadline = coding_started_at + coding_round_duration_minutes (derived, not stored).
-- This enables server-authoritative enforcement without a dedicated deadline column.

ALTER TABLE interviews
    ADD COLUMN IF NOT EXISTS coding_started_at TIMESTAMPTZ;

-- Index to support deadline-based queries
CREATE INDEX IF NOT EXISTS ix_interviews_coding_started_at
    ON interviews (coding_started_at)
    WHERE coding_started_at IS NOT NULL;
