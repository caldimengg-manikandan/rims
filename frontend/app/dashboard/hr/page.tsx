'use client'

/**
 * RIMS HR Dashboard
 * Forced refresh: 2026-04-15
 */

import React, { useEffect, useState, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/app/dashboard/lib/utils'
import Link from 'next/link'
import { APIClient } from '@/app/dashboard/lib/api-client'
import useSWR from 'swr'
import { fetcher } from '@/app/dashboard/lib/swr-fetcher'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/app/dashboard/lib/auth-context'
import {
  Briefcase,
  Users,
  Calendar,
  CheckCircle,
  TrendingUp,
  Clock,
  ArrowRight,
  Search,
  Filter,
  X,
  Award,
  RotateCw,
  RotateCcw,
  LayoutDashboard,
  FileText,
  AlertCircle
} from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Lazy-load the entire chart component — defers Recharts bundle (~200KB)
const DashboardChart = dynamic(
  () => import('@/components/dashboard-chart').then(mod => ({ default: mod.DashboardChart })),
  {
    ssr: false,
    loading: () => (
      <div className="h-[300px] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-10 border-b-2 border-primary"></div>
      </div>
    )
  }
)
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

interface DashboardData {
  recruitment_metrics: {
    total_candidates: number
    shortlisted_candidates: number
    interviewed_candidates: number
    offers_released: number
    hiring_success_rate: number
  }
  candidate_metrics: {
    avg_job_compatibility: number
    avg_aptitude_score: number
    avg_interview_score: number
    avg_composite_score: number
  }
  chart_data: { name: string; value: number }[]
  recent_interviews: any[]
}

export default function HRDashboard() {
  const router = useRouter()
  const { user, isLoading: authLoading } = useAuth()
  
  const [filters, setFilters] = useState<any>({
    search: '',
    date: '',
    status: 'all'
  })
  
  const [jobFilter, setJobFilter] = useState('all')
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search)
  const [chartType, setChartType] = useState<'bar' | 'funnel'>('bar')

  const { data: dashboardData, error: dashboardError, isLoading: dashboardLoading } = useSWR<DashboardData>(
    `/api/analytics/dashboard?${new URLSearchParams({
      ...(jobFilter !== 'all' ? { job_id: jobFilter } : {}),
      ...(filters.status !== 'all' ? { status: filters.status } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {})
    }).toString()}`, 
    (url: string) => fetcher<DashboardData>(url),
    { keepPreviousData: true }
  )
  const { data: jobs = [] } = useSWR<any[]>(
    '/api/jobs',
    (url: string) => fetcher<any[]>(url),
    { keepPreviousData: true }
  )

  const isSuperAdmin = user?.role === 'super_admin'
  const { data: pendingApprovals = [] } = useSWR<any[]>(
    isSuperAdmin ? '/api/auth/pending-approvals' : null,
    (url: string) => fetcher<any[]>(url),
    {} // no polling — mutations call mutate() explicitly
  )

  useEffect(() => {
    if (!authLoading && user && user.role === 'candidate') {
      router.push('/jobs')
    }
  }, [user, authLoading, router])

  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(filters.search)
    }, 500)
    return () => clearTimeout(timer)
  }, [filters.search])

  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedSearch, filters.date, filters.status])

  // We use SWR for the initial filtered interviews as well
  const filterQuery = useMemo(() => {
    const params = new URLSearchParams()
    if (debouncedSearch) params.append('search', debouncedSearch)
    if (filters.date) params.append('date', filters.date)
    if (filters.status && filters.status !== 'all') params.append('status', filters.status)
    if (jobFilter && jobFilter !== 'all') params.append('job_id', jobFilter)
    
    // Pagination params
    params.append('skip', String((currentPage - 1) * pageSize))
    params.append('limit', String(pageSize))
    
    return params.toString()
  }, [debouncedSearch, filters.date, filters.status, jobFilter, currentPage, pageSize])

  const { data: paginatedInterviews, isValidating: isFiltering, mutate: mutateInterviews } = useSWR<{ items: any[], total: number }>(
    `/api/analytics/interviews${filterQuery ? `?${filterQuery}` : ''}`,
    (url: string) => fetcher<{ items: any[], total: number }>(url),
    { keepPreviousData: true }
  )

  // ... helper calculations ...
  const r_metrics = useMemo(() => {
    const d = dashboardData || {}
    // Check for new flat structure first
    if ('total_applications' in d) {
      return {
        total_candidates: (d as any).total_applications || 0,
        shortlisted_candidates: (d as any).total_interviews || 0,
        interviewed_candidates: (d as any).completed_interviews || 0,
        offers_released: (d as any).offers_released || 0,
        hiring_success_rate: (d as any).success_rate || 0
      }
    }
    // Fallback to legacy nested structure or zero defaults
    const nested = (d as any).recruitment_metrics || {}
    return {
      total_candidates: nested.total_candidates || 0,
      shortlisted_candidates: nested.shortlisted_candidates || 0,
      interviewed_candidates: nested.interviewed_candidates || 0,
      offers_released: nested.offers_released || 0,
      hiring_success_rate: nested.hiring_success_rate || 0
    }
  }, [dashboardData])
  
  const c_metrics = useMemo(() => {
    const d = dashboardData || {}
    // Check for new flat structure first
    if ('average_score' in d) {
      return {
        avg_job_compatibility: 0,
        avg_aptitude_score: 0,
        avg_interview_score: 0,
        avg_composite_score: (d as any).average_score || 0
      }
    }
    // Fallback to legacy nested structure or zero defaults
    const nested = (d as any).candidate_metrics || {}
    return {
      avg_job_compatibility: nested.avg_job_compatibility || 0,
      avg_aptitude_score: nested.avg_aptitude_score || 0,
      avg_interview_score: nested.avg_interview_score || 0,
      avg_composite_score: nested.avg_composite_score || 0
    }
  }, [dashboardData])

  // Chart data is shaped by the backend (Applied, Screened, Interview completed,
  // Physical, Hired [aggregated], Rejected) – no client-side filtering needed.
  const chartData = (dashboardData as any)?.chart_data || []
  const recentInterviews = useMemo(() => {
    if (paginatedInterviews?.items && Array.isArray(paginatedInterviews.items)) {
      return paginatedInterviews.items
    }
    const legacy = (dashboardData as any)?.recent_interviews
    return Array.isArray(legacy) ? legacy : []
  }, [paginatedInterviews, dashboardData])

  const handleReset = () => {
    setFilters({
      search: '',
      date: '',
      status: 'all'
    })
    setJobFilter('all')
    setCurrentPage(1)
    setPageSize(10)
  }


  const COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444'];

  // We've removed the blocking error/loading UI to ensure the dashboard shell always loads.
  // Metrics will fallback to zero defaults handled in useMemos.

  return (
    <div className="section-stack">
      {/* Header */}
      <PageHeader 
        title="Recruitment Dashboard"
        description="AI-Powered Intelligent Dashboard "
        icon={LayoutDashboard}
      />



      {isSuperAdmin && pendingApprovals.length > 0 && (
        <Card className="pt-0 overflow-hidden animate-in fade-in duration-300">
          <CardHeader className="bg-muted/35 border-b border-border/60 pb-4 pt-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle className="text-foreground/80">Pending HR Approvals</CardTitle>
                <CardDescription className="text-muted-foreground">Review newly registered HR users before they can login.</CardDescription>
              </div>
              <Badge variant="secondary" className="bg-primary text-primary-foreground">
                {pendingApprovals.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground mb-4">
              {pendingApprovals.length > 0
                ? `There ${pendingApprovals.length === 1 ? 'is' : 'are'} ${pendingApprovals.length} account${pendingApprovals.length === 1 ? '' : 's'} waiting for approval.`
                : 'No pending HR approvals at the moment.'}
            </p>
            <Link href="/dashboard/hr/approvals">
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-md hover:shadow-lg active:scale-[0.98] transition-all duration-200 rounded-xl">
                Review Pending HR Approvals
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Stats Cards AI Enhanced */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 stagger-children">
        <Link href="/dashboard/hr/applications" className="block cursor-pointer">
          <StatsCard
            title="Total Candidates"
            value={r_metrics.total_candidates}
            icon={Users}
            color="text-primary"
            bg="bg-primary/10"
            isInteractive={true}
          />
        </Link>
        <StatsCard
          title="Hiring Success"
          value={`${r_metrics.hiring_success_rate}%`}
          icon={TrendingUp}
          color="text-emerald-600"
          bg="bg-emerald-500/10"
        />
        <StatsCard
          title="Avg Candidate Score"
          value={c_metrics.avg_composite_score}
          icon={Award}
          color="text-amber-600"
          bg="bg-amber-500/10"
        />
        <StatsCard
          title="Total Offers Sent"
          value={r_metrics.offers_released}
          icon={CheckCircle}
          color="text-blue-600"
          bg="bg-blue-500/10"
        />
      </div>

      {/* Charts & Tables Section */}
      <div className="flex flex-row gap-4 ">

        {/* Chart Section */} 
        <div className="w-[73%] animate-in fade-in duration-500 delay-300">
          <Card className="h-full pt-0 overflow-hidden pb-5">
            <CardHeader className="bg-muted/35 border-b border-border/60 pb-4 pt-5">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle >Application Pipeline</CardTitle>
                  <CardDescription className="text-muted-foreground">Distribution of candidates by status</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setChartType(prev => prev === 'bar' ? 'funnel' : 'bar')}
                    className="h-9 px-3 text-xs"
                  >
                    {chartType === 'bar' ? 'Show Funnel' : 'Show Bar'}
                  </Button>
                  <div className="p-2 bg-primary/10 text-primary rounded-md">
                    <TrendingUp className="h-5 w-5" />
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="h-[300px] w-full">
                <DashboardChart data={chartData} type={chartType} />
              </div>
            </CardContent>
          </Card>
          
        </div>

        {/* Recent Activity / Quick Actions */}
        <div className="w-[27%] animate-in fade-in duration-500 delay-500">
          <Card className="overflow-hidden">
            <CardHeader className="bg-muted/35 border-b border-border/60 pt-5 pb-5">
              <CardTitle >Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 py-5 stagger-children">
              <ActionButton href="/dashboard/hr/applications" label="Review Applications" />
              <ActionButton href="/dashboard/hr/pipeline" label="Hiring Pipeline" />
              <ActionButton href="/dashboard/hr/reports" label="View Reports" />
              <ActionButton href="/dashboard/onboarding" label="Onboarding" />
              <ActionButton href="/dashboard/hr/tickets" label="Resolve Tickets" />
              <ActionButton href="/dashboard/settings" label="Settings" />
            </CardContent>
          </Card>
        </div>
      </div>

    </div>
  )
}

const StatsCard = React.memo(({ title, subtitle, value, icon: Icon, color, bg, isInteractive = false }: any) => {
  return (
    <Card className={cn(
      "group overflow-hidden py-3",
      isInteractive && "hover-premium-lift cursor-pointer active:scale-[0.98] transition-transform duration-200"
    )}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-sm font-semibold text-muted-foreground group-hover:text-foreground transition-colors uppercase tracking-wide">
            {title}
          </CardTitle>
          {subtitle && (
            <p className="text-xs text-muted-foreground/60 mt-0.5">{subtitle}</p>
          )}
        </div>
        <div className={`p-2.5 rounded-md ${bg} transition-colors duration-200`}>
          <Icon className={`h-4 w-4 ${color}`} />
        </div>
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-semibold leading-none text-foreground dark:text-white mt-2 tabular-nums ${color} transition-colors duration-300`}>{value}</div>
      </CardContent>
    </Card>
  )
})
StatsCard.displayName = 'StatsCard'

const ActionButton = React.memo(({ href, label }: { href: string, label: string }) => {
  return (
    <Link href={href} className="block group">
      <Button 
        variant="outline" 
        className="w-full justify-between text-foreground hover:bg-primary/5 hover:text-primary focus:bg-primary/5 focus:text-primary active:bg-primary/10 active:text-primary border-border hover:border-primary/40 active:scale-[0.99] transition-all duration-200"
      >
        {label}
        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
      </Button>
    </Link>
  )
})
ActionButton.displayName = 'ActionButton'
