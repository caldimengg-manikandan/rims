import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

/**
 * Middleware for server-side route protection and security headers (CSP Nonce generation).
 * Next.js in this setup executes proxy.ts as the entry point middleware.
 */
export async function proxy(request: NextRequest) {
  const token = request.cookies.get('access_token')?.value || request.cookies.get('token')?.value;
  const { pathname } = request.nextUrl;

  // 1. Dashboard routes - require staff/admin token
  if (pathname.startsWith('/dashboard')) {
    let isValid = false;

    if (token) {
      try {
        const secretKey = process.env.JWT_SECRET;
        if (!secretKey) {
          console.error('JWT_SECRET is not configured on the server.');
          return NextResponse.redirect(new URL('/auth/login?error=config', request.url));
        }
        const secret = new TextEncoder().encode(secretKey);
        const { payload } = await jwtVerify(token, secret);
        if (payload && (payload.role === 'hr' || payload.role === 'super_admin')) {
          isValid = true;
        }
      } catch (err) {
        console.error('JWT verification failed in middleware:', err);
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
      return response;
    }
  }

  // 2. Interview routes - require candidate interview JWT (except access page)
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
        console.error('Interview JWT verification failed in middleware:', err);
      }
    }

    if (!isValid) {
      const basePath = request.nextUrl.basePath || '';
      const accessUrl = new URL(`${basePath}/interview/access/`, request.url);
      const response = NextResponse.redirect(accessUrl);
      response.cookies.delete('interview_token');
      return response;
    }
  }

  // 3. Offer routes - require a token parameter in the URL
  if (pathname.startsWith('/offer')) {
    const offerToken = request.nextUrl.searchParams.get('token');
    if (!offerToken) {
      const basePath = request.nextUrl.basePath || '';
      return NextResponse.redirect(new URL(`${basePath}/support`, request.url));
    }
  }

  // 4. Generate secure dynamic nonce for the browser CSP and Next.js internal hydration scripts
  const nonce = btoa(crypto.randomUUID());
  const isProd = process.env.NODE_ENV === 'production';

  const devConnectSrc = isProd
    ? ''
    : ' http://localhost:10000 http://127.0.0.1:10000 http://192.168.1.173:10000 ws://localhost:3000 ws://127.0.0.1:3000';

  const scriptSrc = isProd
    ? `script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net`
    : `script-src 'self' 'nonce-${nonce}' 'unsafe-eval' https://cdn.jsdelivr.net`;

  const cspHeader = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://*.supabase.co https://*.googleusercontent.com",
    `connect-src 'self' https://*.supabase.co https://api.openai.com https://api.anthropic.com https://api.groq.com https://tfhub.dev https://storage.googleapis.com${devConnectSrc}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');

  // Set the headers in the request so Next.js reads the nonce
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', cspHeader);

  // Create the final response using the modified request headers
  const finalResponse = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // Apply the CSP header on the response so the browser enforces it
  finalResponse.headers.set('Content-Security-Policy', cspHeader);

  return finalResponse;
}

// Intercept all document requests to apply CSP, while capturing auth check routes
export const config = {
  matcher: [
    /*
     * Match all request paths except static files, images, etc.
     * Also match routes required by auth checks (/dashboard, /interview, /offer)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
};
