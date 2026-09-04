'use client'

import React, { useState, useMemo } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/app/dashboard/lib/auth-context'
import { fetcher } from '@/app/dashboard/lib/swr-fetcher'
import { APIClient } from '@/app/dashboard/lib/api-client'
import {
  Building2,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldAlert,
  Search,
  ExternalLink,
  Power,
  RotateCw,
  Info,
  Users,
  Briefcase,
  Layers,
  ArrowUpRight,
  Eye,
  AlertTriangle,
  Sparkles,
  ChevronRight,
  Filter
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface TenantUser {
  id: number
  full_name: string
  email: string
  role: string
  is_active: boolean
  approval_status: string
  created_at?: string
}

interface TenantItem {
  id: string
  name: string
  slug: string
  custom_domain?: string | null
  logo_url?: string | null
  status: 'pending' | 'active' | 'suspended' | 'rejected' | 'deactivated'
  settings?: Record<string, any>
  created_at?: string
  updated_at?: string
  primary_admin?: TenantUser | null
  stats: {
    users_count: number
    jobs_count: number
    applications_count: number
  }
}

interface TenantDetailData extends TenantItem {
  users?: TenantUser[]
}

export default function TenantManagementPage() {
  const router = useRouter()
  const { user, activeTenant, setActiveTenant } = useAuth()
  const isRootAdmin = user?.role === 'root-admin' || (user as any)?.role === 'root_admin'

  const [activeTab, setActiveTab] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Modals state
  const [selectedTenantForDetails, setSelectedTenantForDetails] = useState<TenantDetailData | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean
    tenant: TenantItem | null
    action: 'approve' | 'reject' | 'suspend' | 'activate'
  }>({
    isOpen: false,
    tenant: null,
    action: 'approve'
  })

  // SWR fetch all tenants
  const { data: tenants, error, isLoading, mutate } = useSWR<TenantItem[]>(
    isRootAdmin ? '/api/tenants' : null,
    (url: string) => fetcher<TenantItem[]>(url),
    {
      revalidateOnFocus: true,
      refreshInterval: 30000,
    }
  )

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type })
    setTimeout(() => {
      setToastMessage(null)
    }, 4000)
  }

  // Calculate high-level metrics
  const metrics = useMemo(() => {
    if (!tenants) return { total: 0, pending: 0, active: 0, suspended: 0 }
    return {
      total: tenants.length,
      pending: tenants.filter((t) => t.status === 'pending').length,
      active: tenants.filter((t) => t.status === 'active').length,
      suspended: tenants.filter((t) => t.status === 'suspended' || t.status === 'deactivated' || t.status === 'rejected').length,
    }
  }, [tenants])

  // Filtered tenants by tab and search
  const filteredTenants = useMemo(() => {
    if (!tenants) return []
    return tenants.filter((t) => {
      // Tab matching
      if (activeTab === 'pending' && t.status !== 'pending') return false
      if (activeTab === 'active' && t.status !== 'active') return false
      if (activeTab === 'suspended' && !['suspended', 'deactivated', 'rejected'].includes(t.status)) return false

      // Search matching
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim()
        const nameMatch = t.name.toLowerCase().includes(query)
        const slugMatch = t.slug.toLowerCase().includes(query)
        const adminMatch = t.primary_admin?.email.toLowerCase().includes(query) || t.primary_admin?.full_name.toLowerCase().includes(query)
        return nameMatch || slugMatch || Boolean(adminMatch)
      }

      return true
    })
  }, [tenants, activeTab, searchQuery])

  // Fetch full details
  const handleViewDetails = async (tenantId: string) => {
    setDetailsLoading(true)
    try {
      const data = await APIClient.get<TenantDetailData>(`/api/tenants/${tenantId}`)
      setSelectedTenantForDetails(data)
    } catch (err: any) {
      showToast(err.message || 'Error fetching tenant details', 'error')
    } finally {
      setDetailsLoading(false)
    }
  }

  // Execute confirmation action
  const handleExecuteAction = async () => {
    if (!confirmModal.tenant) return
    const tenant = confirmModal.tenant
    const action = confirmModal.action
    setActionLoading(tenant.id)
    setConfirmModal({ isOpen: false, tenant: null, action: 'approve' })

    try {
      let data: any = null

      if (action === 'approve') {
        data = await APIClient.post(`/api/tenants/${tenant.id}/approve`, {})
      } else if (action === 'reject') {
        data = await APIClient.post(`/api/tenants/${tenant.id}/reject`, {})
      } else if (action === 'suspend') {
        data = await APIClient.put(`/api/tenants/${tenant.id}/status`, {
          status: 'suspended',
          reason: 'Administrative suspension',
        })

        // If Root Admin suspended the currently selected tenant:
        // Automatically reset active tenant context to Default Organization and reload switcher
        const isCurrentActive =
          activeTenant && (activeTenant.id === tenant.id || activeTenant.slug === tenant.slug)

        if (isCurrentActive) {
          const defaultOrg = tenants?.find((t) => t.slug === 'default')
          const defaultMeta = {
            id: defaultOrg?.id || 'default',
            name: defaultOrg?.name || 'Default Organization',
            slug: 'default',
            status: 'active',
            logo_url: defaultOrg?.logo_url || null,
          }

          setActiveTenant(defaultMeta)
          APIClient.setTenantContext(defaultMeta)

          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem('tenant_slug', 'default')
            sessionStorage.setItem('tenant_id', defaultMeta.id)
          }
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('tenant_slug', 'default')
            localStorage.setItem('tenant_id', defaultMeta.id)
          }
          if (typeof document !== 'undefined') {
            document.cookie = 'x-tenant-slug=default; path=/; max-age=604800; SameSite=Lax'
          }

          window.dispatchEvent(
            new CustomEvent('rims:tenant-changed', { detail: { tenant: defaultMeta } })
          )
          window.dispatchEvent(
            new CustomEvent('rims:data-mutated', { detail: { keys: ['*'] } })
          )

          // If browsing on a dedicated tenant subdomain, redirect to central platform
          if (typeof window !== 'undefined') {
            const host = window.location.hostname.toLowerCase()
            if (host.endsWith('.localhost') && host !== 'localhost') {
              const port = window.location.port ? `:${window.location.port}` : ''
              window.location.href = `${window.location.protocol}//localhost${port}/calrims/dashboard/tenants`
              return
            }
          }
        }
      } else if (action === 'activate') {
        data = await APIClient.put(`/api/tenants/${tenant.id}/status`, {
          status: 'active',
          reason: 'Administrative reactivation',
        })
      }

      showToast(data?.message || `Tenant ${action}d successfully.`, 'success')
      await mutate()

      // Refresh details modal if open
      if (selectedTenantForDetails && selectedTenantForDetails.id === tenant.id) {
        handleViewDetails(tenant.id)
      }
    } catch (err: any) {
      showToast(err.message || 'Operation failed', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  // Guard for Root Admin role
  if (!isRootAdmin) {
    return (
      <div className="p-8 max-w-4xl mx-auto text-center space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center mx-auto text-destructive">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Access Restricted</h1>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            Tenant Management is exclusively reserved for Platform Root Administrators. Your account does not have sufficient permissions to access this dashboard.
          </p>
        </div>
        <Link href="/dashboard/hr">
          <Button variant="outline" className="rounded-xl">
            Return to Dashboard
          </Button>
        </Link>
      </div>
    )
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25 px-2.5 py-0.5 font-semibold text-xs rounded-full flex items-center gap-1.5 w-fit">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Active
          </Badge>
        )
      case 'pending':
        return (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 px-2.5 py-0.5 font-semibold text-xs rounded-full flex items-center gap-1.5 w-fit">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> Pending Review
          </Badge>
        )
      case 'suspended':
        return (
          <Badge variant="outline" className="bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/25 px-2.5 py-0.5 font-semibold text-xs rounded-full flex items-center gap-1.5 w-fit">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Suspended
          </Badge>
        )
      case 'rejected':
        return (
          <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/25 px-2.5 py-0.5 font-semibold text-xs rounded-full flex items-center gap-1.5 w-fit">
            <span className="w-1.5 h-1.5 rounded-full bg-destructive" /> Rejected
          </Badge>
        )
      case 'deactivated':
        return (
          <Badge variant="outline" className="bg-slate-500/10 text-slate-400 border-slate-500/25 px-2.5 py-0.5 font-semibold text-xs rounded-full flex items-center gap-1.5 w-fit">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" /> Deactivated
          </Badge>
        )
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8 max-w-[1400px] mx-auto min-h-[calc(100vh-4rem)]">
      {/* Toast notification banner */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-2xl border flex items-center gap-3 animate-in fade-in slide-in-from-bottom-3 duration-300 ${
            toastMessage.type === 'success'
              ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500/40 backdrop-blur-xl'
              : 'bg-destructive/90 text-destructive-foreground border-destructive/40 backdrop-blur-xl'
          }`}
        >
          {toastMessage.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-destructive-foreground shrink-0" />
          )}
          <span className="text-sm font-semibold">{toastMessage.text}</span>
        </div>
      )}

      {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/40 pb-6">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 text-primary">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
                Tenant Management
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground font-medium">
                Centrally oversee multi-tenant organizations, manage approvals, and regulate workspace statuses.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 self-start md:self-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => mutate()}
            disabled={isLoading}
            className="rounded-xl h-9 gap-1.5 border-border/60 hover:bg-muted/80 shadow-sm text-xs font-semibold"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-primary' : ''}`} />
            Refresh
          </Button>
          <Link href="/company/register" target="_blank">
            <Button size="sm" className="rounded-xl h-9 gap-1.5 shadow-md shadow-primary/20 text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5" />
              Register Workspace
            </Button>
          </Link>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <Card className="border-border/50 bg-card/60 backdrop-blur-xl shadow-sm hover:shadow-md transition-all duration-200">
          <CardContent className="p-5 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Total Workspaces</p>
              <p className="text-2xl sm:text-3xl font-black text-foreground">{metrics.total}</p>
            </div>
            <div className="w-11 h-11 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <Layers className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className={`border-border/50 bg-card/60 backdrop-blur-xl shadow-sm hover:shadow-md transition-all duration-200 ${metrics.pending > 0 ? 'ring-1 ring-amber-500/40 bg-amber-500/[0.03]' : ''}`}>
          <CardContent className="p-5 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-bold text-amber-500 uppercase tracking-wider flex items-center gap-1.5">
                Pending Review
                {metrics.pending > 0 && <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />}
              </p>
              <p className="text-2xl sm:text-3xl font-black text-foreground">{metrics.pending}</p>
            </div>
            <div className="w-11 h-11 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
              <Clock className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/60 backdrop-blur-xl shadow-sm hover:shadow-md transition-all duration-200">
          <CardContent className="p-5 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-bold text-emerald-500 uppercase tracking-wider">Active Organizations</p>
              <p className="text-2xl sm:text-3xl font-black text-foreground">{metrics.active}</p>
            </div>
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/60 backdrop-blur-xl shadow-sm hover:shadow-md transition-all duration-200">
          <CardContent className="p-5 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Suspended / Rejected</p>
              <p className="text-2xl sm:text-3xl font-black text-foreground">{metrics.suspended}</p>
            </div>
            <div className="w-11 h-11 rounded-2xl bg-muted border border-border/60 flex items-center justify-center text-muted-foreground">
              <Power className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Table / Grid Container */}
      <Card className="border-border/60 bg-card/70 backdrop-blur-xl shadow-lg">
        <CardHeader className="p-5 sm:p-6 border-b border-border/40 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full sm:w-auto">
              <TabsList className="bg-muted/70 p-1 rounded-xl h-10 border border-border/40">
                <TabsTrigger value="all" className="rounded-lg text-xs font-semibold">
                  All ({metrics.total})
                </TabsTrigger>
                <TabsTrigger value="pending" className="rounded-lg text-xs font-semibold gap-1.5">
                  Pending
                  {metrics.pending > 0 && (
                    <Badge variant="secondary" className="bg-amber-500 text-white font-black text-[10px] h-4 px-1 rounded-full">
                      {metrics.pending}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="active" className="rounded-lg text-xs font-semibold">
                  Active ({metrics.active})
                </TabsTrigger>
                <TabsTrigger value="suspended" className="rounded-lg text-xs font-semibold">
                  Suspended / Others
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Search input */}
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search name, slug, admin..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-10 rounded-xl bg-background/50 border-border/60 text-xs"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-16 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <RotateCw className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm font-medium">Loading organizations...</p>
            </div>
          ) : error ? (
            <div className="p-16 text-center space-y-3">
              <AlertTriangle className="w-8 h-8 text-destructive mx-auto" />
              <p className="text-sm font-semibold text-destructive">Failed to fetch tenants data.</p>
              <Button variant="outline" size="sm" onClick={() => mutate()} className="rounded-xl">
                Try Again
              </Button>
            </div>
          ) : filteredTenants.length === 0 ? (
            <div className="p-16 text-center space-y-3 text-muted-foreground">
              <Building2 className="w-10 h-10 mx-auto opacity-40" />
              <p className="text-sm font-medium">No organizations match your current filters.</p>
              {searchQuery && (
                <Button variant="ghost" size="sm" onClick={() => setSearchQuery('')} className="text-xs text-primary font-bold">
                  Clear search query
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border/40 overflow-x-auto">
              {filteredTenants.map((tenant) => {
                const isPending = tenant.status === 'pending'
                const isActive = tenant.status === 'active'
                const isSuspended = ['suspended', 'deactivated', 'rejected'].includes(tenant.status)

                return (
                  <div
                    key={tenant.id}
                    className="p-4 sm:p-6 hover:bg-muted/20 transition-colors flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                  >
                    {/* Organization Identity */}
                    <div className="flex items-start gap-3.5 min-w-[280px]">
                      <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center font-black text-primary text-base shrink-0 overflow-hidden shadow-inner">
                        {tenant.logo_url ? (
                          <img src={tenant.logo_url} alt={tenant.name} className="w-full h-full object-cover" />
                        ) : (
                          tenant.name.slice(0, 2).toUpperCase()
                        )}
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-extrabold text-base text-foreground tracking-tight">
                            {tenant.name}
                          </span>
                          {getStatusBadge(tenant.status)}
                        </div>

                        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                          <span>{tenant.slug}.localhost:3000</span>
                          <span className="text-border">•</span>
                          <span>{tenant.settings?.industry || 'Enterprise'}</span>
                          {tenant.settings?.companySize && (
                            <>
                              <span className="text-border">•</span>
                              <span>{tenant.settings?.companySize}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Primary Admin & Stats */}
                    <div className="flex flex-wrap items-center gap-6 text-xs text-muted-foreground">
                      {/* Admin Info */}
                      <div className="min-w-[160px] space-y-0.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                          Primary Admin
                        </span>
                        <div className="font-semibold text-foreground truncate max-w-[200px]">
                          {tenant.primary_admin?.full_name || 'Not assigned'}
                        </div>
                        <div className="truncate max-w-[200px] text-muted-foreground">
                          {tenant.primary_admin?.email || '—'}
                        </div>
                      </div>

                      {/* Workspace Metrics */}
                      <div className="flex items-center gap-4 border-l border-border/50 pl-4">
                        <div className="space-y-0.5 text-center">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                            Users
                          </span>
                          <div className="font-bold text-foreground text-sm">
                            {tenant.stats.users_count}
                          </div>
                        </div>
                        <div className="space-y-0.5 text-center">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                            Jobs
                          </span>
                          <div className="font-bold text-foreground text-sm">
                            {tenant.stats.jobs_count}
                          </div>
                        </div>
                        <div className="space-y-0.5 text-center">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                            Applicants
                          </span>
                          <div className="font-bold text-foreground text-sm">
                            {tenant.stats.applications_count}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 self-end lg:self-center shrink-0">
                      {/* View Details Button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleViewDetails(tenant.id)}
                        className="h-9 px-3 rounded-xl gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Details
                      </Button>

                      {/* Pending: Approve & Reject Actions */}
                      {isPending && (
                        <>
                          <Button
                            size="sm"
                            disabled={actionLoading === tenant.id}
                            onClick={() => setConfirmModal({ isOpen: true, tenant, action: 'approve' })}
                            className="h-9 px-3.5 rounded-xl gap-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Approve
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={actionLoading === tenant.id}
                            onClick={() => setConfirmModal({ isOpen: true, tenant, action: 'reject' })}
                            className="h-9 px-3 rounded-xl gap-1.5 text-xs font-semibold"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Reject
                          </Button>
                        </>
                      )}

                      {/* Active: Suspend & Switch Workspace */}
                      {isActive && (
                        <>
                          <a
                            href={`http://${tenant.slug}.localhost:3000/calrims/dashboard/hr`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 px-3 rounded-xl gap-1.5 text-xs font-semibold hover:bg-primary/10 hover:text-primary hover:border-primary/40"
                            >
                              <ArrowUpRight className="w-3.5 h-3.5" />
                              Open
                            </Button>
                          </a>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={actionLoading === tenant.id}
                            onClick={() => setConfirmModal({ isOpen: true, tenant, action: 'suspend' })}
                            className="h-9 px-2.5 rounded-xl text-xs font-semibold text-orange-500 hover:text-orange-600 hover:bg-orange-500/10"
                          >
                            <Power className="w-3.5 h-3.5" />
                            Suspend
                          </Button>
                        </>
                      )}

                      {/* Suspended/Deactivated: Reactivate */}
                      {isSuspended && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={actionLoading === tenant.id}
                          onClick={() => setConfirmModal({ isOpen: true, tenant, action: 'activate' })}
                          className="h-9 px-3 rounded-xl gap-1.5 text-xs font-bold text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10 border-emerald-500/30"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Reactivate
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Modal */}
      <Dialog
        open={confirmModal.isOpen}
        onOpenChange={(open) => {
          if (!open) setConfirmModal({ isOpen: false, tenant: null, action: 'approve' })
        }}
      >
        <DialogContent className="sm:max-w-md rounded-2xl border-border/60 bg-card/95 backdrop-blur-2xl">
          <DialogHeader className="space-y-2.5">
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              {confirmModal.action === 'approve' && (
                <>
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  Approve Organization
                </>
              )}
              {confirmModal.action === 'reject' && (
                <>
                  <XCircle className="w-5 h-5 text-destructive" />
                  Reject Organization
                </>
              )}
              {confirmModal.action === 'suspend' && (
                <>
                  <AlertTriangle className="w-5 h-5 text-orange-500" />
                  Suspend Organization
                </>
              )}
              {confirmModal.action === 'activate' && (
                <>
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  Reactivate Organization
                </>
              )}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
              {confirmModal.action === 'approve' && (
                <>
                  Are you sure you want to approve <strong>{confirmModal.tenant?.name}</strong>? This will activate their subdomain workspace (<strong>{confirmModal.tenant?.slug}.localhost:3000</strong>) and grant their primary administrator full access.
                </>
              )}
              {confirmModal.action === 'reject' && (
                <>
                  Are you sure you want to reject the registration for <strong>{confirmModal.tenant?.name}</strong>? Their workspace and primary administrator will be blocked from accessing CALRIMS.
                </>
              )}
              {confirmModal.action === 'suspend' && (
                <>
                  Are you sure you want to suspend <strong>{confirmModal.tenant?.name}</strong>? All staff members belonging to this organization will be temporarily prevented from logging into their workspace.
                </>
              )}
              {confirmModal.action === 'activate' && (
                <>
                  Reactivating <strong>{confirmModal.tenant?.name}</strong> will restore full workspace access for its staff members.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-0 pt-4 border-t border-border/40">
            <Button
              variant="outline"
              onClick={() => setConfirmModal({ isOpen: false, tenant: null, action: 'approve' })}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button
              variant={
                confirmModal.action === 'reject' || confirmModal.action === 'suspend'
                  ? 'destructive'
                  : 'default'
              }
              onClick={handleExecuteAction}
              className="rounded-xl font-bold"
            >
              Confirm {confirmModal.action.charAt(0).toUpperCase() + confirmModal.action.slice(1)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tenant Details Drawer / Modal */}
      <Dialog
        open={Boolean(selectedTenantForDetails)}
        onOpenChange={(open) => {
          if (!open) setSelectedTenantForDetails(null)
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border-border/60 bg-card/95 backdrop-blur-2xl p-6 sm:p-8 space-y-6">
          <DialogHeader className="space-y-2 border-b border-border/40 pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center font-black text-primary text-lg">
                  {selectedTenantForDetails?.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <DialogTitle className="text-xl font-extrabold">
                    {selectedTenantForDetails?.name}
                  </DialogTitle>
                  <p className="text-xs text-muted-foreground font-mono">
                    ID: {selectedTenantForDetails?.id}
                  </p>
                </div>
              </div>
              {selectedTenantForDetails && getStatusBadge(selectedTenantForDetails.status)}
            </div>
          </DialogHeader>

          {selectedTenantForDetails && (
            <div className="space-y-6">
              {/* Workspace Metadata */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 rounded-xl bg-muted/40 border border-border/50 text-xs">
                <div>
                  <span className="text-muted-foreground uppercase font-bold text-[10px] tracking-wider block mb-0.5">
                    Subdomain Slug
                  </span>
                  <span className="font-mono font-semibold text-foreground">
                    {selectedTenantForDetails.slug}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground uppercase font-bold text-[10px] tracking-wider block mb-0.5">
                    Industry
                  </span>
                  <span className="font-semibold text-foreground">
                    {selectedTenantForDetails.settings?.industry || 'Standard'}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground uppercase font-bold text-[10px] tracking-wider block mb-0.5">
                    Company Size
                  </span>
                  <span className="font-semibold text-foreground">
                    {selectedTenantForDetails.settings?.companySize || 'N/A'}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground uppercase font-bold text-[10px] tracking-wider block mb-0.5">
                    Branding Color
                  </span>
                  <div className="flex items-center gap-1.5 font-semibold">
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-border/50"
                      style={{ backgroundColor: selectedTenantForDetails.settings?.primaryColor || '#6366f1' }}
                    />
                    <span>{selectedTenantForDetails.settings?.primaryColor || '#6366f1'}</span>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground uppercase font-bold text-[10px] tracking-wider block mb-0.5">
                    Registered On
                  </span>
                  <span className="font-semibold text-foreground">
                    {selectedTenantForDetails.created_at
                      ? new Date(selectedTenantForDetails.created_at).toLocaleDateString()
                      : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground uppercase font-bold text-[10px] tracking-wider block mb-0.5">
                    Custom Domain
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {selectedTenantForDetails.custom_domain || 'None'}
                  </span>
                </div>
              </div>

              {/* Linked Staff Accounts */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-extrabold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-primary" />
                    Linked Staff Members ({selectedTenantForDetails.users?.length || 0})
                  </h3>
                </div>

                <div className="rounded-xl border border-border/50 overflow-hidden divide-y divide-border/40 text-xs">
                  {selectedTenantForDetails.users && selectedTenantForDetails.users.length > 0 ? (
                    selectedTenantForDetails.users.map((u) => (
                      <div key={u.id} className="p-3 flex items-center justify-between hover:bg-muted/30">
                        <div className="space-y-0.5">
                          <p className="font-bold text-foreground">{u.full_name}</p>
                          <p className="text-muted-foreground font-mono">{u.email}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="font-semibold uppercase text-[10px]">
                            {u.role}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={u.is_active ? 'bg-emerald-500/10 text-emerald-500' : 'bg-muted text-muted-foreground'}
                          >
                            {u.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-4 text-center text-muted-foreground">
                      No users registered for this organization yet.
                    </div>
                  )}
                </div>
              </div>

              {/* Stats Breakdown */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 rounded-xl bg-muted/30 border border-border/40">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">Jobs Posted</p>
                  <p className="text-lg font-black text-foreground">{selectedTenantForDetails.stats.jobs_count}</p>
                </div>
                <div className="p-3 rounded-xl bg-muted/30 border border-border/40">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">Applications</p>
                  <p className="text-lg font-black text-foreground">{selectedTenantForDetails.stats.applications_count}</p>
                </div>
                <div className="p-3 rounded-xl bg-muted/30 border border-border/40">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">Interviews</p>
                  <p className="text-lg font-black text-foreground">{(selectedTenantForDetails as any).stats.interviews_count || 0}</p>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="border-t border-border/40 pt-4 flex sm:justify-between items-center">
            <div className="text-xs text-muted-foreground">
              Direct Subdomain: <span className="font-mono font-semibold text-foreground">{selectedTenantForDetails?.slug}.localhost:3000</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedTenantForDetails(null)}
              className="rounded-xl text-xs font-semibold"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
