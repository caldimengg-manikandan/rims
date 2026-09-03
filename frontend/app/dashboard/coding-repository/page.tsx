'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from '@/components/ui/dialog'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { APIClient } from '@/app/dashboard/lib/api-client'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { Badge } from "@/components/ui/badge"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Code2,
    Plus,
    Pencil,
    Trash2,
    Loader2,
    CheckCircle2,
    AlertCircle,
    Play,
    Layers,
    Clock,
    Cpu,
    Eye,
    EyeOff,
    Check,
} from 'lucide-react'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"

interface TestCase {
    id?: number
    input: string
    expected_output: string
    weight: number
    is_hidden: boolean
    display_order?: number
}

interface Problem {
    id: number
    title: string
    description: string
    input_format?: string
    output_format?: string
    constraints?: string
    starter_code?: Record<string, string>
    solution_code?: string
    difficulty: string
    time_limit_ms: number
    memory_limit_mb: number
    test_cases: TestCase[]
    created_at: string
}

interface QuestionSetItem {
    problem_id: number
    display_order: number
    problem?: Problem
}

interface QuestionSet {
    id: number
    title: string
    description?: string
    supported_languages: string[]
    items: QuestionSetItem[]
    created_at: string
}

const AVAILABLE_LANGUAGES = [
    { id: 'python3', label: 'Python 3' },
    { id: 'java21', label: 'Java 21' },
]

