'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Play,
    CheckCircle2,
    Clock,
    Terminal,
    Code2,
    Loader2,
    AlertCircle,
    Check,
    X,
    Send,
    ChevronDown,
    ChevronUp,
    RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { getApiBaseUrl } from '@/lib/config'

// Dynamically import Monaco Editor to prevent SSR issues
const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false })

interface TestCase {
    id: number
    problem_id: number
    input: string
    expected_output?: string
    weight: number
    is_hidden: boolean
}

interface Problem {
    id: number
    title: string
    description: string
    input_format?: string
    output_format?: string
    constraints?: string
    starter_code?: Record<string, string>
    difficulty: string
    time_limit_ms: number
    memory_limit_mb: number
    test_cases: TestCase[]
}

interface CodingSession {
    allowed_languages: string[]
    duration_minutes: number
    coding_score?: number
    coding_completed: boolean
    problems: Problem[]
    submissions_summary: Array<{
        problem_id: number
        verdict: string
        score: number
        submitted_at: string
    }>
}

interface CodingWorkspaceProps {
    sessionId: string
    token: string
    onCompleted?: (result?: any) => void
}

const LANGUAGE_LABELS: Record<string, { label: string; monacoLang: string }> = {
    python3:    { label: 'Python 3',             monacoLang: 'python'     },
    java21:     { label: 'Java 21',               monacoLang: 'java'       },
    cpp:        { label: 'C++ (GCC 13)',           monacoLang: 'cpp'        },
    javascript: { label: 'JavaScript (Node 20)',   monacoLang: 'javascript' },
    golang:     { label: 'Go 1.22',               monacoLang: 'go'         },
    rust:       { label: 'Rust 1.77',             monacoLang: 'rust'       },
}

const getVerdictBadge = (verdict?: string) => {
    switch (verdict?.toLowerCase()) {
        case 'accepted':
            return <Badge className="border-emerald-500/40 text-emerald-500 bg-emerald-500/10 font-bold">ACCEPTED</Badge>
        case 'wrong_answer':
            return <Badge className="border-rose-500/40 text-rose-500 bg-rose-500/10 font-bold">WRONG ANSWER</Badge>
        case 'compilation_error':
            return <Badge className="border-amber-500/40 text-amber-500 bg-amber-500/10 font-bold">COMPILE ERROR</Badge>
        case 'runtime_error':
            return <Badge className="border-rose-500/40 text-rose-500 bg-rose-500/10 font-bold">RUNTIME ERROR</Badge>
        case 'time_limit_exceeded':
            return <Badge className="border-amber-500/40 text-amber-500 bg-amber-500/10 font-bold">TIME LIMIT EXCEEDED</Badge>
        default:
            return <Badge variant="outline">{verdict?.toUpperCase().replace('_', ' ') || 'UNKNOWN'}</Badge>
    }
}

