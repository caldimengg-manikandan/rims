'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from '@/components/ui/dialog'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { APIClient } from '@/app/dashboard/lib/api-client'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import useSWR from 'swr'
import { fetcher } from '@/app/dashboard/lib/swr-fetcher'
import { useRouter } from 'next/navigation'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'

import {
    Mail,
    Inbox,
    ChevronLeft,
    ChevronRight,
    Loader2,
    CheckCircle2,
    AlertTriangle,
    Search,
    RefreshCw,
    FileText,
    ExternalLink,
    Settings,
    Save,
    Zap,
    WifiOff,
    Trash2,
    Check,
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/app/dashboard/lib/auth-context'

interface IngestedEmail {
    id: number
    sender_email: string
    subject: string
    file_name: string
    file_url: string | null
    received_at: string
    processed: boolean
    application_id: number | null
    job_title: string | null
    job_code: string | null
    is_duplicate: boolean
}

interface PaginatedResponse {
    items: IngestedEmail[]
    total: number
    page: number
    size: number
    pages: number
}
export default function IngestedEmailsPage() {
    const router = useRouter()
    const [page, setPage] = useState(1)
    const [pageSize, setPageSize] = useState(10)
    const [searchTerm, setSearchTerm] = useState('')
    const [debouncedSearch, setDebouncedSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState('all') // all, mapped, unmapped
    const [isSyncing, setIsSyncing] = useState(false)
    const [isAssigning, setIsAssigning] = useState(false)
    const [isSavingSettings, setIsSavingSettings] = useState(false)
    const [selectedIds, setSelectedIds] = useState<number[]>([])
    const [imapUser, setImapUser] = useState('')
    const [imapPass, setImapPass] = useState('') // write-only, never populated from server
    const [imapConfigured, setImapConfigured] = useState(false)
    const [autoSyncEnabled, setAutoSyncEnabled] = useState(false)
    const [showCredentials, setShowCredentials] = useState(false)
    const [emailError, setEmailError] = useState('')
    const [passwordError, setPasswordError] = useState('')
    const [configError, setConfigError] = useState('')

    const { user } = useAuth()

    // Load current settings on mount — use /sensitive endpoint so we get real IMAP values
    useEffect(() => {
        const loadSettings = async () => {
            if (!user) return
            try {
                // BUG-A Fix: Must call /sensitive to get actual imap_email, imap_configured,
                // and auto_sync_enabled. The public GET /api/settings strips all these fields.
                const settings = await APIClient.get('/api/settings/sensitive') as any
                if (settings.imap_email) setImapUser(settings.imap_email)
                setImapConfigured(!!settings.imap_configured)
                setAutoSyncEnabled(!!settings.auto_sync_enabled)
            } catch (err) {
                console.error('Failed to load settings:', err)
            }
        }
        loadSettings()
    }, [user])

    // Assignment Modal State
    const [selectedResume, setSelectedResume] = useState<IngestedEmail | null>(null)
    const [targetJobId, setTargetJobId] = useState<string>('')

    // Debounce search
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedSearch(searchTerm)
            setPage(1)
        }, 400)
        return () => clearTimeout(handler)
    }, [searchTerm])

    // Load open jobs for manual assignment dropdown
    const { data: jobs } = useSWR<any[]>('/api/jobs', fetcher)
    const openJobs = useMemo(() => {
        return (jobs || []).filter(job => job.status === 'open')
    }, [jobs])

    // API URL construction
    const listUrl = useMemo(() => {
        const q = new URLSearchParams()
        q.set('limit', String(pageSize))
        q.set('skip', String((page - 1) * pageSize))
        if (debouncedSearch) q.set('search', debouncedSearch)
        if (statusFilter === 'mapped') q.set('processed', 'true')
        if (statusFilter === 'unmapped') q.set('processed', 'false')
        return `/api/applications/ingested-emails?${q.toString()}`
    }, [page, pageSize, debouncedSearch, statusFilter])

    const { data, error, isLoading, mutate } = useSWR<PaginatedResponse>(listUrl, fetcher, {
        keepPreviousData: true,
        refreshInterval: 60000 // refresh every minute
    })

    // Items are already server-filtered; no need for additional client-side filtering
    // (a previous client-side filter was causing Bugs 8 & 9 by double-filtering results)
    const filteredItems = data?.items ?? []

    const totalCount = data?.total ?? 0;
    const totalPages = data?.pages ?? 0;

    // Global stats come embedded in every listing response via global_stats field.
    // This ensures stats cards always reflect accurate numbers regardless of
    // the active filter (fixes Bugs 4, 5, and 7).
    const globalStats = (data as any)?.global_stats ?? null
    const statTotalIngested = globalStats?.total_ingested ?? totalCount
    const statAutoMapped = globalStats?.auto_mapped ?? 0
    const statPending = globalStats?.pending_assignment ?? 0

    // Save IMAP Settings
    const handleSaveSettings = async () => {
        // Clear previous errors
        setEmailError('')
        setPasswordError('')
        setConfigError('')

        if (!imapUser.trim()) {
            setEmailError('Email address is required')
            return
        }

        // Client-side email format validation
        const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
        if (!emailPattern.test(imapUser.trim())) {
            setEmailError('Invalid email format. Please enter a valid email address (e.g. user@gmail.com).')
            return
        }

        // Only require password if it's a new setup (not yet configured) OR if user has typed something in the password field
        const hasNewPassword = imapPass.trim().length > 0;
        if (!imapConfigured && !hasNewPassword) {
            setPasswordError('App Password is required')
            return
        }

        if (hasNewPassword) {
            // Client-side password length check (Gmail App Passwords are 16 chars)
            const passwordNoSpaces = imapPass.trim().replace(/\s/g, '')
            if (passwordNoSpaces.length < 8) {
                setPasswordError('App Password is too short. Gmail App Passwords are typically 16 characters.')
                return
            }
        }

        setIsSavingSettings(true)
        const toastId = toast.loading('Verifying mailbox credentials and saving configuration...')

        try {
            const payload: Record<string, unknown> = {
                imap_email: imapUser.trim(),
                auto_sync_enabled: autoSyncEnabled
            }
            // Only include password if user typed a new one (write-only — never re-send masked value)
            if (imapPass.trim()) {
                payload.imap_password = imapPass.trim()
            }
            await APIClient.post('/api/settings', payload)

            toast.success('Mailbox verified and configuration saved! Auto-sync will now run in the background.', { id: toastId })
            setImapConfigured(true)
            setImapPass('') // Clear password field after save
            setShowCredentials(false)
            setConfigError('')
        } catch (err: any) {
            console.error('Save settings error:', err)
            toast.dismiss(toastId)
            // APIClient throws a plain Error with the message string — not an axios-style
            // object with .response.data. We read err.message directly.
            const errMsg: string = err?.message || 'Settings could not be saved. Please try again.'

            if (
                errMsg.includes('Invalid email') ||
                errMsg.includes('email format') ||
                errMsg.includes('imap_email')
            ) {
                setEmailError(errMsg.replace('Value error, ', ''))
                toast.error('Please fix the validation errors below.', { id: toastId })
            } else if (
                errMsg.includes('App Password') ||
                errMsg.includes('imap_password') ||
                errMsg.includes('too short')
            ) {
                setPasswordError(errMsg.replace('Value error, ', ''))
                toast.error('Please fix the validation errors below.', { id: toastId })
            } else if (
                errMsg.includes('Authentication failed') ||
                errMsg.includes('AUTHENTICATIONFAILED') ||
                errMsg.includes('Invalid credentials')
            ) {
                // IMAP auth failure returned as HTTP 400 — credentials were NOT saved
                setConfigError(errMsg)
                toast.error('Mailbox authentication failed. Credentials were not saved.', { id: toastId })
            } else {
                setConfigError(errMsg)
                toast.error(errMsg, { id: toastId })
            }
        } finally {
            setIsSavingSettings(false)
        }
    }

    // Trigger Manual Email Ingestion via API
    // BUG-001 Fix: Credentials are NOT sent in the request body.
    // The backend reads IMAP credentials exclusively from server-side GlobalSettings.
    const handleSync = async () => {
        if (!imapConfigured) {
            toast.error('Please configure your mailbox settings first before syncing.')
            setShowCredentials(true)
            return
        }

        setIsSyncing(true)
        const toastId = toast.loading('Connecting to mailbox and fetching resumes...')

        try {
            const res = (await APIClient.post('/api/applications/ingest-emails', {
                trigger: true
            })) as any

            if (res.saved_count > 0 || res.processing_triggered) {
                toast.success(
                    res.message || `Found ${res.saved_count} new resumes! AI mapping and analysis has started in the background.`,
                    { id: toastId, duration: 6000 }
                )
            } else {
                toast.success(res.message || 'Mailbox is up to date. No new resumes found.', { id: toastId })
            }
            
            // Immediately mutate to show the new ingested records (fetch is fast)
            mutate()
            
            // Re-mutate after 10 seconds to show AI mapping results
            setTimeout(() => mutate(), 10000)
            setTimeout(() => mutate(), 30000)
        } catch (err: any) {
            console.error('Sync error:', err)
            // BUG-E Fix: APIClient throws plain Error — message is in err.message, not err.response.data.detail
            toast.error(err.message || 'Mailbox sync failed. Please verify your email address and App Password, then try again.', { id: toastId })
        } finally {
            setIsSyncing(false)
        }
    }

    // Manual Job Assignment Handler
    const handleAssignConfirm = async () => {
        if (!selectedResume || !targetJobId) {
            toast.error('Please select a target job')
            return
        }

        setIsAssigning(true)
        const toastId = toast.loading(`Assigning candidate ${selectedResume.sender_email.split('<')[0]} to selected job...`)

        try {
            await APIClient.post(`/api/applications/ingested-emails/${selectedResume.id}/assign`, {
                job_id: Number(targetJobId)
            })

            toast.success('Successfully assigned! Application created and AI parsing triggered.', { id: toastId })
            setSelectedResume(null)
            setTargetJobId('')
            mutate()
        } catch (err: any) {
            console.error('Assignment error:', err)
            // BUG-F Fix: APIClient throws plain Error — message is in err.message
            toast.error(err.message || 'Could not assign the candidate to the selected job. Please try again.', { id: toastId })
        } finally {
            setIsAssigning(false)
        }
    }
    const handleDeleteEmail = async (id: number) => {
        if (!confirm('Are you sure you want to remove this ingested email record?')) {
            return
        }

        const toastId = toast.loading('Deleting ingested email...')
        try {
            await APIClient.delete(`/api/applications/ingested-emails/${id}`)
            toast.success('Ingested email deleted successfully', { id: toastId })
            setSelectedIds(prev => prev.filter(selectedId => selectedId !== id))
            mutate()
        } catch (err: any) {
            console.error('Delete error:', err)
            toast.error(err.message || 'Could not delete the ingested email. Please try again.', { id: toastId })
        }
    }

    const selectableItems = React.useMemo(() => {
        return filteredItems.filter(item => !item.application_id)
    }, [filteredItems])

    const isAllSelected = React.useMemo(() => {
        if (selectableItems.length === 0) return false
        return selectableItems.every(item => selectedIds.includes(item.id))
    }, [selectableItems, selectedIds])

    const handleSelectAllToggle = () => {
        if (isAllSelected) {
            const selectableIds = selectableItems.map(item => item.id)
            setSelectedIds(prev => prev.filter(id => !selectableIds.includes(id)))
        } else {
            const selectableIds = selectableItems.map(item => item.id)
            setSelectedIds(prev => {
                const newIds = [...prev]
                selectableIds.forEach(id => {
                    if (!newIds.includes(id)) {
                        newIds.push(id)
                    }
                })
                return newIds
            })
        }
    }

    const handleRowSelectToggle = (id: number) => {
        setSelectedIds(prev => {
            if (prev.includes(id)) {
                return prev.filter(item => item !== id)
            } else {
                return [...prev, id]
            }
        })
    }

    const handleBulkDelete = async () => {
        if (selectedIds.length === 0) return

        if (!confirm(`Are you sure you want to delete the ${selectedIds.length} selected ingested email records?`)) {
            return
        }

        const toastId = toast.loading(`Deleting ${selectedIds.length} ingested emails...`)
        try {
            await APIClient.post('/api/applications/ingested-emails/bulk-delete', {
                ids: selectedIds
            })
            toast.success('Selected emails deleted successfully', { id: toastId })
            setSelectedIds([])
            mutate()
        } catch (err: any) {
            console.error('Bulk delete error:', err)
            toast.error(err.message || 'Could not delete the selected emails. Please try again.', { id: toastId })
        }
    }

    const getInitials = (sender: string) => {
        const cleaned = sender.split('<')[0].trim()
        // BUG-J Fix: If display name is missing, an email address, or a placeholder,
        // fall back to the local-part of the email address for meaningful initials.
        if (!cleaned || cleaned.includes('@') || cleaned.toLowerCase() === 'emailed candidate') {
            const emailMatch = sender.match(/<([^>]+)>/) || sender.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+)/)
            if (emailMatch) {
                const localPart = emailMatch[1].split('@')[0].replace(/[._-]/g, ' ')
                return localPart.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || 'U'
            }
            return 'U'
        }
        return cleaned.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    }

    return (
        <div className="space-y-8">
            <PageHeader
                title="Email Ingestion Inbox"
                description="Review, manage, and manually assign job applications fetched automatically from your recruiter email channels."
                icon={Mail}
            >
                <div className="flex items-center gap-4">
                    {autoSyncEnabled && (
                        <Badge variant="outline" className="h-9 px-4 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 dark:border-emerald-500/30 flex items-center gap-2 animate-pulse font-bold text-[10px] tracking-widest uppercase">
                            <Zap className="h-3 w-3 fill-emerald-600 dark:fill-emerald-400" />
                            Auto-Sync Active
                        </Badge>
                    )}
                    <div className="flex gap-3">
                        {selectedIds.length > 0 && (user?.role === 'super_admin' || user?.role === 'hr') && (
                            <Button
                                onClick={handleBulkDelete}
                                className="gap-2 bg-rose-600 hover:bg-rose-700 text-white shadow-lg shadow-rose-600/20 rounded-xl h-11 font-semibold active:scale-[0.98] transition-all duration-200"
                            >
                                <Trash2 className="h-4 w-4" />
                                Delete Selected ({selectedIds.length})
                            </Button>
                        )}
                        <Button
                            variant="outline"
                            onClick={() => setShowCredentials(!showCredentials)}
                            className={`gap-2 border-border shadow-sm rounded-xl h-11 active:scale-[0.98] transition-all duration-200 ${showCredentials ? 'bg-primary/5 border-primary/20 text-primary' : ''}`}
                        >
                            <Settings className="h-4 w-4" />
                            Configure Mailbox
                        </Button>
                        <Button
                            onClick={handleSync}
                            disabled={isSyncing}
                            className="gap-2 bg-primary text-primary-foreground shadow-sm rounded-xl h-11 font-semibold active:scale-[0.98] hover:shadow-md transition-all duration-200"
                        >
                            {isSyncing ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <RefreshCw className="h-4 w-4" />
                            )}
                            Sync Emails
                        </Button>
                    </div>
                </div>
            </PageHeader>

            {/* Credentials Card */}
            {showCredentials && (
                <Card className="bg-card/45 backdrop-blur-xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden rounded-2xl animate-in zoom-in-95 slide-in-from-top-4 duration-300">
                    <CardHeader className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/40 -mx-6 -mt-6 px-12 pt-8 pb-6 rounded-t-[2rem]">
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <CardTitle className="flex items-center gap-2 text-base font-bold">
                                    <Settings className="h-5 w-5 text-primary" />
                                    Mailbox Configuration
                                </CardTitle>
                                <CardDescription>
                                    Manage the Gmail IMAP settings used for background application polling.
                                </CardDescription>
                            </div>
                            <div className="flex items-center gap-3 bg-muted/30 p-2.5 rounded-2xl border border-border/60">
                                <div className="space-y-0.5 px-1">
                                    <Label className="text-[10px] font-black uppercase tracking-tighter text-muted-foreground">Auto-Syncing</Label>
                                    <p className="text-[9px] text-muted-foreground/70 font-medium">Runs every 1 minute</p>
                                </div>
                                <Switch 
                                    checked={autoSyncEnabled} 
                                    onCheckedChange={setAutoSyncEnabled}
                                    className="data-[state=checked]:bg-emerald-500"
                                />
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="pt-8 space-y-6">
                        {configError && (
                            <div className="p-4 rounded-xl bg-red-50 border-2 border-red-200 text-red-700 text-sm font-semibold flex items-start gap-3">
                                <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                                <div>
                                    <p className="font-black text-red-800 text-xs uppercase tracking-wider mb-1">Connection Failed</p>
                                    <p>{configError}</p>
                                </div>
                            </div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <Label htmlFor="imap_user" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">IMAP Email Address</Label>
                                <Input
                                    id="imap_user"
                                    value={imapUser}
                                    onChange={e => { setImapUser(e.target.value); setEmailError(''); setConfigError(''); }}
                                    className={`h-12 bg-background/50 border border-input rounded-xl hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200 font-medium ${emailError ? 'border-red-400 focus:border-red-500 focus:ring-red-500/10' : ''}`}
                                    placeholder="example@gmail.com"
                                />
                                {emailError && <p className="text-xs font-bold text-red-500 ml-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{emailError}</p>}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="imap_pass" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">
                                    Gmail App Password {imapConfigured && <span className="text-emerald-500 normal-case font-semibold tracking-normal">(configured — leave blank to keep current)</span>}
                                </Label>
                                <Input
                                    id="imap_pass"
                                    type="password"
                                    value={imapPass}
                                    onChange={e => { setImapPass(e.target.value); setPasswordError(''); setConfigError(''); }}
                                    className={`h-12 bg-background/50 border border-input rounded-xl hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200 font-medium ${passwordError ? 'border-red-400 focus:border-red-500 focus:ring-red-500/10' : ''}`}
                                    placeholder={imapConfigured ? '••••••••••••••••' : 'xxxx xxxx xxxx xxxx'}
                                    autoComplete="new-password"
                                />
                                {passwordError && <p className="text-xs font-bold text-red-500 ml-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{passwordError}</p>}
                            </div>
                        </div>
                        
                        <div className="pt-2 border-t border-border/50 flex justify-end gap-3">
                             <Button
                                variant="ghost"
                                onClick={() => setShowCredentials(false)}
                                className="h-12 px-6 rounded-xl font-bold text-slate-500 active:scale-[0.98] transition-all duration-200"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleSaveSettings}
                                disabled={isSavingSettings}
                                className="h-12 px-8 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-lg shadow-emerald-600/20 gap-2 active:scale-[0.98] transition-all duration-200"
                            >
                                {isSavingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                Save Configuration
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Quick Metrics — always show real counts from global_stats regardless of active filter */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 stagger-children">
                <Card 
                    onClick={() => setStatusFilter('all')}
                    className={`bg-card/45 backdrop-blur-xl border shadow-[0_8px_30px_rgb(0,0,0,0.02)] transition-all duration-300 rounded-2xl overflow-hidden hover-premium-lift cursor-pointer active:scale-[0.98] ${statusFilter === 'all' ? 'border-primary/60 ring-2 ring-primary/10 bg-primary/[0.03]' : 'border-border/80'}`}
                >
                    <CardContent className="p-6 flex items-center gap-4">
                        <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 shrink-0">
                            <Inbox className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                            <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Total Ingested</div>
                            <div className="text-2xl font-black text-foreground mt-0.5 tabular-nums">
                                {isLoading ? '...' : statTotalIngested}
                            </div>
                        </div>
                    </CardContent>
                </Card>
                
                <Card 
                    onClick={() => setStatusFilter('mapped')}
                    className={`bg-card/45 backdrop-blur-xl border shadow-[0_8px_30px_rgb(0,0,0,0.02)] transition-all duration-300 rounded-2xl overflow-hidden hover-premium-lift cursor-pointer active:scale-[0.98] ${statusFilter === 'mapped' ? 'border-emerald-500/60 ring-2 ring-emerald-500/10 bg-emerald-500/[0.03]' : 'border-border/80'}`}
                >
                    <CardContent className="p-6 flex items-center gap-4">
                        <div className="h-12 w-12 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 shrink-0">
                            <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                        </div>
                        <div>
                            <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Auto-Mapped</div>
                            <div className="text-2xl font-black text-foreground mt-0.5 tabular-nums">
                                {isLoading ? '...' : statAutoMapped}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card 
                    onClick={() => setStatusFilter('unmapped')}
                    className={`bg-card/45 backdrop-blur-xl border shadow-[0_8px_30px_rgb(0,0,0,0.02)] transition-all duration-300 rounded-2xl overflow-hidden hover-premium-lift cursor-pointer active:scale-[0.98] ${statusFilter === 'unmapped' ? 'border-amber-500/60 ring-2 ring-amber-500/10 bg-amber-500/[0.03]' : 'border-border/80'}`}
                >
                    <CardContent className="p-6 flex items-center gap-4">
                        <div className="h-12 w-12 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20 shrink-0">
                            <AlertTriangle className="h-6 w-6 text-amber-500" />
                        </div>
                        <div>
                            <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Pending Assignment</div>
                            <div className="text-2xl font-black text-foreground mt-0.5 tabular-nums">
                                {isLoading ? '...' : statPending}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Filters and Toolbar */}
            <div className="bg-card/45 backdrop-blur-xl p-4 rounded-2xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)]">
                <div className="flex flex-col md:flex-row gap-4 items-center">
                    {/* Search */}
                    <div className="relative flex-1 w-full">
                        <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-muted-foreground h-5 w-5 z-10 pointer-events-none" />
                        <Input
                            type="text"
                            placeholder="Search sender email, subject, or resume name..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="pl-12 h-11 bg-background/50 border border-input rounded-xl hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200 text-base"
                        />
                    </div>
                    {/* Status Filter */}
                    <div className="w-full md:w-[220px]">
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="h-11 rounded-xl border border-input bg-background/50 font-medium hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200 shadow-none">
                                <SelectValue placeholder="Filter by Status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Ingested</SelectItem>
                                <SelectItem value="mapped">Auto-Mapped</SelectItem>
                                <SelectItem value="unmapped">Pending Assignment</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>

            {/* Data Table */}
            {/* BUG-L Fix: Render SWR error state so user knows when data failed to load */}
            {error ? (
                <div className="text-center py-20 flex flex-col items-center justify-center gap-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 rounded-2xl shadow-sm">
                    <WifiOff className="h-10 w-10 text-red-400" />
                    <div>
                        <h3 className="font-bold text-lg text-red-700 dark:text-red-400">Failed to Load Inbox</h3>
                        <p className="text-sm text-red-500 mt-1 max-w-sm">Could not fetch ingested emails. Please check your connection and refresh.</p>
                    </div>
                    <button onClick={() => mutate()} className="text-xs font-bold text-red-600 underline underline-offset-2 hover:text-red-700">Retry</button>
                </div>
            ) : isLoading ? (
                <div className="text-center py-20 flex flex-col items-center justify-center gap-4 bg-card border border-border rounded-2xl shadow-sm">
                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                    <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest animate-pulse">Loading Ingestion Box...</p>
                </div>
            ) : filteredItems.length === 0 ? (
                <div className="text-center py-20 bg-card rounded-2xl border border-border shadow-sm flex flex-col items-center justify-center gap-4">
                    <Inbox className="h-12 w-12 text-muted-foreground/45" />
                    <div>
                        {/* BUG-I Fix: Context-aware empty state based on active filter / search */}
                        <h3 className="font-bold text-lg text-foreground">
                            {statusFilter === 'mapped' ? 'No auto-mapped resumes'
                                : statusFilter === 'unmapped' ? 'No pending resumes'
                                : debouncedSearch ? 'No results found'
                                : 'Inbox is empty'}
                        </h3>
                        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                            {statusFilter === 'mapped'
                                ? 'No resumes have been automatically matched to an open job yet. Sync emails to trigger AI mapping.'
                                : statusFilter === 'unmapped'
                                ? 'All ingested resumes have been assigned — nothing pending.'
                                : debouncedSearch
                                ? `No emails match "${debouncedSearch}". Try a different search term.`
                                : "Click 'Sync Emails' to connect to your configured recruiter mailbox and fetch applicant resumes."}
                        </p>
                    </div>
                </div>
            ) : (
                <div className="bg-card/45 backdrop-blur-xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] rounded-2xl overflow-hidden">
                    <Table>
                        <TableHeader className="bg-muted/30 border-b border-border/40">
                            <TableRow>
                                {(user?.role === 'super_admin' || user?.role === 'hr') && (
                                    <TableHead className="w-[50px] pl-6">
                                        <Checkbox
                                            checked={isAllSelected}
                                            onCheckedChange={handleSelectAllToggle}
                                            disabled={selectableItems.length === 0}
                                            onClick={(e) => e.stopPropagation()}
                                            className="h-4 w-4 rounded border border-slate-400 dark:border-slate-600 transition-all data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                                        />
                                    </TableHead>
                                )}
                                <TableHead className="w-[280px]">Sender / Candidate</TableHead>
                                <TableHead>Email Subject</TableHead>
                                <TableHead className="w-[180px]">Received Date</TableHead>
                                <TableHead className="w-[240px]">Resume File</TableHead>
                                <TableHead className="w-[200px]">Mapping Status</TableHead>
                                <TableHead className="w-[150px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredItems.map((item) => {
                                const senderCleaned = item.sender_email.split('<')[0].trim()
                                const emailAddress = item.sender_email.includes('<')
                                    ? item.sender_email.split('<')[1].replace('>', '').trim()
                                    : item.sender_email.trim()

                                return (
                                    <TableRow key={item.id} className="border-b border-border/20 last:border-b-0 cursor-pointer group premium-table-row">
                                        {(user?.role === 'super_admin' || user?.role === 'hr') && (
                                            <TableCell className="w-[50px] pl-6" onClick={(e) => e.stopPropagation()}>
                                                <Checkbox
                                                    checked={selectedIds.includes(item.id)}
                                                    onCheckedChange={() => handleRowSelectToggle(item.id)}
                                                    disabled={!!item.application_id}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="h-4 w-4 rounded border border-slate-400 dark:border-slate-600 transition-all data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                                                />
                                            </TableCell>
                                        )}
                                        <TableCell className="font-semibold">
                                            <div className="flex items-center gap-3">
                                                <div className="h-9 w-9 rounded-full bg-primary/10 border border-primary/25 flex items-center justify-center text-xs font-bold text-primary shrink-0 shadow-inner">
                                                    {getInitials(item.sender_email)}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <div className="text-sm font-bold text-foreground truncate max-w-[150px]">{senderCleaned}</div>
                                                        {item.is_duplicate && (
                                                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-orange-50 text-orange-600 border-orange-200 font-semibold shrink-0">
                                                                Duplicate
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground truncate max-w-[180px]">{emailAddress}</div>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-sm font-medium text-foreground max-w-[300px] truncate" title={item.subject}>
                                            {item.subject}
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground font-semibold">
                                            {new Date(item.received_at).toLocaleDateString(undefined, {
                                                month: 'short',
                                                day: 'numeric',
                                                year: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })}
                                        </TableCell>
                                        <TableCell>
                                            {item.file_url ? (
                                                <a
                                                    href={item.file_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
                                                >
                                                    <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                                                    <span className="truncate max-w-[150px]">{item.file_name}</span>
                                                    <ExternalLink className="h-3 w-3" />
                                                </a>
                                            ) : (
                                                <span className="text-xs text-muted-foreground italic">attachment missing</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {item.application_id ? (
                                                <div className="flex flex-col gap-1 items-start">
                                                    <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/10 font-bold text-[10px] uppercase py-0.5 px-2">
                                                        Auto-Mapped
                                                    </Badge>
                                                    <span className="text-[11px] text-muted-foreground font-bold truncate max-w-[180px]" title={item.job_title || ''}>
                                                        {item.job_title} ({item.job_code})
                                                    </span>
                                                </div>
                                            ) : (
                                                <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25 hover:bg-amber-500/10 font-bold text-[10px] uppercase py-0.5 px-2 flex items-center gap-1 w-max">
                                                    <AlertTriangle className="h-3 w-3" />
                                                    Pending Assignment
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end items-center gap-2 w-full">
                                                {item.application_id ? (
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => router.push(`/dashboard/hr/applications/${item.application_id}`)}
                                                        className="h-9 px-3 text-xs font-bold text-primary uppercase tracking-wider hover:bg-primary/10 rounded-xl"
                                                    >
                                                        View Candidate
                                                    </Button>
                                                ) : (
                                                    <>
                                                        {!item.file_url ? (
                                                            <Badge className="bg-rose-50 text-rose-400 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25 text-[10px] font-semibold px-2 py-0.5 flex items-center gap-1 w-max">
                                                                <AlertTriangle className="h-3 w-3" />
                                                                No Resume
                                                            </Badge>
                                                        ) : (user?.role === 'super_admin' || user?.role === 'hr') ? (
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={() => setSelectedResume(item)}
                                                                className="h-9 px-3 text-xs font-bold text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-500/10 border-amber-500/30 rounded-xl shadow-none"
                                                            >
                                                                Assign to Job
                                                            </Button>
                                                        ) : (
                                                            <Badge className="bg-slate-100 text-slate-400 border border-slate-200 text-[10px] font-semibold px-2 py-0.5">
                                                                Unassigned
                                                            </Badge>
                                                        )}
                                                        {(user?.role === 'super_admin' || user?.role === 'hr') && (
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleDeleteEmail(item.id);
                                                                }}
                                                                className="h-9 w-9 p-0 text-destructive hover:text-destructive hover:bg-destructive/10 rounded-xl transition-all"
                                                                title="Delete Ingested Email"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>

                    {/* Pagination */}
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-4 border-t border-border bg-muted/20">
                        <div className="text-sm text-muted-foreground font-semibold">
                            Showing <span className="font-bold text-foreground/80">{filteredItems.length}</span> of <span className="font-bold text-foreground/80">{totalCount}</span> ingested records
                        </div>
                        
                        <div className="flex items-center gap-4">
                            <div className="text-xs font-bold text-muted-foreground">
                                Page <span className="text-foreground/80 font-black">{page}</span> of {totalPages || 1}
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPage(p => Math.max(p - 1, 1))}
                                    disabled={page <= 1 || isLoading}
                                    className="h-8 px-3 rounded-lg font-bold border-border bg-background shadow-sm active:scale-95 disabled:opacity-55"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPage(p => Math.min(p + 1, totalPages))}
                                    disabled={page >= totalPages || isLoading}
                                    className="h-8 px-3 rounded-lg font-bold border-border bg-background shadow-sm active:scale-95 disabled:opacity-55"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Manual Assignment Modal */}
            <Dialog open={selectedResume !== null} onOpenChange={(open) => {
                if (!open) {
                    setSelectedResume(null)
                    setTargetJobId('')
                }
            }}>
                <DialogContent className="max-w-md rounded-3xl border border-border/80 bg-background/90 backdrop-blur-xl p-6 shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-black text-foreground flex items-center gap-2">
                            <Mail className="h-5 w-5 text-amber-500" />
                            Manually Assign Job Application
                        </DialogTitle>
                        <DialogDescription className="text-sm text-muted-foreground mt-1">
                            Connect this unassigned candidate email to an open active recruitment job posting.
                        </DialogDescription>
                    </DialogHeader>

                    {selectedResume && (
                        <div className="my-5 p-4 rounded-xl bg-muted/50 border border-border space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="font-bold text-muted-foreground">Candidate:</span>
                                <span className="font-bold text-foreground truncate max-w-[200px]">{selectedResume.sender_email.split('<')[0]}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="font-bold text-muted-foreground">Email:</span>
                                <span className="font-medium text-foreground truncate max-w-[200px]">{selectedResume.sender_email.includes('<') ? selectedResume.sender_email.split('<')[1].replace('>', '') : selectedResume.sender_email}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="font-bold text-muted-foreground">Resume File:</span>
                                <span className="font-medium text-primary truncate max-w-[200px]">{selectedResume.file_name}</span>
                            </div>
                        </div>
                    )}

                    <div className="space-y-2.5">
                        <Label htmlFor="target_job" className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Select Active Recruitment Job</Label>
                        <Select value={targetJobId} onValueChange={setTargetJobId}>
                            <SelectTrigger id="target_job" className="h-11 rounded-xl border-border bg-background focus:ring-0 text-sm font-semibold">
                                <SelectValue placeholder="Choose an open role..." />
                            </SelectTrigger>
                            <SelectContent>
                                {openJobs.map((job) => (
                                    <SelectItem key={job.id} value={String(job.id)} className="font-semibold text-sm">
                                        {job.title} ({job.job_id})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {openJobs.length === 0 && (
                            <p className="text-xs text-destructive font-bold flex items-center gap-1 mt-1">
                                <AlertTriangle className="h-3 w-3" />
                                No active open jobs found. Please create an open job first!
                            </p>
                        )}
                    </div>

                    <DialogFooter className="mt-8 flex gap-3 sm:justify-end">
                        <Button
                            variant="ghost"
                            onClick={() => setSelectedResume(null)}
                            className="rounded-xl border border-border font-bold text-muted-foreground h-11"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleAssignConfirm}
                            disabled={isAssigning || !targetJobId}
                            className="rounded-xl font-bold bg-primary text-primary-foreground hover:opacity-90 h-11 active:scale-95 transition-all gap-2"
                        >
                            {isAssigning ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <CheckCircle2 className="h-4 w-4" />
                            )}
                            Confirm Assignment
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
