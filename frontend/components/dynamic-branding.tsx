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

function normalizePathname(raw: string | null | undefined): string {
  if (!raw) return '/';
  // Strip basePath /calrims
  let p = raw.replace(/^\/calrims(?=\/|$)/, '');
  // Strip query and hash
  p = p.split('?')[0].split('#')[0];
  // Strip trailing slashes (except root)
  p = p.replace(/\/+$/, '');
  return p || '/';
}

function getPageLabel(p: string): string | null {
  // Auth
  if (p === '/auth/login') return 'Sign In';
  if (p === '/auth/register') return 'Create Account';
  if (p === '/auth/forgot-password') return 'Forgot Password';
  if (p === '/auth/reset-password') return 'Reset Password';
  if (p === '/auth/verify') return 'Verify Account';
  if (p.startsWith('/auth/')) return 'Authentication';

  // Company
  if (p === '/company/register') return 'Register Organization';
  if (p === '/company' || p.startsWith('/company/')) return 'Company Profile';

  // Dashboard - Jobs
  if (p === '/dashboard/hr/jobs/create') return 'Create Job';
  if (p.startsWith('/dashboard/hr/jobs/') && p.endsWith('/edit')) return 'Edit Job';
  if (p === '/dashboard/hr/jobs' || p.startsWith('/dashboard/hr/jobs/')) return 'Job Openings';

  // Dashboard - Applications
  if (p === '/dashboard/hr/applications') return 'Applications';
  if (p.startsWith('/dashboard/hr/applications/')) return 'Application Details';

  // Dashboard - Pipelines
  if (p === '/dashboard/hr/pipeline') return 'Hiring Pipeline';
  if (p.startsWith('/dashboard/hr/pipelines/')) return 'Pipeline View';

  // Dashboard - HR sub-sections
  if (p === '/dashboard/hr/approvals') return 'Pending Approvals';
  if (p === '/dashboard/hr/batch-analysis') return 'Batch Analysis';
  if (p === '/dashboard/hr/ingested-emails') return 'Ingested Emails';
  if (p === '/dashboard/hr/profile') return 'Profile';
  if (p.startsWith('/dashboard/hr/ranking/')) return 'Candidate Ranking';
  if (p === '/dashboard/hr/reports') return 'Analytics & Reports';
  if (p.startsWith('/dashboard/hr/scorecard/')) return 'Interview Scorecard';
  if (p === '/dashboard/hr/tickets') return 'Support Tickets';

  // Coding Repository & Question Repository
  if (p === '/dashboard/coding-repository' || p.startsWith('/dashboard/coding-repository/')) return 'Coding Repository';
  if (p === '/dashboard/repository' || p.startsWith('/dashboard/repository/')) return 'Question Repository';

  // Other Dashboard sections
  if (p === '/dashboard/tenants' || p.startsWith('/dashboard/tenants/')) return 'Tenant Management';
  if (p === '/dashboard/settings' || p.startsWith('/dashboard/settings/')) return 'Settings';
  if (p === '/dashboard/onboarding' || p.startsWith('/dashboard/onboarding/')) return 'Onboarding';

  // General Dashboard & HR root (fallback for any other dashboard subpath)
  if (p === '/dashboard' || p === '/dashboard/hr' || p.startsWith('/dashboard/hr') || p.startsWith('/dashboard/')) return 'Dashboard';

  // Candidate / Public Jobs
  if (p === '/jobs') return 'Careers';
  if (p.startsWith('/jobs/')) return 'Job Details';

  // Interview Sessions
  if (p === '/interview/access') return 'Interview Access';
  if (p.startsWith('/interview/live/')) return 'Live Interview';
  if (p.startsWith('/interview/')) return 'AI Interview';

  // Offer
  if (p.startsWith('/offer/')) return 'Offer Response';

  // Informational / Support
  if (p === '/support' || p.startsWith('/support/')) return 'Support';
  if (p === '/terms' || p.startsWith('/terms/')) return 'Terms of Service';
  if (p === '/privacy' || p.startsWith('/privacy/')) return 'Privacy Policy';
  if (p === '/demo' || p.startsWith('/demo/')) return 'Platform Demo';

  return null;
}

export function DynamicBranding() {
  const { branding } = useBranding();
  const pathname = usePathname();
  const { isAuthenticated, activeTenant } = useAuth();

  useEffect(() => {
    if (!branding) return;

    const currentPath = pathname || (typeof window !== 'undefined' ? window.location.pathname : '');
    const normalizedPath = normalizePathname(currentPath);
    const subdomain = getSubdomainSlug();
    const isLanding = !normalizedPath || normalizedPath === '/';

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
    const orgDisplayName =
      branding.companyName && branding.companyName !== 'Default Organization' && branding.companyName !== 'CALDIM'
        ? branding.companyName
        : activeTenant?.name && activeTenant.name !== 'Default Organization' && activeTenant.name !== 'CALDIM'
        ? activeTenant.name
        : subdomain
        ? subdomain.toUpperCase()
        : activeTenant?.slug && activeTenant.slug !== 'default'
        ? activeTenant.slug.toUpperCase()
        : 'CAL-RIMS';

    if (isLanding) {
      if (!subdomain && !isAuthenticated && (!activeTenant || activeTenant.slug === 'default')) {
        document.title = branding.seoTitleDefault || 'CAL-RIMS - AI-Powered Recruitment Intelligence System';
      } else {
        document.title = `Careers | ${orgDisplayName}`;
      }
    } else {
      const pageLabel = getPageLabel(normalizedPath);
      if (pageLabel) {
        document.title = `${pageLabel} | ${orgDisplayName}`;
      } else if (orgDisplayName && orgDisplayName !== 'CAL-RIMS') {
        document.title = `${orgDisplayName} | Recruitment Intelligence System`;
      } else if (branding.seoTitleDefault) {
        document.title = branding.seoTitleDefault;
      }
    }
  }, [branding, pathname, isAuthenticated, activeTenant]);

  return null;
}
