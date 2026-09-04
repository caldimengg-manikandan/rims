'use client'

import React, { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/app/dashboard/lib/auth-context'
import { ChevronRight } from 'lucide-react'
import { UserNav } from '@/components/user-nav'
import { NotificationBell } from '@/components/notification-bell'
import { ToggleTheme } from '@/components/lightswind/toggle-theme'
import { ThemeTogglerButton } from '@/components/animate-ui/components/buttons/theme-toggler'
import { TenantSwitcher } from '@/components/tenant-switcher'
import useSWR from 'swr'
import { APIClient } from '@/app/dashboard/lib/api-client'
import { useBranding } from '@/lib/branding-client'

export const GlobalNavbar = React.memo(function GlobalNavbar() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const pathname = usePathname()
  const { isAuthenticated, user } = useAuth()

  const { branding } = useBranding()
  const rawCompanyName = branding.companyName
  const companyName = (!rawCompanyName || rawCompanyName === 'Default Organization') ? 'CAL-RIMS' : rawCompanyName
  const companyLogo = branding.logoUrl || '/calrims/logo.png'

  if (!mounted) return null

  const isDashboard = pathname?.startsWith('/dashboard')
  const isAuth = pathname?.startsWith('/auth')
  const isJobs = pathname?.startsWith('/jobs')
  const isHome = pathname === '/'
  const isInterview = pathname?.startsWith('/interview')

  if (isInterview) return null

  const NavContent = () => (
    <div className="flex flex-col md:flex-row items-start md:items-center gap-4 p-4 md:p-0">
      {!isDashboard && (
        <div className="flex items-center gap-4 font-semibold text-sm">
          {!isHome && (
            <Link href="/" prefetch={false} className="text-muted-foreground hover:text-foreground hover:scale-105 active:scale-95 transition-all duration-200 block">
              Home
            </Link>
          )}
          {!isJobs && (
            <Link href="/jobs" prefetch={false} className="text-muted-foreground hover:text-foreground hover:scale-105 active:scale-95 transition-all duration-200 block">
              Browse Roles
            </Link>
          )}
          {!isAuth && (
            <Link href="/auth/login?role=hr" prefetch={false} className="text-muted-foreground hover:text-foreground hover:scale-105 active:scale-95 transition-all duration-200 block">
              HR Portal
            </Link>
          )}
        </div>
      )}

      <ToggleTheme className="text-muted-foreground hover:text-foreground hover:bg-accent hidden md:flex" />

      {isDashboard ? (
        <div className="flex items-center gap-2 md:gap-4">
          <TenantSwitcher />
          <NotificationBell />
          <UserNav />
        </div>
      ) : (isAuthenticated && !isJobs && !isHome && !isAuth) ? (
        <Link href={user?.role === 'candidate' ? '/jobs' : '/dashboard/hr'} prefetch={false} className="w-full md:w-auto">
          <Button className="w-full md:w-auto rounded-full px-6 bg-primary text-primary-foreground hover:bg-primary/90 font-bold transition-all shadow-lg shadow-primary/20">
            {user?.role === 'candidate' ? 'Browse Jobs' : 'Go to Dashboard'} <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </Link>
      ) : null}
    </div>
  )

  const logoLink = isAuthenticated 
    ? (user?.role === 'candidate' ? '/jobs' : '/dashboard/hr') 
    : '/'

  return (
    <nav className="sticky top-0 w-full z-50 bg-sidebar/45 backdrop-blur-xl border-b border-border/40 h-16 flex items-center shrink-0 shadow-[0_1px_0_0_color-mix(in_oklab,var(--border)_80%,transparent),0_4px_16px_-4px_rgba(0,0,0,0.02)] transition-colors duration-300">
      <div className="w-full px-4 flex items-center justify-between">

        {/* Left: Logo and Title */}
        <Link href={logoLink} prefetch={false} className="flex items-center gap-3 group">
          <div className="bg-primary/10 p-1.5 rounded-xl group-hover:scale-110 transition-transform border border-primary/20 shadow-sm group-hover:bg-primary/15 group-hover:shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_10%,transparent)]">
            <img src={companyLogo} alt="Logo" className="h-7 w-auto object-contain max-w-[150px] group-hover:scale-105 transition-transform" />
          </div>
          <span className="text-lg font-extrabold tracking-tight text-foreground hidden lg:block uppercase pl-2 border-l-2 border-primary/30">
            {companyName}
          </span>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:block">
          <NavContent />
        </div>

        {/* Mobile Navigation Toggle */}
        <div className="flex items-center gap-2 md:hidden">
          <ToggleTheme className="text-muted-foreground" />
          <Button
            variant="ghost"
            size="icon"
            className="text-foreground hover:scale-105 active:scale-95 transition-all duration-200"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
            )}
          </Button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {isMenuOpen && (
        <div className="absolute top-16 left-0 w-full bg-background/95 backdrop-blur-xl border-b border-border md:hidden animate-in slide-in-from-top-2 fade-in duration-200 shadow-xl z-50">
          <NavContent />
        </div>
      )}
    </nav>
  )
})
