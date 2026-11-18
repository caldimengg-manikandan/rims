import { headers } from 'next/headers';
import { cache } from 'react';
import { getServerApiBaseUrl } from './config';
import { getBranding, BrandingConfig } from './branding';

const fetchBrandingData = cache(async (tenantSlug: string): Promise<BrandingConfig> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  try {
    const fetchHeaders: Record<string, string> = {};
    if (tenantSlug) {
      fetchHeaders['X-Tenant-Slug'] = tenantSlug;
    }

    // Cache branding settings for 5 minutes (300s) to avoid repeated backend round-trips
    const res = await fetch(`${getServerApiBaseUrl()}/api/settings/branding`, { 
      headers: fetchHeaders,
      signal: controller.signal,
      next: { revalidate: 300 }
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      return getBranding(data);
    }
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    console.warn("Branding SSR fetch skipped/timed out; using default branding:", err instanceof Error ? err.message : String(err));
  }
  
  // Fallback to env variables and default constants
  return getBranding(null);
});

export async function getBrandingServer(): Promise<BrandingConfig> {
  let tenantSlug = '';
  try {
    const headerList = await headers();
    tenantSlug = headerList.get('x-tenant-slug') || '';
    if (!tenantSlug) {
      const host = headerList.get('host') || '';
      const lowerHost = host.split(':')[0].toLowerCase().trim();
      if (lowerHost.endsWith('.localhost')) {
        const sub = lowerHost.slice(0, -'.localhost'.length);
        if (sub && sub !== 'localhost' && sub !== 'www' && sub !== '127.0.0.1') {
          tenantSlug = sub;
        }
      } else {
        const parts = lowerHost.split('.');
        if (parts.length >= 3 && !['www', 'api', 'mail', 'admin', 'static'].includes(parts[0])) {
          tenantSlug = parts[0];
        }
      }
    }
  } catch (_) {
    // headers() may not be available in all build/SSG contexts
  }

  return fetchBrandingData(tenantSlug);
}

