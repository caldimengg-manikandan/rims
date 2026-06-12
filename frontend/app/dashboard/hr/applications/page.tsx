"use client";
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  History,
  AlertCircle,
  FileCheck,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  User,
  Users,
  UserCheck,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { APIClient } from "@/app/dashboard/lib/api-client";
import { RejectDialog } from "@/components/reject-dialog";
import useSWR from "swr";
import { fetcher } from "@/app/dashboard/lib/swr-fetcher";
import { performMutation } from "@/app/dashboard/lib/swr-utils";
import { useRouter } from "next/navigation";
import { getApiBaseUrl } from "@/lib/config";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useApplicationsMutate } from "./hooks/use-applications-mutate";
import { PageHeader } from "@/components/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

interface Application {
  id: number;
  status: string;
  file_status: string;
  applied_at: string;
  candidate_name: string;
  candidate_email: string;
  candidate_photo_path: string | null;
  photo_url: string | null;
  composite_score: number | null;
  job: {
    id: number;
    job_id: string | null;
    title: string;
  };
  interview: {
    id: number;
    test_id: string | null;
    report: {
      aptitude_score: number | null;
      technical_skills_score: number | null;
      behavioral_score: number | null;
    } | null;
  } | null;
  resume_extraction: {
    resume_score: number;
    skill_match_percentage: number;
    summary: string | null;
    extracted_skills: string | null;
  } | null;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}


