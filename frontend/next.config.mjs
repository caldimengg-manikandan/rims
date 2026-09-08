import os from 'os';
import path from 'path';

// Enable polling for Watchpack only if on a network drive or explicitly requested
const isNetworkDrive = process.cwd().toUpperCase().startsWith('Z:');
if (isNetworkDrive || process.env.WATCHPACK_POLLING === 'true') {
  process.env.WATCHPACK_POLLING = 'true';
}

const nextConfig = {
  output: 'standalone',
  allowedDevOrigins: ['127.0.0.1', '127.0.0.1:3000', 'localhost:3000', '192.168.1.78', '192.168.1.78:3000', '192.168.1.173', '192.168.1.173:3000', '*.localhost:3000', 'amazon.localhost:3000', 'acme.localhost:3000', 'nexus.localhost:3000'],
  basePath: '/calrims',
  trailingSlash: true,
  experimental: {
    optimizePackageImports: [
      '@mui/material',
      '@mui/x-date-pickers',
      'recharts',
      'framer-motion',
      'lucide-react',
      'date-fns',
      'dayjs',
      '@radix-ui/react-icons',
      'radix-ui',
    ],
  },
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
  webpack: (config, { dev }) => {
    if (dev) {
      // Direct Webpack compilation cache to local NVMe SSD (os.tmpdir() on C:\)
      // instead of writing thousands of small cache files across network/remote shares
      config.cache = {
        type: 'filesystem',
        cacheDirectory: path.join(os.tmpdir(), 'calrims-next-webpack'),
      };

      const usePolling = process.env.WATCHPACK_POLLING === 'true';
      config.watchOptions = {
        ...(usePolling ? { poll: 1500 } : {}),
        aggregateTimeout: 400,
        ignored: ['**/node_modules/**', '**/.next/**', '**/.git/**', '**/logs/**', '**/coverage/**'],
      };
    }
    return config;
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
      {
        source: '/api/:path*',
        destination: '/calrims/api/:path*',
        permanent: false,
        basePath: false,
      },
    ]
  },
  async rewrites() {
    const backendUrl = (process.env.BACKEND_URL || 'http://127.0.0.1:10000').replace(/\/$/, '');
    return [
      {
        source: '/api/:path((?!generate-pdf|health|geocode).*)',
        destination: `${backendUrl}/api/:path`,
      },
    ]
  }
}
export default nextConfig
