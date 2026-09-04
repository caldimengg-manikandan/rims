-- Migration: 20260904000000_allow_pending_tenant_status.sql
-- Description: Expand public.tenants status constraint to include pending, rejected, deactivated

ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS check_tenants_status;
ALTER TABLE public.tenants ADD CONSTRAINT check_tenants_status 
    CHECK (status IN ('pending', 'active', 'rejected', 'suspended', 'trial', 'deactivated'));
