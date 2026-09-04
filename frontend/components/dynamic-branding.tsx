'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useBranding } from '@/lib/branding-client';
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

export function DynamicBranding() {
  const { branding } = useBranding();
  const pathname = usePathname();
  const { isAuthenticated, activeTenant } = useAuth();

  useEffect(() => {
    if (!branding) return;

    const subdomain = getSubdomainSlug();
    const isLanding = !pathname || pathname === '/' || pathname === '/calrims' || pathname === '/calrims/';

    // 1. Dynamic Favicon synchronization across all icon link tags
    const targetFavicon = (isLanding && !subdomain) ? '/calrims/logo.png' : (branding.faviconUrl || '/calrims/logo.png');
    const rels = ['icon', 'shortcut icon', 'apple-touch-icon'];
    rels.forEach((rel) => {
      let links = document.querySelectorAll(`link[rel="${rel}"]`) as NodeListOf<HTMLLinkElement>;
      if (!links || links.length === 0) {
        const link = document.createElement('link');
        link.rel = rel;
        link.href = targetFavicon;
        document.head.appendChild(link);
      } else {
        links.forEach((l) => {
          if (l.getAttribute('href') !== targetFavicon) {
            l.href = targetFavicon;
          }
        });
      }
    });

    // 2. Dynamic Primary and Ring Theme Color synchronization
    const safeThemeColor =
      branding.themeColor && /^#[0-9A-Fa-f]{3,8}$/.test(branding.themeColor)
        ? branding.themeColor
        : '#2563eb';
    document.documentElement.style.setProperty('--primary', safeThemeColor);
    document.documentElement.style.setProperty('--ring', safeThemeColor);

    // 3. Dynamic Document Title Synchronization
    if (isLanding && !subdomain && !isAuthenticated) {
      document.title = 'CAL-RIMS - AI-Powered Recruitment Intelligence System';
    } else {
      let pageLabel = '';
      if (pathname.includes('/auth/login')) pageLabel = 'Sign In';
      else if (pathname.includes('/auth/register')) pageLabel = 'Create Account';
      else if (pathname.includes('/company/register')) pageLabel = 'Register Organization';
      else if (pathname.includes('/dashboard/tenants')) pageLabel = 'Tenant Management';
      else if (pathname.includes('/dashboard/hr/jobs')) pageLabel = 'Job Openings';
      else if (pathname.includes('/dashboard/hr/candidates')) pageLabel = 'Candidates';
      else if (pathname.includes('/dashboard/hr/interviews')) pageLabel = 'AI Interviews';
      else if (pathname.includes('/dashboard/hr/analytics')) pageLabel = 'Analytics';
      else if (pathname.includes('/dashboard/hr/settings')) pageLabel = 'Settings';
      else if (pathname.includes('/dashboard/hr')) pageLabel = 'Dashboard';
      else if (pathname.includes('/jobs')) pageLabel = 'Careers';

      const orgDisplayName =
        branding.companyName && branding.companyName !== 'Default Organization' && branding.companyName !== 'CALDIM'
          ? branding.companyName
          : subdomain
          ? subdomain.toUpperCase()
          : 'CAL-RIMS';

      if (pageLabel) {
        document.title = `${pageLabel} | ${orgDisplayName}`;
      } else if (branding.seoTitleDefault) {
        document.title = branding.seoTitleDefault;
      }
    }
  }, [branding, pathname, isAuthenticated, activeTenant]);

  return null;
}
