/**
 * Client-side configuration for the Automated Recruitment System
 */

export function getApiBaseUrl(): string {
  const rawApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:10000';
  let url = rawApiBaseUrl.replace(/\/+$/, '');

  if (typeof window !== 'undefined') {
    const host = window.location.hostname;

    // In local development (localhost, 127.0.0.1, *.localhost, *.local, or port 3000)
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      window.location.port === '3000'
    ) {
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
