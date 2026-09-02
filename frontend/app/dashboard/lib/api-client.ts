// API Client - Last Updated: 2026-09-01 (multi-tenancy)
import { getApiBaseUrl } from '@/lib/config'
import { toast } from 'sonner'

const MUTATION_REVALIDATION_PREFIXES = [
  '/api/auth/pending-approvals',
  '/api/analytics/dashboard',
  '/api/applications',
  '/api/applications/pending-count',
  '/api/decisions',
  '/api/jobs',
  '/api/notifications',
  '/api/tickets',
] as const

export function revalidateDashboardData() {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(
    new CustomEvent('rims:data-mutated', {
      detail: { keys: [...MUTATION_REVALIDATION_PREFIXES] },
    }),
  )
}

// ---------------------------------------------------------------------------
// Module-level tenant context store
// ---------------------------------------------------------------------------
interface TenantMeta {
  id: string
  slug: string
  name?: string
  logo_url?: string | null
}

let _activeTenant: TenantMeta | null = null

/** Called by AuthContext (or TenantSwitcher) when the active tenant changes. */
export function setActiveTenantMeta(tenant: TenantMeta | null): void {
  _activeTenant = tenant
}

/** Read the currently active tenant metadata (or null if not set). */
export function getActiveTenantMeta(): TenantMeta | null {
  return _activeTenant
}

export class APIClient {
  private static MAX_RETRIES = 3
  private static TIMEOUT_MS = 120000 // Increased to 120s globally for heavy tasks

