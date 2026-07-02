'use client'

import React, { useState, useMemo, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { BatchUploadModal } from '@/components/batch-upload-modal'
import { Badge } from '@/components/ui/badge'
import { UploadCloud, Download, Loader2, SearchX, CalendarDays, Briefcase, Clock, Filter, FileText } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { APIClient } from '@/app/dashboard/lib/api-client'
import { fetcher } from '@/app/dashboard/lib/swr-fetcher'
import * as XLSX from 'xlsx'
import { useConfirm } from '@/components/ui/confirm-dialog'

// ─── Phone normalizer (mirrored from batch-upload-modal) ────────────
function normalizePhone(rawPhone: string, countryCode?: string | null): string {
  if (!rawPhone || rawPhone.trim() === '') return 'N/A'
  const cleaned = rawPhone.replace(/[\s\-\(\)]/g, '').trim()
  if (!cleaned) return 'N/A'
  const digitsOnly = cleaned.replace(/[^\d]/g, '')
  if (!digitsOnly) return 'N/A'
  if (cleaned.startsWith('+')) return '+' + digitsOnly
  const prefix = countryCode ? countryCode.toString().replace(/\D/g, '') : '91'
  if (digitsOnly.length > 10 && digitsOnly.startsWith(prefix)) return '+' + digitsOnly
  if (digitsOnly.length === 10) return '+' + prefix + digitsOnly
  return '+' + digitsOnly
}

interface Job {
  id: number
  title: string
  status: string
}

interface BatchApplication {
  candidate_name?: string
  candidate_email?: string
  candidate_phone?: string
  country_code?: string
  job?: { title?: string }
  resume_score?: number
  resume_extraction?: { resume_score?: number }
  applied_at?: string
}

const TIME_OPTIONS = [
  { value: 'all', label: 'All Time' },
  { value: 'morning', label: 'Morning (6 AM – 12 PM)' },
  { value: 'afternoon', label: 'Afternoon (12 PM – 6 PM)' },
  { value: 'evening', label: 'Evening (6 PM – 12 AM)' },
  { value: 'night', label: 'Night (12 AM – 6 AM)' },
]

export default function BatchAnalysisPage() {
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false)
  const router = useRouter()

  // ─── Filter state ─────────────────────────────────────────────
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [filterJobId, setFilterJobId] = useState('all')
  const [timeRange, setTimeRange] = useState('all')

  // ─── Export state ─────────────────────────────────────────────
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportCount, setExportCount] = useState<number | null>(null)

  // ─── Live count (updates with filters) ───────────────────────
  const [liveCount, setLiveCount] = useState<number | null>(null)
  const [isCountLoading, setIsCountLoading] = useState(false)

  const { data: jobs, isLoading: jobsLoading } = useSWR<Job[]>(
    '/api/jobs?limit=500',
    (url: string) => fetcher<Job[]>(url),
  )

  // Validation
  const dateError = useMemo(() => {
    if (fromDate && toDate && fromDate > toDate) return 'From date cannot be after To date'
    const todayStr = new Date().toISOString().slice(0, 10)
    if (fromDate && fromDate > todayStr) return 'From date cannot be in the future'
    if (toDate && toDate > todayStr) return 'To date cannot be in the future'
    return ''
  }, [fromDate, toDate])

  // Human-readable filter summary
  const filterSummary = useMemo(() => {
    const parts: string[] = []
    if (fromDate || toDate) {
      const f = fromDate ? new Date(fromDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Start'
      const t = toDate ? new Date(toDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Present'
      parts.push(`📅 ${f} → ${t}`)
    }
    if (filterJobId !== 'all') {
      const job = jobs?.find(j => j.id.toString() === filterJobId)
      parts.push(`💼 ${job?.title || 'Selected Role'}`)
    }
    if (timeRange !== 'all') {
      const opt = TIME_OPTIONS.find(t => t.value === timeRange)
      parts.push(`⏱ ${opt?.label || timeRange}`)
    }
    return parts
  }, [fromDate, toDate, filterJobId, timeRange, jobs])

  const hasFilters = fromDate || toDate || filterJobId !== 'all' || timeRange !== 'all'

  // ─── Fetch live count on filter change ───────────────────────
  useEffect(() => {
    const fetchCount = async () => {
      if (dateError) return
      setIsCountLoading(true)
      try {
        const params = new URLSearchParams()
        if (filterJobId !== 'all') params.append('job_id', filterJobId)
        if (fromDate) params.append('from_date', fromDate)
        if (toDate) params.append('to_date', toDate)
        if (timeRange !== 'all') params.append('time_range', timeRange)
        params.append('limit', '1000')
        const qs = params.toString()
        const response = await APIClient.get(`/api/applications${qs ? '?' + qs : ''}`) as any
        const total = response?.total ?? (Array.isArray(response) ? response.length : (response?.items?.length ?? 0))
        setLiveCount(total)
      } catch {
        setLiveCount(null)
      } finally {
        setIsCountLoading(false)
      }
    }
    const timer = setTimeout(fetchCount, 400)
    return () => clearTimeout(timer)
  }, [fromDate, toDate, filterJobId, timeRange, dateError])

  const clearFilters = () => {
    setFromDate('')
    setToDate('')
    setFilterJobId('all')
    setTimeRange('all')
    setExportError('')
    setExportCount(null)
  }

  // ─── Export handler ───────────────────────────────────────────────────
  const confirm = useConfirm()
  const handleFilteredExport = async () => {
    if (dateError) return
    setIsExporting(true)
    setExportError('')
    setExportCount(null)

    try {
      // Build query params
      const params = new URLSearchParams()
      if (filterJobId !== 'all') params.append('job_id', filterJobId)
      if (fromDate) params.append('from_date', fromDate)
      if (toDate) params.append('to_date', toDate)
      if (timeRange !== 'all') params.append('time_range', timeRange)
      params.append('limit', '1000')

      const qs = params.toString()
      const url = `/api/applications${qs ? '?' + qs : ''}`

      // BA_033: Hard requirement to indicate filters
      if (!hasFilters) {
        const confirmAll = await confirm({
          title: 'Export All Candidates?',
          description: 'You have not applied any filters. This will export ALL candidates in the system (up to 1,000). Apply a Job, Date, or Time filter first for specific data.',
          confirmLabel: 'Export All',
          cancelLabel: 'Add Filters',
          variant: 'warning',
        })
        if (!confirmAll) {
          setIsExporting(false)
          return
        }
      }

      const response = await APIClient.get(url) as any
      const data = Array.isArray(response) ? response : (response?.items || [])

      if (!data || data.length === 0) {
        setExportError('No candidates found for selected filters.')
        setExportCount(0)
        return
      }

      setExportCount(data.length)

      // Build Excel rows
      const rows = data.map((app: BatchApplication) => {
        const name = app.candidate_name || 'Unknown'
        const email = app.candidate_email || 'N/A'
        const phone = normalizePhone(app.candidate_phone || '', app.country_code || null)
        const role = app.job?.title || 'Unknown Role'
        const rawScore = app.resume_score ?? app.resume_extraction?.resume_score ?? 0
        const pctScore = rawScore <= 10 && rawScore > 0 ? rawScore * 10 : rawScore
        const match = pctScore >= 50 ? 'YES' : 'NO'
        const appliedAt = app.applied_at ? new Date(app.applied_at).toLocaleString() : 'N/A'

        return {
          'Name': name,
          'Email': email,
          'Phone Number': phone,
          'Job Role': role,
          'Applied At': appliedAt,
          'MATCH': match,
        }
      })

      const worksheet = XLSX.utils.json_to_sheet(rows)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Candidates')

      // Generate filename with filter context
      const datePart = fromDate || toDate ? `_${fromDate || 'start'}_to_${toDate || 'present'}` : ''
      const rolePart = filterJobId !== 'all' ? `_${(jobs?.find(j => j.id.toString() === filterJobId)?.title || 'role').replace(/\s+/g, '_')}` : ''
      XLSX.writeFile(workbook, `candidates_export${datePart}${rolePart}.xlsx`)
    } catch (err) {
      console.error('Export failed:', err)
      setExportError(err instanceof Error ? err.message : 'Failed to export data.')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="Batch Analysis"
        description="Upload and process multiple resumes, or export filtered candidate data."
        icon={FileText}
      />

      <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-6 stagger-children">
        {/* ─── Bulk Upload Card ──────────────────────────── */}
        <Card className="flex flex-col h-full bg-card/60 backdrop-blur-md rounded-2xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden pt-0">
          <CardHeader className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/40 pb-4 pt-5">
            <CardTitle className="flex items-center gap-2.5 text-base font-bold">
              <div className="p-1.5 bg-primary/10 rounded-lg">
                <UploadCloud className="h-4 w-4 text-primary" />
              </div>
              Bulk Processing Engine
            </CardTitle>
            <CardDescription>
              Supported inputs: PDF/DOCX files, nested folders, or ZIP archives (max 40 per batch).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col p-5">
            <div className="flex-1 min-h-[300px] bg-gradient-to-br from-primary/5 via-muted/10 to-primary/5 border-2 border-dashed border-primary/30 rounded-2xl p-8 text-center flex flex-col items-center justify-center gap-1 transition-all duration-300 hover:border-primary/50 hover:bg-primary/[0.03] group shadow-inner cursor-pointer" onClick={() => setIsBatchModalOpen(true)}>
              <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-4 shadow-inner transition-all duration-300 group-hover:scale-110 group-hover:ring-4 group-hover:ring-primary/15">
                <UploadCloud className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-lg font-bold mb-1 text-foreground">Ready to ingest resumes</h3>
              <p className="text-muted-foreground text-sm max-w-md mx-auto mb-6 leading-relaxed">
                Our AI engine maps resumes to job roles, strips duplicates, extracts identities, and prepares spreadsheets for export.
              </p>
              <Button
                onClick={() => setIsBatchModalOpen(true)}
                size="lg"
                className="gap-2 rounded-xl px-8 shadow-md active:scale-[0.99] transition-all duration-200"
              >
                <UploadCloud className="h-4 w-4" />
                Run Batch Analysis
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ─── Filtered Export Card ──────────────────────── */}
        <Card className="flex flex-col h-full bg-card/60 backdrop-blur-md rounded-2xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden pt-0">
          <CardHeader className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/40 pb-4 pt-5">
            <CardTitle className="flex items-center gap-2.5 text-base font-bold">
              <div className="p-1.5 bg-primary/10 rounded-lg">
                <Filter className="h-4 w-4 text-primary" />
              </div>
              Export Filtered Data
            </CardTitle>
            <CardDescription className="flex items-center justify-between">
              <span>Download candidate data filtered by date, role, or time-of-day.</span>
              <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400 dark:border-amber-500/30 text-[10px] h-5">
                Max 40
              </Badge>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col pt-6">
            <div className="space-y-5 max-w-2xl w-full">
              {/* Date Range */}
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-sm font-medium">
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                  Date Range
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">From</Label>
                    <Input
                      type="date"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                      className="text-sm bg-background/50 border border-input rounded-xl hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">To</Label>
                    <Input
                      type="date"
                      value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                      className="text-sm bg-background/50 border border-input rounded-xl hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200"
                    />
                  </div>
                </div>
                {dateError && (
                  <p className="text-xs text-destructive mt-1">{dateError}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                
                  {/* Job Role */}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5 text-sm font-medium">
                      <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                      Job Role
                    </Label>
                    <Select value={filterJobId} onValueChange={setFilterJobId} disabled={jobsLoading}>
                      <SelectTrigger className="text-sm bg-background/50 border border-input rounded-xl hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200">
                        <SelectValue placeholder={jobsLoading ? 'Loading...' : 'All Roles'} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Roles</SelectItem>
                        {jobs?.filter(j => j.status === 'open').map(job => (
                          <SelectItem key={job.id} value={job.id.toString()}>
                            {job.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Time Window */}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5 text-sm font-medium">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      Applied Time
                    </Label>
                    <Select value={timeRange} onValueChange={setTimeRange}>
                      <SelectTrigger className="text-sm bg-background/50 border border-input rounded-xl hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIME_OPTIONS.map(opt => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
              
              </div>
              {/* Filter Summary */}
              {filterSummary.length > 0 && (
                <div className="bg-primary/5 border-l-4 border-l-primary border border-primary/15 rounded-xl p-3.5 space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
                  <p className="text-[10px] font-bold text-primary uppercase tracking-widest flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary inline-block" />
                    Exporting with filters
                  </p>
                  {filterSummary.map((line, i) => (
                    <p key={i} className="text-sm text-foreground/80 font-medium pl-3">{line}</p>
                  ))}
                </div>
              )}

              {/* Export Error / Empty */}
              {exportError && (
                <div className="flex items-center gap-2 bg-destructive/10 text-destructive border border-destructive/20 rounded-lg p-3">
                  <SearchX className="h-4 w-4 shrink-0" />
                  <p className="text-sm font-medium">{exportError}</p>
                </div>
              )}

              {/* Export Success Count */}
              {exportCount !== null && exportCount > 0 && !exportError && (
                <div className="flex items-center gap-2.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 rounded-xl p-3 animate-in fade-in zoom-in-95 duration-300">
                  <div className="h-7 w-7 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <p className="text-sm font-bold">Successfully exported {exportCount} candidate{exportCount !== 1 ? 's' : ''}.</p>
                </div>
              )}

              {/* Live Count Badge */}
              {hasFilters && liveCount !== null && (
                <div className={`flex items-center justify-between px-4 py-2.5 rounded-xl border text-sm font-semibold ${
                  liveCount === 0
                    ? 'bg-destructive/10 border-destructive/20 text-destructive'
                    : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                }`}>
                  <span>
                    {isCountLoading ? 'Counting...' : liveCount === 0 ? 'No candidates found for these filters' : `${liveCount} candidate${liveCount !== 1 ? 's' : ''} will be exported`}
                  </span>
                  {liveCount > 0 && <Download className="h-3.5 w-3.5 opacity-60" />}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <Button
                  onClick={handleFilteredExport}
                  disabled={isExporting || !!dateError || liveCount === 0}
                  className="flex-1 gap-2 rounded-xl shadow-md shadow-primary/10 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.99] transition-all duration-200 font-bold"
                >
                  {isExporting ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Exporting...</>
                  ) : (
                    <><Download className="h-4 w-4" /> Download Excel</>
                  )}
                </Button>
                {hasFilters && (
                  <Button 
                    variant="outline" 
                    onClick={clearFilters} 
                    className="shrink-0 rounded-xl active:scale-[0.99] transition-all duration-200 font-bold hover:bg-muted/50"
                  >
                    Clear Filters
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <BatchUploadModal
        isOpen={isBatchModalOpen}
        onClose={() => setIsBatchModalOpen(false)}
        onSuccess={() => {
          setIsBatchModalOpen(false)
          router.push('/dashboard/hr/applications')
        }}
      />
    </div>
  )
}
