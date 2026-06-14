/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';
const devConnectSrc = isProd
  ? ''
  : ' http://localhost:10000 http://127.0.0.1:10000 http://192.168.1.173:10000 ws://localhost:3000 ws://127.0.0.1:3000';
const scriptSrc = isProd
  ? "script-src 'self' https://cdn.jsdelivr.net"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net";

const contentSecurityPolicy = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://*.supabase.co https://*.googleusercontent.com",
  `connect-src 'self' https://*.supabase.co https://api.openai.com https://api.anthropic.com https://api.groq.com https://tfhub.dev https://storage.googleapis.com${devConnectSrc}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

const nextConfig = {
  output: 'standalone',
  allowedDevOrigins: ['127.0.0.1', 'localhost:3000', '192.168.1.173', '192.168.1.173:3000'],
  basePath: '/calrims',
  trailingSlash: true,
  devIndicators: {
    appIsrStatus: false,
    buildActivity: false,
    buildActivityPosition: 'bottom-right',
  },
  typescript: {
    ignoreBuildErrors: true,
  },

  images: {
    unoptimized: false,
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error'] } : false,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          {
            key: 'Content-Security-Policy',
            value: contentSecurityPolicy,
          },
        ],
      },
    ]
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: '/calrims/',
        permanent: false,
        basePath: false,
      },
      {
        source: '/auth/:path*',
        destination: '/calrims/auth/:path*',
        permanent: false,
        basePath: false,
      },
      {
        source: '/dashboard/:path*',
        destination: '/calrims/dashboard/:path*',
        permanent: false,
        basePath: false,
      },
      {
        source: '/jobs/:path*',
        destination: '/calrims/jobs/:path*',
        permanent: false,
        basePath: false,
      },
      {
        source: '/interview/:path*',
        destination: '/calrims/interview/:path*',
        permanent: false,
        basePath: false,
      },
      {
        source: '/support/:path*',
        destination: '/calrims/support/:path*',
        permanent: false,
        basePath: false,
      },
      {
        source: '/terms/:path*',
        destination: '/calrims/terms/:path*',
        permanent: false,
        basePath: false,
      },
      {
        source: '/privacy/:path*',
        destination: '/calrims/privacy/:path*',
        permanent: false,
        basePath: false,
      },
      {
        source: '/offer/:path*',
        destination: '/calrims/offer/:path*',
        permanent: false,
        basePath: false,
      },
      {
        source: '/company/:path*',
        destination: '/calrims/company/:path*',
        permanent: false,
        basePath: false,
      },
    ]
  },
  async rewrites() {
    const backendUrl = (process.env.BACKEND_URL || 'http://127.0.0.1:10000').replace(/\/$/, '');
    return [
      {
        source: '/api/((?!generate-pdf|health).*)',
        destination: `${backendUrl}/api/:1`,
      },
    ]
  }
}
export default nextConfig
