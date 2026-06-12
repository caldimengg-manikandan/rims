'use client'

import React, { useState, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Slider } from "@/components/ui/slider"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { useSearchParams } from 'next/navigation'
import { MonitoringReviewer } from '@/components/reports/MonitoringReviewer'
import { ReportFilters, AppliedFilters } from '@/components/reports/ReportFilters'
import { ReportDashboard } from '@/components/reports/ReportDashboard'

// MUI Imports for Date Pickers
import dayjs, { Dayjs } from 'dayjs'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { PickerDay } from '@mui/x-date-pickers'
import type { PickerDayProps } from '@mui/x-date-pickers'
import { Box } from '@mui/material'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import useSWR, { mutate } from 'swr'
import { fetcher } from '@/app/dashboard/lib/swr-fetcher'
import { APIClient } from '@/app/dashboard/lib/api-client'
import { getApiBaseUrl } from '@/lib/config'
import { toast } from 'sonner'
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer
} from 'recharts'
import { Download, FileText, Filter, Search, AlertCircle, CheckCircle2, XCircle, RotateCcw, Activity, Video, CameraOff, BarChart, ChevronLeft, ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { cn } from '@/app/dashboard/lib/utils'

import { StatusChart, DetailedMetricsChart, SkillProficiencyChart } from '@/components/reports/Charts'
import { MetricCard } from '@/components/reports/MetricCard'
import { ReportCard } from '@/components/reports/ReportCard'
import { CategoryScoreCard } from '@/components/reports/CategoryScoreCard'
import {
  isAnswerEmpty,
  getDisplayedQuestionScore,
  isInterviewNotCompleted,
  isProgressionAllZeros,
  isRadarAllZeros,
} from '@/components/reports/interviewIncomplete'
import { getRecommendationLabel, getRecommendationColor } from '@/lib/recommendation-label'

// Constants
const SKILL_CATEGORIES = [
  "backend", "business_analyst", "business_intelligence", "CAE-MECHANICAL",
  "customer_support", "cybersecurity", "data_analysis", "database_admin",
  "devops", "digital_marketing", "electrical", "embedded_systems",
  "finance_accounting", "frontend", "fullstack", "generative_ai",
  "graphic_design", "healthcare_it", "hr", "instrumentation", "legal",
  "mobile", "networking", "project_management", "qa_testing", "sales_crm",
  "Steel_detailing", "ui_ux", "video_editing"
]

// Types
interface Evaluation {
  overall?: number
  relevance?: number
  action_impact?: number
  communication?: number
  coherence?: number
  empathy?: number
  situational_handling?: number
  self_awareness?: number
  technical_accuracy?: number
  completeness?: number
  depth?: number
  strengths?: string[]
  weaknesses?: string[]
}

interface QuestionEvaluation {
  question: string
  answer: string
  evaluation: Evaluation
  question_number?: number
  question_type?: 'technical' | 'behavioral' | 'aptitude'
  correct?: boolean
  score?: number
}

interface CandidateProfile {
  candidate_name?: string
  candidate_email?: string
  applied_role?: string
  experience_level?: string
  primary_skill?: string
  confidence?: string
  communication?: string
  skills?: string[]
}

export interface Report {
  id: string | number
  filename: string
  timestamp: string
  display_date: string
  display_date_short: string
  status: string
  status_color: string
  overall_score: number
  final_score: number
  total_questions_answered: number
  question_evaluations: QuestionEvaluation[]
  candidate_profile: CandidateProfile
  tech_score?: number
  comm_score?: number
  evaluated_skills?: string | null
  aptitude_score?: number | null
  behavioral_score?: number | null
  technical_score?: number | null
  first_level_score?: number | null
  aptitude_question_evaluations?: QuestionEvaluation[]
  aptitude_questions_answered?: number
  video_url?: string | null
  termination_reason?: string | null
  interview_id?: string | number | null
}

// Helper to clean question text that may be stored as JSON array strings
function cleanQuestionText(text: string): string {
  if (!text) return '';
  let cleaned = text.trim();
  // Strip JSON array brackets: ["question text"] → question text
  if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length > 0) {
        cleaned = parsed[0];
      }
    } catch {
      // Not valid JSON array, try manual strip
      cleaned = cleaned.slice(1, -1).trim();
    }
  }
  // Strip surrounding quotes
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }
  return cleaned.trim();
}

