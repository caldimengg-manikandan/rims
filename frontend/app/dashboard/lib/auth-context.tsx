'use client'

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { getApiBaseUrl } from '@/lib/config'
import { clearSession } from '@/lib/session-store'
import { APIClient, setActiveTenantMeta } from '@/app/dashboard/lib/api-client'

export interface User {
  id: number
  email: string
  full_name: string
  role: 'root-admin' | 'root_admin' | 'super_admin' | 'hr' | 'candidate' | 'pending_hr'
  is_active: boolean
  is_verified: boolean
  approval_status: 'pending' | 'approved' | 'rejected'
  profile_image_url?: string
  created_at: string
  tenant_id?: string | null
  tenant_slug?: string | null
  is_root_admin?: boolean
  is_platform_super_admin?: boolean
}

/**
 * Tenant metadata stored in AuthContext after successful authentication.
 * Matches the TenantContext dataclass returned by the FastAPI /api/auth/me endpoint.
 */
export interface TenantMeta {
  id: string
  name: string
  slug: string
  status: string
  logo_url?: string | null
  custom_domain?: string | null
  settings?: Record<string, unknown>
}

interface AuthContextType {
  user: User | null
  token: string | null
  isLoading: boolean
  isOffline: boolean
  isAuthenticated: boolean
  /** The active tenant for the current session. */
  activeTenant: TenantMeta | null
  /** Update the active tenant (used by TenantSwitcher). */
  setActiveTenant: (tenant: TenantMeta | null) => void
  register: (email: string, password: string, full_name: string) => Promise<void>
  verify: (email: string, otp: string) => Promise<void>
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// We cannot read HttpOnly cookies from JS, so we use a non-HttpOnly "session present" flag.
// This prevents React Strict Mode from hammering GET /api/auth/me and causing 401 noise
// before login establishes the cookie.
const SESSION_PRESENT_KEY = 'rims_session_present'
type MeResult = { userData: User | null; status: number; isOffline: boolean }
let fetchMeInFlight: Promise<MeResult> | null = null

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isOffline, setIsOffline] = useState(false)
  const [activeTenant, setActiveTenantState] = useState<TenantMeta | null>(null)

  /** Update active tenant both in state and in the APIClient header store. */
  const setActiveTenant = useCallback((tenant: TenantMeta | null) => {
    setActiveTenantState(tenant)
    setActiveTenantMeta(tenant ? { id: tenant.id, slug: tenant.slug, name: tenant.name, logo_url: tenant.logo_url } : null)
    if (typeof window !== 'undefined') {
      if (tenant) {
        sessionStorage.setItem('tenant_slug', tenant.slug)
        sessionStorage.setItem('tenant_id', tenant.id)
        localStorage.setItem('tenant_slug', tenant.slug)
        localStorage.setItem('tenant_id', tenant.id)
        document.cookie = `x-tenant-slug=${encodeURIComponent(tenant.slug)}; path=/; max-age=604800; SameSite=Lax`
      } else {
        sessionStorage.removeItem('tenant_slug')
        sessionStorage.removeItem('tenant_id')
        localStorage.removeItem('tenant_slug')
        localStorage.removeItem('tenant_id')
        document.cookie = `x-tenant-slug=; path=/; max-age=0; SameSite=Lax`
      }
      window.dispatchEvent(new CustomEvent('rims:tenant-changed', { detail: { tenant } }))
    }
  }, [])

  // Effect initialization moved down below dependency definitions


  const fetchCurrentUser = useCallback(async (opts?: { silent?: boolean; token?: string }) => {
    const silent = opts?.silent ?? false
    const explicitToken = opts?.token

    try {
      // If the user is not logged in, avoid GET /api/auth/me entirely.
      // HttpOnly cookies can't be checked here, so we rely on the session-present flag.
      if (typeof window !== 'undefined') {
        const hasSession = localStorage.getItem(SESSION_PRESENT_KEY) === '1' || Boolean(explicitToken)
        if (!hasSession) {
          if (!silent) {
            setToken(null)
            setUser(null)
            setIsOffline(false)
          }
          return
        }
      }

      if (explicitToken) {
        fetchMeInFlight = null
      }

      if (!fetchMeInFlight) {
        fetchMeInFlight = (async (): Promise<MeResult> => {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 15000)
          try {
            const headers: Record<string, string> = {}
            const storedToken = explicitToken || (typeof window !== 'undefined' ? (localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token')) : null)
            if (storedToken && storedToken !== 'cookie_managed') {
              headers['Authorization'] = `Bearer ${storedToken}`
            }

            const response = await fetch(`${getApiBaseUrl()}/api/auth/me`, {
              credentials: 'include',
              headers,
              signal: controller.signal,
              cache: 'no-store',
            })

            if (response.ok) {
              const userData = await response.json()
              return { userData, status: response.status, isOffline: false }
            }

            if (response.status === 401) {
              return { userData: null, status: 401, isOffline: false }
            }

            if (response.status >= 500) {
              return { userData: null, status: response.status, isOffline: true }
            }

            return { userData: null, status: response.status, isOffline: false }
          } catch (error: any) {

            if (error?.name === 'AbortError') {
              console.warn('Request timeout fetching user info. Server might be cold starting.')
              return { userData: null, status: 0, isOffline: true }
            }

            console.error('Network error fetching user info:', error)
            return { userData: null, status: 0, isOffline: true }
          } finally {
            clearTimeout(timeoutId)
          }
        })()

        // Ensure the in-flight promise is cleared even if the call rejects.
        fetchMeInFlight.finally(() => {
          fetchMeInFlight = null
        })
      }

      const result = await fetchMeInFlight

      if (result?.userData) {
        setUser(result.userData)
        setToken('cookie_managed')
        setIsOffline(false)
        if (typeof window !== 'undefined') localStorage.setItem(SESSION_PRESENT_KEY, '1')
        // Extract tenant metadata from the /me response if present
        const tenantData = (result.userData as any)?.tenant as TenantMeta | undefined
        if (tenantData?.id) {
          setActiveTenant(tenantData)
        }
      } else if (result?.status === 401) {
        // Not authenticated — clear state, do NOT redirect.
        setToken(null)
        setUser(null)
        setIsOffline(false)
        if (typeof window !== 'undefined') localStorage.removeItem(SESSION_PRESENT_KEY)
      } else {
        // Other server error: don't force logout; just mark offline if needed.
        if (!silent) {
          console.error(`[v0] Server error (${result?.status}) fetching user info from ${getApiBaseUrl()}/api/auth/me`)
        }
        setIsOffline(Boolean(result?.isOffline))
      }
    } finally {
      if (!silent) setIsLoading(false)
    }
  }, []) // No dependencies — API_BASE_URL is a module constant

  const register = useCallback(async (email: string, password: string, full_name: string) => {
    setIsLoading(true)
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, full_name }),
        credentials: 'include'
      })

      if (!response.ok) {
        let errorMessage = 'Registration failed'
        try {
          const errorData = await response.json()
          if (typeof errorData.error === 'string') {
            errorMessage = errorData.error
          } else if (typeof errorData.detail === 'string') {
            errorMessage = errorData.detail
          } else if (errorData.error) {
            errorMessage = errorData.error
          } else if (Array.isArray(errorData.detail)) {
            errorMessage = errorData.detail.map((err: any) => err.msg || JSON.stringify(err)).join(', ')
          } else if (errorData.message) {
            errorMessage = errorData.message
          }
        } catch (e) {
          errorMessage = `Server error (${response.status}): ${response.statusText}`
        }
        throw new Error(errorMessage)
      }

      // Do not set user or token yet because they need to verify their email
    } catch (error) {
      // Don't log expected registration errors (email exists, etc.) to console
      if (error instanceof TypeError && error.message.includes('fetch')) {
        console.error("[v0] Registration error:", error)
        throw new Error(`Unable to connect to backend server at ${getApiBaseUrl()}. Please ensure the FastAPI server is running.`)
      }
      throw error
    } finally {
      setIsLoading(false)
    }
  }, [])

  const verify = useCallback(async (email: string, otp: string) => {
    setIsLoading(true)
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      })

      if (!response.ok) {
        let errorMessage = 'Verification failed'
        try {
          const errorData = await response.json()
          if (typeof errorData.error === 'string') {
            errorMessage = errorData.error
          } else if (typeof errorData.detail === 'string') {
            errorMessage = errorData.detail
          } else if (errorData.error) {
            errorMessage = errorData.error
          } else if (Array.isArray(errorData.detail)) {
            errorMessage = errorData.detail.map((err: any) => err.msg || JSON.stringify(err)).join(', ')
          } else if (errorData.message) {
            errorMessage = errorData.message
          }
        } catch (e) {
          errorMessage = `Server error (${response.status}): ${response.statusText}`
        }
        throw new Error(errorMessage)
      }

    } catch (error) {
      throw error
    } finally {
      setIsLoading(false)
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    setIsLoading(true)
    try {
      const apiBase = getApiBaseUrl()
      if (!apiBase || apiBase === 'undefined') {
        throw new Error("API base URL is not defined. Please check your environment configuration.");
      }

      let currentSlug = 'default';
      if (typeof window !== 'undefined') {
        const hostname = window.location.hostname.toLowerCase();
        if (hostname.endsWith('.localhost')) {
          const sub = hostname.slice(0, -'.localhost'.length);
          if (sub && !['www', 'api', 'mail', 'admin', 'static'].includes(sub)) {
            currentSlug = sub;
          }
        } else if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
          const parts = hostname.split('.');
          if (parts.length >= 3 && !['www', 'api', 'mail', 'admin', 'static'].includes(parts[0])) {
            currentSlug = parts[0];
          }
        }
      }

      const response = await fetch(`${apiBase}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Slug': currentSlug,
        },
        body: JSON.stringify({ email, password }),
        credentials: 'include'
      })

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Invalid credentials')
        }
        let errorMessage = 'Login failed'
        try {
          const errorData = await response.json()
          if (typeof errorData.error === 'string') {
            errorMessage = errorData.error
          } else if (typeof errorData.detail === 'string') {
            errorMessage = errorData.detail
          } else if (errorData.error) {
            errorMessage = errorData.error
          } else if (Array.isArray(errorData.detail)) {
            // Handle Pydantic validation errors (e.g. invalid email format)
            errorMessage = errorData.detail.map((err: any) => err.msg || JSON.stringify(err)).join(', ')
          } else if (errorData.message) {
            errorMessage = errorData.message
          } else if (errorData.detail) {
            errorMessage = JSON.stringify(errorData.detail)
          }
        } catch (e) {
          errorMessage = `Server error (${response.status}): ${response.statusText}`
        }
        throw new Error(errorMessage)
      }

      let data;
      try {
        data = await response.json()
      } catch (e) {
        throw new Error("Failed to parse login response from the server.");
      }

      // Backend wraps JSON in FastAPI StandardizedAPIRoute: { success, data, error }
      const payload = data && typeof data === 'object' && 'data' in data && data.success !== undefined
        ? (data as { data?: { user?: unknown; message?: string; token?: string; access_token?: string } }).data
        : data
      const userFromPayload = payload && typeof payload === 'object' && 'user' in payload
        ? (payload as { user?: unknown }).user
        : undefined
      const tokenFromPayload = payload && typeof payload === 'object' && ('token' in payload || 'access_token' in payload)
        ? (payload as any).token || (payload as any).access_token
        : undefined

      if (tokenFromPayload) {
        setToken(tokenFromPayload)
        if (typeof window !== 'undefined') {
          localStorage.setItem('auth_token', tokenFromPayload)
          sessionStorage.setItem('auth_token', tokenFromPayload)
          // Set cookie strictly on current host to prevent cross-tenant cookie leakage
          document.cookie = `access_token=${tokenFromPayload}; path=/; max-age=604800; SameSite=Lax`
        }
      } else {
        setToken("cookie_managed")
      }

      if (typeof window !== 'undefined') localStorage.setItem(SESSION_PRESENT_KEY, '1')
      fetchMeInFlight = null
      if (userFromPayload) {
        setUser(userFromPayload as User)
      } else {
        await fetchCurrentUser({ token: tokenFromPayload })
      }

      // Force a post-login refresh so protected routes/SWR don't race the cookie setup.
      await fetchCurrentUser({ silent: true, token: tokenFromPayload })
    } catch (error) {

      // Don't log expected authentication errors to console (wrong password, etc.)
      // as they're handled by the UI and would trigger Next.js error overlay
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(`Unable to connect to backend server at ${getApiBaseUrl()}. Please ensure the FastAPI server is running.`)
      }
      throw error
    } finally {
      setIsLoading(false)
    }
  }, [fetchCurrentUser])

  const logout = useCallback(async () => {
    try {
      await fetch(`${getApiBaseUrl()}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      })
    } catch (e) {
      console.error("Logout request failed:", e)
    }
    setUser(null)
    setToken(null)
    setActiveTenant(null)
    setActiveTenantMeta(null)
    if (typeof window !== 'undefined') {
      localStorage.removeItem(SESSION_PRESENT_KEY)
      localStorage.removeItem('auth_token')
      localStorage.removeItem('tenant_slug')
      localStorage.removeItem('tenant_id')
      sessionStorage.removeItem('tenant_slug')
      sessionStorage.removeItem('tenant_id')
      document.cookie = 'x-tenant-slug=; path=/; max-age=0; SameSite=Lax'
      document.cookie = 'x-tenant-slug=; path=/calrims; max-age=0; SameSite=Lax'
      document.cookie = 'x-tenant-slug=; path=/calrims/; max-age=0; SameSite=Lax'
      document.cookie = 'x-tenant-id=; path=/; max-age=0; SameSite=Lax'
      document.cookie = 'x-tenant-id=; path=/calrims; max-age=0; SameSite=Lax'
      document.cookie = 'x-tenant-id=; path=/calrims/; max-age=0; SameSite=Lax'
      document.cookie = 'access_token=; path=/; max-age=0; SameSite=Lax'
      document.cookie = 'access_token=; path=/calrims; max-age=0; SameSite=Lax'
      document.cookie = 'access_token=; path=/calrims/; max-age=0; SameSite=Lax'
      document.cookie = 'token=; path=/; max-age=0; SameSite=Lax'
      document.cookie = 'token=; path=/calrims; max-age=0; SameSite=Lax'
      document.cookie = 'token=; path=/calrims/; max-age=0; SameSite=Lax'
      window.dispatchEvent(new CustomEvent('rims:tenant-changed', { detail: { tenant: null } }))
      window.dispatchEvent(new CustomEvent('rims:data-mutated', { detail: { keys: ['*'] } }))
    }
    clearSession() // Clear session intelligence data
    window.location.href = window.location.origin + '/calrims/'
  }, [setActiveTenant])

  const refreshUser = useCallback(async () => {
    if (typeof window !== 'undefined') {
      const hasSession = localStorage.getItem(SESSION_PRESENT_KEY) === '1'
      if (!hasSession) return
    }
    await fetchCurrentUser()
  }, [fetchCurrentUser])

  // Check cookie session on mount by resolving currently authenticated user
  useEffect(() => {
    if (typeof window === 'undefined') return

    const hasSession = localStorage.getItem(SESSION_PRESENT_KEY) === '1'
    if (!hasSession) {
      setIsLoading(false)
      setIsOffline(false)
      setToken(null)
      setUser(null)
      return
    }

    fetchCurrentUser()
  }, [fetchCurrentUser])

  // Expose a data-hydrated attribute to signal to Cypress E2E tests that React has hydrated and bound events
  useEffect(() => {
    if (typeof window !== 'undefined' && !isLoading) {
      document.body.setAttribute('data-hydrated', 'true')
    }
  }, [isLoading])

  const value = useMemo<AuthContextType>(() => ({
    user,
    token,
    isLoading,
    isOffline,
    isAuthenticated: !!user && !!token,
    activeTenant,
    setActiveTenant,
    register,
    verify,
    login,
    logout,
    refreshUser
  }), [user, token, isLoading, isOffline, activeTenant, setActiveTenant, register, verify, login, logout, refreshUser])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
