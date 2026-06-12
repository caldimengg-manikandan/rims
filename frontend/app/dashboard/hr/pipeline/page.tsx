'use client'

import React, { useState, useMemo } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/app/dashboard/lib/swr-fetcher'
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Briefcase, ArrowRight, Layers, Users, UserCheck, Search } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import Link from 'next/link'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface Job {
    id: number
    job_id: string
    title: string
    status: string
    created_at: string
    application_count?: number
}

export default function PipelineIndexPage() {
    const router = useRouter()
    const { data: jobs, isLoading } = useSWR<Job[]>('/api/jobs?limit=500', fetcher)
    const [currentPage, setCurrentPage] = useState(1)
    const [pageSize, setPageSize] = useState(10)
    const [searchTerm, setSearchTerm] = useState('')

    // Only count truly 'open' roles for the badge
    const activeRolesCount = useMemo(() => {
        if (!jobs) return 0
        return jobs.filter(j => j.status === 'open').length
    }, [jobs])

    const filteredJobs = useMemo(() => {
        if (!jobs) return []
        let filtered = jobs
        
        if (searchTerm) {
            const lowerTerm = searchTerm.toLowerCase()
            filtered = filtered.filter(job => 
                String(job.title || '').toLowerCase().includes(lowerTerm) || 
                String(job.job_id || '').toLowerCase().includes(lowerTerm)
            )
        }
        
        return filtered
    }, [jobs, searchTerm])

    const paginatedJobs = useMemo(() => {
        const start = (currentPage - 1) * pageSize
        return filteredJobs.slice(start, start + pageSize)
    }, [filteredJobs, currentPage, pageSize])

    const totalPages = Math.ceil((filteredJobs.length) / pageSize)

    if (isLoading) return (
        <div className="p-8 flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
    )

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <PageHeader
                title="Hiring Pipelines"
                description="Manage candidate flow for each active position"
                icon={UserCheck}
            >
                <div className="flex items-center gap-2 bg-primary/10 dark:bg-white/5 px-6 py-4 rounded-2xl border border-primary/20 dark:border-white/10 shadow-sm">
                    <Layers className="h-5 w-5 text-primary dark:text-slate-200" />
                    <span className="text-l font-black text-primary dark:text-white tabular-nums">{activeRolesCount} Active Roles</span>
                </div>
            </PageHeader>

            <div className="relative group max-w-md">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors z-10" />
                <Input
                    type="text"
                    placeholder="Search by job title or ID..."
                    className="w-full pl-11 pr-4 py-3 rounded-2xl bg-background/50 border border-border hover:border-primary/40 focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/10 outline-none transition-all font-medium shadow-sm h-12"
                    value={searchTerm}
                    onChange={(e) => {
                        setSearchTerm(e.target.value)
                        setCurrentPage(1)
                    }}
                />
            </div>

            <Card className="bg-card/45 backdrop-blur-xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] rounded-2xl overflow-hidden">
                <Table>
                    <TableHeader className="">
                        <TableRow className="hover:bg-transparent border-none">
                            <TableHead className="font-bold py-4">Job Title & ID</TableHead>
                            <TableHead className="font-bold text-center">Status</TableHead>
                            <TableHead className="font-bold text-center">Pipeline</TableHead>
                            <TableHead className="font-bold text-center">Action</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody className="stagger-children">
                        {paginatedJobs.map((job) => (
                            <TableRow 
                                key={job.id} 
                                className="premium-table-row border-b border-border/20 last:border-b-0 cursor-pointer group"
                                onClick={() => router.push(`/dashboard/hr/pipelines/${job.id}`)}
                            >
                                <TableCell className="py-4">
                                    <div className="flex items-center gap-3">
                                        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary group-hover:text-white transition-colors">
                                            <Briefcase className="h-5 w-5" />
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="font-bold text-foreground uppercase tracking-tight">{job.title}</span>
                                            <span className="text-[10px] font-mono text-muted-foreground opacity-60">#{job.job_id}</span>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell className="text-center">
                                    <Badge variant={job.status === 'open' ? 'default' : 'secondary'} className="text-[10px] uppercase font-black px-2 py-0">
                                        {job.status}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-center">
                                    <div className="flex flex-col items-center gap-1">
                                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                                            <Users className="h-3.5 w-3.5" />
                                            <span>Full Pipeline</span>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell className="text-center pr-6">
                                    <Button 
                                        variant="ghost" 
                                        className="h-9 gap-2 font-bold text-primary group-hover:translate-x-1 transition-transform"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            router.push(`/dashboard/hr/pipelines/${job.id}`);
                                        }}
                                    >
                                        Open Pipeline
                                        <ArrowRight className="h-4 w-4" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>



                {filteredJobs.length === 0 && (
                    <div className="text-center py-20">
                        <Briefcase className="h-12 w-12 mx-auto text-slate-300 mb-4" />
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                            {searchTerm ? 'No matching pipelines found' : 'No active jobs found'}
                        </h3>
                        <p className="text-muted-foreground mt-2">
                            {searchTerm ? 'Try adjusting your search terms' : 'Create a job posting to start building your pipeline'}
                        </p>
                        {!searchTerm && (
                            <Link href="/dashboard/hr/jobs/create" className="mt-6 inline-block">
                                <Button className="rounded-xl px-8 font-bold">Create Your First Job</Button>
                            </Link>
                        )}
                    </div>
                )}
            </Card>

            {totalPages > 1 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 pt-6 border-t border-border">
                    <div className="text-sm text-muted-foreground font-medium">
                            Showing <span className="font-semibold text-foreground/80">{((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, filteredJobs.length)}</span> of <span className="font-semibold text-foreground/80">{filteredJobs.length}</span> pipelines
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
                                    className="h-8 px-4 rounded-xl font-bold bg-background dark:bg-muted border-border transition-all shadow-sm active:scale-95 disabled:opacity-50"
                                >
                                    Previous
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setCurrentPage(prev => prev + 1)}
                                    disabled={currentPage >= totalPages}
                                    className="h-8 px-4 rounded-xl font-bold bg-background dark:bg-muted border-border transition-all shadow-sm active:scale-95 disabled:opacity-50"
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
        </div>
    )
}
