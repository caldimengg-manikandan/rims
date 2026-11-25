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

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useAuth } from '@/app/dashboard/lib/auth-context'
import { APIClient } from '@/app/dashboard/lib/api-client'
import { extractSubdomainSlug } from '@/lib/tenant-host'
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
  return extractSubdomainSlug(window.location.hostname)
}

export function TenantSwitcher() {
  const { activeTenant, setActiveTenant, isAuthenticated, user } = useAuth()
  const [tenants, setTenants] = useState<TenantOption[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const subdomainSlug = getSubdomainSlug()

  // Strict Rule: ONLY accounts with role 'root-admin' (or 'root_admin'), and ONLY when on the
  // central platform portal (NOT on tenant subdomains like amazon.localhost:3000), can see
  // and use the Tenant Switcher dropdown.
  // Super Admins (tenant admins), HR recruiters, candidates, and any user on a tenant subdomain
  // see ONLY a static Organization Badge.
  const isRootAdmin = Boolean(
    isAuthenticated &&
    user &&
    !subdomainSlug &&
    (user.role === 'root-admin' || (user as any).role === 'root_admin')
  )

  const fetchTenants = useCallback(() => {
    if (!isRootAdmin || subdomainSlug) return

    setLoading(true)
    APIClient.get<TenantOption[]>('/api/auth/tenants')
      .then((data) => {
        const list = data ?? []
        setTenants(list)

        // If active tenant is not set, or is no longer active in the list (e.g. was suspended), reset to Default Organization
        const isCurrentActiveInList =
          activeTenant &&
          list.some(
            (t) =>
              (t.id === activeTenant.id || t.slug === activeTenant.slug) &&
              t.status === 'active'
          )

        if (!activeTenant || !isCurrentActiveInList) {
          const defaultTenant =
            list.find((t) => t.slug === 'default') ||
            list.find((t) => t.status === 'active') ||
            list[0]
          if (defaultTenant) {
            setActiveTenant(defaultTenant)
          }
        }
      })
      .catch(() => {
        // Silently handle
      })
      .finally(() => {
        setLoading(false)
      })
  }, [isRootAdmin, subdomainSlug, activeTenant, setActiveTenant])

  useEffect(() => {
    if (!isAuthenticated) return

    // If visiting on a dedicated subdomain (e.g. amazon.localhost:3000), lock to that tenant
    if (subdomainSlug) {
      if (activeTenant?.slug !== subdomainSlug) {
        setActiveTenant({
          id: subdomainSlug,
          slug: subdomainSlug,
          name: subdomainSlug.charAt(0).toUpperCase() + subdomainSlug.slice(1),
          logo_url: null,
          status: 'active',
        })
      }
      setLoading(false)
      return
    }

    // Only fetch list of tenants if root admin on the central portal
    if (!isRootAdmin) {
      setLoading(false)
      return
    }

    fetchTenants()

    const handleUpdate = () => {
      fetchTenants()
    }

    window.addEventListener('rims:tenant-changed', handleUpdate)
    window.addEventListener('rims:data-mutated', handleUpdate)

    return () => {
      window.removeEventListener('rims:tenant-changed', handleUpdate)
      window.removeEventListener('rims:data-mutated', handleUpdate)
    }
  }, [isAuthenticated, subdomainSlug, isRootAdmin, fetchTenants])

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

  // CASE 1: Tenant Super Admins, HR Recruiters, Candidates, OR browsing on a tenant subdomain
  // -> Render only a sleek, static Organization Badge. No switcher dropdown!
  if (!isRootAdmin) {
    const orgName = activeTenant?.name || (subdomainSlug ? subdomainSlug.toUpperCase() : 'Organization')
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
        title="Switch Organization (Root Admin)"
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
          Root Admin
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
            <span className="text-[10px] text-primary font-semibold">Root Admin</span>
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
