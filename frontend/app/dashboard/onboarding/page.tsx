'use client'

import React, { useState, useMemo } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/app/dashboard/lib/swr-fetcher'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { 
    Users, 
    Send, 
    CheckCircle2, 
    Download, 
    RefreshCcw, 
    UserPlus,
    Calendar,
    Search as SearchIcon,
    FileText,
    ShieldAlert,
    Camera,
    ShieldCheck,
    CreditCard,
    AlertTriangle,
    Eye,
    RefreshCw,
    BarChart3,
    BarChart,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { SendOfferDialog } from '@/components/send-offer-dialog'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { CapturePhotoDialog } from '@/components/capture-photo-dialog'
import { APIClient } from '@/app/dashboard/lib/api-client'
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { EyeOff } from 'lucide-react'
import { 
    Dialog, 
    DialogContent, 
    DialogHeader, 
    DialogTitle, 
    DialogDescription,
    DialogFooter
} from "@/components/ui/dialog"
import { useAuth } from '@/app/dashboard/lib/auth-context'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { PageHeader } from '@/components/page-header'

interface OnboardingCandidate {
    id: number
    candidate_name: string
    candidate_email: string
    job?: { title?: string }
    job_title?: string
    status: string
    joining_date?: string
    offer_sent?: boolean
    offer_response_status?: string
    offer_email_status?: string
    offer_token_expiry?: string
    candidate_photo_path?: string
    id_card_url?: string
    onboarding_approval_status?: string
    onboarded_at?: string
}

interface OnboardingResponse {
    items: OnboardingCandidate[]
    total: number
}

interface OfferPreviewResponse {
    html: string
}

interface GenerateIDResponse {
    employee_id: string
}

