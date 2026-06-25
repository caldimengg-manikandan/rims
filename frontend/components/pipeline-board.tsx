"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { RejectDialog } from "@/components/reject-dialog"
import { APIClient } from '@/app/dashboard/lib/api-client'
import { Button } from "@/components/ui/button"
import { XCircle, Trash2, ListX, FileText } from "lucide-react"
import useSWR from 'swr'
import { fetcher } from '@/app/dashboard/lib/swr-fetcher'
import { useRouter } from 'next/navigation'
import { Checkbox } from "@/components/ui/checkbox"
import { getApiBaseUrl } from "@/lib/config"
import { performMutation } from "@/app/dashboard/lib/swr-utils"

type Application = {
    id: number
    job_title: string
    candidate: {
        full_name: string
        email: string
        candidate_photo_path?: string
        photo_url?: string
    }
    status: string
    skill_match_percentage?: number
    resume_score?: number
    aptitude_score?: number | null
    behavioral_score?: number | null
    technical_skills_score?: number | null
}

const STATUS_COLUMNS = [
    { id: "applied", label: "Applied" },
    { id: "screened", label: "Screened" },
    { id: "interview_scheduled", label: "Interview Scheduled" },
    { id: "interview_completed", label: "Interview Completed" },
    { id: "review_later", label: "Review Later" },
    { id: "physical_interview", label: "Physical Interview" },
    { id: ["hired", "pending_approval"], label: "Hired" },
    { id: ["offer_sent", "accepted"], label: "Offer Sent" },
    { id: "onboarded", label: "Onboarded" },
    { id: "rejected", label: "Rejected" },
]

const STATE_ACTIONS: Record<string, { action: string; label: string; variant: 'primary' | 'destructive' | 'secondary' | 'success' }[]> = {
    applied: [
        { action: "mark_screened", label: "Screen", variant: "primary" },
    ],
    screened: [
        { action: "approve_for_interview", label: "Approve", variant: "primary" },
    ],
    // interview_scheduled: waiting state — no transition actions
    interview_completed: [
        { action: "hire", label: "Hire", variant: "success" },
        { action: "call_for_interview", label: "Physical", variant: "primary" },
        { action: "review_later", label: "Review", variant: "secondary" },
    ],
    review_later: [
        { action: "call_for_interview", label: "Physical", variant: "primary" },
    ],
    physical_interview: [
        { action: "hire", label: "Hire", variant: "success" },
    ],
    hired: [
        { action: "send_offer", label: "Send Offer", variant: "success" },
    ],
    pending_approval: [
        { action: "send_offer", label: "Send Offer", variant: "success" },
    ],
    offer_sent: [
        { action: "accept_offer", label: "Accept Offer", variant: "success" },
    ],
    accepted: [
        { action: "onboard", label: "Onboard", variant: "success" },
    ],
}

const APPLICATIONS_PER_PAGE = 5

