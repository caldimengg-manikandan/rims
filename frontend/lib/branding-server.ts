import { headers } from 'next/headers';
import { cache } from 'react';
import { getApiBaseUrl } from './config';
import { getBranding, BrandingConfig } from './branding';

const fetchBrandingData = cache(async (tenantSlug: string): Promise<BrandingConfig> => {
  try {
    const fetchHeaders: Record<string, string> = {};
    if (tenantSlug) {
      fetchHeaders['X-Tenant-Slug'] = tenantSlug;
    }

    // Cache branding settings for 5 minutes (300s) to avoid repeated backend round-trips
    const res = await fetch(`${getApiBaseUrl()}/api/settings/branding`, { 
      headers: fetchHeaders,
      next: { revalidate: 300 }
    });
    if (res.ok) {
      const data = await res.json();
      return getBranding(data);
    }
  } catch (err) {
    console.error("Failed to fetch branding on server:", err);
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

