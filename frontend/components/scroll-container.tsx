'use client'

import React from 'react'
import { usePathname } from 'next/navigation'
import { ErrorBoundary } from '@/components/error-boundary'

interface ScrollContainerProps {
  children: React.ReactNode
}

/**
 * ScrollContainer is the single scroll authority for non-dashboard pages.
 *
 * Dashboard / auth → overflow-hidden on <main>; the dashboard layout owns
 *   its own overflow-y-auto content zone. The inner div uses min-h-0 so the
 *   flex chain stays bounded (no double scroll in the sidebar layout).
 *
 * Public pages (landing, jobs, etc.) → overflow-y-auto on <main>; the inner
 *   div must NOT have min-h-0, otherwise it gets clamped to the viewport and
 *   both it AND <main> register as scroll zones (double scrollbar).
 */
export function ScrollContainer({ children }: ScrollContainerProps) {
  const pathname = usePathname()
  const isDashboard = pathname?.startsWith('/dashboard')
  const isAuth = pathname?.startsWith('/auth')
  const isConstrained = isDashboard || isAuth

  React.useEffect(() => {
    if (isConstrained) {
      document.documentElement.classList.add('layout-constrained')
      document.body.classList.add('layout-constrained')
    } else {
      document.documentElement.classList.remove('layout-constrained')
      document.body.classList.remove('layout-constrained')
    }
    return () => {
      document.documentElement.classList.remove('layout-constrained')
      document.body.classList.remove('layout-constrained')
    }
  }, [isConstrained])

  return (
    <main className={`flex-1 min-h-0 w-full flex flex-col ${isConstrained ? 'overflow-hidden' : 'overflow-y-auto'}`}>
      <ErrorBoundary>
        {/* min-h-0 only for dashboard/auth where the sidebar flex-chain must stay bounded */}
        <div className={`flex-1 flex flex-col${isConstrained ? ' min-h-0' : ''}`}>
          {children}
        </div>
      </ErrorBoundary>
    </main>
  )
}
