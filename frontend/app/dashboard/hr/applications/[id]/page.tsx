"use client"

import { useEffect, useState, useMemo, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { RejectDialog } from "@/components/reject-dialog"
import { ArrowLeft, FileText, CheckCircle2, XCircle, Clock, PhoneCall, Star, RotateCw, Eye, ChevronRight, Edit2, Save, X, Camera, CameraOff, Video, Send, UserPlus, ShieldAlert, Info } from "lucide-react"
import { SendOfferDialog } from "@/components/send-offer-dialog"
import { Textarea } from "@/components/ui/textarea"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogDescription
} from "@/components/ui/dialog"
import useSWR from 'swr'
import { fetcher } from '@/app/dashboard/lib/swr-fetcher'
import { performMutation } from "@/app/dashboard/lib/swr-utils"
import { APIClient } from "@/app/dashboard/lib/api-client"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { normalizeHireRecommendation } from "@/lib/recommendation-label"
import { isInterviewNotCompleted } from "@/components/reports/interviewIncomplete"
import { AlertCircle } from "lucide-react"
import { toast } from "sonner"

// ─── FSM Button Config ──────────────────────────────────────────────────
const FSM_BUTTONS: Record<string, { action: string; label: string; icon: React.ReactNode; className: string }[]> = {
    applied: [
        { action: "mark_screened", label: "MARK AS SCREENED", icon: <CheckCircle2 className="h-4 w-4" />, className: "bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg hover:scale-102 hover:shadow-primary/15 active:scale-[0.98] transition-all duration-300" },
        { action: "reject", label: "REJECT CANDIDATE", icon: <XCircle className="h-4 w-4" />, className: "bg-destructive hover:bg-destructive/90 text-white shadow-lg hover:scale-102 hover:shadow-destructive/15 active:scale-[0.98] transition-all duration-300" },
    ],
    screened: [
        { action: "approve_for_interview", label: "APPROVE FOR INTERVIEW", icon: <CheckCircle2 className="h-4 w-4" />, className: "bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg hover:scale-102 hover:shadow-primary/15 active:scale-[0.98] transition-all duration-300" },
        { action: "reject", label: "REJECT CANDIDATE", icon: <XCircle className="h-4 w-4" />, className: "bg-destructive hover:bg-destructive/90 text-white shadow-lg hover:scale-102 hover:shadow-destructive/15 active:scale-[0.98] transition-all duration-300" },
    ],
    // interview_scheduled: waiting state — no HR transition buttons
    interview_scheduled: [],
    interview_completed: [
        { action: "hire", label: "HIRE CANDIDATE", icon: <Star className="h-4 w-4" />, className: "bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg hover:scale-102 hover:shadow-emerald-600/15 active:scale-[0.98] transition-all duration-300" },
        { action: "call_for_interview", label: "CALL FOR PHYSICAL INTERVIEW", icon: <PhoneCall className="h-4 w-4" />, className: "bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg hover:scale-102 hover:shadow-primary/15 active:scale-[0.98] transition-all duration-300" },
        { action: "review_later", label: "REVIEW LATER", icon: <Clock className="h-4 w-4" />, className: "bg-amber-500 hover:bg-amber-600 text-white shadow-lg hover:scale-102 hover:shadow-amber-500/15 active:scale-[0.98] transition-all duration-300" },
        // NOTE: No reject from interview_completed per spec
    ],
    review_later: [
        { action: "call_for_interview", label: "CALL FOR PHYSICAL INTERVIEW", icon: <PhoneCall className="h-4 w-4" />, className: "bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg hover:scale-102 hover:shadow-primary/15 active:scale-[0.98] transition-all duration-300" },
        { action: "reject", label: "REJECT CANDIDATE", icon: <XCircle className="h-4 w-4" />, className: "bg-destructive hover:bg-destructive/90 text-white shadow-lg hover:scale-102 hover:shadow-destructive/15 active:scale-[0.98] transition-all duration-300" },
    ],
    physical_interview: [
        { action: "hire", label: "HIRE CANDIDATE", icon: <Star className="h-4 w-4" />, className: "bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg hover:scale-102 hover:shadow-emerald-600/15 active:scale-[0.98] transition-all duration-300" },
        { action: "reject", label: "REJECT CANDIDATE", icon: <XCircle className="h-4 w-4" />, className: "bg-destructive hover:bg-destructive/90 text-white shadow-lg hover:scale-102 hover:shadow-destructive/15 active:scale-[0.98] transition-all duration-300" },
    ],
    hired: [],
    accepted: [
        { action: "onboard", label: "FINALIZE JOINING", icon: <UserPlus className="h-4 w-4" />, className: "bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg hover:scale-102 hover:shadow-emerald-600/15 active:scale-[0.98] transition-all duration-300" },
    ],
}

