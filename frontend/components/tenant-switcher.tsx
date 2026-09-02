'use client'

/**
 * TenantSwitcher — Allows an authenticated HR/Admin user to switch between
 * the tenant organizations they belong to.
 *
 * Slot location: global-navbar.tsx (dashboard header right side)
 *
 * Behaviour:
 *  - Fetches /api/auth/tenants to get the list of tenants accessible to the
 *    current user (returns [] for single-tenant deployments).
 *  - Renders nothing if the user belongs to only one tenant (no switching needed).
 *  - On selection, calls AuthContext.setActiveTenant() which updates the
 *    APIClient header store and re-validates all SWR caches.
 */

import React, { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/app/dashboard/lib/auth-context'
import { APIClient } from '@/app/dashboard/lib/api-client'

interface TenantOption {
  id: string
  name: string
  slug: string
  logo_url: string | null
  status: string
}

export function TenantSwitcher() {
  const { activeTenant, setActiveTenant, isAuthenticated, user } = useAuth()
  const [tenants, setTenants] = useState<TenantOption[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Only HR and super_admin roles can switch tenants
  const canSwitch = isAuthenticated && user && ['hr', 'super_admin'].includes(user.role)

  useEffect(() => {
    if (!canSwitch) return

    let cancelled = false
    setLoading(true)

    APIClient.get<TenantOption[]>('/api/auth/tenants')
      .then((data) => {
        if (!cancelled) setTenants(data ?? [])
      })
      .catch(() => {
        // Silently fail — single-tenant deployments may not expose this endpoint
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [canSwitch])

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

  // Do not render if only one tenant or not applicable
  if (!canSwitch || loading || tenants.length <= 1) return null

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

    // Trigger full SWR revalidation so all dashboard data refreshes for the new tenant
    window.dispatchEvent(
      new CustomEvent('rims:data-mutated', {
        detail: { keys: ['*'] },
      }),
    )
  }

  return (
    <div
      ref={dropdownRef}
      className="relative"
      style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      {/* Trigger button */}
      <button
        id="tenant-switcher-btn"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Switch organization"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 12px',
          borderRadius: '10px',
          border: '1px solid rgba(255,255,255,0.15)',
          background: open
            ? 'rgba(255,255,255,0.12)'
            : 'rgba(255,255,255,0.06)',
          color: '#fff',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: 500,
          transition: 'background 0.15s',
          maxWidth: '200px',
        }}
      >
        {/* Logo or initials */}
        {activeTenant?.logo_url ? (
          <img
            src={activeTenant.logo_url}
            alt={activeTenant.name}
            style={{ width: 20, height: 20, borderRadius: '4px', objectFit: 'cover' }}
          />
        ) : (
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: '4px',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10px',
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {(activeTenant?.name ?? 'D')[0].toUpperCase()}
          </span>
        )}

        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {activeTenant?.name ?? 'Default'}
        </span>

        {/* Chevron */}
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          style={{
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="listbox"
          aria-label="Select organization"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            minWidth: '220px',
            background: 'rgba(20,20,30,0.98)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '12px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            overflow: 'hidden',
            zIndex: 100,
            backdropFilter: 'blur(20px)',
          }}
        >
          <div
            style={{
              padding: '6px 12px',
              fontSize: '11px',
              color: 'rgba(255,255,255,0.4)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            Organizations
          </div>

          {tenants.map((tenant) => {
            const isActive = tenant.id === activeTenant?.id
            return (
              <button
                key={tenant.id}
                role="option"
                aria-selected={isActive}
                id={`tenant-option-${tenant.id}`}
                type="button"
                onClick={() => handleSelect(tenant)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  width: '100%',
                  padding: '10px 14px',
                  background: isActive ? 'rgba(99,102,241,0.15)' : 'transparent',
                  border: 'none',
                  color: isActive ? '#a5b4fc' : '#e5e7eb',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '13px',
                  fontWeight: isActive ? 600 : 400,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                  }
                }}
              >
                {/* Logo or initials */}
                {tenant.logo_url ? (
                  <img
                    src={tenant.logo_url}
                    alt={tenant.name}
                    style={{ width: 24, height: 24, borderRadius: '6px', objectFit: 'cover', flexShrink: 0 }}
                  />
                ) : (
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '6px',
                      background: isActive
                        ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                        : 'rgba(255,255,255,0.08)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: 700,
                      flexShrink: 0,
                      color: isActive ? '#fff' : 'rgba(255,255,255,0.5)',
                    }}
                  >
                    {tenant.name[0].toUpperCase()}
                  </span>
                )}

                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {tenant.name}
                  </div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>
                    {tenant.slug}
                  </div>
                </div>

                {isActive && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path
                      d="M2.5 7l3 3 6-6"
                      stroke="#818cf8"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
