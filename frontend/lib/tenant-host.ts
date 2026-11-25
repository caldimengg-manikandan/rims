/**
 * Shared multi-tenant host/subdomain parsing utilities.
 * Safe for Next.js Edge Middleware, Server Components, and Browser Client code.
 */

export const RESERVED_SUBDOMAINS = new Set([
  'www',
  'api',
  'mail',
  'admin',
  'static',
  'cdn',
  'assets',
  'auth',
  'staging',
  'preview',
  'sandbox',
]);

const KNOWN_APEX_DOMAINS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  'calrims.com',
  'rims.app',
  'calrims.local',
  'caldimproducts.com',
]);

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Extract the tenant slug from a Host / hostname string.
 * Returns null for apex domains (e.g. caldimproducts.com), localhost, bare IPs,
 * and reserved subdomains (www, api, etc.).
 */
export function extractSubdomainSlug(host: string | null | undefined): string | null {
  if (!host) return null;
  const hostname = host.split(':')[0].toLowerCase().trim();
  if (!hostname || IPV4_RE.test(hostname) || KNOWN_APEX_DOMAINS.has(hostname)) {
    return null;
  }

  // Support *.localhost out of the box (e.g. acme.localhost -> acme)
  if (hostname.endsWith('.localhost')) {
    const sub = hostname.slice(0, -'.localhost'.length);
    if (sub && !RESERVED_SUBDOMAINS.has(sub)) {
      return sub;
    }
    return null;
  }

  const parts = hostname.split('.');
  // Standard internet hostnames require at least 3 labels for a subdomain (e.g. acme.caldimproducts.com)
  if (parts.length < 3) {
    return null;
  }

  const candidate = parts[0];
  if (!candidate || RESERVED_SUBDOMAINS.has(candidate)) {
    return null;
  }

  return candidate;
}
