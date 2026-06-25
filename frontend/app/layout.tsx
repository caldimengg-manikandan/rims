import React, { Suspense } from "react"
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { AuthProvider } from '@/app/dashboard/lib/auth-context'
import { ThemeProvider } from '@/components/theme-provider'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'
import { SWRProvider } from '@/app/dashboard/lib/swr-provider';
import { TooltipProvider } from "@/components/ui/tooltip"
import { GlobalNavbar } from '@/components/global-navbar'
import { NavigationProgress } from '@/components/navigation-progress'
import { ScrollContainer } from '@/components/scroll-container'

import { getBrandingServer } from '@/lib/branding-server';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBrandingServer();
  const siteUrl = (process.env.NEXT_PUBLIC_FRONTEND_URL || 'https://caldimproducts.com/calrims').replace(/\/$/, '');
  const canonicalUrl = siteUrl.endsWith('/calrims') ? `${siteUrl}/` : `${siteUrl}/calrims/`;

  return {
    metadataBase: new URL(siteUrl),
    title: branding.seoTitleDefault,
    description: branding.seoDescriptionDefault,
    openGraph: {
      title: branding.seoTitleDefault,
      description: branding.seoDescriptionDefault,
      images: [`${siteUrl}/logo.png`],
      type: 'website',
      url: canonicalUrl,
    },
    twitter: {
      card: 'summary_large_image',
      title: branding.seoTitleDefault,
      description: branding.seoDescriptionDefault,
      images: [`${siteUrl}/logo.png`],
    },
    alternates: {
      canonical: canonicalUrl,
    },
    generator: branding.productName,
    icons: {
      icon: branding.faviconUrl,
      shortcut: branding.faviconUrl,
      apple: branding.faviconUrl,
    }
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const branding = await getBrandingServer();
  const safeThemeColor = /^#[0-9A-Fa-f]{3,8}$/.test(branding.themeColor || "") 
    ? branding.themeColor 
    : "#2563eb";

  const headerList = await headers();
  const nonce = headerList.get('x-nonce') || undefined;

  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <script src="/calrims/js/chunk-error-handler.js" defer nonce={nonce} />
      </head>
      <body className="app-shell font-sans" suppressHydrationWarning style={{ margin: 0, padding: 0 }}>
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: `
          :root {
            --primary: ${safeThemeColor} !important;
            --ring: ${safeThemeColor} !important;
          }
          .dark {
            --primary: ${safeThemeColor} !important;
            --ring: ${safeThemeColor} !important;
          }
        `}} />
        <SWRProvider>
          {/* Stable container to mitigate hydration issues from browser extensions */}
          <div className="relative flex flex-col h-screen overflow-hidden">
            {/* Global grid background for all pages */}
            <div className="app-shell-grid" />
            <div className="app-shell-watermark" />

            <AuthProvider>
              <ThemeProvider
                attribute="class"
                defaultTheme="system"
                enableSystem
                disableTransitionOnChange
                nonce={nonce}
              >
                <div className="app-shell-content flex flex-col h-full flex-1 overflow-hidden" suppressHydrationWarning>
                  <TooltipProvider delayDuration={300}>
                    <Suspense fallback={null}>
                      <NavigationProgress />
                    </Suspense>
                    <header className="shrink-0 flex flex-col sticky top-0 z-[100]">
                      <GlobalNavbar />
                    </header>
                    <ScrollContainer>
                      {children}
                    </ScrollContainer>
                    <Toaster richColors position="top-right" />
                  </TooltipProvider>
                </div>
              </ThemeProvider>
            </AuthProvider>
          </div>
        </SWRProvider>
      </body>
    </html>
  )
}
