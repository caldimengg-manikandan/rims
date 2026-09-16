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

  // 3. Dashboard routes - require staff/admin token and strict tenant matching
  if (pathname.startsWith('/dashboard')) {
    let isValid = false;
    let tenantMismatch = false;

    if (token) {
      try {
        const secretKey = process.env.JWT_SECRET;
        if (secretKey) {
          const secret = new TextEncoder().encode(secretKey);
          const { payload } = await jwtVerify(token, secret);
          if (payload && (payload.role === 'hr' || payload.role === 'super_admin' || payload.role === 'root-admin' || payload.role === 'root_admin')) {
            const tokenTenantSlug = (payload as any).tenant_slug || (payload as any).app_metadata?.tenant_slug;
            const tokenTenantId = (payload as any).tenant_id || (payload as any).app_metadata?.tenant_id;
            const isRoot = payload.role === 'root-admin' || payload.role === 'root_admin';

            // Restrict /dashboard/tenants strictly to Root Admin
            if (pathname.startsWith('/dashboard/tenants') && !isRoot) {
              const basePath = request.nextUrl.basePath || '';
              return NextResponse.redirect(new URL(`${basePath}/dashboard/hr`, request.url));
            }

            // Enforce tenant matching:
            if (isRoot) {
              // Root Admin can only access central platform, not individual tenant workspaces directly
              if (tenantSlug !== 'default') {
                tenantMismatch = true;
                isValid = false;
              } else {
                isValid = true;
              }
            } else {
              // Tenant-scoped user (tenant super_admin or hr):
              if (tenantSlug !== 'default') {
                if (tokenTenantSlug === tenantSlug) {
                  isValid = true;
                } else {
                  tenantMismatch = true;
                  isValid = false;
                }
              } else {
                // On default / central platform:
                if (!tokenTenantSlug || tokenTenantSlug === 'default') {
                  isValid = true;
                } else {
                  tenantMismatch = true;
                  isValid = false;
                }
              }
            }
          }
        }
      } catch (err) {
        // Token expired or invalid
      }
    }

    if (!isValid) {
      const basePath = request.nextUrl.basePath || '';
      const loginUrl = new URL(`${basePath}/auth/login`, request.url);
      if (tenantMismatch) {
        loginUrl.searchParams.set('error', 'tenant_mismatch');
      } else {
        loginUrl.searchParams.set('expired', 'true');
      }
      loginUrl.searchParams.set('from', pathname);
      loginUrl.searchParams.set('redirect', pathname);
      
      const response = NextResponse.redirect(loginUrl);
      response.cookies.delete('access_token');
      response.cookies.delete('token');
      response.headers.set('x-tenant-slug', tenantSlug);
      return response;
    }
  }

  // 4. Interview routes - require candidate interview JWT (via cookie or query param token)
  if (pathname.startsWith('/interview') && pathname !== '/interview/access' && pathname !== '/interview/access/') {
    const tokenFromQuery = request.nextUrl.searchParams.get('token');
    const cookieToken = request.cookies.get('interview_token')?.value;
    const tokensToTry = [tokenFromQuery, cookieToken].filter(Boolean) as string[];
    let isValid = false;
    let validatedToken: string | null = null;

    const possibleSecrets = [
      process.env.INTERVIEW_JWT_SECRET,
      process.env.JWT_SECRET ? process.env.JWT_SECRET + "_interview" : undefined,
      "Y7sv6mIW9Mtls08f8QKNaEd1hjLk7qy2FFK4A3rzyF9wLjCnKIRIOu8sSeKwd1Hbg_interview",
      "Y7sv6mIW9Mtls08f8QKNaEd1hjLk7qy2FFK4A3rzyF9wLjCnKIRIOu8sSeKwd1Hbg",
      "dev_jwt_secret_key_must_be_at_least_32_chars_long_interview",
      "dev_jwt_secret_key_must_be_at_least_32_chars_long",
    ].filter(Boolean) as string[];

    for (const t of tokensToTry) {
      if (isValid) break;
      for (const s of possibleSecrets) {
        try {
          const secret = new TextEncoder().encode(s);
          const { payload } = await jwtVerify(t, secret);
          if (payload && payload.role === 'interview') {
            isValid = true;
            validatedToken = t;
            break;
          }
        } catch {
          // continue checking other secrets or tokens
        }
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

    const response = NextResponse.next();
    if (validatedToken) {
      response.cookies.set('interview_token', validatedToken, {
        path: '/',
        maxAge: 14400,
        sameSite: 'lax',
      });
    }
    response.headers.set('x-tenant-slug', tenantSlug);
    return response;
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
