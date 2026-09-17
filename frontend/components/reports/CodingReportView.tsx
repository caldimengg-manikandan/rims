'use client'

import React, { useState, useMemo } from 'react'
import dynamic from 'next/dynamic'
import {
  CheckCircle2,
  XCircle,
  Code2,
  Terminal,
  Copy,
  Check,
  Clock,
  Cpu,
  Maximize2,
  Minimize2,
  FileCode,
  Sparkles,
  Layers,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronRight
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

// Dynamically import Monaco Editor to prevent SSR issues
const Editor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full min-h-[300px] flex flex-col items-center justify-center bg-slate-950 text-muted-foreground gap-3 rounded-xl border border-border/60">
      <Code2 className="w-8 h-8 animate-pulse text-primary" />
      <span className="text-xs font-medium">Loading Code Editor…</span>
    </div>
  )
})

export interface CodingTestCaseResult {
  id: number
  input: string
  expected_output: string
  weight?: number
  is_hidden?: boolean
  display_order?: number
  passed?: boolean | null
  actual_stdout?: string | null
  error?: string | null
  execution_time_ms?: number | null
}

export interface CodingEvaluation {
  problem_id: number
  title: string
  description: string
  difficulty: 'easy' | 'medium' | 'hard' | string
  input_format?: string | null
  output_format?: string | null
  constraints?: string | null
  supported_languages?: string[]
  time_limit_ms?: number
  memory_limit_mb?: number
  test_cases: CodingTestCaseResult[]
  candidate_code: string
  candidate_language: string
  correct_code: string
  correct_solutions?: Record<string, string>
  verdict: 'accepted' | 'wrong_answer' | 'time_limit_exceeded' | 'runtime_error' | 'compilation_error' | 'not_attempted' | 'pending' | string
  score: number
  passed_tests: number
  total_tests: number
  execution_time_ms?: number | null
  memory_used_kb?: number | null
  error_output?: string | null
  submitted_at?: string | null
}

interface CodingReportViewProps {
  evaluations?: CodingEvaluation[]
  codingScore?: number | null
}

const MONACO_LANG_MAP: Record<string, string> = {
  python3: 'python',
  python: 'python',
  py: 'python',
  java21: 'java',
  java: 'java',
  cpp: 'cpp',
  'c++': 'cpp',
  javascript: 'javascript',
  js: 'javascript',
  typescript: 'typescript',
  ts: 'typescript',
  go: 'go',
  golang: 'go',
  csharp: 'csharp',
  'c#': 'csharp',
  rust: 'rust',
  rs: 'rust',
}