  private static createRequestId(): string {
    if (typeof window !== 'undefined' && typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID()
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  private static isPublicEndpoint(endpoint: string): boolean {
    const normalized = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
    return (
      normalized.startsWith('/api/jobs/public') ||
      normalized.startsWith('/api/onboarding/') ||
      normalized === '/api/applications/apply' ||
      normalized === '/api/applications/extract-basic-info' ||
      normalized.startsWith('/api/applications/has-applied') ||
      normalized === '/api/support/ticket' ||
      normalized === '/api/settings/branding'
    )
  }

  /**
   * Set the active tenant context so all subsequent API calls carry the
   * correct X-Tenant-Slug / X-Tenant-ID headers.
   */
  static setTenantContext(tenant: TenantMeta | null): void {
    setActiveTenantMeta(tenant)
  }

  private static getHeaders(isMultipart = false, endpoint?: string): Record<string, string> {
    const headers: Record<string, string> = {}
    if (!isMultipart) {
      headers['Content-Type'] = 'application/json'
    }
    if (typeof window !== 'undefined' && !(endpoint && this.isPublicEndpoint(endpoint))) {
      const isInterviewRoute = window.location.pathname.includes('/interview')
      if (isInterviewRoute) {
        const interviewToken = sessionStorage.getItem('interview_token')
        if (interviewToken) {
          headers['Authorization'] = `Bearer ${interviewToken}`
        }
      }

      // ── Multi-tenancy: attach tenant headers to every authenticated call ──
      // First try the module-level store (set by AuthContext after login).
      // Then fall back to the x-tenant-slug cookie injected by Next.js middleware.
      const tenant = _activeTenant
      if (tenant) {
        headers['X-Tenant-Slug'] = tenant.slug
        if (tenant.id) {
          headers['X-Tenant-ID'] = tenant.id
        }
      } else {
        // Edge middleware injects x-tenant-slug as a response header that the
        // browser exposes via document.cookie or a <meta> tag; alternatively we
        // read it from sessionStorage if the auth-context wrote it on login.
        const storedSlug =
          (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('tenant_slug')) || ''
        if (storedSlug) {
          headers['X-Tenant-Slug'] = storedSlug
        }
      }
    }
    headers['X-Request-Source'] = 'rims-frontend'
    return headers
  }


  private static async fetchWithRetry(url: string, options: RequestInit, retries = 0, customTimeoutMs?: number): Promise<Response> {
    const controller = new AbortController()
    const timeout = customTimeoutMs ?? this.TIMEOUT_MS
    const id = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await fetch(url, { ...options, signal: controller.signal })
      clearTimeout(id)
      return response
    } catch (err: any) {
      clearTimeout(id)
      const isTimeout = err.name === 'AbortError'
      if (retries < this.MAX_RETRIES && (isTimeout || !window.navigator.onLine)) {
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retries) * 1000))
        return this.fetchWithRetry(url, options, retries + 1, customTimeoutMs)
      }
      throw err
    }
  }

  static async get<T>(endpoint: string): Promise<T> {
    const url = `${getApiBaseUrl()}${endpoint}`
    const response = await this.fetchWithRetry(url, {
      method: 'GET',
      headers: this.getHeaders(false, endpoint),
      credentials: 'include',
    })
    return this.handleResponse<T>(response)
  }

  static async post<T>(endpoint: string, data: any, requestId?: string): Promise<T> {
    const url = `${getApiBaseUrl()}${endpoint}`
    const headers = this.getHeaders(false, endpoint)
    headers['X-Request-ID'] = requestId ?? this.createRequestId()
    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
      credentials: 'include',
    })
    return this.handleResponse<T>(response)
  }

  static async postWithRequestId<T>(endpoint: string, data: any, requestId: string): Promise<T> {
    return this.post<T>(endpoint, data, requestId)
  }

  static async postMultipart<T>(endpoint: string, formData: FormData, requestId?: string, timeoutMs?: number): Promise<T> {
    const url = `${getApiBaseUrl()}${endpoint}`
    const headers = this.getHeaders(true, endpoint)
    headers['X-Request-ID'] = requestId ?? this.createRequestId()
    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    }, 0, timeoutMs)
    return this.handleResponse<T>(response)
  }

  static async postFormData<T>(endpoint: string, formData: FormData, requestId?: string): Promise<T> {
    return this.postMultipart<T>(endpoint, formData, requestId)
  }

  static async put<T>(endpoint: string, data: any): Promise<T> {
    const url = `${getApiBaseUrl()}${endpoint}`
    const headers = this.getHeaders(false, endpoint)
    headers['X-Request-ID'] = this.createRequestId()
    const response = await this.fetchWithRetry(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify(data),
      credentials: 'include',
    })
    return this.handleResponse<T>(response)
  }

  static async delete(endpoint: string): Promise<void> {
    const url = `${getApiBaseUrl()}${endpoint}`
    const headers = this.getHeaders(false, endpoint)
    headers['X-Request-ID'] = this.createRequestId()
    const response = await this.fetchWithRetry(url, {
      method: 'DELETE',
      headers,
      credentials: 'include',
    })
    await this.handleResponse(response)
  }

  static async downloadFile(endpoint: string, filename: string): Promise<void> {
    const url = `${getApiBaseUrl()}${endpoint}`
    const response = await this.fetchWithRetry(url, {
      method: 'GET',
      headers: this.getHeaders(false, endpoint),
      credentials: 'include',
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.detail || errorData.error || `Download failed: ${response.statusText}`)
    }

    const blob = await response.blob()
    const downloadUrl = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = downloadUrl
    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(downloadUrl)
  }

  static async handleResponse<T>(response: Response): Promise<T> {
    if (response.status === 204) {
      return {} as T
    }

    const result = await response.json().catch(() => ({
      success: false,
      data: null,
      error: `Error ${response.status}: ${response.statusText}`
    }))

    const isStandardFormat = result && typeof result === 'object' && 'success' in result
    const success = isStandardFormat ? result.success : response.ok
    const data = isStandardFormat ? result.data : result
    const error = isStandardFormat ? result.error : (result.detail || result.error || response.statusText)

    if (!success) {
      const errorMessage = typeof error === 'string' ? error : (error?.message || 'Unknown API error')

      if (typeof window !== 'undefined' && (response.status === 401 || response.status === 403 || response.status >= 500)) {
        // Don't toast for background SWR polling endpoints or if it's a session expiry (handled by redirect)
        const isSilentEndpoint = response.url?.includes('/api/settings') ||
          response.url?.includes('/api/notifications') ||
          response.url?.includes('/api/analytics/dashboard') ||
          response.url?.includes('/api/tickets') ||
          response.url?.includes('/api/applications') ||
          response.status === 401; // Primary UX fix: don't flood on 401

        if (!isSilentEndpoint) {
          toast.error(`Error ${response.status}: ${errorMessage}`)
        }
      }

      if (response.status === 401 && typeof window !== 'undefined') {
        const currentPath = window.location.pathname
        // Only redirect if NOT already on an auth/public page (prevents loop)
        const cleanPath = currentPath.replace(/^\/calrims/, '') || '/'
        const isAuthPage = cleanPath.includes('/auth/') ||
          cleanPath.includes('/interview') ||
          cleanPath.includes('/jobs') ||
          cleanPath.includes('/support') ||
          cleanPath.includes('/terms') ||
          cleanPath.includes('/privacy') ||
          cleanPath.includes('/company') ||
          cleanPath === '/'
        if (!isAuthPage) {
          // Debounce: only redirect once every 3s to prevent looping
          const lastRedirect = parseInt(sessionStorage.getItem('_auth_redirect_ts') || '0')
          const now = Date.now()
          if (now - lastRedirect > 3000) {
            sessionStorage.setItem('_auth_redirect_ts', String(now))
            localStorage.removeItem('auth_token')
            window.location.href = '/calrims/'
          }
        }
      }

      // CRITICAL: Throw so that performMutation and other callers detect the failure
      const apiError = new Error(errorMessage) as any
      apiError.status = response.status
      throw apiError
    }

    // Handled in the success case as well
    if (data == null) {
      return ({} as T)
    }

    return data as T
  }
}
