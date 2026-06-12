'use client'

import React from "react"

import { useAuth } from '@/app/dashboard/lib/auth-context'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { SidebarProvider } from '@/components/animate-ui/components/radix/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { UserNav } from '@/components/user-nav'
import { ToggleTheme } from '@/components/lightswind/toggle-theme'
import { NotificationBell } from '@/components/notification-bell'
import { Search } from 'lucide-react'
import { SWRConfig, mutate as globalMutate } from 'swr'
import { fetcher } from '@/app/dashboard/lib/swr-fetcher'
import { useSessionIntelligence } from '@/hooks/use-session-intelligence'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, isAuthenticated, isLoading, isOffline } = useAuth()
  const router = useRouter()
  const [isMounted, setIsMounted] = useState(false)

  // Session intelligence: auto-tracks page visits
  useSessionIntelligence()

  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    // Only redirect to login if we are CERTAIN that the user is not authenticated
    // (or is not an HR / Admin) and the loading process has finished without network errors.
    if (isMounted && !isLoading && !isOffline) {
      if (!isAuthenticated || (user && user.role !== 'hr' && user.role !== 'super_admin')) {
        router.push('/auth/login?expired=true')
      }
    }
  }, [isAuthenticated, user, isLoading, isOffline, isMounted, router])

  useEffect(() => {
    const handleDataMutation = (event: Event) => {
      const customEvent = event as CustomEvent<{ keys?: string[] }>
      const keys = customEvent.detail?.keys || []
      for (const key of keys) {
        globalMutate(
          (cacheKey) => typeof cacheKey === 'string' && (cacheKey === key || cacheKey.startsWith(`${key}?`)),
          undefined,
          { revalidate: true },
        )
      }
    }

    window.addEventListener('rims:data-mutated', handleDataMutation)
    return () => window.removeEventListener('rims:data-mutated', handleDataMutation)
  }, [])

  if (!isMounted || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5">
        <div className="flex flex-col items-center gap-6 animate-in fade-in zoom-in duration-500">
          <div className="relative">
            <div className="h-16 w-16 rounded-full border-4 border-primary/10 border-t-primary animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-8 w-8 rounded-full bg-primary/10 animate-pulse" />
            </div>
          </div>
          <div className="text-center space-y-1">
            <p className="text-base font-bold text-foreground tracking-tight">Loading your workspace</p>
            <p className="text-sm text-muted-foreground">Preparing everything for you...</p>
          </div>
        </div>
      </div>
    )
  }

  const isUserAuthorized = isAuthenticated && user && (user.role === 'hr' || user.role === 'super_admin')

  // Prevent rendering protected content for unauthenticated or unauthorized users
  if (!isUserAuthorized && !isOffline) {
    return null;
  }

  if (isOffline && !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-destructive/5 p-6 text-center">
        <div className="max-w-md space-y-6 animate-in fade-in zoom-in duration-500">
          <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mx-auto border border-destructive/20 shadow-[0_0_0_8px_rgba(239,68,68,0.05)]">
            <span className="text-4xl text-destructive font-black">!</span>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-black tracking-tight">Connection Lost</h1>
            <p className="text-muted-foreground leading-relaxed">
              Unable to connect to the recruitment server. Please check your internet connection or verify the backend is running.
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-8 py-3 bg-primary text-primary-foreground rounded-xl font-bold hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] transition-all duration-200"
          >
            Retry Connection
          </button>
        </div>
      </div>
    )
  }

  if (!isUserAuthorized) {
    // Fallback while redirecting
    return null
  }

  return (
    <SWRConfig
      value={{
        fetcher,
        revalidateOnFocus: false,   // disabled: prevents refetch on every tab focus
        revalidateOnReconnect: true,
        dedupingInterval: 15_000,   // increased: reduces duplicate requests on navigation
        errorRetryCount: 2,
        // Don't retry on auth errors — retrying 401/403 worsens redirect loops
        shouldRetryOnError: (error: any) => {
          const status = error?.status ?? error?.statusCode
          if (status === 401 || status === 403) return false
          return true
        }
      }}
    >
      <SidebarProvider className="relative overflow-hidden h-full">
        <div className="pointer-events-none absolute inset-0 z-0 opacity-80">
          <div className="absolute inset-0 bg-background/95" />
        </div>

      <AppSidebar />

          {/* Right panel: flex-1 min-h-0 so it shrinks properly; overflow-hidden clips children */}
          <div className="flex-1 min-h-0 flex flex-col relative z-10 transition-all duration-400 ease-[cubic-bezier(0.75,0,0.25,1)] overflow-hidden">
            {/* Decorative glow blobs — purely cosmetic */}
            {/* Single scroll zone - this is the ONLY element that scrolls */}
            <div className="flex-1 min-h-0 px-4 py-5 sm:px-5 md:px-7 md:py-7 overflow-y-auto overflow-x-hidden scrollbar-premium">
              <div className="w-full max-w-[1600px] mx-auto">
                {children}
              </div>
            </div>
          </div>
      </SidebarProvider>
    </SWRConfig>
  )
}
