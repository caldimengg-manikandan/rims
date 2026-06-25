import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const siteUrl = (process.env.NEXT_PUBLIC_FRONTEND_URL || 'https://caldimproducts.com/calrims').replace(/\/$/, '');
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/jobs', '/jobs/', '/privacy', '/terms', '/support', '/company'],
      disallow: ['/dashboard', '/dashboard/', '/api/'],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