export function CodingReportView({ evaluations = [], codingScore }: CodingReportViewProps) {
  const [selectedProblemIndex, setSelectedProblemIndex] = useState(0)
  const [codeView, setCodeView] = useState<'candidate' | 'correct'>('candidate')
  const [testCaseFilter, setTestCaseFilter] = useState<'all' | 'passed' | 'failed'>('all')
  const [copied, setCopied] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [expandedTestCases, setExpandedTestCases] = useState<Record<number, boolean>>({})

  const currentProblem: CodingEvaluation | undefined = evaluations[selectedProblemIndex]

  // Copy code helper
  const handleCopyCode = () => {
    if (!currentProblem) return
    const textToCopy = codeView === 'candidate'
      ? (currentProblem.candidate_code || '')
      : (currentProblem.correct_code || '')
    navigator.clipboard.writeText(textToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Toggle single test case expand
  const toggleTestCaseExpand = (id: number) => {
    setExpandedTestCases(prev => ({
      ...prev,
      [id]: !prev[id]
    }))
  }

  // Language configuration
  const editorLanguage = useMemo(() => {
    if (!currentProblem) return 'plaintext'
    const langKey = (currentProblem.candidate_language || 'python3').toLowerCase()
    return MONACO_LANG_MAP[langKey] || 'plaintext'
  }, [currentProblem])

  // Filtered test cases
  const filteredTestCases = useMemo(() => {
    if (!currentProblem || !currentProblem.test_cases) return []
    if (testCaseFilter === 'passed') {
      return currentProblem.test_cases.filter(tc => tc.passed === true)
    }
    if (testCaseFilter === 'failed') {
      return currentProblem.test_cases.filter(tc => tc.passed === false)
    }
    return currentProblem.test_cases
  }, [currentProblem, testCaseFilter])

  // Test case counts
  const testCounts = useMemo(() => {
    if (!currentProblem || !currentProblem.test_cases) return { total: 0, passed: 0, failed: 0 }
    const total = currentProblem.test_cases.length
    const passed = currentProblem.test_cases.filter(tc => tc.passed === true).length
    const failed = currentProblem.test_cases.filter(tc => tc.passed === false).length
    return { total, passed, failed }
  }, [currentProblem])

  // Empty state
  if (!evaluations || evaluations.length === 0) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[360px] text-center bg-card/30 rounded-2xl border border-dashed border-border/80">
        <div className="p-4 rounded-full bg-primary/10 text-primary mb-4">
          <Code2 className="w-10 h-10" />
        </div>
        <h4 className="text-base font-bold text-foreground">No Coding Questions or Submissions</h4>
        <p className="text-sm text-muted-foreground max-w-md mt-1 leading-relaxed">
          There are no coding round questions or candidate submissions recorded for this interview session.
        </p>
      </div>
    )
  }

  if (!currentProblem) return null

  const getVerdictBadge = (verdict: string) => {
    switch (verdict) {
      case 'accepted':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800">
            <CheckCircle2 className="w-3.5 h-3.5" /> Accepted
          </span>
        )
      case 'wrong_answer':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400 border border-rose-300 dark:border-rose-800">
            <XCircle className="w-3.5 h-3.5" /> Wrong Answer
          </span>
        )
      case 'time_limit_exceeded':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border border-amber-300 dark:border-amber-800">
            <Clock className="w-3.5 h-3.5" /> Time Limit Exceeded
          </span>
        )
      case 'runtime_error':
      case 'compilation_error':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400 border border-rose-300 dark:border-rose-800">
            <AlertTriangle className="w-3.5 h-3.5" /> {verdict === 'compilation_error' ? 'Compilation Error' : 'Runtime Error'}
          </span>
        )
      case 'not_attempted':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-border">
            <FileCode className="w-3.5 h-3.5" /> Not Attempted
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
            <Clock className="w-3.5 h-3.5" /> {verdict || 'Pending'}
          </span>
        )
    }
  }

  const getDifficultyBadge = (difficulty: string) => {
    const diff = (difficulty || 'medium').toLowerCase()
    if (diff === 'easy') {
      return <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-none font-bold text-[11px] uppercase tracking-wider">Easy</Badge>
    }
    if (diff === 'hard') {
      return <Badge variant="secondary" className="bg-rose-500/15 text-rose-700 dark:text-rose-300 border-none font-bold text-[11px] uppercase tracking-wider">Hard</Badge>
    }
    return <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-none font-bold text-[11px] uppercase tracking-wider">Medium</Badge>
  }

  return (
    <div className="p-4 flex flex-col gap-5">
      {/* ── 1. Multiple Problems Navigation Tabs ── */}
      {evaluations.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-border/50 scrollbar-none">
          {evaluations.map((prob, idx) => {
            const isSelected = idx === selectedProblemIndex
            return (
              <button
                key={prob.problem_id || idx}
                onClick={() => setSelectedProblemIndex(idx)}
                className={`flex items-center gap-2.5 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border ${
                  isSelected
                    ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                    : 'bg-card/60 hover:bg-card border-border/80 text-muted-foreground hover:text-foreground'
                }`}
              >
                <span>Question {idx + 1}: {prob.title || `Problem ${idx + 1}`}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  isSelected
                    ? 'bg-white/20 text-white'
                    : prob.verdict === 'accepted'
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {prob.score !== undefined ? `${Math.round(prob.score)}%` : '-'}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* ── 2. Problem Header & Performance Metrics ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-2xl bg-muted/25 border border-border/70 backdrop-blur-sm">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-black">
              {selectedProblemIndex + 1}
            </span>
            <h3 className="text-lg font-bold text-foreground tracking-tight">
              {currentProblem.title}
            </h3>
            {getDifficultyBadge(currentProblem.difficulty)}
            {getVerdictBadge(currentProblem.verdict)}
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
            <span>Language: <strong className="text-foreground uppercase">{currentProblem.candidate_language || 'python3'}</strong></span>
            <span>&bull;</span>
            <span>Test Cases: <strong className="text-foreground">{currentProblem.passed_tests}/{currentProblem.total_tests} Passed</strong></span>
            {currentProblem.execution_time_ms !== null && currentProblem.execution_time_ms !== undefined && (
              <>
                <span>&bull;</span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-primary/70" />
                  <span>Time: <strong>{currentProblem.execution_time_ms} ms</strong></span>
                </span>
              </>
            )}
            {currentProblem.memory_used_kb !== null && currentProblem.memory_used_kb !== undefined && (
              <>
                <span>&bull;</span>
                <span className="flex items-center gap-1">
                  <Cpu className="w-3 h-3 text-primary/70" />
                  <span>Memory: <strong>{(currentProblem.memory_used_kb / 1024).toFixed(1)} MB</strong></span>
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right px-4 py-2 rounded-xl bg-background border border-border/70 shadow-sm">
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Coding Score</div>
            <div className="text-2xl font-black text-primary tabular-nums">
              {Math.round(currentProblem.score)}<span className="text-sm text-primary/60 font-medium">%</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── 3. Split Layout: Left (Problem Statement & Test Cases) + Right (Monaco Editor & Answer Toggle) ── */}
      <div className={`grid grid-cols-1 lg:grid-cols-12 gap-5 items-start ${isExpanded ? 'lg:grid-cols-1' : ''}`}>
        {/* Left Pane: Problem Details & All Test Cases */}
        {!isExpanded && (
          <div className="lg:col-span-5 flex flex-col gap-4">
            {/* Problem Description Card */}
            <div className="p-4 rounded-2xl bg-card/60 border border-border/80 shadow-sm space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground border-b border-border/40 pb-2">
                <Info className="w-4 h-4 text-primary" />
                Problem Statement
              </div>
              <div className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto pr-2 scrollbar-premium">
                {currentProblem.description || 'No problem description available.'}
              </div>

              {currentProblem.constraints && (
                <div className="pt-2 border-t border-border/40">
                  <span className="text-xs font-bold text-foreground">Constraints:</span>
                  <pre className="mt-1 text-xs font-mono bg-muted/50 p-2 rounded-lg text-muted-foreground whitespace-pre-wrap">
                    {currentProblem.constraints}
                  </pre>
                </div>
              )}

              {(currentProblem.input_format || currentProblem.output_format) && (
                <div className="pt-2 border-t border-border/40 grid grid-cols-1 gap-2 text-xs">
                  {currentProblem.input_format && (
                    <div>
                      <strong className="text-foreground">Input Format:</strong>
                      <div className="text-muted-foreground mt-0.5 whitespace-pre-wrap">{currentProblem.input_format}</div>
                    </div>
                  )}
                  {currentProblem.output_format && (
                    <div>
                      <strong className="text-foreground">Output Format:</strong>
                      <div className="text-muted-foreground mt-0.5 whitespace-pre-wrap">{currentProblem.output_format}</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Test Cases Section */}
            <div className="p-4 rounded-2xl bg-card/60 border border-border/80 shadow-sm space-y-3">
              <div className="flex items-center justify-between border-b border-border/40 pb-2 flex-wrap gap-2">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <Terminal className="w-4 h-4 text-primary" />
                  All Test Cases ({testCounts.total})
                </div>
                <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg text-[11px] font-semibold">
                  <button
                    onClick={() => setTestCaseFilter('all')}
                    className={`px-2 py-0.5 rounded ${testCaseFilter === 'all' ? 'bg-background text-foreground shadow-xs font-bold' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    All ({testCounts.total})
                  </button>
                  <button
                    onClick={() => setTestCaseFilter('passed')}
                    className={`px-2 py-0.5 rounded ${testCaseFilter === 'passed' ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Passed ({testCounts.passed})
                  </button>
                  <button
                    onClick={() => setTestCaseFilter('failed')}
                    className={`px-2 py-0.5 rounded ${testCaseFilter === 'failed' ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300 font-bold' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Failed ({testCounts.failed})
                  </button>
                </div>
              </div>

              {/* Test Cases List */}
              <div className="flex flex-col gap-2.5 max-h-[380px] overflow-y-auto pr-1 scrollbar-premium">
                {filteredTestCases.map((tc, idx) => {
                  const isExpanded = expandedTestCases[tc.id] ?? true
                  const isPassed = tc.passed === true
                  const isFailed = tc.passed === false

                  return (
                    <div
                      key={tc.id || idx}
                      className={`rounded-xl border transition-all text-xs overflow-hidden ${
                        isPassed
                          ? 'border-emerald-500/30 bg-emerald-500/[0.02]'
                          : isFailed
                          ? 'border-rose-500/30 bg-rose-500/[0.02]'
                          : 'border-border/70 bg-card/40'
                      }`}
                    >
                      {/* Accordion Header */}
                      <button
                        type="button"
                        onClick={() => toggleTestCaseExpand(tc.id)}
                        className="w-full px-3 py-2.5 flex items-center justify-between hover:bg-muted/40 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          )}
                          <span className="font-bold text-foreground">
                            Test Case #{idx + 1}
                          </span>
                          {tc.is_hidden ? (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-muted-foreground/30 text-muted-foreground">
                              Hidden
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-400/40 text-blue-600 dark:text-blue-400">
                              Public
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {isPassed && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Passed
                            </span>
                          )}
                          {isFailed && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 dark:text-rose-400">
                              <XCircle className="w-3.5 h-3.5" /> Failed
                            </span>
                          )}
                          {!isPassed && !isFailed && (
                            <span className="text-[11px] font-medium text-muted-foreground">
                              Unchecked
                            </span>
                          )}
                        </div>
                      </button>

                      {/* Accordion Content */}
                      {isExpanded && (
                        <div className="px-3 pb-3 pt-1 border-t border-border/30 flex flex-col gap-2">
                          {/* Input */}
                          <div>
                            <div className="text-[10px] uppercase font-bold text-muted-foreground mb-1 tracking-wider">Input:</div>
                            <pre className="p-2 rounded-lg bg-slate-900 text-slate-100 font-mono text-xs whitespace-pre-wrap overflow-x-auto">
                              {tc.input || '(empty)'}
                            </pre>
                          </div>

                          {/* Expected Output */}
                          <div>
                            <div className="text-[10px] uppercase font-bold text-muted-foreground mb-1 tracking-wider">Expected Output:</div>
                            <pre className="p-2 rounded-lg bg-slate-900 text-emerald-400 font-mono text-xs whitespace-pre-wrap overflow-x-auto">
                              {tc.expected_output || '(empty)'}
                            </pre>
                          </div>

                          {/* Candidate Actual Output */}
                          {tc.actual_stdout !== undefined && tc.actual_stdout !== null && (
                            <div>
                              <div className="text-[10px] uppercase font-bold text-muted-foreground mb-1 tracking-wider">Candidate Actual Output:</div>
                              <pre className={`p-2 rounded-lg font-mono text-xs whitespace-pre-wrap overflow-x-auto ${
                                isPassed
                                  ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-rose-950/40 text-rose-300 border border-rose-500/30'
                              }`}>
                                {tc.actual_stdout || '(empty stdout)'}
                              </pre>
                            </div>
                          )}

                          {/* Error if present */}
                          {tc.error && (
                            <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs">
                              <strong className="block font-bold mb-0.5">Execution Error:</strong>
                              <pre className="font-mono text-[11px] whitespace-pre-wrap">{tc.error}</pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}

                {filteredTestCases.length === 0 && (
                  <div className="p-6 text-center text-muted-foreground italic text-xs">
                    No test cases match the selected filter.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Right Pane: Monaco Editor with Answer Toggle Switcher */}
        <div className={`${isExpanded ? 'col-span-1' : 'lg:col-span-7'} flex flex-col gap-2`}>
          {/* Editor Header Bar with Toggle Switcher */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-2.5 rounded-2xl bg-card border border-border/80 shadow-sm">
            {/* Answer Toggle Switch */}
            <div className="flex items-center p-1 bg-muted/60 rounded-xl border border-border/50 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setCodeView('candidate')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                  codeView === 'candidate'
                    ? 'bg-background text-foreground shadow-sm font-bold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <FileCode className="w-3.5 h-3.5 text-blue-500" />
                Candidate's Answer
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-mono font-medium uppercase">
                  {currentProblem.candidate_language || 'code'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setCodeView('correct')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                  codeView === 'correct'
                    ? 'bg-background text-foreground shadow-sm font-bold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                Correct Answer (Reference)
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-medium">
                  Solution
                </span>
              </button>
            </div>

            {/* Action Buttons: Copy & Expand */}
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyCode}
                className="h-8 px-2.5 text-xs font-semibold gap-1.5 rounded-lg border-border"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Code</span>
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="h-8 w-8 p-0 rounded-lg border-border"
                title={isExpanded ? 'Collapse editor view' : 'Expand editor full width'}
              >
                {isExpanded ? (
                  <Minimize2 className="w-3.5 h-3.5" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
              </Button>
            </div>
          </div>

          {/* Monaco Editor Container */}
          <div className={`w-full rounded-2xl overflow-hidden border border-border/80 shadow-md bg-slate-950 transition-all duration-300 ${
            isExpanded ? 'h-[560px]' : 'h-[460px]'
          }`}>
            <Editor
              height="100%"
              language={editorLanguage}
              theme="vs-dark"
              value={
                codeView === 'candidate'
                  ? (currentProblem.candidate_code || '// No candidate answer submitted.')
                  : (currentProblem.correct_code || '// No reference solution provided.')
              }
              options={{
                readOnly: true,
                domReadOnly: true,
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 4,
                wordWrap: 'on',
                renderWhitespace: 'selection',
                scrollbar: {
                  vertical: 'auto',
                  horizontal: 'auto',
                  verticalScrollbarSize: 8,
                  horizontalScrollbarSize: 8,
                },
              }}
            />
          </div>

          {/* Editor Footer Status */}
          <div className="px-3 py-2 rounded-xl bg-card/50 border border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>
                Viewing: <strong className="text-foreground">{codeView === 'candidate' ? "Candidate's Submission" : 'Official Reference Solution'}</strong>
              </span>
            </div>
            <div>
              Language Mode: <span className="font-mono font-bold uppercase text-foreground">{editorLanguage}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
