import { Metadata } from 'next';

import { getBrandingServer } from '@/lib/branding-server';

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBrandingServer();
  const siteUrl = (process.env.NEXT_PUBLIC_FRONTEND_URL || 'https://caldimproducts.com/calrims').replace(/\/$/, '');
  const canonicalUrl = `${siteUrl}/privacy/`;
  
  return {
    title: `Privacy Policy – ${branding.productName}`,
    description: `Read the Privacy Policy for ${branding.productName}. Understand how we collect, use, and protect your data while complying with global privacy standards.`,
    openGraph: {
      title: `Privacy Policy – ${branding.productName}`,
      description: `Read the Privacy Policy for ${branding.productName}. Understand how we collect, use, and protect your data while complying with global privacy standards.`,
      images: [branding.logoUrl],
    },
    alternates: {
      canonical: canonicalUrl,
    }
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
   