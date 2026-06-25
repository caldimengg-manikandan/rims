import React from 'react'
import { Metadata } from 'next'
import { getApiBaseUrl } from '@/lib/config'
import { PublicJobDetail, Job } from '@/components/public-job-detail'

interface PageProps {
  params: Promise<{ id: string }>
}

/**
 * Safely serialize JSON for inline <script> tags.
 * JSON.stringify alone does NOT escape `<`, `>`, or `&`, which allows
 * an attacker to inject `</script>` and break out of the tag (XSS).
 * We replace them with Unicode escape sequences that are 100% valid JSON.
 */
function safeJsonLd(data: object): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/'/g, '\\u0027')
}

async function getJob(id: string): Promise<Job | null> {
  // Sanitize: only allow alphanumeric chars and dashes (e.g. "123" or "JOB-ABC123")
  // Reject anything else to prevent path traversal or URL injection
  if (!/^[a-zA-Z0-9\-]+$/.test(id)) {
    return null
  }
  const apiBase = getApiBaseUrl()
  try {
    const res = await fetch(`${apiBase}/api/jobs/public/${encodeURIComponent(id)}`, {
      next: { revalidate: 60 } // Cache for 1 minute
    })
    if (res.ok) {
      return await res.json()
    }
  } catch (err) {
    console.error(`Failed to fetch job for SSR:`, err)
  }
  return null
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const job = await getJob(id)

  if (!job) {
    return {
      title: 'Position Unavailable | Automated Recruitment System',
      description: 'The job posting you are looking for could not be found or is no longer accepting applications.'
    }
  }

  const title = `${job.title} - ${job.mode_of_work || 'Remote'} | Careers`
  const description = job.description
    ? job.description.substring(0, 160).replace(/\s+/g, ' ').trim() + '...'
    : `Apply for the ${job.title} position today.`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
    }
  }
}

export default async function Page({ params }: PageProps) {
  const { id } = await params
  const job = await getJob(id)

  let jsonLd = null
  if (job) {
    const siteUrl = (process.env.NEXT_PUBLIC_FRONTEND_URL || 'https://caldimproducts.com/calrims').replace(/\/$/, '')
    const jobUrl = siteUrl.endsWith('/calrims') ? `${siteUrl}/jobs/${id}` : `${siteUrl}/calrims/jobs/${id}`
    
    jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      'title': job.title,
      'description': job.description,
      'datePosted': job.created_at,
      'validThrough': job.closed_at || undefined,
      'employmentType': job.job_type === 'Full-Time' ? 'FULL_TIME' : job.job_type === 'Part-Time' ? 'PART_TIME' : 'FULL_TIME',
      'hiringOrganization': {
        '@type': 'Organization',
        'name': 'Automated Recruitment System',
        'sameAs': siteUrl,
      },
      'jobLocation': {
        '@type': 'Place',
        'address': {
          '@type': 'PostalAddress',
          'addressLocality': job.location || 'Remote',
          'addressCountry': 'IN',
        }
      },
      'url': jobUrl,
    }
  }

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
        />
      )}
      <PublicJobDetail initialJob={job as any} jobId={id} />
    </>
  )
}