export default function OnboardingPage() {
    const { user } = useAuth()
    const router = useRouter()
    const handleConfigError = (error: any, fallbackMessage: string) => {
        const msg = error.message || fallbackMessage
        const isConfigError = msg.toLowerCase().includes('settings') || 
                              msg.toLowerCase().includes('template') || 
                              msg.toLowerCase().includes('configured') ||
                              msg.toLowerCase().includes('missing')
        if (user?.role === 'super_admin' && isConfigError) {
            toast.error(msg, {
                action: {
                    label: 'Go to Settings',
                    onClick: () => router.push('/dashboard/settings')
                },
                duration: 10000
            })
        } else {
            toast.error(msg)
        }
    }
    const { data: resp, isLoading, mutate } = useSWR<OnboardingResponse>('/api/onboarding/candidates', fetcher)
    const candidates = resp?.items || []
    const totalCount = resp?.total || 0
    
    const searchParams = useSearchParams();
    const initialSearch = searchParams.get('search') || '';
    const [searchQuery, setSearchQuery] = useState(initialSearch);

    const [statusFilter, setStatusFilter] = useState('all')
    const [jobFilter, setJobFilter] = useState('all')
    const [currentPage, setCurrentPage] = useState(1)
    const [pageSize, setPageSize] = useState(10)
    const [showStats, setShowStats] = useState(true)

    const handleResetFilters = () => {
        setSearchQuery('')
        setStatusFilter('all')
        setJobFilter('all')
        setCurrentPage(1)
    }

    const jobTitles = useMemo(() => {
        const titles = new Set<string>()
        candidates.forEach(c => {
            const title = c.job_title || c.job?.title
            if (title) titles.add(title)
        })
        return Array.from(titles).sort()
    }, [candidates])

    const sortedCandidates = useMemo(() => {
        return [...candidates].sort((a, b) => {
            // Sort by status priority first
            const statusOrder: Record<string, number> = {
                'accepted': 0,
                'hired': 1,
                'offer_sent': 2,
                'pending_approval': 3,
                'onboarded': 4,
                'rejected': 5
            }
            const orderA = statusOrder[a.status] ?? 99
            const orderB = statusOrder[b.status] ?? 99
            
            if (orderA !== orderB) return orderA - orderB
            
            // Then by joining date (latest first)
            if (a.joining_date && b.joining_date) {
                return new Date(b.joining_date).getTime() - new Date(a.joining_date).getTime()
            }
            if (a.joining_date) return -1
            if (b.joining_date) return 1
            
            // Then by newest entry
            return b.id - a.id
        })
    }, [candidates])

    const filteredCandidates = useMemo(() => {
        return sortedCandidates?.filter(c => {
            const matchesSearch = 
                c.candidate_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                c.candidate_email.toLowerCase().includes(searchQuery.toLowerCase())
            
            const matchesStatus = 
                statusFilter === 'all' || 
                c.status === statusFilter
                
            const candidateJob = c.job_title || c.job?.title || 'Unknown Role'
            const matchesJob = 
                jobFilter === 'all' || 
                candidateJob === jobFilter

            return matchesSearch && matchesStatus && matchesJob
        }) || []
    }, [sortedCandidates, searchQuery, statusFilter, jobFilter])

    const totalPages = Math.ceil(filteredCandidates.length / pageSize)
    
    const paginatedCandidates = useMemo(() => {
        const start = (currentPage - 1) * pageSize
        return filteredCandidates.slice(start, start + pageSize)
    }, [filteredCandidates, currentPage, pageSize])

    if (user && user.role !== 'hr' && user.role !== 'super_admin') {
        return (
            <div className="flex flex-col items-center justify-center p-20 gap-4 text-center">
                <ShieldAlert className="h-16 w-16 text-destructive opacity-20" />
                <h2 className="text-2xl font-black">Access Denied</h2>
                <p className="text-muted-foreground">This page is restricted to HR and Administrators only.</p>
                <Button onClick={() => router.push('/dashboard/hr')}>Return to Dashboard</Button>
            </div>
        )
    }

    const [approvingCandidate, setApprovingCandidate] = useState<OnboardingCandidate | null>(null)
    const [isApproveOpen, setIsApproveOpen] = useState(false)
    const [isCaptureOpen, setIsCaptureOpen] = useState(false)
    const [activeCaptureId, setActiveCaptureId] = useState<number | null>(null)
    const [previewHtml, setPreviewHtml] = useState<string | null>(null)
    const [isPreviewOpen, setIsPreviewOpen] = useState(false)

    const handleApprove = async (candidate: OnboardingCandidate) => {
        try {
            await APIClient.post(`/api/onboarding/applications/${candidate.id}/approve-offer`, {})
            toast.success("Offer letter approved and sent to candidate")
            mutate(undefined, { revalidate: true })
            setIsApproveOpen(false)
        } catch (error: any) {
            handleConfigError(error, "Failed to approve offer letter.")
        }
    }

    const handleComplete = async (id: number) => {
        try {
            await APIClient.post(`/api/onboarding/applications/${id}/onboard`, {})
            toast.success("Candidate marked as onboarded")
            mutate(undefined, { revalidate: true })
            setActiveCaptureId(id)
            setIsCaptureOpen(true)
        } catch (error: unknown) {
            const err = error as { response?: { data?: { error?: string } } }
            toast.error(err?.response?.data?.error || "Failed to complete onboarding. Candidate's joining date may not have arrived yet.")
        }
    }


    const handleGenerateID = async (id: number) => {
        try {
            const res = await APIClient.post(`/api/onboarding/applications/${id}/generate-id-card`, {}) as any
            toast.success(`ID Card generated. Employee ID: ${res.employee_id}`)
            mutate(undefined, { revalidate: true })
        } catch (error: any) {
            toast.error(error.message || "Failed to generate ID card")
        }
    }

    const handlePreviewOffer = async (id: number) => {
        try {
            const res = await APIClient.get(`/api/onboarding/applications/${id}/offer-preview`) as any
            setPreviewHtml(res.html)
            setIsPreviewOpen(true)
        } catch (error: any) {
            handleConfigError(error, "Failed to load offer preview")
        }
    }

    const exportToCSV = () => {
        if (!candidates || candidates.length === 0) return
        
        const headers = ["Name,Email,Job,Status,Joining Date,Approval"]
        const rows = candidates.map(c => 
            `"${c.candidate_name}","${c.candidate_email}","${c.job_title || c.job?.title || ''}","${c.status}","${c.joining_date || ''}","${c.onboarding_approval_status}"`
        )
        
        const csvContent = "data:text/csv;charset=utf-8," + headers.concat(rows).join("\n")
        const encodedUri = encodeURI(csvContent)
        const link = document.createElement("a")
        link.setAttribute("href", encodedUri)
        link.setAttribute("download", "onboarding_candidates.csv")
        document.body.appendChild(link)
        link.click()
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-700">
            <PageHeader
                title="Onboarding Pipeline"
                description="Track and manage newly hired candidates"
                icon={CheckCircle2}
            >
                <div className="flex items-center gap-3">
                    { (searchQuery || statusFilter !== 'all' || jobFilter !== 'all') ? (
                        <>
                            <Badge variant="outline" className="h-10 px-4 bg-primary/10 dark:bg-white/5 text-primary dark:text-white border-primary/20 dark:border-white/10 flex items-center justify-center font-bold text-sm rounded-xl">
                                {filteredCandidates.length} {filteredCandidates.length === 1 ? 'Match' : 'Matches'}
                            </Badge>
                            <Badge variant="outline" className="h-10 px-4 bg-muted/50 text-muted-foreground border-border flex items-center justify-center font-bold text-sm rounded-xl">
                                {totalCount} Total
                            </Badge>
                        </>
                    ) : (
                        <Badge variant="outline" className="h-10 px-4 bg-primary/10 dark:bg-white/5 text-primary dark:text-white border-primary/20 dark:border-white/10 flex items-center justify-center font-bold text-sm rounded-xl">
                            {totalCount} {totalCount === 1 ? 'Candidate' : 'Candidates'}
                        </Badge>
                    )}
                    <Button variant="outline" className="gap-2 h-11 px-5 rounded-xl border-border font-bold" onClick={exportToCSV}>
                        <Download className="h-4 w-4" />
                        Export Data
                    </Button>
                    <Button 
                        variant="outline" 
                        className="gap-2 h-11 px-5 rounded-xl border-border font-bold hover:bg-muted/50" 
                        onClick={() => {
                            mutate(undefined, { revalidate: true });
                            toast.info("Refreshing candidate data...");
                        }}
                    >
                        <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                    <Button 
                        variant={showStats ? "default" : "outline"}
                        className={`gap-2 h-11 px-5 rounded-xl font-bold shadow-sm transition-all ${showStats ? 'bg-primary text-white' : 'border-border'}`} 
                        onClick={() => setShowStats(!showStats)}
                    >
                        {showStats ? <EyeOff className="h-4 w-4" /> : <BarChart3 className="h-4 w-4" />}
                        {showStats ? "Hide Stats" : "Show Stats"}
                    </Button>
                </div>
            </PageHeader>


            {showStats && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in slide-in-from-top-4 duration-500 ease-out stagger-children">
                    <Card className="bg-card/45 backdrop-blur-xl rounded-2xl border py-3 border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden bg-gradient-to-br from-blue-500/5 to-primary/5 border-l-4 border-l-blue-500/50">
                        <CardHeader className="">
                            <CardTitle className="text-sm font-bold flex items-center gap-1">
                                <FileText className="h-4 w-4 text-blue-500" />
                                Pending Offers
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-black tabular-nums text-blue-600 dark:text-blue-400">
                                {candidates?.filter(c => 
                                    (c.status === 'hired' || c.status === 'pending_approval') && !c.offer_sent
                                ).length || 0}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">Action required: send letters</p>
                        </CardContent>
                    </Card>
                    <Card className="bg-card/45 backdrop-blur-xl rounded-2xl border py-3 border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden bg-gradient-to-br from-amber-500/5 to-amber-600/5 border-l-4 border-l-amber-500/50">
                        <CardHeader className="">
                            <CardTitle className="text-sm font-bold flex items-center gap-1">
                                <Calendar className="h-4 w-4 text-amber-500" />
                                Upcoming Joinings (7d)
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-black tabular-nums text-amber-600 dark:text-amber-400">
                                {candidates?.filter(c => {
                                    if (!c.joining_date || c.status === 'onboarded') return false
                                    // Candidates who are in the active final pipeline but not yet onboarded
                                    if (c.status !== 'accepted' && c.status !== 'offer_sent' && c.offer_response_status !== 'accept' && c.offer_response_status !== 'accepted') return false
                                    
                                    // Parse date manually to avoid timezone shifting
                                    const [y, m, d] = c.joining_date.split('T')[0].split('-').map(Number);
                                    const jDate = new Date(y, m - 1, d);
                                    jDate.setHours(0, 0, 0, 0)
                                    
                                    const today = new Date()
                                    today.setHours(0, 0, 0, 0)
                                    
                                    const diff = jDate.getTime() - today.getTime()
                                    const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000
                                    
                                    // Only include candidates joining in the next 7 days (from today onwards)
                                    return diff >= 0 && diff <= sevenDaysInMs
                                }).length || 0}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">Upcoming in next 7 days</p>
                        </CardContent>
                    </Card>
                    <Card className="bg-card/45 backdrop-blur-xl rounded-2xl py-3 border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden bg-gradient-to-br from-emerald-500/5 to-emerald-600/5 border-l-4 border-l-emerald-500/50">
                        <CardHeader className="">
                            <CardTitle className="text-sm font-bold flex items-center gap-1">
                                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                Onboarded This Month
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-black tabular-nums text-emerald-600 dark:text-emerald-400">
                                {candidates?.filter(c => {
                                    if (c.status !== 'onboarded') return false
                                    if (!c.onboarded_at) return true // Fallback for legacy records
                                    const oDate = new Date(c.onboarded_at)
                                    const now = new Date()
                                    return oDate.getMonth() === now.getMonth() && oDate.getFullYear() === now.getFullYear()
                                }).length || 0}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">Successfully closed hires</p>
                        </CardContent>
                    </Card>
                </div>
            )}


            <Card className="bg-card/45 backdrop-blur-xl rounded-2xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden pt-0">
                <CardHeader className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/40  pt-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-0">
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
                            <div className="relative flex-1 max-w-md">
                                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10 pointer-events-none" />
                                <Input 
                                    placeholder="Search by name or email..." 
                                    className="pl-10 h-10 bg-background/50 border border-input rounded-xl hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200"
                                    value={searchQuery}
                                    onChange={(e) => {
                                        setSearchQuery(e.target.value)
                                        setCurrentPage(1)
                                    }}
                                />
                            </div>
                            
                            <div className="w-full sm:w-[180px]">
                                <Select
                                    value={statusFilter}
                                    onValueChange={(val) => {
                                        setStatusFilter(val)
                                        setCurrentPage(1)
                                    }}
                                >
                                    <SelectTrigger className="h-10 w-full rounded-xl border-border bg-background/50 hover:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all font-bold">
                                        <SelectValue placeholder="All Statuses" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl">
                                        <SelectItem value="all" className="font-bold">All Statuses</SelectItem>
                                        <SelectItem value="offer_sent" className="font-bold">Offer Sent</SelectItem>
                                        <SelectItem value="accepted" className="font-bold">Accepted</SelectItem>
                                        <SelectItem value="onboarded" className="font-bold">Onboarded</SelectItem>
                                        <SelectItem value="rejected" className="font-bold">Rejected</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="w-full sm:w-[200px]">
                                <Select
                                    value={jobFilter}
                                    onValueChange={(val) => {
                                        setJobFilter(val)
                                        setCurrentPage(1)
                                    }}
                                >
                                    <SelectTrigger className="h-10 w-full rounded-xl border-border bg-background/50 hover:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all font-bold">
                                        <SelectValue placeholder="All Jobs" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl">
                                        <SelectItem value="all" className="font-bold">All Jobs</SelectItem>
                                        {jobTitles.map((title) => (
                                            <SelectItem key={title} value={title} className="font-bold">
                                                {title}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {(searchQuery || statusFilter !== 'all' || jobFilter !== 'all') && (
                                <Button
                                    variant="ghost"
                                    onClick={handleResetFilters}
                                    className="h-10 px-3 text-sm font-bold text-muted-foreground hover:text-primary transition-all duration-200 rounded-xl hover:bg-primary/5 gap-1.5"
                                >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                    Reset
                                </Button>
                            )}
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto scrollbar-premium">
                    <div className="min-w-[800px]">
                    <Table>
                        <TableHeader className="bg-muted/30 border-b border-border/40">
                            <TableRow className="hover:bg-transparent border-none">
                                <TableHead className="font-bold py-4">Candidate</TableHead>
                                <TableHead className="font-bold">Job & Joining</TableHead>
                                <TableHead className="font-bold text-center">Status</TableHead>
                                <TableHead className="font-bold text-right pr-6">Action</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody className="stagger-children">
                            {isLoading ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-48 text-center align-middle">
                                        <div className="flex flex-col items-center justify-center gap-4">
                                            <div className="relative">
                                                <div className="h-12 w-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                    <div className="h-6 w-6 rounded-full bg-primary/10 animate-pulse" />
                                                </div>
                                            </div>
                                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest animate-pulse">Loading onboarding pipeline...</p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : paginatedCandidates?.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-48 text-center align-middle">
                                        <div className="flex flex-col items-center justify-center gap-3 py-6 animate-in fade-in duration-500">
                                            <div className="relative">
                                                <div className="absolute -inset-2 rounded-full bg-primary/10 blur-xl" />
                                                <div className="relative w-12 h-12 rounded-xl bg-gradient-to-br from-primary/15 to-blue-500/10 border border-primary/20 flex items-center justify-center shadow-md">
                                                    <Users className="h-6 w-6 text-primary" />
                                                </div>
                                            </div>
                                            <div className="space-y-1">
                                                <p className="text-sm font-bold text-foreground">No onboarding candidates</p>
                                                <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                                                    No candidates are currently in the onboarding pipeline matching the active filters.
                                                </p>
                                            </div>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                paginatedCandidates?.map((candidate) => (
                                    <TableRow key={candidate.id} className="border-b border-border/10 last:border-b-0 group premium-table-row">
                                        <TableCell className="py-4">
                                            <div className="flex items-center gap-3">
                                                <Avatar className="h-9 w-9 shrink-0 border border-border">
                                                    <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs uppercase">
                                                        {candidate.candidate_name[0]}
                                                    </AvatarFallback>
                                                </Avatar>
                                                <div className="flex flex-col">
                                                    <Link href={`/dashboard/hr/applications/${candidate.id}`} className="font-bold text-sm text-foreground hover:text-primary hover:underline transition-colors block">
                                                        {candidate.candidate_name}
                                                    </Link>
                                                    <span className="text-xs text-muted-foreground block mt-0.5">
                                                        {candidate.candidate_email}
                                                    </span>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div>
                                                <div className="text-sm font-medium">{candidate.job_title || candidate.job?.title || 'Unknown Role'}</div>
                                                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-1 font-semibold">
                                                    <Calendar className="h-3 w-3 opacity-60" />
                                                    Joining: {candidate.joining_date ? new Date(candidate.joining_date).toLocaleDateString() : 'TBD'}
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <div className="flex flex-col items-center gap-1.5">
                                                 {(() => {
                                                    if (candidate.status === 'onboarded') return <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] uppercase tracking-wider font-semibold rounded-full px-2.5 py-0.5">Onboarded</span>;
                                                    if (candidate.status === 'accepted' || candidate.offer_response_status === 'accept' || candidate.offer_response_status === 'accepted') return <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] uppercase tracking-wider font-semibold rounded-full px-2.5 py-0.5">Accepted</span>;
                                                    if (candidate.status === 'rejected' || candidate.offer_response_status === 'reject' || candidate.offer_response_status === 'rejected') return <span className="bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-[10px] uppercase tracking-wider font-semibold rounded-full px-2.5 py-0.5">Rejected</span>;
                                                    
                                                    if (candidate.status === 'offer_sent') return <span className="bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 text-[10px] uppercase tracking-wider font-semibold rounded-full px-2.5 py-0.5">Sent - Awaiting</span>;
                                                    if (candidate.status === 'pending_approval') return <span className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-[10px] uppercase tracking-wider font-semibold rounded-full px-2.5 py-0.5 animate-pulse">Approval Pending</span>;
                                                    if (candidate.status === 'hired') return <span className="bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 text-[10px] uppercase tracking-wider font-semibold rounded-full px-2.5 py-0.5">Hired</span>;
                                                    
                                                    return <span className="bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20 text-[10px] uppercase tracking-wider font-semibold rounded-full px-2.5 py-0.5">Staging</span>;
                                                })()}
                                                
                                                {(() => {
                                                    const isExpired = candidate.offer_token_expiry &&
                                                        new Date(candidate.offer_token_expiry) < new Date() &&
                                                        (candidate.status === 'offer_sent' || candidate.offer_response_status === 'pending')
                                                    return (
                                                        <>
                                                            {isExpired && (
                                                                <span className="text-[9px] text-rose-500 font-bold uppercase tracking-tighter bg-rose-500/5 px-2 py-0.5 rounded-full mt-1 border border-rose-500/20">Link Expired</span>
                                                            )}
                                                        </>
                                                    )
                                                })()}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right pr-6">
                                            <div className="flex items-center justify-end gap-2">
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button 
                                                                size="sm" 
                                                                variant="ghost" 
                                                                className="h-8 w-8 p-0"
                                                                onClick={async () => {
                                                                    const win = window.open('', '_blank');
                                                                    if (!win) {
                                                                        toast.error("Popup blocked! Please allow popups for this site.");
                                                                        return;
                                                                    }
                                                                    win.document.write('<div style="font-family: sans-serif; padding: 40px; text-align: center; color: #666;">Loading offer letter preview...</div>');
                                                                    try {
                                                                        const res = await APIClient.get(`/api/onboarding/applications/${candidate.id}/offer-preview`) as any;
                                                                        win.document.open();
                                                                        win.document.write(res.html || '<div style="color: red; padding: 20px;">Offer letter is empty or not generated yet.</div>');
                                                                        win.document.close();
                                                                    } catch (error: any) {
                                                                        win.document.open();
                                                                        win.document.write(`<div style="color: red; padding: 20px; font-family: sans-serif;"><h3>Failed to load offer preview</h3><p>${error.message || "Unknown error"}</p></div>`);
                                                                        win.document.close();
                                                                        handleConfigError(error, "Failed to load offer preview");
                                                                    }
                                                                }}
                                                            >
                                                                <Eye className="h-4 w-4 text-muted-foreground" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            Preview Offer Letter
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                                {candidate.status === 'hired' && (
                                                    <SendOfferDialog 
                                                        applicationId={candidate.id}
                                                        candidateName={candidate.candidate_name}
                                                        onSuccess={() => mutate(undefined, { revalidate: true })}
                                                        trigger={
                                                            <Button size="sm" className="h-8 gap-1.5 text-xs font-black shadow-lg shadow-primary/20 bg-primary hover:bg-primary/90">
                                                                <Send className="h-3.5 w-3.5" />
                                                                Issue Offer Letter
                                                            </Button>
                                                        }
                                                    />
                                                )}
                                                {candidate.status === 'offer_sent' &&
                                                    candidate.offer_token_expiry &&
                                                    new Date(candidate.offer_token_expiry) < new Date() &&
                                                    (candidate.offer_response_status === 'pending' || !candidate.offer_response_status) && (
                                                    <SendOfferDialog 
                                                         applicationId={candidate.id}
                                                         candidateName={candidate.candidate_name}
                                                         initialDate={candidate.joining_date}
                                                         onSuccess={() => mutate(undefined, { revalidate: true })}
                                                         trigger={
                                                             <Button
                                                                 size="sm"
                                                                 variant="outline"
                                                                 className="h-8 gap-1.5 text-xs text-destructive border-destructive/50 hover:bg-destructive/10"
                                                             >
                                                                 <RefreshCcw className="h-3.5 w-3.5" />
                                                                 Resend Offer
                                                             </Button>
                                                         }
                                                     />
                                                )}
                                                {candidate.status === 'pending_approval' && (user?.role === 'super_admin' || user?.role === 'hr') && (
                                                    <Button 
                                                        size="sm" 
                                                        variant="outline" 
                                                        className="h-8 gap-1.5 text-xs text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/10 rounded-lg font-bold"
                                                        onClick={() => {
                                                            setApprovingCandidate(candidate)
                                                            setIsApproveOpen(true)
                                                        }}
                                                    >
                                                        <ShieldAlert className="h-3.5 w-3.5" />
                                                        Approve Offer
                                                    </Button>
                                                )}
                                                {candidate.status === 'accepted' && (
                                                    <Button 
                                                        size="sm" 
                                                        className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-md shadow-emerald-600/10 font-bold active:scale-[0.99] transition-all"
                                                        onClick={() => handleComplete(candidate.id)}
                                                    >
                                                        <UserPlus className="h-3.5 w-3.5" />
                                                        Finalize Join
                                                    </Button>
                                                )}
                                                {candidate.status === 'onboarded' && (
                                                    <div className="flex items-center gap-2">
                                                        {!candidate.candidate_photo_path ? (
                                                            <Button 
                                                                size="sm" 
                                                                variant="outline" 
                                                                className="h-8 gap-1.5 text-xs text-blue-600 dark:text-blue-400 border-blue-500/30 hover:bg-blue-500/10 rounded-lg font-bold"
                                                                onClick={() => {
                                                                    setActiveCaptureId(candidate.id)
                                                                    setIsCaptureOpen(true)
                                                                }}
                                                            >
                                                                <Camera className="h-3.5 w-3.5" />
                                                                Add Photo
                                                            </Button>
                                                        ) : !candidate.id_card_url ? (
                                                            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/10 rounded-lg font-bold" onClick={() => handleGenerateID(candidate.id)}>
                                                                <CreditCard className="h-3.5 w-3.5" />
                                                                Generate ID
                                                            </Button>
                                                        ) : (
                                                            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 rounded-lg font-bold" onClick={async () => {
                                                                try {
                                                                    const res = await APIClient.get(`/api/onboarding/applications/${candidate.id}/download-id-card`) as any;
                                                                    const link = document.createElement('a');
                                                                    link.href = res.url;
                                                                    link.download = `ID_Card_${candidate.candidate_name.replace(/\s+/g, '_')}.pdf`;
                                                                    document.body.appendChild(link);
                                                                    link.click();
                                                                    document.body.removeChild(link);
                                                                } catch(e) {
                                                                    toast.error('Failed to get download link');
                                                                }
                                                            }}>
                                                                <Download className="h-3.5 w-3.5" />
                                                                Download ID
                                                            </Button>
                                                        )}
                                                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 dark:border-emerald-500/30 font-bold text-[10px] tracking-wider uppercase hidden sm:inline-flex rounded-full">
                                                            Onboarded
                                                        </Badge>
                                                    </div>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>

            {totalPages > 1 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 pt-6 border-t border-border">
                    <div className="text-sm text-muted-foreground font-medium">
                            Showing <span className="font-semibold text-foreground/80">{((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, filteredCandidates.length)}</span> of <span className="font-semibold text-foreground/80">{filteredCandidates.length}</span> candidates
                        </div>
                        
                        <div className="flex flex-wrap items-center gap-6">
                            <div className="text-sm font-medium text-muted-foreground">
                                Page <span className="text-foreground/80 font-semibold">{currentPage}</span> of {totalPages}
                            </div>
                            
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                    disabled={currentPage === 1}
                                    className="h-8 px-4 rounded-xl font-bold bg-background dark:bg-muted border-border transition-all shadow-sm active:scale-[0.99] disabled:opacity-50"
                                >
                                    Previous
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setCurrentPage(prev => prev + 1)}
                                    disabled={currentPage >= totalPages}
                                    className="h-8 px-4 rounded-xl font-bold bg-background dark:bg-muted border-border transition-all shadow-sm active:scale-[0.99] disabled:opacity-50"
                                >
                                    Next
                                </Button>
                            </div>

                            <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-muted-foreground">Show</span>
                                <Select
                                    value={String(pageSize)}
                                    onValueChange={(val) => {
                                        setPageSize(Number(val));
                                        setCurrentPage(1);
                                    }}
                                >
                                    <SelectTrigger className="h-8 w-[75px] rounded-xl border-border bg-background font-bold shadow-none focus:ring-0">
                                        <SelectValue placeholder="10" />
                                    </SelectTrigger>
                                    <SelectContent className="min-w-[70px]">
                                        {[5, 10, 20, 50, 100].map((size) => (
                                            <SelectItem key={size} value={String(size)} className="font-bold">
                                                {size}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                </div>
            )}

            {activeCaptureId && (
                <CapturePhotoDialog 
                    isOpen={isCaptureOpen}
                    onOpenChange={setIsCaptureOpen}
                    applicationId={activeCaptureId}
                    onSuccess={() => mutate(undefined, { revalidate: true })}
                />
            )}

            <Dialog open={isApproveOpen} onOpenChange={setIsApproveOpen}>
                <DialogContent className="max-w-md rounded-3xl border border-border/80 bg-background/95 backdrop-blur-xl shadow-2xl p-6">
                    <DialogHeader className="space-y-2">
                        <DialogTitle className="text-xl font-bold">Finalize Offer Approval</DialogTitle>
                        <DialogDescription className="text-sm text-muted-foreground leading-normal">
                            Are you sure you want to approve the offer for <strong>{approvingCandidate?.candidate_name}</strong>? 
                            This will generate the final PDF and email it to the candidate immediately.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="mt-4 gap-2 sm:gap-0">
                        <Button variant="outline" className="rounded-xl active:scale-[0.99] transition-all" onClick={() => setIsApproveOpen(false)}>Cancel</Button>
                        <Button 
                            className="bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow-md shadow-amber-600/10 active:scale-[0.99] transition-all"
                            onClick={() => approvingCandidate && handleApprove(approvingCandidate)}
                        >
                            Confirm & Send
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
                <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0 overflow-hidden border border-border/80 bg-background/95 backdrop-blur-xl shadow-2xl rounded-3xl">
                    <DialogHeader className="p-6 border-b bg-muted/30">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <DialogTitle className="flex items-center gap-2 text-xl">
                                    <Eye className="h-5 w-5 text-blue-500" />
                                    Offer Letter Preview
                                </DialogTitle>
                                <DialogDescription>
                                    Review the generated offer letter. This is exactly what the candidate will see.
                                </DialogDescription>
                            </div>
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="h-8 gap-2"
                                onClick={() => {
                                    const win = window.open('', '_blank');
                                    win?.document.write(previewHtml || '');
                                    win?.document.close();
                                }}
                            >
                                Open in New Tab
                            </Button>
                        </div>
                    </DialogHeader>
                    
                    <div className="flex-1 bg-muted/10 p-4 md:p-8 overflow-y-auto overflow-x-hidden flex justify-center items-start scrollbar-premium">
                        <div className="w-full flex justify-center origin-top transform scale-75 md:scale-85 lg:scale-90 transition-transform duration-300">
                            <Card className="w-[210mm] min-h-[297mm] bg-white shadow-2xl overflow-hidden border-none">
                                {previewHtml ? (
                                    <iframe 
                                        className="w-full h-full min-h-[297mm] border-none"
                                        srcDoc={previewHtml}
                                        title="Offer Preview"
                                    />
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-96 text-muted-foreground gap-4">
                                        <RefreshCw className="h-8 w-8 animate-spin opacity-20" />
                                        <p className="italic font-medium">Rendering pixel-perfect preview...</p>
                                    </div>
                                )}
                            </Card>
                        </div>
                    </div>
                    
                    <DialogFooter className="p-4 border-t bg-white">
                        <Button 
                            variant="secondary" 
                            className="font-bold border-none"
                            onClick={() => setIsPreviewOpen(false)}
                        >
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
