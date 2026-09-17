'use client'

import React from 'react'
import { CheckCircle2, AlertCircle, XCircle, Trash2 } from 'lucide-react'
import { isInterviewNotCompleted } from '@/components/reports/interviewIncomplete'

interface ReportCardProps {
    report: any
    onClick: () => void
    onDelete?: (report: any) => void
}

const ReportCardImpl = ({ report, onClick, onDelete }: ReportCardProps) => {
  const notCompleted = isInterviewNotCompleted(report)
  return (
    <div
        className="bg-card/45 backdrop-blur-xl border border-border/80 rounded-2xl px-6 py-5 shadow-[0_8px_30px_rgb(0,0,0,0.02)] hover-premium-lift cursor-pointer group relative overflow-hidden active:scale-[0.99]"
        onClick={onClick}
    >
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
        <div className="flex flex-col md:flex-row md:items-center justify-between w-full gap-6 relative z-10">
            <div className="flex flex-col items-start gap-1">
                <div className="font-bold text-lg flex items-center gap-2 group-hover:text-primary transition-colors flex-wrap">
                    <span className="truncate max-w-[200px] md:max-w-[300px] tracking-tight">{report?.candidate_profile?.candidate_name || "Anonymous"}</span>
                    {report?.is_demo && (
                        <span className="text-xs font-bold text-purple-600 bg-purple-100 dark:bg-purple-900/40 dark:text-purple-300 px-2.5 py-0.5 rounded-full border border-purple-200 dark:border-purple-800">
                            Demo Interview
                        </span>
                    )}
                    {report?.display_date_short && <span className="text-xs font-medium text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full ml-1 hidden sm:inline-block">{report.display_date_short}</span>}
                    {report?.status === 'Selected' && <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
                    {report?.status === 'Hold' && <AlertCircle className="h-5 w-5 text-amber-500" />}
                    {report?.status === 'Rejected' && <XCircle className="h-5 w-5 text-red-500" />}
                </div>
                <div className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                    {report?.candidate_profile?.applied_role || report?.filename || "Unspecified Role"}
                </div>
            </div>

            <div className="flex gap-4 sm:gap-6 items-center">
                <div className="text-right w-20">
                    <div className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-bold">Score</div>
                    <div className="font-black text-3xl text-primary tabular-nums tracking-tighter">{(report?.overall_score || 0).toFixed(1)}</div>
                </div>
                <div className="text-right w-20 hidden md:block border-l pl-4 border-slate-100 dark:border-slate-800">
                    <div className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-bold">Aptitude</div>
                    <div className="font-bold text-lg text-slate-700 dark:text-slate-300 tabular-nums">
                        {typeof report?.aptitude_score === 'number' ? report.aptitude_score.toFixed(1) : '-'}
                    </div>
                </div>
                <div className="text-right w-20 hidden md:block border-l pl-4 border-slate-100 dark:border-slate-800">
                    <div className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-bold">Behavioral</div>
                    <div className="font-bold text-lg text-slate-700 dark:text-slate-300 tabular-nums">
                        {typeof report?.behavioral_score === 'number' ? report.behavioral_score.toFixed(1) : '-'}
                    </div>
                </div>
                <div className="text-right w-20 hidden lg:block border-l pl-4 border-slate-100 dark:border-slate-800">
                    <div className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-bold">Coding</div>
                    <div className="font-bold text-lg text-slate-700 dark:text-slate-300 tabular-nums">
                        {typeof report?.coding_score === 'number' ? `${Math.round(report.coding_score)}%` : '-'}
                    </div>
                </div>

                <div className="text-right w-28 border-l pl-6 border-slate-100 dark:border-slate-800">
                    <div className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-bold">Suggestion</div>
                    <div
                        className={`font-black text-lg tracking-tight transition-transform duration-300 group-hover:scale-105
                          ${report.termination_reason ? 'text-red-500' : ''}
                          ${!report.termination_reason && notCompleted ? 'text-orange-500' : ''}
                          ${!report.termination_reason && !notCompleted && report.overall_score > 6 ? 'text-emerald-600' : ''}
                          ${!report.termination_reason && !notCompleted && report.overall_score <= 4 ? 'text-rose-600' : ''}
                          ${!report.termination_reason && !notCompleted && report.overall_score > 4 && report.overall_score <= 6 ? 'text-amber-600' : ''}
                        `}
                    >
                        {(() => {
                            const score = Number(report?.overall_score || 0)
                            if (report.termination_reason) return 'Terminated'
                            if (notCompleted) return 'Incomplete'
                            if (score > 6) return 'Select'
                            if (score > 4) return 'Hold'
                            return 'Reject'
                        })()}
                    </div>
                </div>

                {onDelete && (
                    <div className="border-l pl-3 sm:pl-4 border-slate-100 dark:border-slate-800">
                        <button
                            type="button"
                            title="Delete report"
                            className="p-2 rounded-xl text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all active:scale-95"
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete(report);
                            }}
                        >
                            <Trash2 className="h-4 w-4" />
                        </button>
                    </div>
                )}
            </div>
        </div>
    </div>
  )
}

export const ReportCard = React.memo(ReportCardImpl);
