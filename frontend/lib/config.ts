/**
 * Client-side configuration for the Automated Recruitment System
 */

export function getApiBaseUrl(): string {
  const rawApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
  let url = rawApiBaseUrl.replace(/\/+$/, '');

  if (typeof window === 'undefined') {
    return getServerApiBaseUrl();
  }

  const host = window.location.hostname;
  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');

  // In local development (localhost, *.localhost, LAN IP, or port 3000)
  if (isLocalhost || window.location.port === '3000') {
    if (!isLocalhost && (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.endsWith('.local'))) {
      return `${window.location.protocol}//${host}:10000`;
    }
    return url || 'http://127.0.0.1:10000';
  }

  // In production behind Nginx (/calrims), always use the active window origin
  // so tenant subdomains (e.g. acme.caldimproducts.com) stay same-origin and preserve Host/cookies.
  if (!url) {
    return window.location.origin + '/calrims';
  }

  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.hostname !== window.location.hostname && window.location.hostname.endsWith(`.${parsed.hostname}`)) {
      return `${window.location.protocol}//${window.location.host}${parsed.pathname.replace(/\/+$/, '')}`;
    }
  } catch {
    // Keep fallback url
  }

  if (window.location.protocol === 'https:' && url.startsWith('http://') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
    url = url.replace(/^http:\/\//, 'https://');
  }

  return url;
}

/**
 * Resolves API base URL for server-side rendering (SSR) in Node.js.
 * In Docker containers, INTERNAL_API_URL (or API_INTERNAL_URL / BRANDING_API_URL)
 * routes directly to the internal backend container (e.g. http://backend_blue:10000 or http://backend_green:10000),
 * avoiding external DNS, loopback alias (127.0.1.1:443), and reverse-proxy overhead.
 */
export function getServerApiBaseUrl(): string {
  const internal =
    process.env.INTERNAL_API_URL ||
    process.env.API_INTERNAL_URL ||
    process.env.BRANDING_API_URL ||
    process.env.NEXT_PUBLIC_INTERNAL_API_URL;
  if (internal) {
    return internal.replace(/\/+$/, '');
  }
  const rawApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:10000';
  return rawApiBaseUrl.replace(/\/+$/, '');
}

// Other global constants can go here
export const APP_NAME = 'Automated Recruitment System';