const RESUME_STATUS_LABELS: Record<string, { label: string; color: string }> = {
    pending: { label: "Resume: queued", color: "bg-muted text-muted-foreground border-border/80" },
    parsing: { label: "Resume: parsing…", color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" },
    parsed: { label: "Resume: ready", color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
    failed: { label: "Resume: failed", color: "bg-destructive/15 text-destructive border-destructive/20" },
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
    applied: { label: "Applied", color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" },
    screened: { label: "Screened", color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20" },
    interview_scheduled: { label: "Interview Scheduled", color: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20" },
    interview_completed: { label: "Interview Completed", color: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20" },
    review_later: { label: "Review Later", color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" },
    physical_interview: { label: "Physical Interview", color: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20" },
    hired: { label: "Hired", color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
    pending_approval: { label: "Pending Offer Approval", color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" },
    offer_sent: { label: "Offer Sent", color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" },
    accepted: { label: "Offer Accepted", color: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" },
    onboarded: { label: "Onboarded", color: "bg-primary/20 text-primary border-primary/30" },
    rejected: { label: "Rejected", color: "bg-destructive/15 text-destructive border-destructive/20" },
}

export default function HRApplicationDetailPage() {
    const params = useParams()
    const router = useRouter()
    const applicationId = params.id as string
    const { data: application, error: appError, isLoading: appLoading, mutate: mutateApp } = useSWR<any>(`/api/applications/${applicationId}`, (url: string) => fetcher<any>(url))

    // Handle unauthorized access explicitly
    useEffect(() => {
        if (appError?.status === 401 || appError?.status === 403) {
            toast.error("You are not authorized to view this application. Redirecting to login...")
            router.push('/auth/login?expired=true')
        }
    }, [appError, router])

    const { data: interviewReport, error: reportError, isLoading: reportLoading, mutate: mutateReport } = useSWR(
        (application?.interview?.status === 'completed' || 
         application?.interview?.status === 'terminated' || 
         application?.status === 'ai_interview_completed') 
        ? `/api/interviews/${application?.interview?.id}/report` : null,
        (url: string) => fetcher<any>(url),
        {
            fallbackData: application?.interview?.report
        }
    )

    const isLoading = appLoading || (
        (application?.interview?.status === 'completed' || application?.interview?.status === 'terminated') && 
        reportLoading && !interviewReport && !reportError
    )
    
    const [actionLoading, setActionLoading] = useState<string | null>(null)
    const [isEditingNotes, setIsEditingNotes] = useState(false)
    const [notesDraft, setNotesDraft] = useState("")
    const [isPhysicalInterviewPopupOpen, setIsPhysicalInterviewPopupOpen] = useState(false)
    const resumePollRef = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => {
        if (application?.hr_notes) {
            setNotesDraft(application.hr_notes)
        }
    }, [application?.hr_notes])

    useEffect(() => {
        if (appError) {
            const errorMsg = appError.message || String(appError);
            if (errorMsg.includes('401') || errorMsg.toLowerCase().includes('unauthorized') || errorMsg.toLowerCase().includes('token')) {
                router.push('/auth/login?expired=true');
            }
        }
    }, [appError, router])

    const resumeStatus: string = useMemo(() => {
        const raw = application?.resume_status as string | undefined
        if (raw) return raw
        const re = application?.resume_extraction
        if (re && (re.skill_match_percentage != null || re.resume_score != null)) return 'parsed'
        return 'pending'
    }, [application?.resume_status, application?.resume_extraction])

    useEffect(() => {
        if (resumeStatus !== 'parsing') {
            if (resumePollRef.current) {
                clearInterval(resumePollRef.current)
                resumePollRef.current = null
            }
            return
        }
        if (resumePollRef.current) return
        resumePollRef.current = setInterval(() => {
            mutateApp()
        }, 2500)
        return () => {
            if (resumePollRef.current) {
                clearInterval(resumePollRef.current)
                resumePollRef.current = null
            }
        }
    }, [resumeStatus, mutateApp])

    const handleTransition = async (action: string, notes?: string) => {
        setActionLoading(action);
        let nextStatus = currentStatus;
        if (action === "mark_screened") nextStatus = "screened";
        else if (action === "approve_for_interview") nextStatus = "interview_scheduled";
        else if (action === "reject") nextStatus = "rejected";
        else if (action === "call_for_interview") nextStatus = "physical_interview";
        else if (action === "review_later") nextStatus = "review_later";
        else if (action === "hire") nextStatus = "hired";

        try {
            await performMutation<any>(
                `/api/applications/${applicationId}`,
                mutateApp,
                () => APIClient.put(`/api/applications/${applicationId}/status`, {
                    action,
                    hr_notes: notes || `HR action: ${action}`,
                }),
                {
                    lockKey: `application-${applicationId}`,
                    optimisticData: (current) => ({ ...current, status: nextStatus }),
                    successMessage: action === "hire" 
                        ? "Candidate hired! Visit Onboarding to issue offer letter." 
                        : `Action ${action} completed`,
                    invalidateKeys: ['/api/analytics/dashboard', '/api/applications']
                }
            )
        } finally {
            setActionLoading(null);
        }
    }

    const handleReject = async (reason: string, notes: string) => {
        await handleTransition('reject', `Reason: ${reason}${notes ? `\nNotes: ${notes}` : ''}`)
    }

    const handleRetryAnalysis = async () => {
        setActionLoading('retry')
        try {
            await performMutation(
                `/api/applications/${applicationId}`,
                mutateApp,
                () => APIClient.post(`/api/applications/${applicationId}/retry-analysis`, {}),
                {
                    lockKey: `application-${applicationId}-retry`,
                    successMessage: "Resume analysis running in the background — refreshing status…",
                    errorMessage: "Could not start resume analysis. Check that the resume file exists and try again.",
                    invalidateKeys: ['/api/applications']
                }
            )
        } finally {
            setActionLoading(null)
        }
    }

    const handleSaveNotes = async () => {
        setActionLoading('save_notes')
        try {
            await performMutation(
                `/api/applications/${applicationId}`,
                mutateApp,
                () => APIClient.put(`/api/applications/${applicationId}/notes`, {
                    hr_notes: notesDraft
                }),
                {
                    lockKey: `application-${applicationId}-notes`,
                    successMessage: "Notes saved successfully",
                    invalidateKeys: ['/api/applications']
                }
            )
            setIsEditingNotes(false)
        } finally {
            setActionLoading(null)
        }
    }

    const handleDownloadResume = async (filePath: string) => {
        // Enforce direct Cloud Storage URL if available (Task 4)
        if (application?.resume_url) {
            window.open(application.resume_url, '_blank')
            return
        }
        
        // Fallback: Securely download via backend API (Legacy or local dev fallback)
        try {
            await APIClient.downloadFile(
                `/api/applications/${applicationId}/resume/download`,
                application.resume_file_name || `resume_${application.candidate_name.replace(/\s+/g, '_')}.pdf`
            )
        } catch (err: any) {
            console.error('Resume download failed:', err)
            toast.error(err.message || 'Failed to download resume')
        }
    }

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
                <div className="relative">
                    <div className="h-16 w-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="h-8 w-8 rounded-full bg-primary/10 animate-pulse" />
                    </div>
                </div>
                <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest animate-pulse">Loading Candidate Profile...</p>
            </div>
        )
    }

    if (appError || !application) {
        return (
            <div className="p-6">
                <Button variant="ghost" onClick={() => router.back()} className="mb-4">
                    <ArrowLeft className="h-4 w-4 mr-2" /> Back
                </Button>
                <Card className="p-6 bg-destructive/10 border-destructive/20">
                    <p className="text-destructive font-bold">{appError?.message || "Application not found"}</p>
                </Card>
            </div>
        )
    }

    const currentStatus = application.status || 'applied'
    const statusInfo = STATUS_LABELS[currentStatus] || { label: currentStatus, color: "bg-gray-100 text-gray-700 border-gray-200" }
    const buttons = FSM_BUTTONS[currentStatus] || []
    const isTerminal = ['rejected', 'onboarded'].includes(currentStatus)
    const isHiredPipeline = ['hired', 'pending_approval', 'offer_sent', 'accepted'].includes(currentStatus)

    // Extract resume data
    const resumeExtraction = application.resume_extraction || {}
    const skills = (() => {
        try {
            const raw = resumeExtraction.skills || resumeExtraction.extracted_skills
            if (typeof raw === 'string') return JSON.parse(raw)
            if (Array.isArray(raw)) return raw
            return []
        } catch { return [] }
    })()

    const educationItems = (() => {
        try {
            const raw = resumeExtraction.education
            if (!raw) return []
            if (typeof raw === 'string') {
                const trimmed = raw.trim()
                if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                    return JSON.parse(trimmed)
                }
                return [raw]
            }
            if (Array.isArray(raw)) return raw
            return []
        } catch { return [] }
    })()

    const report = interviewReport || application.interview?.report || null
    const resumeStatusInfo = RESUME_STATUS_LABELS[resumeStatus] || RESUME_STATUS_LABELS.pending
    const canApproveResume = resumeStatus === 'parsed'
    const showResumeScores = resumeExtraction.skill_match_percentage != null

    return (
        <div className=" space-y-5 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* ─── Candidate Info Card ───────────────────────────────── */}
            <Card className="bg-card/45 backdrop-blur-xl rounded-2xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] bg-gradient-to-br from-card/30 to-muted/10 py-3 relative overflow-hidden">
                <div className="absolute top-4 right-4 z-10 md:top-6 md:right-6">
                    <Badge className={`px-4 py-1.5 text-xs font-bold uppercase border shadow-sm whitespace-nowrap ${statusInfo.color}`}>
                        {statusInfo.label}
                    </Badge>
                </div>

                <CardHeader className="pb-1 ">
                    <div className="mb-1">
                        <Button 
                            variant="ghost" 
                            onClick={() => router.back()} 
                            className="gap-2 text-muted-foreground hover:text-foreground h-auto p-0 flex items-center transition-all hover:bg-transparent group hover:scale-[1.03] active:scale-95 duration-200"
                        >
                            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" /> 
                            <span className="text-sm font-bold">Back</span>
                        </Button>
                    </div>

                    <div className="flex flex-col md:flex-row items-center md:items-start gap-6 relative pr-12 md:pr-0">
                        {application.photo_url ? (
                            <div className="relative group shrink-0">
                                <div className="absolute inset-0 bg-primary/10 rounded-2xl blur-md -z-10 group-hover:bg-primary/20 transition-all" />
                                <img
                                    src={application.photo_url}
                                    alt={application.candidate_name}
                                    className="w-24 h-24 rounded-2xl object-cover border-4 border-card shadow-xl ring-1 ring-border group-hover:scale-105 transition-transform duration-300"
                                />
                            </div>
                        ) : (
                            <div className="relative group shrink-0">
                                <div className="absolute inset-0 bg-primary/10 rounded-2xl blur-md -z-10 group-hover:bg-primary/20 transition-all" />
                                <div className="w-24 h-24 rounded-2xl bg-primary/10 flex items-center justify-center border-2 border-primary/20 shadow-inner group-hover:scale-105 transition-transform duration-300">
                                    <span className="text-3xl font-bold text-primary">{application.candidate_name?.[0]}</span>
                                </div>
                            </div>
                        )}
                        <div className="text-center md:text-left">
                            <CardTitle className="text-3xl font-extrabold tracking-tight text-foreground">{application.candidate_name}</CardTitle>
                            <CardDescription className="text-lg font-medium text-muted-foreground">{application.candidate_email}</CardDescription>
                            <div className="flex items-center justify-center md:justify-start gap-2 mt-2">
                                <Badge variant="outline" className="bg-card text-muted-foreground border-border">
                                    Applied for: <span className="ml-1 font-bold text-foreground">{application.job?.title || 'Unknown Position'}</span>
                                </Badge>
                                <Badge variant="outline" className="bg-card text-muted-foreground border-border capitalize">
                                    {application.job?.location || 'Remote'}
                                </Badge>
                            </div>
                        </div>
                    </div>
                </CardHeader>
            </Card>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
                {/* ─── Main Content (Left) ─── */}
                <div className="xl:col-span-2 space-y-6">
                    <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
                        {/* ─── AI Resume Analysis ─── */}
                        <Card className="bg-card/45 backdrop-blur-xl border border-border/80 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.02)] h-full flex flex-col pb-5 pt-0 overflow-hidden">
                            <CardHeader className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/40 pt-6 pb-4">
                                <CardTitle className="text-lg flex flex-wrap items-center gap-2 font-bold text-foreground">
                                    <FileText className="h-5 w-5 text-primary" />
                                    AI Resume Analysis
                                    <Badge
                                        variant="outline"
                                        className={`text-[10px] uppercase tracking-wide border ${resumeStatusInfo.color}`}
                                    >
                                        {resumeStatusInfo.label}
                                    </Badge>
                                    {application.extraction_degraded ? (
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Badge
                                                        variant="outline"
                                                        className="text-[10px] uppercase tracking-wide border-amber-400 dark:border-amber-500/50 text-amber-900 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 cursor-help"
                                                    >
                                                        Reduced-confidence extraction
                                                    </Badge>
                                                </TooltipTrigger>
                                                <TooltipContent className="max-w-xs">
                                                    Parsing used a fallback or AI was unavailable. Verify skills and summary before decisions.
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    ) : null}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-2 space-y-4 flex-grow ">
                                {showResumeScores ? (
                                    <>
                                        <div className="space-y-3">
                                            <div className="grid grid-cols-3 gap-3">
                                                <div className="text-center p-3 bg-primary/10/50 rounded-xl border border-primary/20 flex flex-col items-center justify-center">
                                                    <p className="text-2xl font-black text-primary/80 leading-none">
                                                        {((resumeExtraction.resume_score || 0) * 10).toFixed(1)}
                                                    </p>
                                                    
                                                    {/* THIS TOOLTIP below IS VERY ROUND MAKE IT SQUIRCLE */}
                                                    <TooltipProvider>
                                                        <Tooltip> 
                                                            <TooltipTrigger asChild>
                                                                <div className="flex items-center gap-1 cursor-help mt-1">
                                                                    <p className="text-[10px] uppercase font-bold text-primary/70 tracking-wider">Score</p>
                                                                    <Info className="h-2.5 w-2.5 text-primary/50" />
                                                                </div>
                                                            </TooltipTrigger>
                                                            <TooltipContent className="max-w-xs border-primary/20 shadow-xl p-3 bg-background">
                                                                <p className="text-xs font-bold mb-1 text-foreground">AI Scoring Reasoning</p>
                                                                <p className="text-[11px] leading-relaxed text-foreground/80">
                                                                    {(typeof resumeExtraction.reasoning === 'object' && resumeExtraction.reasoning !== null) 
                                                                        ? (resumeExtraction.reasoning.ai_justification || "Automated analysis based on core skill density and experience verification.") 
                                                                        : (resumeExtraction.reasoning || "Automated analysis based on core skill density and experience verification.")}
                                                                </p>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                </div>
                                                <div className="text-center p-3 bg-emerald-50/50 dark:bg-emerald-500/10 rounded-xl border border-emerald-100 dark:border-emerald-500/20">
                                                    <p className="text-2xl font-black text-emerald-700 dark:text-emerald-400">{resumeExtraction.skill_match_percentage?.toFixed(1) || '0'}%</p>
                                                    <p className="text-[10px] uppercase font-bold text-emerald-500 dark:text-emerald-400/70 tracking-wider">Skill Match</p>
                                                </div>
                                                <div className="text-center p-3 bg-muted/30 rounded-xl border border-border/50">
                                                    <p className="text-lg font-bold text-foreground/80 truncate">{resumeExtraction.years_of_experience || resumeExtraction.experience_years || '0'}y</p>
                                                    <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Experience</p>
                                                </div>
                                            </div>
                                            <div className="w-full p-4 bg-muted/30 rounded-xl border border-border/50 min-h-[4.5rem] flex flex-col justify-center">
                                                {educationItems.length > 0 ? (
                                                    <ul className="text-sm font-bold text-foreground/80 space-y-3 text-left">
                                                        {educationItems.map((item: any, i: number) => (
                                                            <li key={i} className="flex gap-2 items-start">
                                                                <span className="text-primary/70 font-bold mt-1">•</span>
                                                                <div className="flex flex-col">
                                                                    {typeof item === 'object' && item !== null ? (
                                                                        <>
                                                                            <span className="text-foreground leading-tight">
                                                                                {item.degree || item.field_of_study || 'Qualification'}
                                                                                {item.degree && item.field_of_study && ` in ${item.field_of_study}`}
                                                                            </span>
                                                                            <span className="text-[11px] text-muted-foreground font-medium leading-tight mt-1">
                                                                                {item.university || item.school || 'Unknown Institution'}
                                                                                {item.graduation_date && ` (${item.graduation_date})`}
                                                                            </span>
                                                                        </>
                                                                    ) : (
                                                                        <span className="leading-tight">{String(item)}</span>
                                                                    )}
                                                                </div>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                ) : (
                                                    <p className="text-sm font-bold text-foreground/80 text-center">N/A</p>
                                                )}
                                                <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mt-2 text-center">Education</p>
                                            </div>
                                        </div>

                                        {skills.length > 0 && (
                                            <div>
                                                <h4 className="font-bold text-xs mb-2 text-muted-foreground uppercase tracking-widest">Detected Skills</h4>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {skills.slice(0, 8).map((skill: string, i: number) => (
                                                        <Badge key={i} variant="secondary" className="text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-foreground/80 hover:bg-slate-200 dark:hover:bg-slate-700 border-none px-2 py-0.5">
                                                            {skill}
                                                        </Badge>
                                                    ))}
                                                    {skills.length > 8 && <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold">+{skills.length - 8} more</span>}
                                                </div>
                                            </div>
                                        )}

                                        {(resumeExtraction.summary || resumeExtraction.extracted_text) && (
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <h4 className="font-bold text-xs text-muted-foreground uppercase tracking-widest">AI Summary</h4>
                                                    <Dialog>
                                                        <DialogTrigger asChild>
                                                            <Button variant="link" size="sm" className="h-auto p-0 text-primary font-bold text-xs hover:no-underline flex items-center gap-1 group">
                                                                View More <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                                                            </Button>
                                                        </DialogTrigger>
                                                            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto w-[95vw] bg-background/90 backdrop-blur-xl border border-border/80 shadow-2xl rounded-3xl scrollbar-premium">
                                                            <DialogHeader>
                                                                <DialogTitle className="flex items-center gap-2 text-xl font-bold">
                                                                    <FileText className="h-5 w-5 text-primary" />
                                                                    AI Analysis Details
                                                                </DialogTitle>
                                                            </DialogHeader>
                                                            <div className="space-y-6 py-4">
                                                                <div className="grid grid-cols-3 gap-3">
                                                                    <div className="text-center p-4 bg-primary/10 rounded-xl border border-primary/20">

                                                                        {/* 40 percent problemx */}
                                                                        <p className="text-2xl font-black text-primary/80">{((resumeExtraction.resume_score || 0) * 10).toFixed(1)}%</p>
                                                                        <p className="text-[10px] uppercase font-bold text-primary/70 tracking-wider">Score</p>
                                                                    </div>
                                                                    <div className="text-center p-4 bg-emerald-50 dark:bg-emerald-500/10 rounded-xl border border-emerald-100 dark:border-emerald-500/20">
                                                                        <p className="text-2xl font-black text-emerald-700 dark:text-emerald-400">{resumeExtraction.skill_match_percentage?.toFixed(1) || '0'}%</p>
                                                                        <p className="text-[10px] uppercase font-bold text-emerald-500 dark:text-emerald-400/70 tracking-wider">Skill Match</p>
                                                                    </div>
                                                                    <div className="text-center p-4 bg-slate-100 dark:bg-slate-800/50 rounded-xl border border-border">
                                                                        <p className="text-xl font-bold text-foreground/80 truncate">{resumeExtraction.years_of_experience || '0'}y</p>
                                                                        <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Experience</p>
                                                                    </div>
                                                                </div>
                                                                <div className="bg-muted/30 p-4 rounded-xl border whitespace-pre-wrap text-sm text-foreground/80 overflow-y-auto scrollbar-premium" style={{ maxHeight: '60vh' }}>
                                                                    {resumeExtraction.summary || resumeExtraction.extracted_text}
                                                                </div>
                                                            </div>
                                                        </DialogContent>
                                                    </Dialog>
                                                </div>
                                                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed font-medium italic line-clamp-6">
                                                    "{resumeExtraction.summary || resumeExtraction.extracted_text}"
                                                </p>
                                            </div>
                                        )}
                                        {application.resume_file_path && (
                                            <div className="pt-2">
                                                <Button 
                                                    variant="link"
                                                    onClick={() => handleDownloadResume(application.resume_file_path)}
                                                    className="text-primary text-xs font-bold flex items-center gap-1 h-auto p-0"
                                                >
                                                    <FileText className="h-3 w-3" /> Download Original Resume
                                                </Button>
                                            </div>
                                        )}
                                    </>
                                ) : resumeStatus === 'parsing' || resumeStatus === 'pending' ? (
                                    <div className="text-center py-10 space-y-4">
                                        <RotateCw className={`h-8 w-8 text-sky-500 mx-auto ${resumeStatus === 'parsing' || actionLoading === 'retry' ? 'animate-spin' : ''}`} />
                                        <p className="text-slate-600 font-medium text-sm">
                                            {resumeStatus === 'parsing'
                                                ? 'Resume analysis is running. This page refreshes automatically.'
                                                : 'Resume analysis is queued or starting…'}
                                        </p>
                                        <Button variant="outline" size="sm" onClick={handleRetryAnalysis} disabled={actionLoading === 'retry' || resumeStatus === 'parsing'}>
                                            Retry Analysis
                                        </Button>
                                    </div>
                                ) : resumeStatus === 'failed' ? (
                                    <div className="text-center py-10 space-y-4">
                                        <div className="bg-red-50 dark:bg-red-500/10 border-2 border-red-100 dark:border-red-500/20 p-4 rounded-2xl max-w-sm mx-auto shadow-sm">
                                            <XCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
                                            <p className="text-red-700 dark:text-red-400 font-bold text-sm mb-1 uppercase tracking-tight">Analysis Failed</p>
                                            <p className="text-xs text-red-600/80 dark:text-red-400/60 leading-tight mb-4 italic">
                                                {application.failure_reason || "Unknown error during parsing. Please check file format and retry."}
                                            </p>
                                            <Button 
                                                variant="outline" 
                                                size="sm" 
                                                onClick={handleRetryAnalysis} 
                                                disabled={actionLoading === 'retry'}
                                                className="w-full bg-white dark:bg-slate-900 border-red-200 hover:bg-red-50 font-bold transition-all shadow-sm"
                                            >
                                                {actionLoading === 'retry' ? (
                                                    <><RotateCw className="h-3 w-3 mr-2 animate-spin" /> Retrying...</>
                                                ) : 'Retry Analysis Now'}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-center py-10 space-y-4">
                                        <RotateCw className={`h-8 w-8 text-slate-300 mx-auto ${actionLoading === 'retry' ? 'animate-spin' : ''}`} />
                                        <p className="text-muted-foreground font-medium text-sm">No resume analysis yet.</p>
                                        <Button variant="outline" size="sm" onClick={handleRetryAnalysis} disabled={actionLoading === 'retry'}>Retry Analysis</Button>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* ─── Interview Report ─── */}
                        <Card className="bg-card/45 backdrop-blur-xl border border-border/80 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.02)] h-full flex flex-col pt-0 overflow-hidden">
                            <CardHeader className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/40 pt-6 pb-4">
                                <CardTitle className="text-lg flex items-center gap-2 font-bold text-foreground">
                                    <Star className="h-5 w-5 text-amber-500" />
                                    Interview Report
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-2 space-y-6 flex-grow flex flex-col">
                                {report && isInterviewNotCompleted(report) && (
                                    <div className={`p-4 rounded-2xl border-2 mb-2 flex items-start gap-4 animate-in fade-in zoom-in duration-300 ${report.termination_reason ? 'bg-red-50 dark:bg-red-500/10 border-red-100 dark:border-red-500/20 text-red-900 dark:text-red-400' : 'bg-amber-50 dark:bg-amber-500/10 border-amber-100 dark:border-amber-500/20 text-amber-900 dark:text-amber-400'}`}>
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${report.termination_reason ? 'bg-card text-red-600' : 'bg-card text-amber-600'}`}>
                                            <AlertCircle className="w-6 h-6" />
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <p className="text-xs font-black uppercase tracking-widest opacity-70">
                                                    {report.termination_reason ? 'Interview Terminated' : 'Interview Incomplete'}
                                                </p>
                                                <Badge className={`text-[10px] font-bold ${report.termination_reason ? 'bg-red-600' : 'bg-amber-600'}`}>
                                                    ACTION REQUIRED
                                                </Badge>
                                            </div>
                                            <p className="text-sm leading-tight break-all">
                                                {report.termination_reason || 'This candidate abandoned the interview before completion or encountered a critical issue.'}
                                            </p>
                                        </div>
                                    </div>
                                )}
                                {report ? (
                                    <div className="space-y-6 flex-grow">
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="text-center p-3 bg-orange-50/50 dark:bg-orange-500/10 rounded-xl border border-orange-100 dark:border-orange-500/20 flex flex-col items-center justify-center">
                                                <p className="text-2xl font-black text-orange-600 dark:text-orange-400 leading-none">
                                                    {report.overall_score?.toFixed(1) || '0.0'}
                                                </p>
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <div className="flex items-center gap-1 cursor-help mt-1">
                                                                <p className="text-[10px] uppercase font-bold text-orange-500 dark:text-orange-400/70 tracking-wider">Overall</p>
                                                                <Info className="h-2.5 w-2.5 text-orange-400" />
                                                            </div>
                                                        </TooltipTrigger>
                                                        <TooltipContent className="max-w-xs border-orange-200 dark:border-orange-500/30 shadow-xl p-3 bg-background">
                                                            <p className="text-xs font-bold mb-1 text-foreground">Interview Insight</p>
                                                            <p className="text-[11px] leading-relaxed text-foreground/80">
                                                                {(typeof report.reasoning === 'object' && report.reasoning !== null) 
                                                                    ? (report.reasoning.ai_summary || "Composite score derived from technical accuracy, communication, and depth analysis.") 
                                                                    : (report.reasoning || "Composite score derived from technical accuracy, communication, and depth analysis.")}
                                                            </p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            </div>
                                             <div className="text-center p-3 bg-purple-50/50 dark:bg-purple-500/10 rounded-xl border border-purple-100 dark:border-purple-500/20">
                                                <p className="text-2xl font-black text-purple-700 dark:text-purple-400">{report.aptitude_score != null ? report.aptitude_score.toFixed(1) : 'N/A'}</p>
                                                <p className="text-[10px] uppercase font-bold text-purple-500 dark:text-purple-400/70 tracking-wider">Aptitude</p>
                                            </div>
                                            <div className="text-center p-3 bg-blue-50/50 dark:bg-blue-500/10 rounded-xl border border-blue-100 dark:border-blue-500/20">
                                                <p className="text-2xl font-black text-blue-700 dark:text-blue-400">{report.technical_skills_score != null ? report.technical_skills_score.toFixed(1) : 'N/A'}</p>
                                                <p className="text-[10px] uppercase font-bold text-blue-500 dark:text-blue-400/70 tracking-wider">Technical</p>
                                            </div>
                                            <div className="text-center p-3 bg-emerald-50/50 dark:bg-emerald-500/10 rounded-xl border border-emerald-100 dark:border-emerald-500/20">
                                                <p className="text-2xl font-black text-emerald-700 dark:text-emerald-400">{report.communication_score != null ? report.communication_score.toFixed(1) : 'N/A'}</p>
                                                <p className="text-[10px] uppercase font-bold text-emerald-500 dark:text-emerald-400/70 tracking-wider">Communication</p>
                                            </div>
                                        </div>
                                        {report.recommendation && (
                                            <div className="p-4 bg-muted/30 rounded-xl border border-border/50 text-center">
                                                <h4 className="font-bold text-xs mb-2 text-muted-foreground uppercase tracking-widest">Recommendation</h4>
                                                {(() => {
                                                    const rec = normalizeHireRecommendation(report.recommendation)
                                                    return (
                                                        <div className="space-y-1">
                                                            <Badge className={`${rec.badgeClass} px-6 py-1.5 text-xs font-black uppercase tracking-widest`}>
                                                                {rec.label}
                                                            </Badge>
                                                            {rec.kind === "unknown" ? null : (
                                                                <p className="text-[10px] text-muted-foreground line-clamp-2" title={report.recommendation}>
                                                                    {report.recommendation.replace(/_/g, " ")}
                                                                </p>
                                                            )}
                                                        </div>
                                                    )
                                                })()}
                                            </div>
                                        )}
                                        <div className="mt-auto pt-4">
                                            <Button variant="default" className="w-full h-11 font-bold shadow-md bg-slate-800 dark:bg-primary dark:text-primary-foreground hover:bg-slate-900 dark:hover:bg-primary/90 rounded-xl group" onClick={() => router.push(`/dashboard/hr/reports?search=${encodeURIComponent(application.candidate_name)}&reportId=${report.id}`)}>
                                                View Detailed Report <Eye className="ml-2 h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-12 text-center space-y-3 flex-grow">
                                        <Clock className="h-8 w-8 text-slate-300" />
                                        <p className="text-muted-foreground font-medium text-sm">Report available after completion.</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                </div>

                {/* ─── Sidebar (Right) ─── */}
                <div className="space-y-6">
                    {!isTerminal && buttons.length > 0 && (
                        <Card className="bg-card/60 backdrop-blur-md rounded-2xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden pt-0">
                            <CardHeader className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/40 pt-6 pb-4">
                                <CardTitle className="text-lg font-bold">Pipeline Actions</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {buttons.map((btn, idx) => (
                                    btn.action === 'reject' ? (
                                        <RejectDialog
                                            key={idx}
                                            candidateName={application.candidate_name || 'Candidate'}
                                            onConfirm={handleReject}
                                            trigger={
                                                <Button variant="ghost" className="w-full h-12 justify-start gap-3 font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl active:scale-[0.985] transition-all" disabled={actionLoading !== null}>
                                                    <XCircle className="h-5 w-5" /> {actionLoading === 'reject' ? 'Rejecting...' : 'Reject Candidate'}
                                                </Button>
                                            }
                                        />
                                    ) : (
                                        <Button
                                            key={idx}
                                            className={`w-full h-12 justify-start gap-3 rounded-xl transition-all active:scale-[0.985] ${btn.className}`}
                                            disabled={
                                                actionLoading !== null ||
                                                (btn.action === 'approve_for_interview' && !canApproveResume)
                                            }
                                            title={
                                                btn.action === 'approve_for_interview' && !canApproveResume
                                                    ? 'Resume analysis must finish successfully before approving for interview.'
                                                    : undefined
                                            }
                                            onClick={() => handleTransition(btn.action)}
                                        >
                                            {btn.icon}
                                            <span className="font-bold uppercase tracking-wider text-xs">{actionLoading === btn.action ? 'Processing...' : btn.label}</span>
                                        </Button>
                                    )
                                ))}
                            </CardContent>
                        </Card>
                    )}

                    {/* ─── HR Notes ─── */}
                    <Card className="bg-card/60 backdrop-blur-md rounded-2xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden pt-0">
                        <CardHeader className="flex flex-row items-center justify-between bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border-b border-border/40 pt-6 pb-4">
                            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">HR Notes</CardTitle>
                            {!isEditingNotes && <Button variant="ghost" size="sm" className="active:scale-[0.98]" onClick={() => setIsEditingNotes(true)}><Edit2 className="h-4 w-4" /></Button>}
                        </CardHeader>
                        <CardContent className="pb-5">
                            {isEditingNotes ? (
                                <div className="space-y-3">
                                    <Textarea value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} placeholder="Add notes..." className="min-h-[120px] bg-background/50 border border-input rounded-xl hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200" />
                                    <div className="flex justify-end gap-2">
                                        <Button size="sm" variant="ghost" onClick={() => { setIsEditingNotes(false); setNotesDraft(application.hr_notes || "") }}>Cancel</Button>
                                        <Button size="sm" onClick={handleSaveNotes} className="bg-amber-500 hover:bg-amber-600 text-white">Save</Button>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{application.hr_notes || "No notes yet."}</p>
                            )}
                        </CardContent>
                    </Card>

                    {/* ─── Terminal / Onboarding State Banner ─── */}
                    {(isTerminal || isHiredPipeline) && (
                        <div className="space-y-4">
                            {currentStatus === 'rejected' ? (
                                <Card className="border-2 shadow-sm bg-red-50 border-red-200">
                                    <CardContent className="py-8 text-center space-y-2">
                                        <p className="text-2xl font-black text-red-700">❌ APPLICATION REJECTED</p>
                                    </CardContent>
                                </Card>
                            ) : (
                                <Card className={`border-2 shadow-sm ${currentStatus === 'onboarded' ? 'bg-slate-800 border-slate-900 text-white' : 'bg-emerald-50 border-emerald-200'}`}>
                                    <CardContent className="py-8 text-center space-y-2">
                                        <p className={`text-2xl font-black ${currentStatus === 'onboarded' ? 'text-white' : 'text-emerald-700'}`}>
                                            {currentStatus === 'onboarded' ? '🏁 ONBOARDING COMPLETED' : '🎉 CANDIDATE HIRED'}
                                        </p>
                                        {application.joining_date && (
                                            <p className={`text-sm font-bold ${currentStatus === 'onboarded' ? 'text-slate-300' : 'text-emerald-600'}`}>
                                                Joining Date: {new Date(application.joining_date).toLocaleDateString()}
                                            </p>
                                        )}
                                    </CardContent>
                                </Card>
                            )}

                            {currentStatus === 'hired' && (
                                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-center space-y-3">
                                    <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 mx-auto">
                                        <ShieldAlert className="h-5 w-5" />
                                    </div>
                                    <p className="text-sm font-bold text-emerald-800 uppercase tracking-tight">Hired & Ready for Onboarding</p>
                                    <p className="text-xs text-emerald-600">The next step is to issue the offer letter. Please visit the Onboarding page to complete this process.</p>
                                    <Button 
                                        variant="outline" 
                                        className="w-full text-emerald-700 border-emerald-300 hover:bg-emerald-100 font-bold"
                                        onClick={() => router.push('/dashboard/onboarding')}
                                    >
                                        Go to Onboarding Pipeline
                                    </Button>
                                </div>
                            )}

                            {application.status === 'pending_approval' && (
                                <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-center space-y-3">
                                    <ShieldAlert className="h-8 w-8 text-amber-500 mx-auto" />
                                    <p className="text-sm font-bold text-amber-800">Pending Admin Approval</p>
                                    <p className="text-xs text-amber-600">The offer letter is staged. Waiting for a Super Admin to approve and dispatch the email.</p>
                                </div>
                            )}

                            {application.status === 'offer_sent' && (
                                <Card className="border shadow-sm bg-blue-50/50">
                                    <CardContent className="py-4 flex items-center gap-3">
                                        <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                                            <Send className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-blue-800 uppercase tracking-tight">Offer Letter Sent</p>
                                            <p className="text-xs text-blue-600">Awaiting candidate response via token link.</p>
                                        </div>
                                    </CardContent>
                                </Card>
                            )}

                            {application.status === 'accepted' && (
                                <div className="space-y-3">
                                    <div className="p-4 bg-emerald-500 text-white rounded-2xl text-center flex items-center justify-center gap-3 shadow-lg">
                                        <CheckCircle2 className="h-6 w-6" />
                                        <span className="font-black text-sm uppercase tracking-widest">Offer Accepted!</span>
                                    </div>
                                    <Button 
                                        className="w-full h-12 bg-slate-900 hover:bg-black text-white rounded-xl font-bold"
                                        onClick={() => handleTransition('onboard')}
                                    >
                                        Complete Onboarding
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
