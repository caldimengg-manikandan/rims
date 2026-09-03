import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

/**
 * Next.js Middleware — Multi-Tenant Resolution & Route Protection
 */

const RESERVED_SUBDOMAINS = new Set([
  'www', 'api', 'mail', 'admin', 'static', 'cdn', 'assets',
  'auth', 'staging', 'preview', 'sandbox',
]);

function extractSlugFromHost(host: string): string | null {
  if (!host) return null;
  const hostname = host.split(':')[0].toLowerCase().trim();

  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
  ) {
    return null;
  }

  // Support *.localhost out of the box (e.g., acme.localhost, nexus.localhost)
  if (hostname.endsWith('.localhost')) {
    const sub = hostname.slice(0, -'.localhost'.length);
    if (sub && !RESERVED_SUBDOMAINS.has(sub)) return sub;
  }

  const parts = hostname.split('.');
  if (parts.length < 2) return null;

  const candidate = parts[0];
  if (RESERVED_SUBDOMAINS.has(candidate)) return null;

  return candidate;
}

function extractSlugFromHeader(request: NextRequest): string | null {
  return (
    request.headers.get('x-tenant-slug') ||
    request.headers.get('x-tenant-id') ||
    null
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Resolve Tenant Context
  const host = request.headers.get('host') ?? '';
  let tenantSlug =
    extractSlugFromHost(host) ??
    extractSlugFromHeader(request) ??
    'default';

  if (!/^[a-z0-9-]{1,100}$/.test(tenantSlug)) {
    tenantSlug = 'default';
  }


  const token = request.cookies.get('access_token')?.value || request.cookies.get('token')?.value;

  // 3. Dashboard routes - require staff/admin token
  if (pathname.startsWith('/dashboard')) {
    let isValid = false;

    if (token) {
      try {
        const secretKey = process.env.JWT_SECRET;
        if (secretKey) {
          const secret = new TextEncoder().encode(secretKey);
          const { payload } = await jwtVerify(token, secret);
          if (payload && (payload.role === 'hr' || payload.role === 'super_admin')) {
            isValid = true;
          }
        }
      } catch (err) {
        // Token expired or invalid
      }
    }

    if (!isValid) {
      const basePath = request.nextUrl.basePath || '';
      const loginUrl = new URL(`${basePath}/auth/login`, request.url);
      loginUrl.searchParams.set('expired', 'true');
      loginUrl.searchParams.set('from', pathname);
      loginUrl.searchParams.set('redirect', pathname);
      
      const response = NextResponse.redirect(loginUrl);
      response.cookies.delete('access_token');
      response.cookies.delete('token');
      response.headers.set('x-tenant-slug', tenantSlug);
      return response;
    }
  }

  // 4. Interview routes - require candidate interview JWT
  if (pathname.startsWith('/interview') && pathname !== '/interview/access' && pathname !== '/interview/access/') {
    const interviewToken = request.cookies.get('interview_token')?.value;
    let isValid = false;

    if (interviewToken) {
      try {
        const secretKey = process.env.INTERVIEW_JWT_SECRET || (process.env.JWT_SECRET ? process.env.JWT_SECRET + "_interview" : "");
        if (secretKey) {
          const secret = new TextEncoder().encode(secretKey);
          const { payload } = await jwtVerify(interviewToken, secret);
          if (payload && payload.role === 'interview') {
            isValid = true;
          }
        }
      } catch (err) {
        // Token invalid
      }
    }

    if (!isValid) {
      const basePath = request.nextUrl.basePath || '';
      const accessUrl = new URL(`${basePath}/interview/access/`, request.url);
      const response = NextResponse.redirect(accessUrl);
      response.cookies.delete('interview_token');
      response.headers.set('x-tenant-slug', tenantSlug);
      return response;
    }
  }

  // 5. Offer routes - require a token parameter in the URL
  if (pathname.startsWith('/offer')) {
    const offerToken = request.nextUrl.searchParams.get('token');
    if (!offerToken) {
      const basePath = request.nextUrl.basePath || '';
      const response = NextResponse.redirect(new URL(`${basePath}/support`, request.url));
      response.headers.set('x-tenant-slug', tenantSlug);
      return response;
    }
  }

  // Pass tenant header to downstream components & rewrites
  const response = NextResponse.next();
  response.headers.set('x-tenant-slug', tenantSlug);
  return response;
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/interview/:path*',
    '/offer/:path*',
    '/jobs/:path*',
    '/careers/:path*',
    '/apply/:path*',
  ],
};
