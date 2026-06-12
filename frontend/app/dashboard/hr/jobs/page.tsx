"use client"

import React, { useEffect, useState, useMemo } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAuth } from '@/app/dashboard/lib/auth-context'
import { APIClient } from '@/app/dashboard/lib/api-client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Edit2, ChevronRight, Activity, FileText, Search, Plus, Filter, RotateCcw, Briefcase, Calendar, ChevronLeft, Trash2, XCircle, LayoutDashboard } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import useSWR from "swr"
import { fetcher } from "@/app/dashboard/lib/swr-fetcher"
import { performMutation } from "@/app/dashboard/lib/swr-utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

interface Job {
    id: number
    job_id: string
    title: string
    description: string
    experience_level: string
    status: string
    created_at: string
    closed_at?: string | null
    duration_minutes?: number
}

export default function HRJobsPage() {
    const { user } = useAuth()
    const router = useRouter()
    const { data: jobs = [], error: fetchError, isLoading, mutate } = useSWR<Job[]>(
        '/api/jobs?limit=500',
        fetcher,
    )
    const [confirmAction, setConfirmAction] = useState<{ type: 'close' | 'delete'; jobId: number; message: string } | null>(null)

    const handleConfirm = async () => {
        if (!confirmAction) return
        const { type, jobId } = confirmAction
        setConfirmAction(null)

        if (type === 'close') {
            await performMutation<Job[]>(
                '/api/jobs',
                mutate,
                () => APIClient.put(`/api/jobs/${jobId}`, { status: 'closed' }),
                {
                    lockKey: `job-${jobId}`,
                    optimisticData: (current) => (current || []).map(job =>
                        job.id === jobId ? { ...job, status: 'closed' } : job
                    ),
                    successMessage: 'Job closed successfully',
                    invalidateKeys: ['/api/analytics/dashboard']
                }
            )
        } else if (type === 'delete') {
            await performMutation<Job[]>(
                '/api/jobs',
                mutate,
                () => APIClient.delete(`/api/jobs/${jobId}`),
                {
                    lockKey: `job-${jobId}`,
                    optimisticData: (current) => (current || []).filter(job => job.id !== jobId),
                    successMessage: 'Job deleted successfully',
                    invalidateKeys: ['/api/analytics/dashboard']
                }
            )
        }
    }

    const handleClose = (jobId: number) => {
        setConfirmAction({
            type: 'close',
            jobId,
            message: 'Are you sure you want to close this job? Candidates will still be able to see their already submitted applications.'
        })
    }

    const handleDelete = (jobId: number) => {
        setConfirmAction({
            type: 'delete',
            jobId,
            message: 'Are you sure you want to PERMANENTLY DELETE this job? This action cannot be undone and will remove all associated applications.'
        })
    }

    // Filter Logic
    const [searchTerm, setSearchTerm] = useState('')
    const [statusFilter, setStatusFilter] = useState('all')
    const [sortBy, setSortBy] = useState('newest')
    
    // Pagination state
    const [currentPage, setCurrentPage] = useState(1)
    const [pageSize, setPageSize] = useState(10)

    const filteredJobs = useMemo(() => {
        return jobs.filter(job => {
            const matchesSearch =
                (job.title || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (job.job_id && job.job_id.toLowerCase().includes(searchTerm.toLowerCase()))
            const matchesStatus = statusFilter === 'all' || job.status === statusFilter
            return matchesSearch && matchesStatus
        }).sort((a, b) => {
            if (sortBy === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            if (sortBy === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            if (sortBy === 'job_id_asc') return (a.job_id || "").localeCompare(b.job_id || "")
            if (sortBy === 'job_id_desc') return (b.job_id || "").localeCompare(a.job_id || "")
            return 0
        })
    }, [jobs, searchTerm, statusFilter, sortBy])

    useEffect(() => {
        setCurrentPage(1)
    }, [searchTerm, statusFilter, sortBy])

    const paginatedJobs = useMemo(() => {
        const start = (currentPage - 1) * pageSize
        return filteredJobs.slice(start, start + pageSize)
    }, [filteredJobs, currentPage, pageSize])

    const totalPages = Math.ceil(filteredJobs.length / pageSize)

    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'open':
                return "capsule-badge-success";
            case 'closed':
                return "capsule-badge-destructive";
            default:
                return "capsule-badge-neutral";
        }
    };

    const openJobsCount = useMemo(() => jobs.filter(j => j.status === 'open').length, [jobs])

    return (
        <div className="space-y-8">
            <PageHeader
                title="Job Postings"
                description="Manage your recruitment listings and active roles."
                icon={Briefcase}
            >
                <div className="flex items-center gap-4">
                    <div className="bg-card/45 backdrop-blur-xl border border-border/80 rounded-2xl gap-2 px-6 py-4 flex items-center shadow-[0_8px_30px_rgb(0,0,0,0.02)]">
                        <div className="flex flex-col">
                            <span className="text-[10px] font-black text-primary uppercase tracking-widest leading-tight">Active</span>
                            <span className="text-[18px] font-black text-primary tabular-nums leading-none">
                                {isLoading ? "..." : openJobsCount}
                            </span>
                        </div>
                        <div className="w-px h-8 bg-primary/20 mx-2" />
                        <div className="flex flex-col">
                            <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest leading-tight">Total</span>
                            <span className="text-[18px] font-black text-muted-foreground tabular-nums leading-none">
                                {isLoading ? "..." : jobs.length}
                            </span>
                        </div>
                    </div>
                    <Link href="/dashboard/hr/jobs/create">
                        <Button className="h-14 px-6 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-lg shadow-primary/20 active:scale-[0.99] transition-all flex items-center gap-2">
                            <Plus className="w-5 h-5" />
                            Create New Job
                        </Button>
                    </Link>
                </div>
            </PageHeader>

            {/* Filter Toolbar */}
            <div className="bg-card/45 backdrop-blur-xl p-4 rounded-2xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] mb-8 animate-in fade-in slide-in-from-top-4 duration-700 ease-out">
                <div className="flex flex-wrap gap-4 items-end">
                    {/* Search Bar */}
                    <div className="flex-1 min-w-0">
                        <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 px-1">Search Job Roles</label>
                        <div className="relative group flex gap-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-muted-foreground group-focus-within:text-primary h-5 w-5 transition-colors z-10 pointer-events-none" />
                                <Input
                                    type="text"
                                    placeholder="Search by title, ID, or description..."
                                    className="w-full pl-12 pr-4 h-11 bg-background border border-input rounded-xl focus:outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all text-base placeholder:text-muted-foreground text-foreground hover:border-primary/40"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Status Filter */}
                    <div className="w-[180px]">
                        <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 px-1">Job Status</label>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="w-full h-11 bg-background border border-input rounded-xl text-base font-medium focus:ring-4 focus:ring-primary/10 transition-all text-foreground hover:border-primary/40">
                                <SelectValue placeholder="All Statuses" />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl">
                                <SelectItem value="all">All Statuses</SelectItem>
                                <SelectItem value="open">Open</SelectItem>
                                <SelectItem value="closed">Closed</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Sort By Filter */}
                    <div className="w-[180px]">
                        <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 px-1">Sort Order</label>
                        <Select value={sortBy} onValueChange={setSortBy}>
                            <SelectTrigger className="w-full h-11 bg-background border border-input rounded-xl text-base font-medium focus:ring-4 focus:ring-primary/10 transition-all text-foreground hover:border-primary/40">
                                <SelectValue placeholder="Newest First" />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl">
                                <SelectItem value="newest">Newest First</SelectItem>
                                <SelectItem value="oldest">Oldest First</SelectItem>
                                <SelectItem value="job_id_asc">Job ID (A-Z)</SelectItem>
                                <SelectItem value="job_id_desc">Job ID (Z-A)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Clear Filters */}
                    {(searchTerm || statusFilter !== "all" || sortBy !== "newest") && (
                        <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => {
                                setSearchTerm("");
                                setStatusFilter("all");
                                setSortBy("newest");
                                setCurrentPage(1);
                            }}
                            className="h-11 px-4 text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <RotateCcw className="w-4 h-4 mr-2" />
                            Reset
                        </Button>
                    )}
                </div>
            </div>

            {isLoading ? (
                <div className="text-center py-20 flex flex-col items-center justify-center gap-4 animate-in fade-in duration-500">
                    <div className="relative">
                        <div className="animate-spin rounded-full h-16 w-16 border-4 border-primary/20 border-t-primary shadow-lg"></div>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="h-8 w-8 rounded-full bg-primary/10 animate-pulse"></div>
                        </div>
                    </div>
                    <p className="text-sm font-bold text-muted-foreground animate-pulse tracking-widest uppercase">Fetching Jobs...</p>
                </div>
            ) : filteredJobs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-12 text-center flex flex-col items-center gap-3 animate-in fade-in duration-500">
                    <div className="relative">
                        <div className="absolute -inset-3 rounded-full bg-primary/10 blur-xl" />
                        <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/15 to-blue-500/10 border border-primary/20 flex items-center justify-center shadow-lg">
                            <Briefcase className="w-7 h-7 text-primary" />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <h3 className="text-lg font-bold text-foreground">No jobs match your criteria</h3>
                        <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                            Try adjusting your search terms or filters, or create a new job posting.
                        </p>
                    </div>
                    <Button 
                        variant="outline" 
                        onClick={() => { setSearchTerm(""); setStatusFilter("all"); }}
                        className="mt-2 rounded-xl border-border font-bold active:scale-[0.99] transition-all hover:bg-muted/50"
                    >
                        Clear Filters
                    </Button>
                </div>
            ) : (
                <div className="bg-card/45 backdrop-blur-xl rounded-2xl border border-border/80 overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.02)] animate-in fade-in slide-in-from-bottom-4 duration-700">
                    {/* List Header */}
                    <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-muted/30 border-b border-border/40 text-xs uppercase tracking-widest font-black text-muted-foreground">
                        <div className="col-span-4">Job Title & Identification</div>
                        <div className="col-span-1 text-center">Status</div>
                        <div className="col-span-2 text-center">Experience</div>
                        <div className="col-span-2 text-center">Date Posted</div>
                        <div className="col-span-1 text-center">Analytics</div>
                        <div className="col-span-2 text-center">Actions</div>
                    </div>

                    <div className="divide-y divide-border/50 stagger-children">
                        {paginatedJobs.map((job, index) => (
                            <div
                                key={job.id}
                                className="grid grid-cols-12 gap-4 px-6 py-4 items-center border-b border-border/10 last:border-b-0 cursor-pointer group premium-table-row"
                                onClick={() => router.push(`/dashboard/hr/jobs/${job.id}/edit`)}
                            >
                                {/* Job Title & ID */}
                                <div className="col-span-4 flex items-center gap-4 min-w-0">
                                    <div className="p-2.5 rounded-xl bg-primary/5 text-primary border border-primary/10 shrink-0 group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
                                        <Briefcase className="w-6 h-6" />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="font-bold text-lg text-foreground group-hover:text-primary transition-colors truncate">
                                            {job.title}
                                        </div>
                                        {job.job_id && (
                                            <div className="text-sm font-mono text-muted-foreground flex items-center gap-1.5 mt-0.5">
                                                <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700" />
                                                {job.job_id}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Status */}
                                <div className="col-span-1 text-center">
                                    <span className={`capsule-badge text-[12px] px-2 py-0.5 font-bold ${getStatusStyle(job.status)}`}>
                                        {job.status.toUpperCase()}
                                    </span>
                                </div>
                                {/* Experience  */}
                                <div className="col-span-2 flex justify-center">
                                    <div className="text-md font-bold text-foreground flex items-center gap-1.5">
                                        <Activity className="w-3.5 h-3.5 text-primary/70" />
                                        <span className="truncate">{job.experience_level.replace('_', ' ')}</span>
                                    </div>
                                </div>
                                {/* Date Posted */}
                                <div className="col-span-2 flex justify-center">
                                    <div className="text-[13px] text-muted-foreground font-medium flex items-center gap-1.5">
                                        <Calendar className="w-3.5 h-3.5 text-muted-foreground/60" />
                                        {new Date(job.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                    </div>
                                </div>

                                {/* Analytics Quick View */}
                                <div className="col-span-1 text-center flex justify-center gap-1">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button 
                                                variant="ghost" 
                                                size="sm" 
                                                className="h-9 w-9 p-0 rounded-lg hover:bg-primary/10 text-primary"
                                                onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/hr/pipelines/${job.id}`); }}
                                            >
                                                <Activity className="w-4 h-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>View Pipeline</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button 
                                                variant="ghost" 
                                                size="sm" 
                                                className="h-9 w-9 p-0 rounded-lg hover:bg-amber-100 text-amber-600 dark:hover:bg-amber-900/30 dark:text-amber-400"
                                                onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/hr/ranking/${job.id}`); }}
                                            >
                                                <FileText className="w-4 h-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Leaderboard</TooltipContent>
                                    </Tooltip>
                                </div>

                                {/* Actions */}
                                <div className="col-span-2 text-center" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex justify-center gap-2">
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-9 w-9 p-0 text-primary hover:bg-primary/10 rounded-lg transition-colors"
                                                        onClick={() => router.push(`/dashboard/hr/jobs/${job.id}/edit`)}
                                                        >
                                                        <Edit2 className="h-4 w-4" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    Edit Job
                                                </TooltipContent>
                                            </Tooltip>

                                        {job.status === 'open' && (
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-9 w-9 p-0 text-amber-600 hover:bg-amber-500/10 rounded-lg transition-colors"
                                                    onClick={() => handleClose(job.id)}
                                                    >
                                                        <XCircle className="h-4 w-4" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    Close Job
                                                </TooltipContent>
                                            </Tooltip>
                                        )}

                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-9 w-9 p-0 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                                                            onClick={() => handleDelete(job.id)}
                                                            >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
    
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        Delete Job
                                                    </TooltipContent>
                                                </Tooltip>
                                        </TooltipProvider>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 pt-6 border-t border-border">
                    <div className="text-sm text-muted-foreground font-medium">
                            Showing <span className="font-semibold text-foreground/80">{((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, filteredJobs.length)}</span> of <span className="font-semibold text-foreground/80">{filteredJobs.length}</span> jobs
                        </div>
                        
                        <div className="flex flex-wrap items-center gap-6">
                            <div className="text-sm font-medium text-muted-foreground">
                                Page <span className="text-foreground/80 font-semibold">{currentPage}</span> of {totalPages}
                            </div>
                            
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={currentPage === 1 || isLoading}
                                    className="h-8 px-4 rounded-xl font-bold bg-background dark:bg-muted border-border transition-all shadow-sm active:scale-[0.99] disabled:opacity-50"
                                >
                                    Previous
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages || isLoading}
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

            {/* Confirm Dialog */}
            <Dialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
                <DialogContent className="max-w-md rounded-3xl border border-border/80 bg-background/95 backdrop-blur-xl shadow-2xl p-6">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-bold">Confirm Action</DialogTitle>
                        <DialogDescription className="pt-2 text-base leading-relaxed text-muted-foreground">
                            {confirmAction?.message}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="pt-6 gap-3 sm:gap-0">
                        <Button variant="ghost" onClick={() => setConfirmAction(null)} className="font-bold rounded-xl h-11">Cancel</Button>
                        <Button 
                            variant={confirmAction?.type === 'delete' ? "destructive" : "default"} 
                            onClick={handleConfirm}
                            className="font-bold rounded-xl h-11 px-8"
                        >
                            {confirmAction?.type === 'delete' ? 'Delete Permanently' : 'Close Job Listing'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