export default function ReportsPage() {

  const searchParams = useSearchParams()
  const urlReportId = searchParams.get('reportId')
  const urlSearch = searchParams.get('search')

  // Pagination & Filter State
  const [reportsPage, setReportsPage] = useState(1);
  const [reportsPerPage, setReportsPerPage] = useState(10);
  const [activeTab, setActiveTab] = useState('detailed');
  const [hideStats, setHideStats] = useState(false);

  // Applied state for manual triggering
  const [appliedFilters, setAppliedFilters] = useState<AppliedFilters>({
    search: urlSearch || '',
    status: 'All',
    job: 'All',
    skill: 'All',
    experience: 'All',
    score: [0, 10],
    from: null,
    to: null,
    date: undefined
  })



  const reportsFilterQueryString = useMemo(() => {
    const q = new URLSearchParams();
    if (appliedFilters.status !== "All") q.set("status", appliedFilters.status);
    if (appliedFilters.job !== "All") q.set("job_id", appliedFilters.job);
    if (appliedFilters.skill !== "All") q.set("skill", appliedFilters.skill);
    if (appliedFilters.experience !== "All") q.set("experience", appliedFilters.experience);
    if (appliedFilters.search) q.set("search", appliedFilters.search);
    if (appliedFilters.score[0] > 0) q.set("score_min", String(appliedFilters.score[0]));
    if (appliedFilters.score[1] < 10) q.set("score_max", String(appliedFilters.score[1]));

    const { from, to, date } = appliedFilters;
    const hasValidRange = from && to ? !from.isAfter(to, "day") : true;
    if (from && hasValidRange) q.set("from_date", from.format("YYYY-MM-DD"));
    if (to && hasValidRange) q.set("to_date", to.format("YYYY-MM-DD"));
    if (date && !from && !to) {
      const d = dayjs(date).format("YYYY-MM-DD");
      q.set("from_date", d);
      q.set("to_date", d);
    }
    return q.toString();
  }, [appliedFilters]);

  const reportsApiUrl = useMemo(() => {
    const q = new URLSearchParams(reportsFilterQueryString);
    q.set("limit", String(reportsPerPage));
    q.set("skip", String((reportsPage - 1) * reportsPerPage));
    return `/api/analytics/reports?${q.toString()}`;
  }, [reportsPage, reportsPerPage, reportsFilterQueryString]);

  const heatmapApiUrl = useMemo(() => {
    return `/api/analytics/reports/heatmap?${reportsFilterQueryString}`;
  }, [reportsFilterQueryString]);

  const { data: reportsResponse, error: fetchError, isLoading: isSWRDashboardLoading } = useSWR<{ reports: Report[], total: number, count: number, failed?: number, pages: number, error?: string, metrics?: { selected: number, hold: number, rejected: number, terminated: number, incomplete: number, avg_score: number, avg_questions: number, total_applied: number, total_finished: number } }>(reportsApiUrl, fetcher)
  const { data: heatmapResponse } = useSWR<{ counts?: Record<string, number>; error?: string }>(heatmapApiUrl, fetcher)

  const rawReports = Array.isArray(reportsResponse)
    ? reportsResponse
    : (reportsResponse?.reports || []);
  const totalCount = Array.isArray(reportsResponse)
    ? reportsResponse.length
    : (reportsResponse?.total ?? rawReports.length ?? 0);
  const totalPages = Array.isArray(reportsResponse)
    ? Math.ceil((reportsResponse.length || 0) / reportsPerPage)
    : (reportsResponse?.pages ?? Math.ceil(((reportsResponse?.total ?? 0) / reportsPerPage)));



  const reports = useMemo(() => {
    const processed = rawReports.map(report => {
      let techSum = 0, behSum = 0;
      let techCount = 0, behCount = 0;

      const allQ = [...(report?.question_evaluations || []), ...(report?.aptitude_question_evaluations || [])];

      allQ.forEach(q => {
        const score = q?.evaluation?.overall ?? q?.score ?? 0;
        const qType = (q?.question_type || "technical").toLowerCase();

        if (qType === 'behavioral') {
          behSum += score;
          behCount++;
        } else if (qType === 'technical') {
          techSum += score;
          techCount++;
        }
      });

      // Aptitude Calculation
      const aptQty = report?.aptitude_question_evaluations?.length || 0;
      const aptCorrect = report?.aptitude_question_evaluations?.filter((q: QuestionEvaluation) => q.correct).length || 0;
      const aptScore = aptQty > 0 ? (aptCorrect / aptQty) * 10 : report?.aptitude_score;

      return {
        ...report,
        tech_score: techCount > 0 ? techSum / techCount : report?.tech_score,
        behavioral_score: behCount > 0 ? behSum / behCount : report?.behavioral_score,
        aptitude_score: aptScore,
      };
    });


    return processed;
  }, [rawReports])



  // Contract Validation Warning
  React.useEffect(() => {
    if (reportsResponse && !Array.isArray(reportsResponse) && !reportsResponse.reports) {
      console.warn("[REPORTS] API Contract Violation: Response missing 'reports' array.", reportsResponse);
    }
  }, [reportsResponse]);


  const getStatusColor = (status: string) => {
    switch (status) {
      case 'hired': return 'bg-primary/10 text-primary border-primary/20'
      case 'rejected': return 'bg-destructive/10 text-destructive border-destructive/20'
      case 'review_later': return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
      case 'interview_scheduled':
      case 'approved_for_interview': return 'bg-accent/10 text-accent border-accent/20'
      case 'interview_completed': return 'bg-secondary/10 text-secondary border-secondary/20'
      default: return 'bg-muted text-muted-foreground border-border'
    }
  }

  const getStatusLabel = (status: string) => {
    return status?.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') || status
  }

  // ONLY show the full page spinner on the very FIRST load when we have no data at all.
  // Subsequent re-fetches (filters) will show the existing data while loading in the background (SWR behavior).
  const isInitialLoading = isSWRDashboardLoading && !reportsResponse
  const [selectedQuestion, setSelectedQuestion] = useState<QuestionEvaluation | null>(null)
  const [viewingReport, setViewingReport] = useState<Report | null>(null)
  const [reportView, setReportView] = useState<'technical' | 'aptitude' | 'behavioral'>('technical');

  // Effect to auto-open report if reportId is in URL
  React.useEffect(() => {
    if (urlReportId && reports.length > 0) {
      const reportToView = reports.find(r =>
        String(r.id) === String(urlReportId) ||
        r.filename.includes(String(urlReportId))
      );
      if (reportToView) {
        setViewingReport(reportToView);
      }
    }
  }, [urlReportId, reports]);

  // Derived Data for Filters (Fetch from all reports for heatmap if needed, but for now we use what we have)
  const { data: allJobsData } = useSWR<any[]>('/api/jobs?limit=500', fetcher);


  const [isExportingCsv, setIsExportingCsv] = useState(false)

  // Derived interview counts for calendar heatmap (from lightweight API)
  const interviewCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    const apiCounts = heatmapResponse?.counts || {}
    Object.entries(apiCounts).forEach(([isoDay, count]) => {
      const date = new Date(`${isoDay}T12:00:00`)
      if (!isNaN(date.getTime())) {
        const dateStr = date.toDateString()
        counts[dateStr] = (counts[dateStr] || 0) + count
      }
    })
    return counts
  }, [heatmapResponse])



  // Since filtering is now server-side, filteredReports is just reports
  const filteredReports = reports;

  // Metrics
  const metrics = useMemo(() => {
    const total = reportsResponse?.total || reports.length;

    // Use server-provided metrics if available (accurate across all pages)
    if (reportsResponse && 'metrics' in reportsResponse && reportsResponse.metrics) {
      const apiMetrics = reportsResponse.metrics;
      return {
        total: reportsResponse.total || 0,
        selected: apiMetrics.selected || 0,
        hold: apiMetrics.hold || 0,
        rejected: apiMetrics.rejected || 0,
        terminated: apiMetrics.terminated || 0,
        incomplete: apiMetrics.incomplete || 0,
        avgScore: apiMetrics.avg_score.toFixed(2) || '0.00',
        avgQuestions: apiMetrics.avg_questions.toFixed(1) || '0.0',
        totalApplied: apiMetrics.total_applied || 0,
        totalFinished: apiMetrics.total_finished || 0,
      };
    }

    let selectedCount = 0;
    let holdCount = 0;
    let rejectedCount = 0;
    let terminatedCount = 0;
    let incompleteCount = 0;

    filteredReports.forEach((r: Report) => {
      if (r.termination_reason) {
        terminatedCount++;
      } else if (isInterviewNotCompleted(r as any)) {
        incompleteCount++;
      } else {
        const label = getRecommendationLabel(Number(r?.overall_score || 0));
        if (label === 'Select') selectedCount++;
        else if (label === 'Consider') holdCount++;
        else rejectedCount++;
      }
    });

    const avgScore = total > 0 ? (filteredReports.reduce((acc: number, r: Report) => acc + Number(r?.overall_score || 0), 0) / (filteredReports.length || 1)).toFixed(2) : '0.00'
    const avgQuestions = total > 0 ? (filteredReports.reduce((acc: number, r: Report) => acc + (r?.total_questions_answered || 0), 0) / (filteredReports.length || 1)).toFixed(1) : '0.0'

    return { total, selected: selectedCount, hold: holdCount, rejected: rejectedCount, terminated: terminatedCount, incomplete: incompleteCount, avgScore, avgQuestions, totalApplied: 0, totalFinished: 0 }
  }, [filteredReports, reportsResponse])

  const applyFilters = (newFilters: AppliedFilters) => {
    setAppliedFilters(newFilters)
    setReportsPage(1)
  }

  const removeAppliedFilter = (key: keyof AppliedFilters) => {
    setAppliedFilters(prev => {
      const updated = { ...prev }
      if (key === 'search') updated.search = ''
      else if (key === 'status') updated.status = 'All'
      else if (key === 'job') updated.job = 'All'
      else if (key === 'skill') updated.skill = 'All'
      else if (key === 'experience') updated.experience = 'All'
      else if (key === 'score') updated.score = [0, 10]
      else if (key === 'from') updated.from = null
      else if (key === 'to') updated.to = null
      else if (key === 'date') updated.date = undefined
      return updated
    })
    setReportsPage(1)
  }

  // Chart Data for Report Modal
  const radarData = useMemo(() => {
    if (!viewingReport) return [];
    let tech = 0, depthScore = 0, completenessScore = 0;
    let count = viewingReport.question_evaluations?.length || 1;

    viewingReport.question_evaluations?.forEach(q => {
      tech += q.evaluation?.technical_accuracy || 0;
      depthScore += q.evaluation?.depth || 0;
      completenessScore += q.evaluation?.completeness || 0;
    });

    return [
      { subject: 'Technical', A: tech / count, fullMark: 10 },
      { subject: 'Depth', A: depthScore / count, fullMark: 10 },
      { subject: 'Completeness', A: completenessScore / count, fullMark: 10 },
    ];
  }, [viewingReport]);

  const lineData = useMemo(() => {
    if (!viewingReport) return [];
    return viewingReport.question_evaluations?.map((q) => ({
      name: `Q${(q as any).question_number || '?'}`,
      Tech: q.evaluation?.technical_accuracy || 0,
    })) || [];
  }, [viewingReport]);

  const interviewNotCompleted = useMemo(
    () => (viewingReport ? isInterviewNotCompleted(viewingReport) : false),
    [viewingReport]
  );

  const progressionShowsPlaceholder = interviewNotCompleted || isProgressionAllZeros(lineData);
  const radarShowsPlaceholder = interviewNotCompleted || isRadarAllZeros(radarData);

  // Generate Text Report
  const generateTextReport = (report: Report) => {
    let text = `============================================================\n`
    text += `VIRTUAL HR INTERVIEWER - CANDIDATE REPORT\n`
    text += `============================================================\n\n`

    text += `Report Generated: ${report.display_date}\n`
    text += `Total Questions: ${report.total_questions_answered}\n`
    text += `Overall Score: ${report.overall_score.toFixed(2)}/10\n`
    text += `Status: ${report.status}\n\n`

    text += `CANDIDATE PROFILE\n`
    text += `----------------------------------------\n`
    text += `Name: ${report.candidate_profile.candidate_name || 'N/A'}\n`
    text += `Email: ${report.candidate_profile.candidate_email || 'N/A'}\n`
    text += `Role: ${report.candidate_profile.applied_role || 'N/A'}\n`
    text += `Experience: ${report.candidate_profile.experience_level || 'N/A'}\n`
    text += `Primary Skill: ${report.candidate_profile.primary_skill || 'N/A'}\n`
    text += `Communication: ${report.candidate_profile.communication || 'N/A'}\n\n`

    text += `QUESTION ANALYSIS\n`
    text += `----------------------------------------\n`
    const evaluations = report.question_evaluations || []
    evaluations.forEach((q, i) => {
      const evalData = q.evaluation || {}
      const score = evalData.overall ?? q.score ?? 'N/A'
      text += `\nQuestion ${i + 1}: ${q.question || 'N/A'}\n`
      text += `Score: ${score}/10\n`
      if (evalData.strengths?.length) {
        text += `  Strengths:\n${evalData.strengths.map((s: string) => `    - ${s}`).join('\n')}\n`
      }
      if (evalData.weaknesses?.length) {
        text += `  Weaknesses:\n${evalData.weaknesses.map((w: string) => `    - ${w}`).join('\n')}\n`
      }
    })

    return text
  }

  const downloadCSV = async () => {
    setIsExportingCsv(true)
    try {
      const filename = `interview_reports_${new Date().toISOString().split('T')[0]}.csv`
      await APIClient.downloadFile(`/api/analytics/reports/export?${reportsFilterQueryString}`, filename)
      toast.success(`Exported up to ${totalCount} matching report(s)`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Export failed'
      toast.error(msg)
    } finally {
      setIsExportingCsv(false)
    }
  }

  const downloadFile = (content: string, filename: string, type: 'json' | 'txt' | 'csv') => {
    let mimeType = 'text/plain'
    if (type === 'json') mimeType = 'application/json'
    if (type === 'csv') mimeType = 'text/csv'

    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const clearAllFilters = () => {
    setAppliedFilters({
      search: '',
      status: 'All',
      job: 'All',
      skill: 'All',
      experience: 'All',
      score: [0, 10],
      from: null,
      to: null,
      date: undefined
    })
    setReportsPage(1)
  }

  if (isInitialLoading) {
    return (
      <div className="flex justify-center items-center h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="h-14 w-14 rounded-full border-4 border-primary/20"></div>
            <div className="absolute inset-0 h-14 w-14 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
          </div>
          <p className="text-sm text-muted-foreground font-medium animate-pulse">Loading reports...</p>
        </div>
      </div>
    )
  }

  const apiErrorMessage =
    (!Array.isArray(reportsResponse) && reportsResponse?.error) || null

  if (fetchError || apiErrorMessage) {
    return (
      <div className="p-8">
        <div className="bg-destructive/10 text-destructive p-5 rounded-2xl border border-destructive/20 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <h3 className="font-bold text-base">Error Loading Reports</h3>
          </div>
          <p className="text-sm text-destructive/80">{fetchError?.message || apiErrorMessage || 'An error occurred while fetching reports.'}</p>
          <Button onClick={() => mutate(reportsApiUrl)} variant="outline" className="w-fit gap-2 border-destructive/30 hover:bg-destructive/10 text-destructive">Retry</Button>
        </div>
      </div>
    )
  }

  return (
    /*
      Main Layout Container
      - Uses flex-col to stack Header and Grid.
      - On desktop (lg), sets explicit height [100vh - 9rem] to fill remaining space
        (allowing for 4rem header + 4rem layout padding + 1rem safety).
      - 'min-h-0' is crucial for allowing flex children to scroll.
    */
    <div className="w-full flex flex-col gap-4 lg:h-[calc(100vh-7.5rem)]">

      {/* Question Detail Modal */}
      <Dialog open={!!selectedQuestion} onOpenChange={(open) => !open && setSelectedQuestion(null)}>
        <DialogContent className="w-full md:!max-w-[35vw] md:!w-[35vw] max-h-[90vh] overflow-y-auto bg-background/95 backdrop-blur-xl border border-border/80 shadow-[0_20px_50px_rgba(0,0,0,0.15)] p-6 rounded-3xl scrollbar-premium">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">Detailed Question Analysis</DialogTitle>
            <DialogDescription>In-depth review of the candidate's response.</DialogDescription>
          </DialogHeader>

          {selectedQuestion && (
            <div className="space-y-8 mt-4">
              {/* Row 1: Question */}
              <div className="space-y-2">
                <h4 className="text-lg font-bold text-foreground">Question:</h4>
                <p className="text-lg text-foreground bg-muted/20 p-6 rounded-2xl border border-border/50 leading-relaxed">
                  {cleanQuestionText(selectedQuestion.question)}
                </p>
              </div>

              {/* Row 2: Answer */}
              <div className="space-y-2">
                <h4 className="text-lg font-bold text-foreground">Answer:</h4>
                <p className={`text-base bg-muted/20 p-6 rounded-2xl border border-border/50 leading-relaxed whitespace-pre-wrap ${isAnswerEmpty(selectedQuestion.answer) ? 'text-muted-foreground italic' : 'text-foreground'}`}>
                  {isAnswerEmpty(selectedQuestion.answer) ? 'Candidate did not provide an answer.' : selectedQuestion.answer}
                </p>
              </div>

              {/* Row 3 & 4: Category Scores & Overall Score */}
              <div className="grid grid-cols-1 gap-8 items-center bg-card/45 backdrop-blur-xl p-6 rounded-2xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)]">
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-2">Evaluation Scores</h4>
                  {/* Evaluation Details */}
                  <div className={`grid grid-cols-2 ${selectedQuestion.question_type === 'behavioral' ? 'md:grid-cols-2' : 'md:grid-cols-3'} gap-4`}>
                    {(() => {
                      const na = isAnswerEmpty(selectedQuestion.answer)
                      const ev = selectedQuestion.evaluation ?? {}
                      return (selectedQuestion.question_type === 'behavioral') ? (
                        <>
                          <MetricCard title="Relevance" score={ev.relevance ?? ev.communication ?? ev.technical_accuracy ?? 0} notAvailable={na} />
                          <MetricCard title="Action & Impact" score={ev.action_impact ?? ev.situational_handling ?? ev.completeness ?? 0} notAvailable={na} />
                        </>
                      ) : (
                        <>
                          <MetricCard title="Technical Accuracy" score={ev.technical_accuracy ?? 0} notAvailable={na} />
                          <MetricCard title="Completeness" score={ev.completeness ?? 0} notAvailable={na} />
                          <MetricCard title="Depth" score={ev.depth ?? 0} notAvailable={na} />
                        </>
                      )
                    })()}
                  </div>
                </div>
              </div>


              {/* Row 5: Strengths | Areas for Improvement */}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Strengths */}
                <div>
                  <h4 className="text-lg font-bold text-foreground mb-3">Strengths:</h4>
                  <div className="bg-primary/[0.03] border border-primary/15 rounded-2xl p-6 h-full shadow-sm">
                    {selectedQuestion.evaluation.strengths && selectedQuestion.evaluation.strengths.length > 0 ? (
                      <ul className="space-y-3">
                        {selectedQuestion.evaluation.strengths.map((s, idx) => (
                          <li key={idx} className="flex gap-3 text-base text-primary leading-relaxed">
                            <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5 text-primary" />
                            <span>{s}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground italic text-sm">No specific strengths noted.</p>
                    )}
                  </div>
                </div>

                {/* Weaknesses */}
                <div>
                  <h4 className="text-lg font-bold text-foreground mb-3">Areas for Improvement:</h4>
                  <div className="bg-destructive/[0.03] border border-destructive/15 rounded-2xl p-6 h-full shadow-sm">
                    {selectedQuestion.evaluation.weaknesses && selectedQuestion.evaluation.weaknesses.length > 0 ? (
                      <ul className="space-y-3">
                        {selectedQuestion.evaluation.weaknesses.map((w, idx) => (
                          <li key={idx} className="flex gap-3 text-base text-destructive leading-relaxed">
                            <XCircle className="h-5 w-5 shrink-0 mt-0.5 text-destructive" />
                            <span>{w}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground italic text-sm">No specific improvements noted.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/*
              Content Grid
              - 'flex-1 min-h-0' makes it take remaining height and ALLOWS shrinkage/scrolling.
              - On desktop (lg), it's a 4-column grid.
              - On mobile, it stacks naturally.
            */}
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 items-start">
        <ReportFilters
          appliedFilters={appliedFilters}
          onApplyFilters={applyFilters}
          onClearFilters={clearAllFilters}
          allJobsData={allJobsData}
          hideStats={hideStats}
          interviewCounts={interviewCounts}
        />
        <ReportDashboard
          filteredReports={filteredReports}
          metrics={metrics}
          hideStats={hideStats}
          onHideStatsChange={setHideStats}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          reportsPage={reportsPage}
          setReportsPage={setReportsPage}
          reportsPerPage={reportsPerPage}
          setReportsPerPage={setReportsPerPage}
          totalCount={totalCount}
          totalPages={totalPages}
          isExportingCsv={isExportingCsv}
          downloadCSV={downloadCSV}
          setViewingReport={setViewingReport}
          appliedFilters={appliedFilters}
          onRemoveAppliedFilter={removeAppliedFilter}
          onClearFilters={clearAllFilters}
          allJobsData={allJobsData}
        />
      </div>

      {/* FULL VIEW MODAL FOR REPORT */}
      <Dialog open={!!viewingReport} onOpenChange={(open) => !open && setViewingReport(null)}>
        <DialogContent className="w-[80vw] sm:max-w-[80vw] lg:w-[66vw] lg:max-w-[66vw] h-[85vh] lg:h-[80vh] flex flex-col p-6 overflow-hidden bg-background/95 backdrop-blur-xl border border-border/80 shadow-2xl rounded-3xl">
          {viewingReport && (
            <>
              <DialogHeader className="mb-4">
                <div className="flex justify-between items-start gap-4 pr-6">
                  <div className="flex flex-col items-start gap-1">
                    <DialogTitle className="text-2xl flex items-center gap-3 flex-wrap">
                      {viewingReport.candidate_profile.candidate_name || viewingReport.display_date_short}
                      {interviewNotCompleted ? (
                        <Badge className="capsule-badge border-none shadow-none text-sm bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30">
                          Suggestion: Incomplete
                        </Badge>
                      ) : (
                        <>
                          {viewingReport.overall_score > 6 && <Badge className="capsule-badge capsule-badge-success border-none shadow-none text-sm">Suggestion: Select</Badge>}
                          {(viewingReport.overall_score > 4 && viewingReport.overall_score <= 6) && <Badge className="capsule-badge capsule-badge-warning border-none shadow-none text-sm">Suggestion: Hold</Badge>}
                          {viewingReport.overall_score <= 4 && <Badge className="capsule-badge capsule-badge-destructive border-none shadow-none text-sm">Suggestion: Reject</Badge>}
                        </>
                      )}
                    </DialogTitle>
                    <DialogDescription className="text-base text-muted-foreground mt-1">
                      {viewingReport.candidate_profile.applied_role || viewingReport.filename} &middot; {viewingReport.display_date}
                    </DialogDescription>
                    {interviewNotCompleted && (
                      <div
                        role="status"
                        className={`mt-3 w-full rounded-lg border px-4 py-3 text-sm shadow-sm flex items-center gap-3 ${viewingReport.termination_reason
                          ? 'border-red-500/40 bg-red-500/10 text-red-950 dark:text-red-100'
                          : 'border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100'
                          }`}
                      >
                        <AlertCircle className="h-5 w-5 shrink-0" />
                        <div>
                          <p className="font-bold">
                            {viewingReport.termination_reason ? 'Interview Terminated' : 'Interview Incomplete'}
                          </p>
                          <p className="mt-0.5 opacity-90">
                            {viewingReport.termination_reason
                              ? `Reason: ${viewingReport.termination_reason}`
                              : 'The candidate exited or terminated the session before answering questions.'}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-6 items-center mr-4">
                    <div className="text-right border-l pl-6 border-border hidden sm:block">
                      <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Aptitude</div>
                      <div className="font-bold text-2xl text-slate-700 dark:text-slate-200">
                        {viewingReport.aptitude_score !== undefined && viewingReport.aptitude_score !== null ? (
                          <>{viewingReport.aptitude_score.toFixed(1)}<span className="text-sm text-slate-400 font-normal">/10</span></>
                        ) : (
                          <span className="text-2xl font-semibold text-muted-foreground">—</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right border-l pl-6 border-border hidden sm:block">
                      <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Behavioral</div>
                      <div className="font-bold text-2xl text-slate-700 dark:text-slate-200">
                        {viewingReport.behavioral_score !== undefined && viewingReport.behavioral_score !== null ? (
                          <>{viewingReport.behavioral_score.toFixed(1)}<span className="text-sm text-slate-400 font-normal">/10</span></>
                        ) : (
                          <span className="text-2xl font-semibold text-muted-foreground">—</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right border-l pl-6 border-border">
                      <div className="text-xs text-primary/80 uppercase tracking-wider font-semibold">Technical Score</div>
                      <div className="font-bold text-3xl text-primary">{viewingReport.overall_score.toFixed(1)}<span className="text-base text-primary/60 font-normal">/10</span></div>
                    </div>
                  </div>
                </div>
              </DialogHeader>

              <Separator className="mb-2 shrink-0" />

              <div className="flex-1 overflow-y-auto pr-2 space-y-6 pb-6 mt-4 scrollbar-premium">

                {/* Skill Match Section */}
                <div className="bg-primary/5 border border-primary/10 rounded-2xl p-4 animate-in fade-in slide-in-from-top-2 duration-500">
                  <div className="flex flex-col sm:flex-row gap-4 items-start">
                    <div className="flex items-center gap-2 shrink-0 pt-1">
                      <div className="w-1.5 h-6 bg-primary rounded-full" />
                      <span className="text-xs font-black uppercase tracking-widest text-primary/80">Skill Match:</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(() => {
                        try {
                          const rawSkills = viewingReport.candidate_profile.primary_skill || viewingReport.candidate_profile.skills;
                          const skillsArray = typeof rawSkills === 'string' ? JSON.parse(rawSkills) : rawSkills;

                          if (Array.isArray(skillsArray) && skillsArray.length > 0) {
                            return skillsArray.map((skill, i) => (
                              <Badge
                                key={i}
                                variant="secondary"
                                className={`text-[11px] font-bold px-3 py-1 rounded-lg border-none shadow-sm
                                  ${appliedFilters.skill !== 'All' && (skill || '').toLowerCase().includes(appliedFilters.skill.replace('_', ' ').toLowerCase())
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                                  }`}
                              >
                                {skill}
                              </Badge>
                            ));
                          }
                        } catch (e) {
                          // Fallback if not a JSON array
                          if (viewingReport.candidate_profile.primary_skill) {
                            return <Badge variant="secondary" className="bg-primary text-primary-foreground font-bold">{viewingReport.candidate_profile.primary_skill}</Badge>
                          }
                        }
                        return <span className="text-sm text-muted-foreground italic font-medium">No detected skills for this profile.</span>;
                      })()}
                    </div>
                  </div>
                </div>

                {/* Intelligent Frame-Based Monitoring Review */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold flex items-center gap-2 text-blue-600">
                      <Video className="h-5 w-5" />
                      Intelligent Interview Monitoring Timeline
                    </h3>
                  </div>
                  {viewingReport.interview_id ? (
                    <MonitoringReviewer
                      interviewId={Number(viewingReport.interview_id)}
                      videoUrl={viewingReport.video_url}
                    />
                  ) : viewingReport.video_url ? (
                    <div className="bg-slate-900 rounded-2xl overflow-hidden shadow-xl aspect-video relative group">
                      <video
                        key={viewingReport.id}
                        src={viewingReport.video_url?.startsWith('http') ? viewingReport.video_url : `${getApiBaseUrl()}${viewingReport.video_url}`}
                        controls
                        preload="metadata"
                        className="w-full h-full"
                        crossOrigin="use-credentials"
                      />
                    </div>
                  ) : (
                    <div className="bg-muted/30 border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center">
                      <CameraOff className="h-10 w-10 text-muted-foreground/40 mb-3" />
                      <p className="text-sm font-medium text-muted-foreground">No monitoring frames or video recording available for this session.</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">The candidate may have blocked camera access, or recording failed during the interview.</p>
                    </div>
                  )}
                </div>

                {/* Section Score Breakdown */}
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <Activity className="h-5 w-5 text-primary" />
                    Section Score Breakdown
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <CategoryScoreCard title="📊 Aptitude Score" score={viewingReport.aptitude_score ?? undefined} />
                    <CategoryScoreCard
                      title="💻 Technical Score"
                      score={(viewingReport.technical_score ?? viewingReport.tech_score) ?? undefined}
                      showNotAvailable={interviewNotCompleted}
                    />
                    <CategoryScoreCard
                      title="🧠 Behavioral Score"
                      score={viewingReport.behavioral_score ?? undefined}
                      showNotAvailable={interviewNotCompleted}
                    />
                  </div>


                </div>

                <div className="space-y-4 mb-8">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <Activity className="h-5 w-5 text-primary" />
                    Performance Analytics
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                    {/* Chart 1: Evaluation Radar */}
                    <div className="bg-card/45 backdrop-blur-xl border border-border/80 rounded-2xl p-4 h-[250px] shadow-[0_8px_30px_rgb(0,0,0,0.02)] flex flex-col items-center">
                      <span className="text-sm font-semibold text-muted-foreground w-full text-left mb-2">Competency Radar</span>
                      {radarShowsPlaceholder ? (
                        <div className="flex flex-1 w-full items-center justify-center text-center text-sm text-muted-foreground px-4">
                          No data available.
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                            <PolarGrid stroke="var(--border)" />
                            <PolarAngleAxis dataKey="subject" tick={{ fill: 'currentColor', fontSize: 11 }} />
                            <PolarRadiusAxis angle={30} domain={[0, 10]} tick={{ fontSize: 10 }} />
                            <Radar name="Score" dataKey="A" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.6} />
                            <RechartsTooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--border)' }} />
                          </RadarChart>
                        </ResponsiveContainer>
                      )}
                    </div>

                    {/* Chart 2: Tech Progression Line */}
                    <div className="bg-card/45 backdrop-blur-xl border border-border/80 rounded-2xl p-4 h-[250px] shadow-[0_8px_30px_rgb(0,0,0,0.02)] flex flex-col items-center">
                      <span className="text-sm font-semibold text-muted-foreground w-full text-left mb-2">Progression</span>
                      {progressionShowsPlaceholder ? (
                        <div className="flex flex-1 w-full items-center justify-center text-center text-sm text-muted-foreground px-4">
                          No progression data — interview was not completed.
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={lineData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                            <XAxis dataKey="name" tick={{ fill: 'currentColor', fontSize: 11 }} axisLine={false} tickLine={false} />
                            <YAxis domain={[0, 10]} tick={{ fill: 'currentColor', fontSize: 11 }} axisLine={false} tickLine={false} />
                            <RechartsTooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--border)' }} />
                            <Line type="monotone" dataKey="Tech" stroke="hsl(var(--primary))" strokeWidth={3} dot={{ r: 4 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </div>

                    {/* Chart 3: Detailed Metrics */}
                    <div className="bg-card/45 backdrop-blur-xl border border-border/80 rounded-2xl p-4 h-[250px] shadow-[0_8px_30px_rgb(0,0,0,0.02)] flex flex-col">
                      <span className="text-sm font-semibold text-muted-foreground w-full text-left mb-2">Detailed Metrics (Avg)</span>
                      <div className="flex-1 min-h-0">
                        <DetailedMetricsChart report={viewingReport} showNoData={interviewNotCompleted} />
                      </div>
                    </div>

                    {/* Chart 4: Skill Proficiency Distribution */}
                    <div className="bg-card/45 backdrop-blur-xl border border-border/80 rounded-2xl p-4 h-[250px] shadow-[0_8px_30px_rgb(0,0,0,0.02)] flex flex-col">
                      <span className="text-sm font-semibold text-muted-foreground w-full text-left mb-2">Skill Proficiency</span>
                      <div className="flex-1 min-h-0">
                        <SkillProficiencyChart report={viewingReport} />
                      </div>
                    </div>
                  </div>

                </div>

                <div className="flex flex-col gap-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <FileText className="h-5 w-5 text-primary" />
                      Question Analysis
                    </h3>
                    <div className="flex gap-3 shrink-0">
                      <Button onClick={() => downloadFile(JSON.stringify(viewingReport, null, 2), viewingReport.filename, 'json')} variant="outline" className="bg-card hover:bg-muted shadow-sm">
                        <Download className="h-4 w-4 mr-2" /> Export JSON
                      </Button>
                      <Button onClick={() => downloadFile(generateTextReport(viewingReport), viewingReport.filename.replace('.json', '.txt'), 'txt')} className="shadow-sm">
                        <FileText className="h-4 w-4 mr-2" /> Download Report
                      </Button>
                    </div>
                  </div>
                  {interviewNotCompleted && (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2 inline-block">
                      Note: This report has incomplete data as the candidate did not finish the interview.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={reportView === 'technical' ? 'default' : 'outline'}
                      onClick={() => setReportView('technical')}
                      size="sm"
                      className="rounded-full"
                    >
                      Technical Questions
                    </Button>
                    <Button
                      variant={reportView === 'behavioral' ? 'default' : 'outline'}
                      onClick={() => setReportView('behavioral')}
                      size="sm"
                      className="rounded-full"
                    >
                      Behavioral Questions
                    </Button>
                    <Button
                      variant={reportView === 'aptitude' ? 'default' : 'outline'}
                      onClick={() => setReportView('aptitude')}
                      size="sm"
                      className="rounded-full"
                    >
                      Aptitude Questions
                    </Button>
                  </div>
                  <ScrollArea className="h-[400px] w-full pr-4 border border-border/80 rounded-2xl bg-card/45 backdrop-blur-xl shadow-[0_8px_30px_rgb(0,0,0,0.02)]">
                    {reportView === 'aptitude' ? (
                      <div className="p-0">
                        <table className="w-full text-sm text-left">
                          <thead className="bg-muted/30 sticky top-0 z-10 border-b border-border/40">
                            <tr>
                              <th className="px-4 py-3 font-semibold w-12 text-center">#</th>
                              <th className="px-4 py-3 font-semibold">Question</th>
                              <th className="px-4 py-3 font-semibold">Candidate's Answer</th>
                              <th className="px-4 py-3 font-semibold w-32 text-center">Result</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {(viewingReport.aptitude_question_evaluations ?? []).map((q, i) => (
                              <tr key={i} className="premium-table-row border-b border-border/10 last:border-b-0">
                                <td className="px-4 py-4 text-center font-medium text-muted-foreground">{i + 1}</td>
                                <td className="px-4 py-4">{cleanQuestionText(q.question)}</td>
                                <td className="px-4 py-4 text-muted-foreground">{q.answer || <span className="italic text-muted-foreground/50">No answer provided</span>}</td>
                                <td className="px-4 py-4 text-center">
                                  {q.correct ? (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 font-medium">
                                      <CheckCircle2 className="w-4 h-4" /> Correct
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 font-medium">
                                      <XCircle className="w-4 h-4" /> Incorrect
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                            {(viewingReport.aptitude_question_evaluations?.length === 0) && (
                              <tr>
                                <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground italic">
                                  No aptitude questions found for this interview.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                        {viewingReport.question_evaluations
                          .filter(q => (q.question_type || 'technical') === reportView)
                          .map((q, i) => {
                            const qType = q.question_type || 'technical';
                            const unanswered = isAnswerEmpty(q.answer) && getDisplayedQuestionScore(q) === 0;
                            return (
                              <div
                                key={i}
                                className="bg-card/45 backdrop-blur-xl p-4 rounded-2xl border border-border/80 hover-premium-lift cursor-pointer active:scale-[0.98] group"
                                onClick={() => setSelectedQuestion(q)}
                              >
                                <div className="flex justify-between items-start mb-3 gap-2">
                                  <div className="flex items-center gap-2">
                                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold">
                                      {i + 1}
                                    </span>
                                    <span className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${qType === 'behavioral'
                                      ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                      }`}>
                                      {qType === 'behavioral' ? 'Behavioral' : 'Technical'}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
                                    <Badge variant="secondary" className="font-bold tabular-nums">
                                      {q.evaluation?.technical_accuracy ?? q.evaluation?.overall ?? 0}/10
                                    </Badge>
                                    {unanswered && (
                                      <Badge variant="outline" className="text-xs font-medium text-muted-foreground border-muted-foreground/25 bg-muted/60">
                                        Not Answered
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <p className="text-sm font-medium mb-3 line-clamp-2 leading-relaxed">{cleanQuestionText(q.question)}</p>
                                <div className="flex gap-4">
                                  <div className="flex flex-col gap-1 w-1/2">
                                    <span className="text-xs font-semibold text-green-600 dark:text-green-400">Top Strength</span>
                                    <p className="text-xs text-muted-foreground line-clamp-1">{q.evaluation.strengths?.[0] || 'N/A'}</p>
                                  </div>
                                  <div className="flex flex-col gap-1 w-1/2">
                                    <span className="text-xs font-semibold text-red-600 dark:text-red-400">Area to Improve</span>
                                    <p className="text-xs text-muted-foreground line-clamp-1">{q.evaluation.weaknesses?.[0] || 'N/A'}</p>
                                  </div>
                                </div>
                              </div>
                            )
                          }
                          )}
                        {viewingReport.question_evaluations.filter(q => (q.question_type || 'technical') === reportView).length === 0 && (
                          <div className="col-span-full py-20 text-center text-muted-foreground italic">
                            No {reportView} questions found for this interview.
                          </div>
                        )}
                      </div>
                    )}
                  </ScrollArea>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div >
  )
}
