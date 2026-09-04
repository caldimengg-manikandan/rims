'use client';

import { useEffect } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { APIClient, getActiveTenantMeta } from '@/app/dashboard/lib/api-client';
import { getBranding, BrandingConfig } from './branding';
import { useAuth } from '@/app/dashboard/lib/auth-context';

function getSubdomainSlug(): string | null {
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname.toLowerCase();
  if (host.endsWith('.localhost')) {
    const sub = host.replace('.localhost', '');
    if (sub && sub !== 'localhost' && sub !== 'www' && sub !== '127.0.0.1') return sub;
  }
  const parts = host.split('.');
  if (parts.length >= 3 && !['www', 'api', 'mail', 'admin', 'static', 'cdn'].includes(parts[0])) {
    return parts[0];
  }
  return null;
}

export function useBranding() {
  const { mutate: globalMutate } = useSWRConfig();
  const auth = useAuth();
  const subdomainSlug = typeof window !== 'undefined' ? getSubdomainSlug() : null;

  // Multi-Tenant Isolation Rules:
  // 1. Dedicated Subdomain (e.g. amazon.localhost:3000): ALWAYS use the subdomain slug.
  // 2. Authenticated user with activeTenant (e.g. Root Admin switched into a tenant): use activeTenant.slug.
  // 3. Central Portal (localhost:3000 / apex host without subdomain) when unauthenticated or on public pages:
  //    ALWAYS use neutral platform branding (empty tenantSlug / 'default'). NEVER use stale previous tenant storage!
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
  const isLanding = !pathname || pathname === '/' || pathname === '/calrims' || pathname === '/calrims/';

  let tenantSlug = '';
  if (subdomainSlug) {
    tenantSlug = subdomainSlug;
  } else if (!isLanding && auth?.isAuthenticated && auth?.activeTenant?.slug) {
    tenantSlug = auth.activeTenant.slug;
  } else if (!isLanding && auth?.isAuthenticated) {
    // Authenticated fallback to storage inside dashboard/tenant routes
    const meta = getActiveTenantMeta();
    tenantSlug =
      meta?.slug ||
      (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('tenant_slug') || '' : '') ||
      (typeof localStorage !== 'undefined' ? localStorage.getItem('tenant_slug') || '' : '');
  } else {
    // Unauthenticated on central portal or on public landing page without subdomain:
    // Strictly neutral platform branding. Purge any stale tenant storage/cookies.
    tenantSlug = '';
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem('tenant_slug');
        sessionStorage.removeItem('tenant_id');
        localStorage.removeItem('tenant_slug');
        localStorage.removeItem('tenant_id');
        document.cookie = 'x-tenant-slug=; path=/; max-age=0; SameSite=Lax';
        document.cookie = 'x-tenant-slug=; path=/calrims; max-age=0; SameSite=Lax';
        document.cookie = 'x-tenant-slug=; path=/calrims/; max-age=0; SameSite=Lax';
      } catch (_) {}
    }
  }

  // Tenant-scoped SWR cache key prevents cross-tenant branding leakage
  const swrKey = tenantSlug ? `/api/settings/branding?tenant=${tenantSlug}` : '/api/settings/branding';
  const { data: settings, error, mutate } = useSWR(swrKey, () => APIClient.get(swrKey)) as {
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
