-- Migration: Allow NULL application_id in interviews to support demo interviews
-- Demo interviews run independently without creating fake Applications or Jobs.

ALTER TABLE public.interviews ALTER COLUMN application_id DROP NOT NULL;
