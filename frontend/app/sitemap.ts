import { MetadataRoute } from 'next'
import { getApiBaseUrl } from '@/lib/config'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = (process.env.NEXT_PUBLIC_FRONTEND_URL || 'https://caldimproducts.com/calrims').replace(/\/$/, '');
  const apiBase = getApiBaseUrl();

  const routes = [
    '',
    '/jobs',
    '/privacy',
    '/terms',
    '/support',
    '/company',
  ].map((route) => ({
    url: siteUrl.endsWith('/calrims') ? `${siteUrl}${route}` : `${siteUrl}/calrims${route}`,
    lastModified: new Date(),
    changeFrequency: 'daily' as const,
    priority: route === '' ? 1.0 : 0.8,
  }));

  try {
    const res = await fetch(`${apiBase}/api/jobs/public?limit=200`, {
      next: { revalidate: 300 } // Cache for 5 minutes
    });

    if (res.ok) {
      const jobs = await res.json();
      const jobRoutes = jobs.map((job: any) => {
        const jobId = job.job_id || String(job.id);
        const path = siteUrl.endsWith('/calrims') ? `/jobs/${jobId}` : `/calrims/jobs/${jobId}`;
        return {
          url: `${siteUrl}${path}`,
          lastModified: new Date(job.created_at || new Date()),
          changeFrequency: 'weekly' as const,
          priority: 0.6,
        };
      });
      return [...routes, ...jobRoutes];
    }
  } catch (err) {
    console.error("Failed to fetch jobs for sitemap generation:", err);
  }

  return routes;
}