export default function CodingRepositoryPage() {
    const [activeTab, setActiveTab] = useState<'problems' | 'sets'>('problems')
    const [problems, setProblems] = useState<Problem[]>([])
    const [questionSets, setQuestionSets] = useState<QuestionSet[]>([])
    const [loading, setLoading] = useState(true)

    // Problem Modal State
    const [problemModalOpen, setProblemModalOpen] = useState(false)
    const [editingProblem, setEditingProblem] = useState<Problem | null>(null)
    const [problemTitle, setProblemTitle] = useState('')
    const [problemDesc, setProblemDesc] = useState('')
    const [inputFormat, setInputFormat] = useState('')
    const [outputFormat, setOutputFormat] = useState('')
    const [constraints, setConstraints] = useState('')
    const [difficulty, setDifficulty] = useState('medium')
    const [timeLimitMs, setTimeLimitMs] = useState(2000)
    const [memoryLimitMb, setMemoryLimitMb] = useState(256)
    const [solutionCode, setSolutionCode] = useState('')
    const [pyStarter, setPyStarter] = useState('def solution():\n    # Write your code here\n    pass\n\nif __name__ == "__main__":\n    solution()')
    const [javaStarter, setJavaStarter] = useState('import java.util.*;\n\npublic class Solution {\n    public static void main(String[] args) {\n        Scanner scanner = new Scanner(System.in);\n        // Write your solution here\n    }\n}')
    const [testCases, setTestCases] = useState<TestCase[]>([
        { input: '5\n1 2 3 4 5', expected_output: '15', weight: 1.0, is_hidden: false },
        { input: '3\n10 20 30', expected_output: '60', weight: 1.0, is_hidden: true },
    ])
    const [savingProblem, setSavingProblem] = useState(false)

    // Validation Report Modal
    const [validationModalOpen, setValidationModalOpen] = useState(false)
    const [validatingProblemId, setValidatingProblemId] = useState<number | null>(null)
    const [validationReport, setValidationReport] = useState<any>(null)

    // Question Set Modal State
    const [setModalOpen, setSetModalOpen] = useState(false)
    const [editingSet, setEditingSet] = useState<QuestionSet | null>(null)
    const [setTitle, setSetTitle] = useState('')
    const [setDescription, setSetDescription] = useState('')
    const [supportedLangs, setSupportedLangs] = useState<string[]>(['python3', 'java21'])
    const [selectedProblemIds, setSelectedProblemIds] = useState<number[]>([])
    const [savingSet, setSavingSet] = useState(false)

    // Delete Confirmation
    const [deleteTarget, setDeleteTarget] = useState<{ type: 'problem' | 'set'; id: number; title: string } | null>(null)

    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const [problemsRes, setsRes] = await Promise.all([
                APIClient.get<Problem[]>('/api/coding/problems'),
                APIClient.get<QuestionSet[]>('/api/coding/question-sets'),
            ])
            setProblems(problemsRes || [])
            setQuestionSets(setsRes || [])
        } catch (err: any) {
            toast.error(err.message || 'Failed to load coding repository data')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    // Problem CRUD handlers
    const openCreateProblem = () => {
        setEditingProblem(null)
        setProblemTitle('')
        setProblemDesc('')
        setInputFormat('')
        setOutputFormat('')
        setConstraints('')
        setDifficulty('medium')
        setTimeLimitMs(2000)
        setMemoryLimitMb(256)
        setSolutionCode('')
        setPyStarter('def solution():\n    # Write your code here\n    pass\n\nif __name__ == "__main__":\n    solution()')
        setJavaStarter('import java.util.*;\n\npublic class Solution {\n    public static void main(String[] args) {\n        Scanner scanner = new Scanner(System.in);\n        // Write your solution here\n    }\n}')
        setTestCases([
            { input: '', expected_output: '', weight: 1.0, is_hidden: false },
        ])
        setProblemModalOpen(true)
    }

    const openEditProblem = async (p: Problem) => {
        setEditingProblem(p)
        try {
            const detail = await APIClient.get<Problem>(`/api/coding/problems/${p.id}`)
            setProblemTitle(detail.title)
            setProblemDesc(detail.description)
            setInputFormat(detail.input_format || '')
            setOutputFormat(detail.output_format || '')
            setConstraints(detail.constraints || '')
            setDifficulty(detail.difficulty)
            setTimeLimitMs(detail.time_limit_ms)
            setMemoryLimitMb(detail.memory_limit_mb)
            setSolutionCode(detail.solution_code || '')
            setPyStarter(detail.starter_code?.python3 || '')
            setJavaStarter(detail.starter_code?.java21 || '')
            setTestCases(detail.test_cases || [])
            setProblemModalOpen(true)
        } catch (err: any) {
            toast.error(err.message || 'Failed to load problem details')
        }
    }

    const handleSaveProblem = async () => {
        if (!problemTitle.trim() || !problemDesc.trim() || !solutionCode.trim()) {
            toast.error('Title, description, and reference solution are required.')
            return
        }
        if (testCases.length === 0) {
            toast.error('At least one test case is required.')
            return
        }

        setSavingProblem(true)
        try {
            const payload = {
                title: problemTitle.trim(),
                description: problemDesc.trim(),
                input_format: inputFormat.trim() || null,
                output_format: outputFormat.trim() || null,
                constraints: constraints.trim() || null,
                difficulty,
                time_limit_ms: Number(timeLimitMs),
                memory_limit_mb: Number(memoryLimitMb),
                solution_code: solutionCode.trim(),
                starter_code: {
                    python3: pyStarter,
                    java21: javaStarter,
                },
                test_cases: testCases.map((tc, idx) => ({
                    input: tc.input,
                    expected_output: tc.expected_output,
                    weight: Number(tc.weight) || 1.0,
                    is_hidden: Boolean(tc.is_hidden),
                    display_order: idx + 1,
                })),
            }

            if (editingProblem) {
                await APIClient.put(`/api/coding/problems/${editingProblem.id}`, payload)
                toast.success('Problem updated successfully')
            } else {
                await APIClient.post('/api/coding/problems', payload)
                toast.success('Problem created successfully')
            }
            setProblemModalOpen(false)
            fetchData()
        } catch (err: any) {
            toast.error(err.message || 'Failed to save problem')
        } finally {
            setSavingProblem(false)
        }
    }

    const handleValidateSolution = async (problemId: number) => {
        setValidatingProblemId(problemId)
        try {
            const report = await APIClient.post(`/api/coding/problems/${problemId}/validate-solution`, {})
            setValidationReport(report)
            setValidationModalOpen(true)
            fetchData()
        } catch (err: any) {
            toast.error(err.message || 'Solution validation failed')
        } finally {
            setValidatingProblemId(null)
        }
    }

    // Question Set CRUD handlers
    const openCreateSet = () => {
        setEditingSet(null)
        setSetTitle('')
        setSetDescription('')
        setSupportedLangs(['python3', 'java21'])
        setSelectedProblemIds([])
        setSetModalOpen(true)
    }

    const openEditSet = (qs: QuestionSet) => {
        setEditingSet(qs)
        setSetTitle(qs.title)
        setSetDescription(qs.description || '')
        setSupportedLangs(qs.supported_languages || ['python3', 'java21'])
        setSelectedProblemIds(qs.items?.map(it => it.problem_id) || [])
        setSetModalOpen(true)
    }

    const handleSaveSet = async () => {
        if (!setTitle.trim()) {
            toast.error('Question set title is required.')
            return
        }
        if (supportedLangs.length === 0) {
            toast.error('Select at least one supported language for the question set.')
            return
        }

        setSavingSet(true)
        try {
            const payload = {
                title: setTitle.trim(),
                description: setDescription.trim() || null,
                supported_languages: supportedLangs,
                problem_ids: selectedProblemIds,
            }

            if (editingSet) {
                await APIClient.put(`/api/coding/question-sets/${editingSet.id}`, payload)
                toast.success('Question set updated successfully')
            } else {
                await APIClient.post('/api/coding/question-sets', payload)
                toast.success('Question set created successfully')
            }
            setSetModalOpen(false)
            fetchData()
        } catch (err: any) {
            toast.error(err.message || 'Failed to save question set')
        } finally {
            setSavingSet(false)
        }
    }

    const handleDelete = async () => {
        if (!deleteTarget) return
        try {
            if (deleteTarget.type === 'problem') {
                await APIClient.delete(`/api/coding/problems/${deleteTarget.id}`)
                toast.success('Problem deleted')
            } else {
                await APIClient.delete(`/api/coding/question-sets/${deleteTarget.id}`)
                toast.success('Question set deleted')
            }
            setDeleteTarget(null)
            fetchData()
        } catch (err: any) {
            toast.error(err.message || 'Delete failed')
        }
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <PageHeader
                title="Coding Assessment Repository"
                description="Manage algorithmic problems, test cases, and question sets for candidate coding assessments."
                icon={Code2}
            />

            {/* Navigation Tabs */}
            <div className="flex items-center gap-2 border-b border-border pb-3">
                <Button
                    variant={activeTab === 'problems' ? 'default' : 'ghost'}
                    onClick={() => setActiveTab('problems')}
                    className="gap-2"
                >
                    <Code2 className="h-4 w-4" />
                    Coding Problems ({problems.length})
                </Button>
                <Button
                    variant={activeTab === 'sets' ? 'default' : 'ghost'}
                    onClick={() => setActiveTab('sets')}
                    className="gap-2"
                >
                    <Layers className="h-4 w-4" />
                    Coding Question Sets ({questionSets.length})
                </Button>
            </div>

            {loading ? (
                <div className="py-20 flex flex-col items-center justify-center text-muted-foreground gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm">Loading repository items...</p>
                </div>
            ) : activeTab === 'problems' ? (
                /* Problems View */
                <Card className="border border-border/80 bg-card/60 backdrop-blur-sm">
                    <div className="p-4 flex items-center justify-between border-b border-border/60">
                        <div>
                            <h3 className="font-semibold text-foreground">Coding Problems</h3>
                            <p className="text-xs text-muted-foreground">Individual algorithmic challenges evaluated against hidden and public test cases.</p>
                        </div>
                        <Button onClick={openCreateProblem} className="gap-2">
                            <Plus className="h-4 w-4" /> Create Problem
                        </Button>
                    </div>
                    <CardContent className="p-0">
                        {problems.length === 0 ? (
                            <div className="p-12 text-center text-muted-foreground space-y-2">
                                <Code2 className="h-10 w-10 mx-auto opacity-40" />
                                <p className="font-medium">No coding problems found</p>
                                <p className="text-xs">Create your first coding problem to build technical rounds.</p>
                            </div>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Title</TableHead>
                                        <TableHead>Difficulty</TableHead>
                                        <TableHead>Limits</TableHead>
                                        <TableHead>Test Cases</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {problems.map((p) => (
                                        <TableRow key={p.id}>
                                            <TableCell className="font-medium">
                                                <div className="space-y-0.5">
                                                    <span className="text-foreground">{p.title}</span>
                                                    <p className="text-xs text-muted-foreground line-clamp-1">{p.description}</p>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge
                                                    variant="outline"
                                                    className={
                                                        p.difficulty === 'easy'
                                                            ? 'border-emerald-500/30 text-emerald-600 bg-emerald-500/10'
                                                            : p.difficulty === 'hard'
                                                            ? 'border-rose-500/30 text-rose-600 bg-rose-500/10'
                                                            : 'border-amber-500/30 text-amber-600 bg-amber-500/10'
                                                    }
                                                >
                                                    {p.difficulty.toUpperCase()}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">
                                                <div className="flex items-center gap-3">
                                                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {p.time_limit_ms}ms</span>
                                                    <span className="flex items-center gap-1"><Cpu className="h-3 w-3" /> {p.memory_limit_mb}MB</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-1 text-xs">
                                                    <span className="font-semibold text-foreground">{p.test_cases?.length || 0}</span>
                                                    <span className="text-muted-foreground">
                                                        ({p.test_cases?.filter(tc => !tc.is_hidden).length || 0} public, {p.test_cases?.filter(tc => tc.is_hidden).length || 0} hidden)
                                                    </span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleValidateSolution(p.id)}
                                                        disabled={validatingProblemId === p.id}
                                                        className="text-primary hover:bg-primary/10 gap-1 text-xs"
                                                    >
                                                        {validatingProblemId === p.id ? (
                                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                        ) : (
                                                            <Play className="h-3.5 w-3.5" />
                                                        )}
                                                        Validate
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => openEditProblem(p)}
                                                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                                    >
                                                        <Pencil className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => setDeleteTarget({ type: 'problem', id: p.id, title: p.title })}
                                                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            ) : (
                /* Question Sets View */
                <Card className="border border-border/80 bg-card/60 backdrop-blur-sm">
                    <div className="p-4 flex items-center justify-between border-b border-border/60">
                        <div>
                            <h3 className="font-semibold text-foreground">Coding Question Sets</h3>
                            <p className="text-xs text-muted-foreground">Defined language support policy and ordered bundles of problems attached to Jobs.</p>
                        </div>
                        <Button onClick={openCreateSet} className="gap-2">
                            <Plus className="h-4 w-4" /> Create Question Set
                        </Button>
                    </div>
                    <CardContent className="p-0">
                        {questionSets.length === 0 ? (
                            <div className="p-12 text-center text-muted-foreground space-y-2">
                                <Layers className="h-10 w-10 mx-auto opacity-40" />
                                <p className="font-medium">No question sets created yet</p>
                                <p className="text-xs">Create a question set to select languages and bundle coding problems together.</p>
                            </div>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Title</TableHead>
                                        <TableHead>Supported Languages</TableHead>
                                        <TableHead>Problems</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {questionSets.map((qs) => (
                                        <TableRow key={qs.id}>
                                            <TableCell className="font-medium">
                                                <div className="space-y-0.5">
                                                    <span className="text-foreground">{qs.title}</span>
                                                    {qs.description && (
                                                        <p className="text-xs text-muted-foreground line-clamp-1">{qs.description}</p>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {qs.supported_languages?.map((lang) => (
                                                        <Badge
                                                            key={lang}
                                                            variant="secondary"
                                                            className="text-[11px] font-mono capitalize"
                                                        >
                                                            {lang === 'python3' ? 'Python 3' : lang === 'java21' ? 'Java 21' : lang}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">
                                                <span className="font-semibold text-foreground">{qs.items?.length || 0}</span> problems linked
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => openEditSet(qs)}
                                                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                                    >
                                                        <Pencil className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => setDeleteTarget({ type: 'set', id: qs.id, title: qs.title })}
                                                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Problem Create/Edit Modal */}
            <Dialog open={problemModalOpen} onOpenChange={setProblemModalOpen}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingProblem ? 'Edit Coding Problem' : 'Create Coding Problem'}</DialogTitle>
                        <DialogDescription>Configure problem statement, test cases, and the reference solution.</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="md:col-span-2 space-y-1.5">
                                <Label htmlFor="prob-title">Problem Title *</Label>
                                <Input
                                    id="prob-title"
                                    value={problemTitle}
                                    onChange={(e) => setProblemTitle(e.target.value)}
                                    placeholder="e.g. Two Sum"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="prob-diff">Difficulty</Label>
                                <Select value={difficulty} onValueChange={setDifficulty}>
                                    <SelectTrigger id="prob-diff">
                                        <SelectValue placeholder="Difficulty" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="easy">Easy</SelectItem>
                                        <SelectItem value="medium">Medium</SelectItem>
                                        <SelectItem value="hard">Hard</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="prob-desc">Problem Description *</Label>
                            <textarea
                                id="prob-desc"
                                value={problemDesc}
                                onChange={(e) => setProblemDesc(e.target.value)}
                                rows={4}
                                className="w-full p-3 text-sm bg-background border border-border rounded-lg focus:ring-1 focus:ring-primary focus:outline-none"
                                placeholder="Describe the task, goals, and logic..."
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="space-y-1.5">
                                <Label>Input Format</Label>
                                <Input
                                    value={inputFormat}
                                    onChange={(e) => setInputFormat(e.target.value)}
                                    placeholder="e.g. First line contains N..."
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Output Format</Label>
                                <Input
                                    value={outputFormat}
                                    onChange={(e) => setOutputFormat(e.target.value)}
                                    placeholder="e.g. Print single integer..."
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Constraints</Label>
                                <Input
                                    value={constraints}
                                    onChange={(e) => setConstraints(e.target.value)}
                                    placeholder="e.g. 1 <= N <= 10^5"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <Label>Time Limit (ms)</Label>
                                <Input
                                    type="number"
                                    value={timeLimitMs}
                                    onChange={(e) => setTimeLimitMs(Number(e.target.value))}
                                    min={500}
                                    max={10000}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Memory Limit (MB)</Label>
                                <Input
                                    type="number"
                                    value={memoryLimitMb}
                                    onChange={(e) => setMemoryLimitMb(Number(e.target.value))}
                                    min={64}
                                    max={1024}
                                />
                            </div>
                        </div>

                        {/* Starter Codes */}
                        <div className="space-y-3 pt-2 border-t border-border">
                            <h4 className="text-sm font-semibold text-foreground">Starter Code Templates (by Language)</h4>
                            <div className="space-y-2">
                                <Label className="text-xs text-muted-foreground">Python 3 Starter</Label>
                                <textarea
                                    value={pyStarter}
                                    onChange={(e) => setPyStarter(e.target.value)}
                                    rows={3}
                                    className="w-full font-mono text-xs p-3 bg-muted/40 border border-border rounded-lg focus:outline-none"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs text-muted-foreground">Java 21 Starter</Label>
                                <textarea
                                    value={javaStarter}
                                    onChange={(e) => setJavaStarter(e.target.value)}
                                    rows={4}
                                    className="w-full font-mono text-xs p-3 bg-muted/40 border border-border rounded-lg focus:outline-none"
                                />
                            </div>
                        </div>

                        {/* Reference Solution Code */}
                        <div className="space-y-2 pt-2 border-t border-border">
                            <div className="flex items-center justify-between">
                                <Label className="text-sm font-semibold text-foreground">
                                    Reference Solution Code (Server-side only) *
                                </Label>
                                <span className="text-[11px] text-muted-foreground">Used for validating test cases</span>
                            </div>
                            <textarea
                                value={solutionCode}
                                onChange={(e) => setSolutionCode(e.target.value)}
                                rows={5}
                                className="w-full font-mono text-xs p-3 bg-muted/40 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                                placeholder="# Working reference solution used to verify test cases..."
                            />
                        </div>

                        {/* Test Cases Manager */}
                        <div className="space-y-3 pt-2 border-t border-border">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h4 className="text-sm font-semibold text-foreground">Test Cases</h4>
                                    <p className="text-xs text-muted-foreground">Include public sample cases and hidden evaluation cases.</p>
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setTestCases([...testCases, { input: '', expected_output: '', weight: 1.0, is_hidden: false }])}
                                    className="gap-1 text-xs"
                                >
                                    <Plus className="h-3.5 w-3.5" /> Add Case
                                </Button>
                            </div>

                            <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                                {testCases.map((tc, idx) => (
                                    <div key={idx} className="p-3 bg-muted/30 border border-border rounded-lg space-y-2">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="font-semibold text-foreground">Test Case #{idx + 1}</span>
                                            <div className="flex items-center gap-4">
                                                <label className="flex items-center gap-1.5 cursor-pointer">
                                                    <Checkbox
                                                        checked={tc.is_hidden}
                                                        onCheckedChange={(c) => {
                                                            const updated = [...testCases]
                                                            updated[idx].is_hidden = Boolean(c)
                                                            setTestCases(updated)
                                                        }}
                                                    />
                                                    <span className="text-muted-foreground flex items-center gap-1">
                                                        {tc.is_hidden ? <EyeOff className="h-3 w-3 text-amber-500" /> : <Eye className="h-3 w-3 text-muted-foreground" />}
                                                        Hidden
                                                    </span>
                                                </label>
                                                <div className="flex items-center gap-1">
                                                    <span className="text-muted-foreground">Weight:</span>
                                                    <input
                                                        type="number"
                                                        value={tc.weight}
                                                        step="0.5"
                                                        min="0.1"
                                                        onChange={(e) => {
                                                            const updated = [...testCases]
                                                            updated[idx].weight = Number(e.target.value) || 1.0
                                                            setTestCases(updated)
                                                        }}
                                                        className="w-14 px-1 py-0.5 text-xs bg-background border border-border rounded"
                                                    />
                                                </div>
                                                {testCases.length > 1 && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => setTestCases(testCases.filter((_, i) => i !== idx))}
                                                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                                    >
                                                        <Trash2 className="h-3 w-3" />
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <textarea
                                                value={tc.input}
                                                onChange={(e) => {
                                                    const updated = [...testCases]
                                                    updated[idx].input = e.target.value
                                                    setTestCases(updated)
                                                }}
                                                placeholder="Standard Input (stdin)"
                                                rows={2}
                                                className="w-full font-mono text-xs p-2 bg-background border border-border rounded focus:outline-none"
                                            />
                                            <textarea
                                                value={tc.expected_output}
                                                onChange={(e) => {
                                                    const updated = [...testCases]
                                                    updated[idx].expected_output = e.target.value
                                                    setTestCases(updated)
                                                }}
                                                placeholder="Expected Output (stdout)"
                                                rows={2}
                                                className="w-full font-mono text-xs p-2 bg-background border border-border rounded focus:outline-none"
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setProblemModalOpen(false)}>Cancel</Button>
                        <Button onClick={handleSaveProblem} disabled={savingProblem}>
                            {savingProblem && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            {editingProblem ? 'Save Changes' : 'Create Problem'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Validation Report Dialog */}
            <Dialog open={validationModalOpen} onOpenChange={setValidationModalOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            {validationReport?.all_passed ? (
                                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                            ) : (
                                <AlertCircle className="h-5 w-5 text-amber-500" />
                            )}
                            Reference Solution Validation Report
                        </DialogTitle>
                        <DialogDescription>
                            Execution verification of the reference solution against configured test cases.
                        </DialogDescription>
                    </DialogHeader>

                    {validationReport && (
                        <div className="space-y-3 py-2 text-sm">
                            <div className="flex items-center justify-between p-3 bg-muted/40 rounded-lg">
                                <span className="font-medium">Validation Status:</span>
                                <Badge variant={validationReport.all_passed ? 'default' : 'destructive'}>
                                    {validationReport.all_passed ? 'All Test Cases Passed' : 'Discrepancy Found'}
                                </Badge>
                            </div>
                            {validationReport.generated_count > 0 && (
                                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                                    Generated missing expected outputs for {validationReport.generated_count} test case(s).
                                </p>
                            )}

                            <div className="space-y-2 max-h-60 overflow-y-auto">
                                {validationReport.details?.map((d: any, idx: number) => (
                                    <div key={idx} className="p-2 border border-border rounded flex items-center justify-between text-xs">
                                        <span>Test Case #{idx + 1}</span>
                                        <Badge
                                            variant="outline"
                                            className={
                                                d.status === 'valid'
                                                    ? 'border-emerald-500/30 text-emerald-600'
                                                    : d.status === 'generated'
                                                    ? 'border-blue-500/30 text-blue-600'
                                                    : 'border-rose-500/30 text-rose-600'
                                            }
                                        >
                                            {d.status.toUpperCase()}
                                        </Badge>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <Button onClick={() => setValidationModalOpen(false)}>Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Question Set Create/Edit Modal */}
            <Dialog open={setModalOpen} onOpenChange={setSetModalOpen}>
                <DialogContent className="max-w-xl">
                    <DialogHeader>
                        <DialogTitle>{editingSet ? 'Edit Question Set' : 'Create Question Set'}</DialogTitle>
                        <DialogDescription>
                            Define the languages supported by this assessment and select the problems to include.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="qs-title">Question Set Title *</Label>
                            <Input
                                id="qs-title"
                                value={setTitle}
                                onChange={(e) => setSetTitle(e.target.value)}
                                placeholder="e.g. Backend Engineer Coding Round"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="qs-desc">Description</Label>
                            <Input
                                id="qs-desc"
                                value={setDescription}
                                onChange={(e) => setSetDescription(e.target.value)}
                                placeholder="Optional description..."
                            />
                        </div>

                        {/* Supported Languages (Universe for this Set) */}
                        <div className="space-y-2 pt-2 border-t border-border">
                            <Label className="text-sm font-semibold text-foreground">
                                Supported Languages (Defined at Question Set Level) *
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                Jobs selecting this question set can allow any subset of these languages.
                            </p>
                            <div className="flex items-center gap-4 pt-1">
                                {AVAILABLE_LANGUAGES.map((lang) => {
                                    const isChecked = supportedLangs.includes(lang.id)
                                    return (
                                        <label
                                            key={lang.id}
                                            className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-background cursor-pointer hover:border-primary/40 transition-colors"
                                        >
                                            <Checkbox
                                                checked={isChecked}
                                                onCheckedChange={(c) => {
                                                    if (c) {
                                                        setSupportedLangs([...supportedLangs, lang.id])
                                                    } else {
                                                        setSupportedLangs(supportedLangs.filter(l => l !== lang.id))
                                                    }
                                                }}
                                            />
                                            <span className="text-sm font-medium">{lang.label}</span>
                                        </label>
                                    )
                                })}
                            </div>
                        </div>

                        {/* Problems Picker */}
                        <div className="space-y-2 pt-2 border-t border-border">
                            <Label className="text-sm font-semibold text-foreground">Select Problems to Include</Label>
                            {problems.length === 0 ? (
                                <p className="text-xs text-muted-foreground">No coding problems available. Create problems first.</p>
                            ) : (
                                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                    {problems.map((p) => {
                                        const isSelected = selectedProblemIds.includes(p.id)
                                        return (
                                            <label
                                                key={p.id}
                                                className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all ${
                                                    isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
                                                }`}
                                            >
                                                <div className="flex items-center gap-2.5">
                                                    <Checkbox
                                                        checked={isSelected}
                                                        onCheckedChange={(c) => {
                                                            if (c) {
                                                                setSelectedProblemIds([...selectedProblemIds, p.id])
                                                            } else {
                                                                setSelectedProblemIds(selectedProblemIds.filter(id => id !== p.id))
                                                            }
                                                        }}
                                                    />
                                                    <div>
                                                        <span className="text-sm font-medium text-foreground">{p.title}</span>
                                                        <span className="text-xs text-muted-foreground ml-2 capitalize">({p.difficulty})</span>
                                                    </div>
                                                </div>
                                            </label>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setSetModalOpen(false)}>Cancel</Button>
                        <Button onClick={handleSaveSet} disabled={savingSet}>
                            {savingSet && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            {editingSet ? 'Save Changes' : 'Create Question Set'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Alert */}
            <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete {deleteTarget?.type === 'problem' ? 'Problem' : 'Question Set'}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete &quot;{deleteTarget?.title}&quot;? This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