export default function CodingWorkspace({ sessionId, token, onCompleted }: CodingWorkspaceProps) {
    const [sessionData, setSessionData] = useState<CodingSession | null>(null)
    const [loading, setLoading] = useState(true)
    const [activeProblemIndex, setActiveProblemIndex] = useState(0)
    const [selectedLanguage, setSelectedLanguage] = useState<string>('python3')
    const [codeStore, setCodeStore] = useState<Record<string, string>>({}) // key: `${problemId}_${language}`

    // Execution & Evaluation state
    const [customStdin, setCustomStdin] = useState('')
    const [isCustomInputTab, setIsCustomInputTab] = useState(false)
    const [isRunning, setIsRunning] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [runOutput, setRunOutput] = useState<any>(null)
    const [submitResult, setSubmitResult] = useState<any>(null)
    const [activeOutputTab, setActiveOutputTab] = useState<'tests' | 'custom' | 'console'>('tests')
    const [consoleOpen, setConsoleOpen] = useState(true)

    // Timer
    const [secondsRemaining, setSecondsRemaining] = useState(3600)


    const authHeaders = useCallback(() => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
    }), [token])

    // 1. Fetch Coding Session Data
    const fetchSession = useCallback(async () => {
        try {
            const res = await fetch(`${getApiBaseUrl()}/api/coding/session`, {
                headers: authHeaders(),
            })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.detail || 'Failed to initialize coding assessment session.')
            }
            const data: CodingSession = await res.json()
            setSessionData(data)

            // Select default language
            const defaultLang = data.allowed_languages[0] || 'python3'
            setSelectedLanguage(defaultLang)

            // Server-authoritative countdown: derive from coding_deadline returned by server.
            // This prevents client-side time manipulation. Falls back to duration_minutes if
            // no deadline has been set yet (first call seeds it server-side).
            if (data.coding_deadline) {
                const deadlineMs = new Date(data.coding_deadline).getTime()
                const nowMs = Date.now()
                const remaining = Math.max(0, Math.floor((deadlineMs - nowMs) / 1000))
                setSecondsRemaining(remaining)
            } else {
                setSecondsRemaining((data.duration_minutes || 60) * 60)
            }

            // Pre-seed starter codes
            const initialCodes: Record<string, string> = {}
            data.problems.forEach(p => {
                data.allowed_languages.forEach(lang => {
                    const key = `${p.id}_${lang}`
                    if (p.starter_code && p.starter_code[lang]) {
                        initialCodes[key] = p.starter_code[lang]
                    } else {
                        // Default starters for each supported language
                        const defaults: Record<string, string> = {
                            python3:    'import sys\n\ndef solve():\n    # Write your code here\n    pass\n\nif __name__ == "__main__":\n    solve()',
                            java21:     'import java.util.*;\n\npublic class Solution {\n    public static void main(String[] args) {\n        Scanner scanner = new Scanner(System.in);\n        // Write your solution here\n    }\n}',
                            cpp:        '#include <iostream>\nusing namespace std;\n\nint main() {\n    // Write your solution here\n    return 0;\n}',
                            javascript: 'const fs = require(\'fs\');\n\nfunction solve() {\n    const input = fs.readFileSync(0, \'utf-8\');\n    // Write your solution here\n}\n\nsolve();',
                            golang:     'package main\n\nimport "fmt"\n\nfunc main() {\n    // Write your solution here\n}',
                            rust:       'use std::io::{self, Read};\n\nfn main() {\n    let mut input = String::new();\n    io::stdin().read_to_string(&mut input).unwrap();\n    // Write your solution here\n}',
                        }
                        initialCodes[key] = defaults[lang] ?? `// ${lang} solution`
                    }
                })
            })
            setCodeStore(initialCodes)
        } catch (err: any) {
            toast.error(err.message || 'Error loading coding session.')
        } finally {
            setLoading(false)
        }
    }, [authHeaders])

    useEffect(() => {
        fetchSession()
    }, [fetchSession])

    // 2. Countdown Timer
    useEffect(() => {
        if (secondsRemaining <= 0) return
        const timer = setInterval(() => {
            setSecondsRemaining(prev => {
                if (prev <= 1) {
                    clearInterval(timer)
                    handleCompleteAssessment()
                    return 0
                }
                return prev - 1
            })
        }, 1000)
        return () => clearInterval(timer)
    }, [secondsRemaining])

    const formatTimer = (totalSeconds: number) => {
        const mins = Math.floor(totalSeconds / 60)
        const secs = totalSeconds % 60
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    }

    const currentProblem = sessionData?.problems[activeProblemIndex]
    const currentCodeKey = currentProblem ? `${currentProblem.id}_${selectedLanguage}` : ''
    const currentCode = codeStore[currentCodeKey] || ''

    const handleCodeChange = (val: string | undefined) => {
        if (!currentCodeKey) return
        setCodeStore(prev => ({
            ...prev,
            [currentCodeKey]: val || '',
        }))
    }

    // 3. Run Code (against sample test cases or custom stdin)
    const handleRunCode = async () => {
        if (!currentProblem) return
        setIsRunning(true)
        setRunOutput(null)
        setConsoleOpen(true)

        try {
            const payload: any = {
                problem_id: currentProblem.id,
                language: selectedLanguage,
                source_code: currentCode,
            }
            if (isCustomInputTab && customStdin.trim()) {
                payload.custom_stdin = customStdin
            }

            const res = await fetch(`${getApiBaseUrl()}/api/coding/run`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify(payload),
            })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.detail || 'Code run failed.')
            }
            const data = await res.json()
            setRunOutput(data)
            if (data.is_custom_input) {
                setActiveOutputTab('custom')
            } else {
                setActiveOutputTab('tests')
            }
            if (data.verdict === 'accepted') {
                toast.success('Sample tests passed!')
            } else if (data.verdict === 'compilation_error') {
                toast.error('Compilation Error')
            } else if (data.verdict === 'runtime_error') {
                toast.error('Runtime Error')
            } else if (data.verdict === 'time_limit_exceeded') {
                toast.error('Time Limit Exceeded')
            } else if (data.verdict === 'wrong_answer') {
                toast.warning('Wrong Answer on sample tests')
            } else {
                toast.success('Run complete')
            }
        } catch (err: any) {
            toast.error(err.message || 'Failed to run code')
        } finally {
            setIsRunning(false)
        }
    }

    // 4. Submit Code (evaluates against all official test cases)
    const handleSubmitCode = async () => {
        if (!currentProblem) return
        setIsSubmitting(true)
        setSubmitResult(null)
        setConsoleOpen(true)

        try {
            const payload = {
                problem_id: currentProblem.id,
                language: selectedLanguage,
                source_code: currentCode,
            }

            const res = await fetch(`${getApiBaseUrl()}/api/coding/submit`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify(payload),
            })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.detail || 'Submission failed.')
            }
            const data = await res.json()
            setSubmitResult(data)
            setActiveOutputTab('tests')

            if (data.verdict === 'accepted') {
                toast.success(`Problem ${currentProblem.title} Passed! Score: ${data.score}%`)
            } else {
                toast.warning(`Verdict: ${data.verdict.toUpperCase().replace('_', ' ')} (${data.passed_tests}/${data.total_tests} passed)`)
            }
            // Refresh session summary
            fetchSession()
        } catch (err: any) {
            toast.error(err.message || 'Submission error')
        } finally {
            setIsSubmitting(false)
        }
    }

    // 5. Complete Coding Assessment
    const handleCompleteAssessment = async () => {
        try {
            const res = await fetch(`${getApiBaseUrl()}/api/coding/complete`, {
                method: 'POST',
                headers: authHeaders(),
            })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.detail || 'Failed to finalize assessment.')
            }
            const result = await res.json()
            toast.success('Coding Assessment submitted successfully!')
            if (onCompleted) {
                onCompleted(result)
            }
        } catch (err: any) {
            toast.error(err.message || 'Failed to complete coding round')
        }
    }

    if (loading) {
        return (
            <div className="h-[80vh] flex flex-col items-center justify-center gap-4 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm font-medium">Preparing Coding Sandbox...</p>
            </div>
        )
    }

    if (!sessionData || sessionData.problems.length === 0) {
        return (
            <div className="p-12 text-center text-muted-foreground">
                <AlertCircle className="h-10 w-10 mx-auto mb-3 text-amber-500" />
                <h3 className="text-lg font-semibold text-foreground">No Coding Problems Available</h3>
                <p className="text-sm mt-1">This assessment has no active problems assigned. Please contact HR.</p>
            </div>
        )
    }

    const currentLangConfig = LANGUAGE_LABELS[selectedLanguage] || { label: selectedLanguage, monacoLang: 'plaintext' }

    return (
        <div className="h-[calc(100vh-5rem)] flex flex-col bg-background border border-border/70 rounded-2xl overflow-hidden shadow-2xl animate-in fade-in duration-300">
            {/* ── Top Bar ── */}
            <div className="h-14 px-4 border-b border-border/80 bg-card/70 backdrop-blur-md flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Code2 className="h-5 w-5 text-primary" />
                        <span className="font-bold text-sm text-foreground">Coding Assessment</span>
                    </div>

                    {/* Problem Tabs */}
                    <div className="flex items-center gap-1.5 ml-4">
                        {sessionData.problems.map((p, idx) => {
                            const isSelected = idx === activeProblemIndex
                            const bestSub = sessionData.submissions_summary.find(s => s.problem_id === p.id)
                            return (
                                <button
                                    key={p.id}
                                    onClick={() => setActiveProblemIndex(idx)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                                        isSelected
                                            ? 'bg-primary text-primary-foreground shadow-sm'
                                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                                    }`}
                                >
                                    <span>Problem {idx + 1}</span>
                                    {bestSub && (
                                        bestSub.verdict === 'accepted' ? (
                                            <Check className="h-3 w-3 text-emerald-300" />
                                        ) : (
                                            <span className="text-[10px] opacity-80">{bestSub.score}%</span>
                                        )
                                    )}
                                </button>
                            )
                        })}
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* Language Selector */}
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground hidden sm:inline">Language:</span>
                        <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
                            <SelectTrigger className="h-9 w-36 text-xs bg-background">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {sessionData.allowed_languages.map(lang => (
                                    <SelectItem key={lang} value={lang} className="text-xs">
                                        {LANGUAGE_LABELS[lang]?.label || lang}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Timer Badge */}
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 font-mono text-xs font-semibold border border-amber-500/20">
                        <Clock className="h-3.5 w-3.5" />
                        <span>{formatTimer(secondsRemaining)}</span>
                    </div>

                    {/* Run Button */}
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleRunCode}
                        disabled={isRunning || isSubmitting}
                        className="gap-1.5 text-xs h-9 bg-muted hover:bg-muted/80"
                    >
                        {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                        Run
                    </Button>

                    {/* Submit Button */}
                    <Button
                        size="sm"
                        onClick={handleSubmitCode}
                        disabled={isRunning || isSubmitting}
                        className="gap-1.5 text-xs h-9 bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                        {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                        Submit
                    </Button>

                    {/* Complete Button */}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCompleteAssessment}
                        className="text-xs h-9 text-rose-600 hover:text-rose-700 hover:bg-rose-500/10 border-rose-500/30 ml-2"
                    >
                        Finish Round
                    </Button>
                </div>
            </div>

            {/* ── Main Workspace Body ── */}
            <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
                {/* ── Left Pane: Problem Description & Test Cases ── */}
                <div className="w-full md:w-5/12 h-1/2 md:h-full border-b md:border-b-0 md:border-r border-border/80 overflow-y-auto p-5 space-y-5 bg-card/30">
                    {currentProblem && (
                        <>
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <h2 className="text-xl font-bold text-foreground">{currentProblem.title}</h2>
                                    <Badge
                                        variant="outline"
                                        className={
                                            currentProblem.difficulty === 'easy'
                                                ? 'border-emerald-500/30 text-emerald-600 bg-emerald-500/10'
                                                : currentProblem.difficulty === 'hard'
                                                ? 'border-rose-500/30 text-rose-600 bg-rose-500/10'
                                                : 'border-amber-500/30 text-amber-600 bg-amber-500/10'
                                        }
                                    >
                                        {currentProblem.difficulty.toUpperCase()}
                                    </Badge>
                                </div>
                                <div className="text-xs text-muted-foreground flex items-center gap-4">
                                    <span>Time Limit: {currentProblem.time_limit_ms}ms</span>
                                    <span>Memory: {currentProblem.memory_limit_mb}MB</span>
                                </div>
                            </div>

                            <div className="prose dark:prose-invert text-sm max-w-none space-y-3">
                                <p className="whitespace-pre-line leading-relaxed text-foreground/90">
                                    {currentProblem.description}
                                </p>

                                {currentProblem.input_format && (
                                    <div>
                                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mt-4 mb-1">
                                            Input Format
                                        </h4>
                                        <p className="text-xs bg-muted/40 p-2.5 rounded-lg border border-border/60 whitespace-pre-wrap font-mono">
                                            {currentProblem.input_format}
                                        </p>
                                    </div>
                                )}

                                {currentProblem.output_format && (
                                    <div>
                                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mt-4 mb-1">
                                            Output Format
                                        </h4>
                                        <p className="text-xs bg-muted/40 p-2.5 rounded-lg border border-border/60 whitespace-pre-wrap font-mono">
                                            {currentProblem.output_format}
                                        </p>
                                    </div>
                                )}

                                {currentProblem.constraints && (
                                    <div>
                                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mt-4 mb-1">
                                            Constraints
                                        </h4>
                                        <p className="text-xs bg-muted/40 p-2.5 rounded-lg border border-border/60 whitespace-pre-wrap font-mono">
                                            {currentProblem.constraints}
                                        </p>
                                    </div>
                                )}

                                {/* Public Sample Test Cases */}
                                <div>
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mt-4 mb-2">
                                        Sample Test Cases
                                    </h4>
                                    <div className="space-y-3">
                                        {currentProblem.test_cases?.filter(tc => !tc.is_hidden).map((tc, idx) => (
                                            <div key={tc.id || idx} className="p-3 bg-muted/30 border border-border/70 rounded-xl space-y-2 text-xs">
                                                <span className="font-semibold text-foreground">Sample {idx + 1}</span>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div>
                                                        <span className="text-[10px] text-muted-foreground uppercase">Input</span>
                                                        <pre className="p-2 mt-0.5 rounded bg-background border border-border font-mono text-[11px] overflow-x-auto">
                                                            {tc.input || '(empty)'}
                                                        </pre>
                                                    </div>
                                                    <div>
                                                        <span className="text-[10px] text-muted-foreground uppercase">Expected Output</span>
                                                        <pre className="p-2 mt-0.5 rounded bg-background border border-border font-mono text-[11px] overflow-x-auto">
                                                            {tc.expected_output || '(empty)'}
                                                        </pre>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* ── Right Pane: Monaco Editor & Output Console ── */}
                <div className="w-full md:w-7/12 h-1/2 md:h-full flex flex-col min-h-0">
                    {/* Monaco Editor Container */}
                    <div className="flex-1 min-h-0 relative">
                        <Editor
                            height="100%"
                            language={currentLangConfig.monacoLang}
                            theme="vs-dark"
                            value={currentCode}
                            onChange={handleCodeChange}
                            options={{
                                minimap: { enabled: false },
                                fontSize: 13,
                                lineNumbers: 'on',
                                scrollBeyondLastLine: false,
                                automaticLayout: true,
                                tabSize: 4,
                                renderWhitespace: 'selection',
                            }}
                        />
                    </div>

                    {/* Collapsible Output Console */}
                    <div className={`border-t border-border/80 bg-card/95 backdrop-blur-md flex flex-col transition-all duration-200 ${
                        consoleOpen ? 'h-80 sm:h-96' : 'h-10'
                    }`}>
                        {/* Console Header Bar */}
                        <div className="h-10 px-4 border-b border-border/60 flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-4 text-xs font-semibold">
                                <button
                                    onClick={() => { setActiveOutputTab('tests'); setIsCustomInputTab(false) }}
                                    className={`flex items-center gap-1.5 py-1 ${activeOutputTab === 'tests' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                                >
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Test Results
                                </button>
                                <button
                                    onClick={() => { setActiveOutputTab('custom'); setIsCustomInputTab(true) }}
                                    className={`flex items-center gap-1.5 py-1 ${activeOutputTab === 'custom' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                                >
                                    <Terminal className="h-3.5 w-3.5" />
                                    Custom Input
                                </button>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setConsoleOpen(!consoleOpen)}
                                className="h-7 w-7 text-muted-foreground"
                            >
                                {consoleOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                            </Button>
                        </div>

                        {/* Console Content */}
                        {consoleOpen && (
                            <div className="flex-1 min-h-0 p-4 overflow-y-auto font-mono text-xs space-y-4">
                                {activeOutputTab === 'custom' ? (
                                    <div className="space-y-3 h-full flex flex-col">
                                        <div className="space-y-1">
                                            <span className="text-muted-foreground text-[11px]">Provide custom stdin string to pass to the program:</span>
                                            <textarea
                                                value={customStdin}
                                                onChange={(e) => setCustomStdin(e.target.value)}
                                                placeholder="Custom input data..."
                                                rows={3}
                                                className="w-full p-2.5 text-xs bg-background border border-border rounded-lg focus:outline-none"
                                            />
                                        </div>
                                        {runOutput?.is_custom_input && (
                                            <div className="space-y-2 flex-1 min-h-0">
                                                <div className="flex items-center justify-between">
                                                    <span className="font-semibold text-foreground">Standard Output:</span>
                                                    {runOutput.time_ms !== undefined && (
                                                        <span className="text-[11px] text-muted-foreground">{runOutput.time_ms}ms</span>
                                                    )}
                                                </div>
                                                <pre className="p-3 bg-muted/40 rounded-lg border border-border/80 text-foreground overflow-x-auto max-h-32">
                                                    {runOutput.stdout || '(no output)'}
                                                </pre>
                                                {(runOutput.error || runOutput.compilation_error || runOutput.stderr) && (
                                                    <div className="space-y-1">
                                                        <span className="text-[11px] font-bold text-rose-500">Error / Stderr:</span>
                                                        <pre className="p-3 bg-rose-500/10 text-rose-300 rounded-lg border border-rose-500/30 overflow-x-auto max-h-36 whitespace-pre-wrap">
                                                            {runOutput.error || runOutput.compilation_error || runOutput.stderr}
                                                        </pre>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    /* Test Results tab */
                                    <div>
                                        {submitResult ? (
                                            <div className="space-y-4">
                                                <div className="flex items-center justify-between p-3 bg-muted/40 rounded-xl border border-border">
                                                    <div className="flex items-center gap-2.5">
                                                        {getVerdictBadge(submitResult.verdict)}
                                                        <span className="text-muted-foreground text-xs font-medium">
                                                            Passed {submitResult.passed_tests} of {submitResult.total_tests} test cases
                                                        </span>
                                                    </div>
                                                    <span className="font-bold text-foreground text-sm">
                                                        Score: {submitResult.score}%
                                                    </span>
                                                </div>

                                                {/* Prominent Submission Error Banner */}
                                                {submitResult.error && (
                                                    <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-xl space-y-2">
                                                        <div className="flex items-center gap-2 text-xs font-bold text-rose-500">
                                                            <AlertCircle className="h-4 w-4 shrink-0" />
                                                            <span>{submitResult.verdict === 'compilation_error' ? 'Compilation Error' : 'Runtime Error / Traceback'}</span>
                                                        </div>
                                                        <pre className="p-3 bg-black/70 rounded-lg text-xs font-mono text-rose-300 overflow-x-auto whitespace-pre-wrap max-h-48 border border-rose-500/20 leading-relaxed select-text">
                                                            {submitResult.error}
                                                        </pre>
                                                    </div>
                                                )}

                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                                    {submitResult.test_results?.map((tr: any, idx: number) => (
                                                        <div
                                                            key={idx}
                                                            className={`p-3 rounded-xl border text-xs flex flex-col gap-1.5 ${
                                                                tr.passed ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5'
                                                            }`}
                                                        >
                                                            <div className="flex items-center justify-between">
                                                                <div className="flex items-center gap-2">
                                                                    {tr.passed ? (
                                                                        <Check className="h-4 w-4 text-emerald-500" />
                                                                    ) : (
                                                                        <X className="h-4 w-4 text-rose-500" />
                                                                    )}
                                                                    <span className="font-semibold text-foreground">
                                                                        Test Case {idx + 1} {tr.is_hidden && '(Hidden)'}
                                                                    </span>
                                                                </div>
                                                                <span className="text-[11px] text-muted-foreground font-mono">{tr.execution_time_ms}ms</span>
                                                            </div>
                                                            {tr.error && (
                                                                <pre className="p-2 bg-rose-500/10 border border-rose-500/20 rounded text-[11px] font-mono text-rose-400 whitespace-pre-wrap">
                                                                    {tr.error}
                                                                </pre>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : runOutput && !runOutput.is_custom_input ? (
                                            <div className="space-y-4">
                                                <div className="flex items-center justify-between p-3 bg-muted/40 rounded-xl border border-border">
                                                    <div className="flex items-center gap-2.5">
                                                        {getVerdictBadge(runOutput.verdict)}
                                                        <span className="text-xs text-muted-foreground font-medium">
                                                            Sample Tests: {runOutput.passed_tests}/{runOutput.total_tests} Passed
                                                        </span>
                                                    </div>
                                                    {runOutput.time_ms !== undefined && (
                                                        <span className="text-xs text-muted-foreground font-mono">
                                                            {runOutput.time_ms}ms
                                                        </span>
                                                    )}
                                                </div>

                                                {/* LeetCode-style prominent error banner */}
                                                {(runOutput.error || runOutput.compilation_error || runOutput.stderr) && (
                                                    <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-xl space-y-2">
                                                        <div className="flex items-center gap-2 text-xs font-bold text-rose-500">
                                                            <AlertCircle className="h-4 w-4 shrink-0" />
                                                            <span>{runOutput.verdict === 'compilation_error' ? 'Compilation Error' : 'Runtime Error / Traceback'}</span>
                                                        </div>
                                                        <pre className="p-3 bg-black/70 rounded-lg text-xs font-mono text-rose-300 overflow-x-auto whitespace-pre-wrap max-h-48 border border-rose-500/20 leading-relaxed select-text">
                                                            {runOutput.error || runOutput.compilation_error || runOutput.stderr}
                                                        </pre>
                                                    </div>
                                                )}

                                                {/* Detailed Sample Test Results */}
                                                {runOutput.test_results && runOutput.test_results.length > 0 && (
                                                    <div className="space-y-3">
                                                        {runOutput.test_results.map((tr: any, idx: number) => {
                                                            const sampleCases = currentProblem?.test_cases?.filter(tc => !tc.is_hidden) || [];
                                                            const tc = sampleCases[idx];
                                                            return (
                                                                <div key={idx} className="p-3.5 border border-border/80 rounded-xl space-y-2.5 bg-background/50">
                                                                    <div className="flex items-center justify-between font-semibold text-xs">
                                                                        <div className="flex items-center gap-2">
                                                                            {tr.passed ? (
                                                                                <Check className="h-4 w-4 text-emerald-500" />
                                                                            ) : (
                                                                                <X className="h-4 w-4 text-rose-500" />
                                                                            )}
                                                                            <span>Case {idx + 1}</span>
                                                                        </div>
                                                                        <div className="flex items-center gap-2">
                                                                            <Badge
                                                                                variant="outline"
                                                                                className={tr.passed
                                                                                    ? 'border-emerald-500/30 text-emerald-600 bg-emerald-500/10'
                                                                                    : 'border-rose-500/30 text-rose-600 bg-rose-500/10'
                                                                                }
                                                                            >
                                                                                {tr.passed ? 'PASSED' : (tr.error ? 'RUNTIME ERROR' : 'WRONG ANSWER')}
                                                                            </Badge>
                                                                            {tr.execution_time_ms !== undefined && (
                                                                                <span className="text-[11px] text-muted-foreground font-mono">{tr.execution_time_ms}ms</span>
                                                                            )}
                                                                        </div>
                                                                    </div>

                                                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs pt-1">
                                                                        {tc && (
                                                                            <div>
                                                                                <span className="text-[10px] uppercase font-bold text-muted-foreground">Input</span>
                                                                                <pre className="p-2 mt-1 bg-muted/40 rounded border border-border/60 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap">{tc.input || '(empty)'}</pre>
                                                                            </div>
                                                                        )}
                                                                        <div>
                                                                            <span className="text-[10px] uppercase font-bold text-muted-foreground">Your Output</span>
                                                                            <pre className={`p-2 mt-1 bg-muted/40 rounded border border-border/60 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap ${tr.passed ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                                                {tr.actual_stdout ?? '(no output)'}
                                                                            </pre>
                                                                        </div>
                                                                        <div>
                                                                            <span className="text-[10px] uppercase font-bold text-muted-foreground">Expected</span>
                                                                            <pre className="p-2 mt-1 bg-muted/40 rounded border border-border/60 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap text-muted-foreground">
                                                                                {tr.expected_stdout ?? tc?.expected_output ?? '(empty)'}
                                                                            </pre>
                                                                        </div>
                                                                    </div>

                                                                    {tr.error && (
                                                                        <div className="mt-1">
                                                                            <span className="text-[10px] uppercase font-bold text-rose-500">Error / Stderr</span>
                                                                            <pre className="p-2.5 mt-1 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg font-mono text-[11px] whitespace-pre-wrap overflow-x-auto">
                                                                                {tr.error}
                                                                            </pre>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                                                Click &quot;Run&quot; to test your code against sample cases, or &quot;Submit&quot; for complete evaluation.
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
