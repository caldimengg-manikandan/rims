'use client';

import { useEffect } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { APIClient, getActiveTenantMeta } from '@/app/dashboard/lib/api-client';
import { getBranding, BrandingConfig } from './branding';
import { useAuth } from '@/app/dashboard/lib/auth-context';

export function useBranding() {
  const { mutate: globalMutate } = useSWRConfig();

  // Try getting tenant slug from auth context or active tenant meta
  let tenantSlug = '';
  try {
    const auth = useAuth();
    tenantSlug = auth?.activeTenant?.slug || '';
  } catch (_) {
    const meta = getActiveTenantMeta();
    tenantSlug = meta?.slug || '';
  }

  // Fallback to storage or cookie if in browser
  if (!tenantSlug && typeof window !== 'undefined') {
    tenantSlug =
      sessionStorage.getItem('tenant_slug') ||
      localStorage.getItem('tenant_slug') ||
      '';
    if (!tenantSlug) {
      const match = document.cookie.match(/(?:^|;\s*)x-tenant-slug=([^;]+)/);
      if (match) tenantSlug = decodeURIComponent(match[1]);
    }
  }

  // Tenant-scoped SWR cache key prevents cross-tenant branding leakage
  const swrKey = tenantSlug ? `/api/settings/branding?tenant=${tenantSlug}` : '/api/settings/branding';
  const { data: settings, error, mutate } = useSWR(swrKey, () => APIClient.get('/api/settings/branding')) as {
    data: any;
    error: any;
    mutate: any;
  };

  // Revalidate branding when active tenant changes
  useEffect(() => {
    const handleTenantChanged = () => {
      globalMutate((key) => typeof key === 'string' && key.startsWith('/api/settings/branding'));
    };
    window.addEventListener('rims:tenant-changed', handleTenantChanged);
    return () => window.removeEventListener('rims:tenant-changed', handleTenantChanged);
  }, [globalMutate]);

  const branding = getBranding(settings);

  return {
    branding,
    isLoading: !settings && !error,
    isError: error,
    mutate,
  };
}
