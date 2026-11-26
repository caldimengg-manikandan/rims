'use client'

import React from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import useSWR from 'swr'
import { fetcher } from '@/app/dashboard/lib/swr-fetcher'
import { getApiBaseUrl } from '@/lib/config'
import { 
    Award, 
    FileText, 
    Brain, 
    MessageSquare, 
    User, 
    Mail, 
    Briefcase,
    Star,
    CheckCircle2,
    XCircle,
    Info,
    Clock,
    LucideIcon
} from 'lucide-react'

interface PipelineStage {
    id: number
    stage_name: string
    stage_status: string
    score?: number
}

interface InterviewReport {
    communication_score?: number
    strengths?: string
    weaknesses?: string
    status?: string
    ai_used?: boolean
    fallback_used?: boolean
}

interface ApplicationScorecard {
    candidate_name: string
    candidate_email: string
    job: { title: string }
    recommendation?: string
    composite_score?: number
    resume_score?: number
    aptitude_score?: number
    interview_score?: number
    candidate_photo_path?: string
    photo_url?: string | null
    hr_notes?: string
    pipeline_stages?: PipelineStage[]
    interview?: { id: number; status: string }
}

interface ScoreItemProps {
    label: string
    score: number
    icon: LucideIcon
    colorClass?: string
}

