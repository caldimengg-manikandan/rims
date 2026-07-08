/** @type {import('next').NextConfig} */

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
    ignoreBuildErrors: false,
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
        source: '/api/:path((?!generate-pdf|health).*)',
        destination: `${backendUrl}/api/:path`,
      },
    ]
  }
}
export default nextConfig
