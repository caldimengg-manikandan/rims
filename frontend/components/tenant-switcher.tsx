'use client'

/**
 * TenantSwitcher — Multi-Tenant Organization Switcher & Organization Badge
 *
 * Rules:
 *  1. ONLY the CALRIMS Platform Super Admin (Global Super Admin) is permitted to
 *     view and use the Tenant Switcher dropdown to switch between client organizations.
 *  2. All other users (Tenant Super Admins, HR Recruiters, Hiring Managers) are
 *     strictly locked to their own organization and only see a static Organization Badge.
 *  3. Automatically locks active tenant context to the subdomain when browsing
 *     on a dedicated tenant hostname (e.g. amazon.localhost:3000 -> amazon).
 */

import React, { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/app/dashboard/lib/auth-context'
import { APIClient } from '@/app/dashboard/lib/api-client'
import { Building2, ShieldCheck, ChevronDown, Check } from 'lucide-react'

interface TenantOption {
  id: string
  name: string
  slug: string
  logo_url: string | null
  status: string
}

function getSubdomainSlug(): string | null {
  if (typeof window === 'undefined') return null
  const host = window.location.hostname.toLowerCase()
  if (host.endsWith('.localhost')) {
    const sub = host.replace('.localhost', '')
    if (sub && sub !== 'localhost' && sub !== 'www' && sub !== '127.0.0.1') return sub
  }
  const parts = host.split('.')
  if (parts.length >= 3 && parts[0] !== 'www') {
    return parts[0]
  }
  return null
}

export function TenantSwitcher() {
  const { activeTenant, setActiveTenant, isAuthenticated, user } = useAuth()
  const [tenants, setTenants] = useState<TenantOption[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Determine if current user is the CALRIMS Platform Super Admin
  const isPlatformSuperAdmin = Boolean(
    isAuthenticated &&
    user &&
    ((user as any).is_platform_super_admin === true ||
      ['caldiminternship@gmail.com', 'test.admin@calrims.local', 'admin@calrims.com'].includes(user.email?.toLowerCase().trim()))
  )

  useEffect(() => {
    if (!isAuthenticated) return

    let cancelled = false
    setLoading(true)

    const subdomainSlug = getSubdomainSlug()

    APIClient.get<TenantOption[]>('/api/auth/tenants')
      .then((data) => {
        if (cancelled) return
        const list = data ?? []
        setTenants(list)

        // If visiting on a dedicated subdomain (e.g. amazon.localhost:3000), lock to that tenant
        if (subdomainSlug) {
          const match = list.find((t) => t.slug === subdomainSlug)
          if (match && activeTenant?.slug !== match.slug) {
            setActiveTenant(match)
            if (typeof sessionStorage !== 'undefined') {
              sessionStorage.setItem('tenant_slug', match.slug)
              sessionStorage.setItem('tenant_id', match.id)
            }
            return
          } else if (!match && activeTenant?.slug !== subdomainSlug) {
            const fallback = {
              id: subdomainSlug,
              slug: subdomainSlug,
              name: subdomainSlug.charAt(0).toUpperCase() + subdomainSlug.slice(1),
              logo_url: null,
              status: 'active',
            }
            setActiveTenant(fallback)
            return
          }
        }

        // If on root domain, set initial active tenant
        if (!activeTenant && list.length > 0) {
          const savedSlug = typeof window !== 'undefined' ? sessionStorage.getItem('tenant_slug') : null
          const initial =
            list.find((t) => t.slug === savedSlug) ||
            list.find((t) => t.slug !== 'default') ||
            list[0]
          if (initial) {
            setActiveTenant(initial)
          }
        }
      })
      .catch(() => {
        // Silently handle
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [isAuthenticated, activeTenant, setActiveTenant])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (!isAuthenticated) return null

  // CASE 1: Regular Organization Super Admin or HR Recruiter
  // -> Render only a sleek, static Organization Badge. No switcher dropdown!
  if (!isPlatformSuperAdmin) {
    const orgName = activeTenant?.name || (getSubdomainSlug() ? getSubdomainSlug()!.toUpperCase() : 'Organization')
    const logoUrl = activeTenant?.logo_url

    return (
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-primary/10 border border-primary/20 text-foreground text-xs font-semibold select-none shadow-sm"
        title={`Active Organization: ${orgName}`}
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={orgName}
            className="w-4 h-4 rounded object-cover"
            onError={(e) => {
              ;(e.currentTarget as HTMLElement).style.display = 'none'
            }}
          />
        ) : (
          <Building2 className="w-3.5 h-3.5 text-primary shrink-0" />
        )}
        <span className="truncate max-w-[140px] font-bold text-foreground">{orgName}</span>
        <span className="text-[10px] px-1.5 py-0.2 rounded bg-primary/20 text-primary font-medium">Org</span>
      </div>
    )
  }

  // CASE 2: CALRIMS Platform Super Admin
  // -> Render the interactive multi-tenant Switcher
  const handleSelect = (tenant: TenantOption) => {
    setOpen(false)
    if (tenant.id === activeTenant?.id) return

    setActiveTenant({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      logo_url: tenant.logo_url,
    })

    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('tenant_slug', tenant.slug)
      sessionStorage.setItem('tenant_id', tenant.id)
    }

    // Trigger full SWR revalidation so all dashboard data refreshes for the new tenant
    window.dispatchEvent(
      new CustomEvent('rims:data-mutated', {
        detail: { keys: ['*'] },
      })
    )
  }

  return (
    <div ref={dropdownRef} className="relative font-sans text-xs">
      {/* Trigger button */}
      <button
        id="tenant-switcher-btn"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Switch Organization (Platform Super Admin)"
        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all cursor-pointer font-medium max-w-[210px] ${
          open
            ? 'bg-muted border-primary/40 text-foreground shadow-md'
            : 'bg-card/70 hover:bg-muted/80 border-border/70 text-foreground'
        }`}
      >
        {/* Logo or initials */}
        {activeTenant?.logo_url ? (
          <img
            src={activeTenant.logo_url}
            alt={activeTenant.name}
            className="w-4 h-4 rounded object-cover"
          />
        ) : (
          <span className="w-4 h-4 rounded bg-primary/20 text-primary flex items-center justify-center font-bold text-[10px] shrink-0">
            {(activeTenant?.name ?? 'D')[0].toUpperCase()}
          </span>
        )}

        <span className="truncate flex-1 text-left font-semibold">
          {activeTenant?.name ?? 'Select Org'}
        </span>

        <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-500 font-bold uppercase">
          Admin
        </span>

        <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {open && (
        <div
          role="listbox"
          aria-label="Select organization"
          className="absolute right-0 top-full mt-2 w-64 bg-popover/95 backdrop-blur-xl border border-border/80 rounded-2xl shadow-2xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="px-3.5 py-2.5 border-b border-border/50 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="font-bold uppercase tracking-wider">Switch Organization</span>
            <span className="text-[10px] text-primary font-semibold">Global Admin</span>
          </div>

          <div className="max-h-64 overflow-y-auto p-1.5 space-y-1">
            {tenants.map((tenant) => {
              const isActive = tenant.id === activeTenant?.id || tenant.slug === activeTenant?.slug
              return (
                <button
                  key={tenant.id}
                  role="option"
                  aria-selected={isActive}
                  id={`tenant-option-${tenant.id}`}
                  type="button"
                  onClick={() => handleSelect(tenant)}
                  className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-left transition-all ${
                    isActive
                      ? 'bg-primary/15 text-primary font-bold'
                      : 'text-foreground hover:bg-muted/70 font-medium'
                  }`}
                >
                  {tenant.logo_url ? (
                    <img
                      src={tenant.logo_url}
                      alt={tenant.name}
                      className="w-5 h-5 rounded object-cover shrink-0"
                    />
                  ) : (
                    <span
                      className={`w-5 h-5 rounded flex items-center justify-center font-bold text-[10px] shrink-0 ${
                        isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {tenant.name[0].toUpperCase()}
                    </span>
                  )}

                  <div className="flex-1 overflow-hidden">
                    <div className="truncate text-xs font-semibold">{tenant.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{tenant.slug}.calrims.com</div>
                  </div>

                  {isActive && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
