/**
 * Client-side configuration for the Automated Recruitment System
 */

export function getApiBaseUrl(): string {
  const rawApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:10000';
  let url = rawApiBaseUrl.replace(/\/+$/, '');

  if (typeof window !== 'undefined') {
    const host = window.location.hostname;

    // If accessing via LAN IP or hostname (e.g. 192.168.x.x), route API calls to that host's port 10000
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
    if (!isLocalhost && (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.endsWith('.local'))) {
      return `${window.location.protocol}//${host}:10000`;
    }

    // In local development on localhost or tenant subdomains (e.g. amazon.localhost)
    if (isLocalhost || window.location.port === '3000') {
      return url || 'http://127.0.0.1:10000';
    }

    if (!process.env.NEXT_PUBLIC_API_BASE_URL) {
      return window.location.origin + '/calrims';
    }

    if (window.location.protocol === 'https:' && url.startsWith('http://') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
      url = url.replace(/^http:\/\//, 'https://');
    }
  }

  return url;
}

/**
 * Resolves API base URL for server-side rendering (SSR) in Node.js.
 * In Docker containers, INTERNAL_API_URL routes directly to backend (e.g. http://backend_blue:10000),
 * avoiding external DNS, loopback alias (127.0.1.1:443), and reverse-proxy overhead.
 */
export function getServerApiBaseUrl(): string {
  if (process.env.INTERNAL_API_URL) {
    return process.env.INTERNAL_API_URL.replace(/\/+$/, '');
  }
  return getApiBaseUrl();
}


// Safeguard: warn in production if API base URL is missing (fallback remains localhost).
if (typeof window !== 'undefined') {
  const isProd = process.env.NODE_ENV === 'production'
  if (isProd && !process.env.NEXT_PUBLIC_API_BASE_URL) {
    // eslint-disable-next-line no-console
    console.warn('[config] NEXT_PUBLIC_API_BASE_URL is not set in production; falling back to localhost')
  }
}

// Other global constants can go here
export const APP_NAME = 'Automated Recruitment System';