export function PipelineBoard({ jobId }: { jobId?: string }) {
    const router = useRouter()
    const apiPath = jobId
        ? `/api/applications?job_id=${jobId}&limit=49`
        : '/api/applications?limit=49'
    const { data: paginatedData, error, isLoading, mutate } = useSWR<any>(
        apiPath, 
        (url: string) => fetcher<any>(url)
    )

    const rawApplications = paginatedData?.items || (Array.isArray(paginatedData) ? paginatedData : [])

    const applications: Application[] = rawApplications.map((app: any) => ({
        id: app.id,
        job_title: app.job?.title || "Unknown",
        candidate: {
            full_name: app.candidate_name || "Unknown",
            email: app.candidate_email || "",
            candidate_photo_path: app.candidate_photo_path,
            photo_url: app.photo_url
        },
        status: app.status,
        skill_match_percentage: app.resume_extraction?.skill_match_percentage,
        resume_score: app.resume_extraction?.resume_score,
        aptitude_score: app.interview?.report?.aptitude_score,
        behavioral_score: app.interview?.report?.behavioral_score,
        technical_skills_score: app.interview?.report?.technical_skills_score,
    }))

    const [fetchError, setFetchError] = useState<string | null>(null)
    const [pages, setPages] = useState<Record<string, number>>({})
    const [selectedApps, setSelectedApps] = useState<number[]>([])

    const toggleAppSelection = (id: number) => {
        setSelectedApps(prev => prev.includes(id) ? prev.filter(appId => appId !== id) : [...prev, id])
    }
    
    const handleClearOrDelete = async (colId: string | string[], colApps: Application[]) => {
        const colAppIds = colApps.map(app => app.id)
        const selectedInCol = selectedApps.filter(id => colAppIds.includes(id))
        
        const isDeleteMode = selectedInCol.length > 0
        const itemsToDelete = isDeleteMode ? selectedInCol : colAppIds

        if (itemsToDelete.length === 0) return

        const actionText = isDeleteMode ? `delete ${itemsToDelete.length} selected` : `clear all ${itemsToDelete.length}`
        if (!confirm(`Are you sure you want to ${actionText} applications? This action cannot be undone.`)) {
            return
        }

        const actionFn = () => Promise.all(itemsToDelete.map(id => APIClient.delete(`/api/applications/${id}`)))

        await performMutation<any[]>(
            apiPath,
            mutate,
            actionFn,
            {
                lockKey: `pipeline-bulk-delete-${jobId ?? 'all'}`,
                optimisticData: (current: any) => {
                    if (!current) return current;
                    const items = current.items || (Array.isArray(current) ? current : []);
                    const filtered = items.filter((app: any) => !itemsToDelete.includes(app.id));
                    return Array.isArray(current) ? filtered : { ...current, items: filtered };
                },
                successMessage: `Successfully deleted ${itemsToDelete.length} candidate(s)`,
                invalidateKeys: ['/api/analytics/dashboard']
            }
        )
        setSelectedApps(prev => prev.filter(id => !itemsToDelete.includes(id)))
    }

    // ─── FSM Transition Handler ────────────────────────────────────────
    const handleTransition = async (applicationId: number, action: string, notes?: string) => {
        const actionFn = () => APIClient.put(`/api/applications/${applicationId}/status`, {
            action,
            hr_notes: notes || `Action: ${action}`
        })

        await performMutation<any[]>(
            apiPath,
            mutate,
            actionFn,
            {
                lockKey: `application-${applicationId}`,
                optimisticData: (current: any) => {
                    if (!current) return current;
                    const items = current.items || (Array.isArray(current) ? current : []);
                    const mapped = items.map((app: any) =>
                        app.id === applicationId 
                            ? { ...app, status: action === 'reject' ? 'rejected' : app.status } 
                            : app
                    );
                    return Array.isArray(current) ? mapped : { ...current, items: mapped };
                },
                successMessage: action === 'hire' ? 'Candidate hired! Redirecting to Onboarding...' : `Action ${action} completed`,
                invalidateKeys: ['/api/analytics/dashboard']
            }
        )

        if (action === 'hire') {
            router.push('/dashboard/onboarding')
        }
    }

    const handleReject = async (applicationId: number, reason: string, notes: string) => {
        await handleTransition(applicationId, 'reject', `Reason: ${reason}${notes ? `\nNotes: ${notes}` : ''}`)
    }

    if (isLoading && !paginatedData) {
        return (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
                <div className="relative">
                    <div className="h-16 w-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="h-8 w-8 rounded-full bg-primary/10 animate-pulse" />
                    </div>
                </div>
                <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest animate-pulse">Loading Pipeline...</p>
            </div>
        )
    }

    if (fetchError || error) {
        return (
            <div className="p-4 bg-destructive/10 text-destructive rounded-md border border-destructive/20">
                <h3 className="font-bold">Status</h3>
                <p>{fetchError || (error as Error).message}</p>
                <div className="mt-2 text-sm text-gray-700">
                    <p>Check:</p>
                    <ul className="list-disc pl-5">
                        <li>Applications are only visible to the HR user who owns the job.</li>
                        <li>Confirm you are signed in with an HR account that has access to this job.</li>
                        {process.env.NODE_ENV === "development" && (
                            <li className="text-muted-foreground">
                                Dev only: seed users may use <strong>hr@company.com</strong> if configured via{" "}
                                <code className="text-xs">SUPER_ADMIN_*</code> in backend <code className="text-xs">.env</code>.
                            </li>
                        )}
                    </ul>
                </div>
            </div>
        )
    }

    if (applications.length === 0 && !isLoading && !fetchError && !error) {
        return (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] w-full bg-muted/20 rounded-2xl border border-dashed border-border/60 p-12 text-center gap-4 animate-in fade-in duration-500">
                <div className="relative">
                    <div className="absolute -inset-3 rounded-full bg-primary/10 blur-xl" />
                    <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/15 to-blue-500/10 border border-primary/20 flex items-center justify-center shadow-lg">
                        <FileText className="h-7 w-7 text-primary" />
                    </div>
                </div>
                <div className="space-y-1">
                    <h3 className="text-lg font-bold text-foreground">No applications found</h3>
                    <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                        There are currently no candidates in the pipeline{jobId ? ' for this job' : ''}.
                    </p>
                </div>
            </div>
        )
    }

    const getColumnApplications = (columnId: string | string[]) => {
        return applications.filter(app => {
            if (Array.isArray(columnId)) {
                return columnId.includes(app.status)
            }
            return app.status === columnId
        })
    }

    // Determine which non-reject action buttons to show on a card
    const getCardActions = (status: string) => {
        return STATE_ACTIONS[status] || []
    }

    // Check if reject is allowed for this state (per spec)
    const isRejectAllowed = (status: string) => {
        return ["applied", "screened", "review_later", "physical_interview"].includes(status)
    }

    return (
        <div className="flex h-full gap-4 overflow-x-auto pb-4 scrollbar-premium">
            {STATUS_COLUMNS.map((column, colIndex) => {
                const colKey = Array.isArray(column.id) ? column.id.join("-") : column.id;
                const colApps = getColumnApplications(column.id);
                const hasApps = colApps.length > 0;
                const pageNum = pages[colKey] || 0;
                const pageApps = colApps.slice(pageNum * APPLICATIONS_PER_PAGE, (pageNum + 1) * APPLICATIONS_PER_PAGE);
                const selectedInCol = selectedApps.filter(id => colApps.map(a => a.id).includes(id));

                return (
                <div key={colKey} style={{ animationDelay: `${colIndex * 150}ms` }} className="min-w-[280px] flex-1 max-w-[350px] h-full max-h-full flex flex-col bg-card/45 backdrop-blur-xl rounded-2xl border border-border/80 p-3 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out fill-mode-both">
                    <div className="flex items-center justify-between p-2 mb-2 shrink-0">
                        <div className="flex items-center gap-2">
                            <h3 className="font-bold text-sm text-muted-foreground uppercase tracking-wide">{column.label}</h3>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-6 w-6 text-muted-foreground focus:ring-0 hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0"
                                onClick={() => handleClearOrDelete(column.id, colApps)}
                                disabled={!hasApps}
                                title={selectedInCol.length > 0 ? "Delete Selected" : "Clear Column"}
                            >
                                {selectedInCol.length > 0
                                    ? <Trash2 className="h-4 w-4" />
                                    : <ListX className="h-4 w-4" />}
                            </Button>
                            <Badge variant="secondary" className="bg-background text-muted-foreground shadow-sm border border-border">
                                {colApps.length}
                            </Badge>
                        </div>
                    </div>

                    <ScrollArea className="flex-1 min-h-0 pr-2 pb-2">
                        <div className="space-y-3 p-1">
                            {!hasApps ? (
                                <div className="flex flex-col items-center justify-center h-24 mt-4 opacity-50">
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">No data available</p>
                                </div>
                            ) : (
                                pageApps.map((app, index) => (
                                    <Card 
                                        key={app.id} 
                                        style={{ animationDelay: `${index * 50}ms` }} 
                                        className={`relative cursor-pointer bg-card/45 backdrop-blur-xl border rounded-xl group animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both hover-premium-lift active:scale-[0.98] ${selectedApps.includes(app.id) ? 'border-primary bg-primary/5 shadow-sm' : 'border-border/80'}`}
                                        onClick={() => {
                                            const selection = window.getSelection();
                                            if (selection && selection.toString().length > 0) return;
                                            router.push(`/dashboard/hr/applications/${app.id}`);
                                        }}
                                    >
                                        {/* Right side controls */}
                                        <div className="absolute inset-y-0 right-1.5 flex flex-col items-center justify-evenly py-2 z-10">
                                            <div onClick={e => e.stopPropagation()} className="cursor-pointer p-1">
                                                <Checkbox 
                                                    className="h-5 w-5 bg-background border-2 border-muted-foreground/40 hover:border-primary/80 data-[state=checked]:bg-primary data-[state=checked]:border-primary transition-colors shadow-sm"
                                                    checked={selectedApps.includes(app.id)}
                                                    onCheckedChange={() => toggleAppSelection(app.id)}
                                                />
                                            </div>
                                            {isRejectAllowed(app.status) && (
                                                <div onClick={(e) => e.stopPropagation()}>
                                                    <RejectDialog
                                                        candidateName={app.candidate.full_name}
                                                        onConfirm={(reason, notes) => handleReject(app.id, reason, notes)}
                                                        trigger={
                                                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                                                                <XCircle className="h-5 w-5" />
                                                            </Button>
                                                        }
                                                    />
                                                </div>
                                            )}
                                        </div>
                                        <CardHeader className="p-3 pb-1.5 flex flex-row items-center space-y-0 relative pr-10">
                                            <div className="flex items-start space-x-2.5 flex-1 min-w-0">
                                                <Avatar className="h-8 w-8 border-2 border-background shadow-md ring-1 ring-primary/15 shrink-0">
                                                    <AvatarImage 
                                                        src={app.candidate.photo_url || (app.candidate.candidate_photo_path ? (app.candidate.candidate_photo_path.startsWith('http') ? app.candidate.candidate_photo_path : `${getApiBaseUrl()}/${app.candidate.candidate_photo_path.replace(/\\/g, '/')}`) : undefined)}
                                                        alt={app.candidate.full_name}
                                                        className="object-cover"
                                                    />
                                                    <AvatarFallback className="bg-gradient-to-br from-primary/30 to-accent/40 text-primary font-extrabold text-xs shadow-inner">
                                                        {app.candidate.full_name?.charAt(0)}
                                                    </AvatarFallback>
                                                </Avatar>
                                                <div className="overflow-hidden min-w-0 pt-0.5">
                                                    <CardTitle className="text-[13px] font-bold text-foreground truncate leading-tight">{app.candidate.full_name}</CardTitle>
                                                    <CardDescription className="text-[11px] truncate text-muted-foreground font-medium leading-tight mt-0.5" title={app.job_title}>
                                                        {app.job_title}
                                                    </CardDescription>
                                                </div>
                                            </div>
                                        </CardHeader>
                                        <CardContent className="p-3 pt-0 pr-10">
                                            <div className="flex flex-wrap gap-1.5 mt-1 items-center">
                                                {app.resume_score !== undefined && app.resume_score !== null && (
                                                    <Badge
                                                        variant="outline"
                                                        className={`text-[9px] px-1.5 py-0 h-4 border transition-colors ${
                                                            (app.resume_score <= 10 ? app.resume_score * 10 : app.resume_score) > 80
                                                                ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/15"
                                                                : "bg-secondary/15 text-secondary-foreground border-border hover:bg-secondary/20"
                                                            }`}
                                                    >
                                                        Job Comp: {(app.resume_score <= 10 ? app.resume_score * 10 : app.resume_score).toFixed(0)}%
                                                    </Badge>
                                                )}
                                                {app.aptitude_score !== null && app.aptitude_score !== undefined && (
                                                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 bg-indigo-500/10 text-indigo-600 border-indigo-500/20 dark:text-indigo-400 dark:border-indigo-500/30 font-semibold hover:bg-indigo-500/15 transition-colors">
                                                        Apt: {app.aptitude_score.toFixed(1)}
                                                    </Badge>
                                                )}
                                                {app.behavioral_score !== null && app.behavioral_score !== undefined && (
                                                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400 dark:border-emerald-500/30 font-semibold hover:bg-emerald-500/15 transition-colors">
                                                        Behav: {app.behavioral_score.toFixed(1)}
                                                    </Badge>
                                                )}
                                                {app.technical_skills_score !== null && app.technical_skills_score !== undefined && (
                                                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 bg-sky-500/10 text-sky-600 border-sky-500/20 dark:text-sky-400 dark:border-sky-500/30 font-semibold hover:bg-sky-500/15 transition-colors">
                                                        Tech: {app.technical_skills_score.toFixed(1)}
                                                    </Badge>
                                                )}
                                            </div>

                                            {/* FSM Action Buttons */}
                                            {getCardActions(app.status).length > 0 && (
                                                <div className="flex flex-wrap gap-1.5 mt-2" onClick={e => e.stopPropagation()}>
                                                    {getCardActions(app.status).map(btn => (
                                                        <Button
                                                            key={btn.action}
                                                            variant={btn.variant === 'primary' ? 'default' : btn.variant === 'destructive' ? 'destructive' : 'outline'}
                                                            size="sm"
                                                            className={`h-6 px-2 text-[10px] font-bold uppercase tracking-wider rounded-md hover:scale-105 active:scale-[0.95] transition-all duration-200 ${
                                                                btn.variant === 'success' 
                                                                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700 shadow-sm' 
                                                                    : btn.variant === 'secondary'
                                                                        ? 'bg-amber-500/10 text-amber-600 border-amber-500/30 hover:bg-amber-500/20'
                                                                        : ''
                                                            }`}
                                                            onClick={() => handleTransition(app.id, btn.action)}
                                                        >
                                                            {btn.label}
                                                        </Button>
                                                    ))}
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                ))
                            )}
                        </div>
                    </ScrollArea>
                    
                    {/* Pagination controls */}
                    {colApps.length > APPLICATIONS_PER_PAGE && (
                        <div className="flex justify-between items-center px-1 pt-2 shrink-0 border-t mt-1 border-border/40">
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="h-6 px-2 text-xs hover:scale-105 active:scale-95 transition-all duration-200"
                                disabled={pageNum === 0}
                                onClick={() => setPages(p => ({ ...p, [colKey]: pageNum - 1 }))}
                            >
                                &larr; Prev
                            </Button>
                            <span className="text-xs text-muted-foreground font-medium">
                                {pageNum + 1} / {Math.ceil(colApps.length / APPLICATIONS_PER_PAGE)}
                            </span>
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="h-6 px-2 text-xs hover:scale-105 active:scale-95 transition-all duration-200"
                                disabled={(pageNum + 1) * APPLICATIONS_PER_PAGE >= colApps.length}
                                onClick={() => setPages(p => ({ ...p, [colKey]: pageNum + 1 }))}
                            >
                                Next &rarr;
                            </Button>
                        </div>
                    )}
                </div>
                );
            })}
        </div>
    )
}