export default function HRApplicationsPage() {
  const { push } = useRouter();
  const router = useRouter();
  const { invalidateApplications } = useApplicationsMutate();
  const [pageSize, setPageSize] = useState(10);
  const [applicationsPage, setApplicationsPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  /** Server-side search; debounced to avoid refetching on every keystroke. */
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [jobIdFilter, setJobIdFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [processingIds, setProcessingIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 400);
    return () => clearTimeout(t);
  }, [searchTerm]);


  const applicationsListUrl = useMemo(() => {
    const q = new URLSearchParams();
    q.set("limit", String(pageSize));
    q.set("skip", String((applicationsPage - 1) * pageSize));
    if (statusFilter !== "all") q.set("status", statusFilter);
    if (jobIdFilter !== "all") q.set("job_id", jobIdFilter);
    if (dateFrom) q.set("from_date", dateFrom);
    if (dateTo) q.set("to_date", dateTo);
    if (debouncedSearch) q.set("search", debouncedSearch);
    return `/api/applications?${q.toString()}`;
  }, [applicationsPage, pageSize, statusFilter, jobIdFilter, dateFrom, dateTo, debouncedSearch]);

  useEffect(() => {
    setApplicationsPage(1);
  }, [statusFilter, jobIdFilter, dateFrom, dateTo, debouncedSearch, searchTerm]);

  const {
    data: paginatedData,
    error,
    isLoading: isSwrLoading,
    mutate,
  } = useSWR<PaginatedResponse<Application>>(
    applicationsListUrl,
    (url: string) => fetcher<PaginatedResponse<Application>>(url),
    { keepPreviousData: true },
  );

  const applications = paginatedData?.items ?? [];
  const totalCount = paginatedData?.total || 0;
  const isLoading = isSwrLoading;









  useEffect(() => {
    if (error) {
      console.error("[Applications Page] SWR Fetching Error:", error);
    }
  }, [paginatedData, error]);

  const totalPages = paginatedData?.pages || 0;
  const hasMoreApplications = applicationsPage < totalPages;

  // Fetch jobs for filter
  const { data: jobs } = useSWR<any[]>("/api/jobs", fetcher);


  const handleDecision = useCallback(async (
    applicationId: number,
    decision: "hired" | "rejected",
    reason?: string,
    notes?: string,
  ) => {
    setProcessingIds(prev => new Set(prev).add(applicationId));
    const actionFn = () => {
      let userComments = `Candidate ${decision} via quick action in applications list.`;
      if (decision === "rejected") {
        userComments = `Reason: ${reason}${notes ? `\nNotes: ${notes}` : ""}`;
      }
      return APIClient.put(
        `/api/decisions/applications/${applicationId}/decide`,
        {
          decision,
          decision_comments: userComments,
        },
      );
    };

    try {
      await performMutation<PaginatedResponse<Application>>(
        applicationsListUrl,
        mutate,
        actionFn,
        {
          lockKey: `application-${applicationId}`,
          optimisticData: (current) => {
            const defaultResp = { items: [], total: 0, page: 1, size: 20, pages: 1 };
            const data = current || defaultResp;
            return {
              ...data,
              items: data.items.map((app) =>
                app.id === applicationId
                  ? { ...app, status: decision }
                  : app
              )
            };
          },
          successMessage: `Candidate ${decision} successfully`,
          invalidateKeys: ["/api/analytics/dashboard", "/api/search/candidates"]
        }
      );
    } finally {
      setProcessingIds(prev => {
        const next = new Set(prev);
        next.delete(applicationId);
        return next;
      });
    }
  }, [mutate, applicationsListUrl]);

  const handleTransition = useCallback(async (
    applicationId: number,
    action: string,
    notes?: string,
  ) => {
    setProcessingIds(prev => new Set(prev).add(applicationId));
    // Map action → optimistic status for immediate UI feedback
    const ACTION_TO_STATUS: Record<string, string> = {
      mark_screened: "screened",
      approve_for_interview: "interview_scheduled",
      reject: "rejected",
      call_for_interview: "physical_interview",
      review_later: "review_later",
      hire: "hired",
    };
    const nextStatus = ACTION_TO_STATUS[action] ?? "applied";

    const actionFn = () => APIClient.put(`/api/applications/${applicationId}/status`, {
      action,
      hr_notes: notes || `Action: ${action}`,
    });

    try {
      await performMutation<PaginatedResponse<Application>>(
        applicationsListUrl,
        mutate,
        actionFn,
        {
          lockKey: `application-${applicationId}`,
          optimisticData: (current) => {
            const defaultResp = { items: [], total: 0, page: 1, size: 20, pages: 1 };
            const data = current || defaultResp;
            return {
              ...data,
              items: data.items.map((app) =>
                app.id === applicationId
                  ? { ...app, status: nextStatus }
                  : app
              )
            };
          },
          successMessage: action === "hire"
            ? "Candidate hired! Visit Onboarding to issue offer letter."
            : `Status updated to ${nextStatus.replace(/_/g, " ")}`,
          invalidateKeys: ["/api/analytics/dashboard", "/api/search/candidates"]
        }
      );
    } finally {
      setProcessingIds(prev => {
        const next = new Set(prev);
        next.delete(applicationId);
        return next;
      });
    }
  }, [mutate, applicationsListUrl]);



  // Get unique job titles for the filter dropdown
  const jobTitles = useMemo(() => Array.from(
    new Set(applications.map((app) => app.job.title)),
  ).sort(), [applications]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "applied":
        return "capsule-badge-primary";
      case "screened":
        return "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20";
      case "interview_scheduled":
        return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20";
      case "interview_completed":
        return "capsule-badge-info";
      case "review_later":
        return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
      case "physical_interview":
        return "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20";
      case "hired":
        return "capsule-badge-success";
      case "rejected":
        return "capsule-badge-destructive";
      default:
        return "capsule-badge-neutral";
    }
  };

  return (
    <div className="section-stack">
      <PageHeader
        title="Applications"
        description="Review and manage candidate applications."
        icon={Users}
      >
        <div className="rounded-lg border border-primary/20 bg-primary/10 px-5 py-2 text-right shadow-sm">
          <span className="text-[12px] font-semibold text-primary uppercase tracking-normal mb-1 block">Total Records</span>
          <span className="text-xl font-semibold text-primary tabular-nums">
            {isLoading ? "..." : totalCount}
          </span>
        </div>
      </PageHeader>


      {/* Filters Toolbar */}
      <div className="surface-panel p-3 animate-in fade-in slide-in-from-top-4 duration-500 ease-out">
        <div className="flex flex-col md:flex-row flex-wrap gap-3 items-start md:items-end">
          {/* Combined Search Bar */}
          <div className="w-full md:flex-1 min-w-0">
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-normal mb-1 px-1">Search applications</label>
            <div className="relative group flex gap-2">
              <div className="relative flex-1">
                <svg
                    className="absolute left-4 top-1/2 transform -translate-y-1/2 text-muted-foreground group-focus-within:text-primary h-5 w-5 transition-colors z-10 pointer-events-none"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                </svg>
                <Input
                    type="text"
                    placeholder="Search name, ID, or job details..."
                    className="pl-10"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Date From Filter */}
          <div className="w-full sm:w-[170px]">
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-normal mb-1 px-1">From Date</label>
            <input
              type="date"
              min="2020-01-01"
              max={dateTo || new Date().toLocaleDateString('en-CA')}
              className="w-full px-3 h-10 bg-background border border-input hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200 rounded-md text-sm font-medium text-foreground cursor-pointer"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>

          <div className="w-full sm:w-[170px]">
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-normal mb-1 px-1">To Date</label>
            <input
              type="date"
              min={dateFrom || "2020-01-01"}
              max={new Date().toLocaleDateString('en-CA')}
              value={dateTo}
              className="w-full px-3 h-10 bg-background border border-input hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200 rounded-md text-sm font-medium text-foreground cursor-pointer"
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>

          {/* Status Filter */}
          <div className="w-full sm:w-[200px]">
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-normal mb-1 px-1">Status</label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="applied">Applied</SelectItem>
                <SelectItem value="screened">Screened</SelectItem>
                <SelectItem value="interview_scheduled">Interview Scheduled</SelectItem>
                <SelectItem value="interview_completed">Interview Completed</SelectItem>
                <SelectItem value="review_later">Review Later</SelectItem>
                <SelectItem value="physical_interview">Physical Interview</SelectItem>
                <SelectItem value="hired">Hired</SelectItem>
                <SelectItem value="offer_sent">Offer Sent</SelectItem>
                <SelectItem value="onboarded">Onboarded</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Job Filter */}
          <div className="w-full sm:w-[200px]">
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-normal mb-1 px-1">Filter by Job</label>
            <Select value={jobIdFilter} onValueChange={setJobIdFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Jobs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Jobs</SelectItem>
                {jobs?.map((job) => (
                  <SelectItem key={job.id} value={String(job.id)}>
                    {job.title} ({job.job_id})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Clear Filters */}
          {(searchTerm || dateFrom || dateTo || statusFilter !== "all" || jobIdFilter !== "all") && (
            <Button 
                variant="ghost" 
                size="sm"
                onClick={() => {
                    setSearchTerm("");
                    setDateFrom("");
                    setDateTo("");
                    setStatusFilter("all");
                    setJobIdFilter("all");
                    setApplicationsPage(1);
                }}
                className="w-full sm:w-auto h-11 px-4 text-muted-foreground hover:text-foreground transition-colors mt-2 sm:mt-0"
            >
                Clear All
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
          <p className="text-sm font-bold text-muted-foreground animate-pulse tracking-widest uppercase">Fetching Records...</p>
        </div>
      ) : applications.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-12 text-center flex flex-col items-center gap-3 animate-in fade-in duration-500">
          <div className="relative">
            <div className="absolute -inset-3 rounded-full bg-primary/10 blur-xl" />
            <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/15 to-blue-500/10 border border-primary/20 flex items-center justify-center shadow-lg">
              <Users className="h-7 w-7 text-primary" />
            </div>
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-foreground">No applications found</h3>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              No candidates match your current filtering criteria. Try resetting or adjusting the options above.
            </p>
          </div>
          <Button 
            variant="outline" 
            onClick={() => {
              setSearchTerm("");
              setDateFrom("");
              setDateTo("");
              setStatusFilter("all");
              setJobIdFilter("all");
              setApplicationsPage(1);
            }}
            className="mt-2 rounded-xl border-border font-bold active:scale-[0.99] transition-all hover:bg-muted/50"
          >
            Clear All Filters
          </Button>
        </div>
      ) : (
        <div className="surface-panel overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* List Header */}
          <div className="hidden lg:grid grid-cols-12 gap-4 px-6 py-3 bg-muted/35 border-b border-border/60 text-xs uppercase tracking-normal font-semibold text-muted-foreground">
            <div className="col-span-3 xl:col-span-2">Candidate</div>
            <div className="col-span-2">Position & IDs</div>
            <div className="col-span-2">Skills Match</div>
            <div className="col-span-2">Scores</div>
            <div className="col-span-2 text-center">Status</div>
            <div className="col-span-1 xl:col-span-2 text-center">Actions</div>
          </div>

          <div className="bg-transparent divide-y divide-border/40 stagger-children">
            {applications.map((app, index) => (
              <div
                key={app.id}
                className="flex flex-col lg:grid lg:grid-cols-12 gap-4 lg:gap-6 px-4 sm:px-6 lg:px-6 py-4 lg:py-5 lg:items-center border-b border-border/10 last:border-b-0 cursor-pointer group premium-table-row"
                onClick={() => router.push(`/dashboard/hr/applications/${app.id}`)}
              >
                {/* Candidate Info */}
                <div className="col-span-3 xl:col-span-2 flex items-center gap-4 min-w-0">
                  <Avatar className="h-12 w-12 border border-border/50 shadow-sm shrink-0">
                    <AvatarImage 
                      src={app.photo_url 
                        || (app.candidate_photo_path ? (app.candidate_photo_path.startsWith('http') ? app.candidate_photo_path : `${getApiBaseUrl()}/${app.candidate_photo_path.replace(/\\/g, "/")}`) : undefined)}
                      alt={app.candidate_name || 'Candidate'}
                      className="object-cover"
                    />
                    <AvatarFallback className="bg-primary/25 text-primary font-bold text-base shadow-inner">
                      {(app.candidate_name || 'U').charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors truncate">
                      {app.candidate_name}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{app.candidate_email}</div>
                  </div>
                </div>

                {/* Position & IDs */}
                <div className="col-span-2 min-w-0 mt-3 lg:mt-0">
                  <div className="lg:hidden text-xs font-semibold text-muted-foreground uppercase tracking-normal mb-1">Position & IDs</div>
                  <div className="text-sm font-semibold text-foreground truncate">{app.job.title}</div>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {app.job.job_id && (
                      <span className="text-[11px] bg-muted px-2 py-0.5 rounded text-muted-foreground border border-border font-bold">
                        {app.job.job_id}
                      </span>
                    )}
                    {app.interview?.test_id && (
                      <span className="text-[11px] bg-primary/5 px-2 py-0.5 rounded text-primary border border-primary/10 font-bold">
                        {app.interview.test_id}
                      </span>
                    )}
                  </div>
                </div>

                {/* Skills Match */}
                <div className="col-span-2 mt-3 lg:mt-0">
                  <div className="lg:hidden text-xs font-semibold text-muted-foreground uppercase tracking-normal mb-1">Skills Match</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(() => {
                      try {
                        // Parse once and reuse — avoids 3 separate JSON.parse calls per row.
                        const skills: string[] = JSON.parse(app.resume_extraction?.extracted_skills || '[]');
                        if (Array.isArray(skills) && skills.length > 0) {
                          return (
                            <>
                              {skills.slice(0, 3).map((skill, idx) => (
                                <Badge key={idx} variant="secondary" className="bg-muted/50 text-muted-foreground border-none text-[10px] py-0 px-2 h-5 font-bold">
                                  {skill}
                                </Badge>
                              ))}
                              {skills.length > 3 && (
                                <span className="text-[10px] text-muted-foreground font-bold pt-1">+{skills.length - 3} more</span>
                              )}
                            </>
                          );
                        }
                      } catch (e) {}
                      return <span className="text-sm text-muted-foreground italic font-medium">No skills data</span>;
                    })()}
                  </div>
                </div>

                {/* Scores */}
                <div className="col-span-2 mt-3 lg:mt-0">
                  <div className="lg:hidden text-xs font-semibold text-muted-foreground uppercase tracking-normal mb-1">Scores</div>
                  {(app.composite_score! > 0 || app.resume_extraction) && (
                    <div className="inline-flex items-center gap-2 bg-primary/10 px-2.5 py-1 rounded-md border border-primary/20 hover:bg-primary/15 transition-colors mb-2 shadow-sm">
                      <span className="text-[11px] font-semibold text-primary uppercase tracking-normal">Score</span>
                      <span className="text-sm font-semibold text-primary tabular-nums">
                        {((app.composite_score ?? 0) > 0 
                          ? (app.composite_score ?? 0) 
                          : ((app.resume_extraction?.resume_score ?? 0) <= 10 
                            ? (app.resume_extraction?.resume_score ?? 0) * 10 
                            : (app.resume_extraction?.resume_score ?? 0))
                        ).toFixed(1)}
                      </span>
                    </div>
                  )}
                  <div className="flex gap-1.5">
                    {app.interview?.report?.aptitude_score != null && (
                      <div className="h-2 w-8 bg-primary/15 rounded-full overflow-hidden" title={`Aptitude: ${app.interview?.report?.aptitude_score}/10`}>
                        <div className="h-full bg-primary/70" style={{ width: `${(app.interview?.report?.aptitude_score || 0) * 10}%` }} />
                      </div>
                    )}
                    {app.interview?.report?.technical_skills_score != null && (
                      <div className="h-2 w-8 bg-chart-2/20 rounded-full overflow-hidden" title={`Tech: ${app.interview?.report?.technical_skills_score}/10`}>
                        <div className="h-full bg-chart-2" style={{ width: `${(app.interview?.report?.technical_skills_score || 0) * 10}%` }} />
                      </div>
                    )}
                    {app.interview?.report?.behavioral_score != null && (
                      <div className="h-2 w-8 bg-chart-4/20 rounded-full overflow-hidden" title={`Behav: ${app.interview?.report?.behavioral_score}/10`}>
                        <div className="h-full bg-chart-4" style={{ width: `${(app.interview?.report?.behavioral_score || 0) * 10}%` }} />
                      </div>
                    )}
                  </div>
                </div>

                {/* Status & Date */}
                <div className="col-span-2 text-left lg:text-center min-w-0 mt-3 lg:mt-0">
                  <div className="lg:hidden text-xs font-semibold text-muted-foreground uppercase tracking-normal mb-2">Status</div>
                  <div className="flex flex-row lg:flex-col items-center lg:justify-center gap-3 lg:gap-1.5">
                    <span className={`capsule-badge text-[10px] px-3 py-1 font-bold ${getStatusColor(app.status)}`}>
                      {app.status.replace(/_/g, " ").toUpperCase()}
                    </span>
                    {app.file_status === 'missing' && (
                      <span className="text-destructive text-[10px] font-semibold tracking-normal uppercase">File Missing</span>
                    )}
                    <span className="text-xs font-bold text-muted-foreground">
                      {new Date(app.applied_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="col-span-1 xl:col-span-2 text-left lg:text-center mt-4 lg:mt-0 pt-4 lg:pt-0 border-t border-border lg:border-t-0" onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-wrap lg:justify-center gap-2 lg:gap-3">

                    {/* ── Applied: Mark as Screened ── */}
                    {app.status === "applied" && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={processingIds.has(app.id)}
                            className="h-10 w-10 p-0 text-primary hover:bg-primary/10 rounded-xl transition-colors shadow-none"
                            onClick={() => handleTransition(app.id, "mark_screened")}
                          >
                            <FileCheck className="h-5 w-5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Mark as Screened</TooltipContent>
                      </Tooltip>
                    )}

                    {/* ── Screened: Approve for Interview ── */}
                    {app.status === "screened" && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={processingIds.has(app.id)}
                            className="h-10 w-10 p-0 text-indigo-600 hover:bg-indigo-500/10 rounded-xl transition-colors shadow-none"
                            onClick={() => handleTransition(app.id, "approve_for_interview")}
                          >
                            <FileCheck className="h-5 w-5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Approve for Interview</TooltipContent>
                      </Tooltip>
                    )}

                    {/* ── Interview Scheduled: no transition buttons (waiting state) ── */}

                    {/* ── Interview Completed: Hire ── */}
                    {app.status === "interview_completed" && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={processingIds.has(app.id)}
                            className="h-10 w-10 p-0 text-emerald-600 hover:bg-emerald-500/10 rounded-xl transition-colors shadow-none"
                            onClick={() => handleTransition(app.id, "hire")}
                          >
                            <CheckCircle2 className="h-5 w-5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Hire Candidate</TooltipContent>
                      </Tooltip>
                    )}

                    {/* ── Interview Completed: Call for Physical Interview ── */}
                    {app.status === "interview_completed" && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={processingIds.has(app.id)}
                            className="h-10 w-10 p-0 text-teal-600 hover:bg-teal-500/10 rounded-xl transition-colors shadow-none"
                            onClick={() => handleTransition(app.id, "call_for_interview")}
                          >
                            <User className="h-5 w-5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Call for Physical Interview</TooltipContent>
                      </Tooltip>
                    )}

                    {/* ── Interview Completed: Review Later ── */}
                    {app.status === "interview_completed" && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={processingIds.has(app.id)}
                            className="h-10 w-10 p-0 text-amber-600 hover:bg-amber-500/10 rounded-xl transition-colors shadow-none"
                            onClick={() => handleTransition(app.id, "review_later")}
                          >
                            <History className="h-5 w-5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Review Later</TooltipContent>
                      </Tooltip>
                    )}

                    {/* ── Review Later: Call for Physical Interview ── */}
                    {app.status === "review_later" && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={processingIds.has(app.id)}
                            className="h-10 w-10 p-0 text-teal-600 hover:bg-teal-500/10 rounded-xl transition-colors shadow-none"
                            onClick={() => handleTransition(app.id, "call_for_interview")}
                          >
                            <User className="h-5 w-5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Call for Physical Interview</TooltipContent>
                      </Tooltip>
                    )}

                    {/* ── Physical Interview: Hire ── */}
                    {app.status === "physical_interview" && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-10 w-10 p-0 text-emerald-600 hover:bg-emerald-500/10 rounded-xl transition-colors shadow-none"
                            onClick={() => handleTransition(app.id, "hire")}
                          >
                            <CheckCircle2 className="h-5 w-5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Hire Candidate</TooltipContent>
                      </Tooltip>
                    )}

                    {/* ── Reject Button: only for states where spec allows rejection ── */}
                    {["applied", "screened", "review_later", "physical_interview"].includes(app.status) && (
                      <RejectDialog
                        candidateName={app.candidate_name}
                        onConfirm={(reason, notes) =>
                          handleTransition(app.id, "reject", `Reason: ${reason}${notes ? `\nNotes: ${notes}` : ''}`)
                        }
                        trigger={
                          <div className="inline-block">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-10 w-10 p-0 text-destructive hover:bg-destructive/10 rounded-xl transition-colors shadow-none"
                                >
                                  <XCircle className="h-5 w-5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Reject Candidate</TooltipContent>
                            </Tooltip>
                          </div>
                        }
                      />
                    )}
                    {(app.status === "hired" || app.status === "offer_sent" || app.status === "onboarded") && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={processingIds.has(app.id)}
                            className="h-10 w-10 p-0 text-emerald-600 hover:bg-emerald-500/10 rounded-xl transition-colors shadow-none"
                            onClick={() => push(`/dashboard/onboarding?search=${encodeURIComponent(app.candidate_email)}`)}
                          >
                            <UserCheck className="h-5 w-5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Visit Onboarding Page</TooltipContent>
                      </Tooltip>
                    )}
                    {(app.status === "interview_scheduled" || app.status === "rejected") && (
                      <p className='text-[13px] font-medium text-muted-foreground '>NONE</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 pt-6 border-t border-border">
            <div className="text-sm text-muted-foreground font-medium">
                Showing <span className="font-semibold text-foreground/80">{Math.min(pageSize, totalCount)}</span> of <span className="font-semibold text-foreground/80">{totalCount}</span> candidates
              </div>
              
              <div className="flex flex-wrap items-center gap-6">
                <div className="text-sm font-medium text-muted-foreground">
                  Page <span className="text-foreground/80 font-semibold">{applicationsPage}</span> of {totalPages}
                </div>
                
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setApplicationsPage(applicationsPage - 1)}
                    disabled={applicationsPage <= 1 || isLoading}
                    className="h-8 px-4 rounded-xl font-bold bg-background border-border transition-all shadow-sm active:scale-95 disabled:opacity-50"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setApplicationsPage(applicationsPage + 1)}
                    disabled={!hasMoreApplications || isLoading}
                    className="h-8 px-4 rounded-xl font-bold bg-background border-border transition-all shadow-sm active:scale-95 disabled:opacity-50"
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
                      setApplicationsPage(1);
                    }}
                  >
                    <SelectTrigger className="h-8 w-[75px] rounded-xl border-border bg-background font-bold shadow-none focus:ring-0">
                      <SelectValue placeholder="10" />
                    </SelectTrigger>
                    <SelectContent className="min-w-[70px]">
                      {[10, 20, 50, 100].map((size) => (
                        <SelectItem key={size} value={String(size)} className="font-bold">
                          {size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              </div>
            </div>
  );
}
