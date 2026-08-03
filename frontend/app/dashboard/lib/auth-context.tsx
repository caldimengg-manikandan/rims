'use client'

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { getApiBaseUrl } from '@/lib/config'
import { clearSession } from '@/lib/session-store'

export interface User {
  id: number
  email: string
  full_name: string
  role: 'candidate' | 'hr' | 'super_admin' | 'pending_hr'
  is_active: boolean
  is_verified: boolean
  approval_status: 'pending' | 'approved' | 'rejected'
  profile_image_url?: string
  created_at: string
}

interface AuthContextType {
  user: User | null
  token: string | null
  isLoading: boolean
  isOffline: boolean
  isAuthenticated: boolean
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

  // Effect initialization moved down below dependency definitions


  const fetchCurrentUser = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false

    try {
      // If the user is not logged in, avoid GET /api/auth/me entirely.
      // HttpOnly cookies can't be checked here, so we rely on the session-present flag.
      if (typeof window !== 'undefined') {
        const hasSession = localStorage.getItem(SESSION_PRESENT_KEY) === '1'
        if (!hasSession) {
          if (!silent) {
            setToken(null)
            setUser(null)
            setIsOffline(false)
          }
          return
        }
      }

      if (!fetchMeInFlight) {
        fetchMeInFlight = (async (): Promise<MeResult> => {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 15000)
          try {
            const response = await fetch(`${getApiBaseUrl()}/api/auth/me`, {
              credentials: 'include',
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

      const response = await fetch(`${apiBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include'
      })

      if (!response.ok) {
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
        ? (data as { data?: { user?: unknown; message?: string } }).data
        : data
      const userFromPayload = payload && typeof payload === 'object' && 'user' in payload
        ? (payload as { user?: unknown }).user
        : undefined

      setToken("cookie_managed")
      if (typeof window !== 'undefined') localStorage.setItem(SESSION_PRESENT_KEY, '1')
      if (userFromPayload) {
        setUser(userFromPayload as User)
      } else {
        // Fallback for older backend versions (though we just updated it)
        await fetchCurrentUser()
      }

      // Force a post-login refresh so protected routes/SWR don't race the cookie setup.
      await fetchCurrentUser({ silent: true })
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
    if (typeof window !== 'undefined') localStorage.removeItem(SESSION_PRESENT_KEY)
    localStorage.removeItem('auth_token') // For legacy test hooks
    clearSession() // Clear session intelligence data
    window.location.href = window.location.origin + '/calrims/'
  }, [])

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
    register,
    verify,
    login,
    logout,
    refreshUser
  }), [user, token, isLoading, isOffline, register, verify, login, logout, refreshUser])

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