export default function CandidateScorecardPage() {
    const params = useParams()
    const applicationId = params.id as string

    const { data: application, isLoading: appLoading } = useSWR<ApplicationScorecard>(`/api/applications/${applicationId}`, (url: string) => fetcher<ApplicationScorecard>(url))
    
    // We can also fetch report for more details
    const { data: report, isLoading: reportLoading } = useSWR<InterviewReport>(
        application?.interview?.status === 'completed' ? `/api/interviews/${application.interview.id}/report` : null,
        (url: string) => fetcher<InterviewReport>(url)
    )

    if (appLoading) return (
        <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 animate-in fade-in duration-500">
            <div className="relative">
                <div className="animate-spin rounded-full h-16 w-16 border-4 border-primary/20 border-t-primary shadow-lg"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                    <Award className="h-6 w-6 text-primary animate-pulse" />
                </div>
            </div>
            <p className="text-sm font-bold text-muted-foreground animate-pulse tracking-widest uppercase mt-2">Loading Scorecard...</p>
        </div>
    )
    if (!application) return <div className="p-12 text-center text-destructive">Candidate not found</div>

    const getRecommendationColor = (rec?: string) => {
        switch (rec?.toLowerCase()) {
            case 'strong hire': return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20'
            case 'hire': return 'text-primary bg-primary/10 border-primary/20'
            case 'borderline': return 'text-amber-500 bg-amber-500/10 border-amber-500/20'
            case 'reject': return 'text-destructive bg-destructive/10 border-destructive/20'
            default: return 'text-muted-foreground bg-muted/10 border-border'
        }
    }

    const ScoreItem = ({ label, score, icon: Icon, colorClass = "text-primary" }: ScoreItemProps) => (
        <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
                <div className="flex items-center gap-2 font-medium">
                    <Icon className={`w-4 h-4 ${colorClass}`} />
                    {label}
                </div>
                <span className="font-bold">{score || 0}/100</span>
            </div>
            <Progress value={score || 0} className="h-2" />
        </div>
    )

    return (
        <div className="p-8 max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-top-4 duration-1000">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row justify-between items-start gap-6 border-b border-border pb-8">
                <div className="flex items-center gap-6">
                    <Avatar className="h-24 w-24 ring-4 ring-background shadow-2xl border-2 border-border/50">
                        <AvatarImage
                            src={application.photo_url
                                || (application.candidate_photo_path
                                    ? (application.candidate_photo_path.startsWith('http')
                                        ? application.candidate_photo_path
                                        : `${getApiBaseUrl()}/${application.candidate_photo_path.replace(/\\/g, '/')}`)
                                    : undefined)}
                            alt={application.candidate_name}
                            className="object-cover"
                        />
                        <AvatarFallback className="text-3xl font-black bg-gradient-to-br from-primary/20 to-primary/40">
                            {application.candidate_name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                    </Avatar>
                    <div>
                        <h1 className="text-4xl font-extrabold tracking-tight text-foreground">{application.candidate_name}</h1>
                        <div className="flex flex-wrap items-center gap-4 mt-2 text-muted-foreground">
                            <span className="flex items-center gap-1.5 text-sm"><Mail className="w-4 h-4" /> {application.candidate_email}</span>
                            <span className="flex items-center gap-1.5 text-sm"><Briefcase className="w-4 h-4" /> {application.job.title}</span>
                        </div>
                    </div>
                </div>
                <div className="flex flex-col items-end gap-3 self-center md:self-start">
                    <div className="text-center md:text-right">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Final Assessment</p>
                        <Badge className={`text-base px-6 py-1.5 border shadow-sm font-black tracking-wide ${getRecommendationColor(application.recommendation)}`}>
                            {application.recommendation || 'PENDING'}
                        </Badge>
                    </div>
                    <div className="flex items-center gap-2 bg-muted/20 backdrop-blur-md px-4 py-2 rounded-xl border border-border/80 shadow-sm">
                        <Star className="w-5 h-5 text-amber-500 fill-amber-500" />
                        <span className="text-2xl font-black">{application.composite_score?.toFixed(1) || '0.0'}</span>
                        <span className="text-muted-foreground text-xs font-bold uppercase">Points</span>
                    </div>
                </div>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
                {/* Column 1: Core Evaluation Scores */}
                <div className="md:col-span-2 space-y-6">
                    <Card className="bg-card/45 backdrop-blur-xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] rounded-2xl">
                        <CardHeader className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/40 pb-4">
                            <CardTitle className="text-xl flex items-center gap-2">
                                <Award className="w-6 h-6 text-primary" />
                                Recruitment Performance
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="grid sm:grid-cols-2 gap-x-12 gap-y-8 py-6">
                            <ScoreItem 
                                label="Resume Compatibility" 
                                score={application.resume_score ? (application.resume_score <= 10 ? application.resume_score * 10 : application.resume_score) : 0} 
                                icon={FileText} 
                            />
                            <ScoreItem 
                                label="Aptitude Test" 
                                score={application.aptitude_score || 0} 
                                icon={Brain} 
                                colorClass="text-accent"
                            />
                            <ScoreItem 
                                label="Interview Performance" 
                                score={application.interview_score || 0} 
                                icon={MessageSquare} 
                                colorClass="text-secondary"
                            />
                            <ScoreItem 
                                label="Communication Skills" 
                                score={report?.communication_score ? report.communication_score * 10 : 0} 
                                icon={User} 
                                colorClass="text-blue-500"
                            />
                        </CardContent>
                    </Card>

                    {/* AI Insights & Feedback */}
                    <Card className="bg-card/45 backdrop-blur-xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] rounded-2xl">
                        <CardHeader className="flex flex-row items-center justify-between border-b border-border/40 pb-4">
                            <CardTitle className="text-xl flex items-center gap-2">
                                <Info className="w-5 h-5 text-primary" />
                                AI Evaluation Feedback
                            </CardTitle>
                            {report && report.fallback_used && (
                                <Badge variant="outline" className="text-amber-500 border-amber-500 bg-amber-500/10 text-xs font-bold px-2 py-0.5">
                                    Heuristic Fallback (AI Error)
                                </Badge>
                            )}
                            {report && !report.ai_used && !report.fallback_used && (
                                <Badge variant="outline" className="text-muted-foreground text-xs font-bold px-2 py-0.5">
                                    Manual / No AI
                                </Badge>
                            )}
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {report ? (
                                <>
                                    <div className="bg-muted/30 p-4 rounded-xl border border-border">
                                        <h4 className="text-sm font-bold flex items-center gap-2 mb-2 uppercase tracking-wide">
                                            <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Key Strengths
                                        </h4>
                                        <p className="text-sm text-foreground leading-relaxed italic">
                                            {report.strengths || 'Analyzing candidate strengths...'}
                                        </p>
                                    </div>
                                    <div className="bg-muted/30 p-4 rounded-xl border border-border">
                                        <h4 className="text-sm font-bold flex items-center gap-2 mb-2 uppercase tracking-wide">
                                            <XCircle className="w-4 h-4 text-destructive" /> Areas for Improvement
                                        </h4>
                                        <p className="text-sm text-foreground leading-relaxed italic">
                                            {report.weaknesses || 'Analyzing candidate weaknesses...'}
                                        </p>
                                    </div>
                                </>
                            ) : (
                                <div className="text-center py-12 text-muted-foreground bg-muted/10 rounded-xl border border-dashed border-border">
                                    <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                    <p className="text-sm">Detailed feedback becomes available once the AI interview is completed.</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Column 2: Metadata & Pipeline */}
                <div className="space-y-6">
                    <Card className="bg-card/45 backdrop-blur-xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] rounded-2xl">
                        <CardHeader className="border-b border-border/40 pb-4">
                            <CardTitle className="text-lg">Pipeline Status</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {application.pipeline_stages?.map((stage: PipelineStage, idx: number) => (
                                <div key={stage.id} className="flex items-start gap-3">
                                    <div className={`mt-1 h-3 w-3 rounded-full shrink-0 ${
                                        stage.stage_status === 'pass' ? 'bg-emerald-500' : 
                                        stage.stage_status === 'fail' ? 'bg-destructive' : 'bg-muted-foreground animate-pulse'
                                    }`} />
                                    <div className="flex-1">
                                        <p className="text-xs font-bold leading-none">{stage.stage_name}</p>
                                        <p className="text-[10px] text-muted-foreground mt-0.5">{stage.stage_status.toUpperCase()}</p>
                                    </div>
                                    {stage.score !== null && stage.score !== undefined && <span className="text-[10px] font-bold">{stage.score}</span>}
                                </div>
                            ))}
                            {(!application.pipeline_stages || application.pipeline_stages.length === 0) && (
                                <p className="text-xs text-muted-foreground italic">No pipeline data recorded yet.</p>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="bg-primary/[0.02] backdrop-blur-xl border border-primary/20 shadow-[0_8px_30px_rgb(0,0,0,0.02)] rounded-2xl">
                        <CardHeader className="border-b border-primary/10 pb-4">
                            <CardTitle className="text-lg">Recruiter Remarks</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm italic text-muted-foreground">
                                {application.hr_notes || 'No manual notes added yet.'}
                            </p>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
