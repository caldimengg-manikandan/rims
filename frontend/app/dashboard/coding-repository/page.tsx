'use client'

import React, { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
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
    RotateCcw,
    FileCode,
    Download,
    Upload,
    FileUp,
    FileJson,
    FileSpreadsheet,
} from 'lucide-react'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import {
    CodingLanguage,
    FALLBACK_CODING_LANGUAGES,
    getLanguageById,
    getLanguageLabel,
} from '@/lib/coding-languages'

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
    supported_languages?: string[]
    starter_code?: Record<string, string>
    solution_code?: string
    solution_codes?: Record<string, string>
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

export default function CodingRepositoryPage() {
    const [activeTab, setActiveTab] = useState<'problems' | 'sets'>('problems')
    const [problems, setProblems] = useState<Problem[]>([])
    const [questionSets, setQuestionSets] = useState<QuestionSet[]>([])
    const [availableLanguages, setAvailableLanguages] = useState<CodingLanguage[]>(FALLBACK_CODING_LANGUAGES)
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

    // Multi-Language state for Problem
    const [selectedLangs, setSelectedLangs] = useState<string[]>(['python3', 'java21'])
    const [starterCodes, setStarterCodes] = useState<Record<string, string>>({})
    const [solutionCodes, setSolutionCodes] = useState<Record<string, string>>({})
    const [activeCodeLang, setActiveCodeLang] = useState<string>('python3')

    const [testCases, setTestCases] = useState<TestCase[]>([
        { input: '5\n1 2 3 4 5', expected_output: '15', weight: 1.0, is_hidden: false },
        { input: '3\n10 20 30', expected_output: '60', weight: 1.0, is_hidden: true },
    ])
    const [savingProblem, setSavingProblem] = useState(false)

    // Validation Report Modal
    const [validationModalOpen, setValidationModalOpen] = useState(false)
    const [validatingProblemId, setValidatingProblemId] = useState<number | null>(null)
    const [validatingLang, setValidatingLang] = useState<string | null>(null)
    const [validationLangFilter, setValidationLangFilter] = useState<string>('all')
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

    // Export & Import State
    const [exportFormat, setExportFormat] = useState<'xlsx' | 'json'>('xlsx')
    const [exporting, setExporting] = useState(false)
    const [exportingId, setExportingId] = useState<string | null>(null)
    const [importModalOpen, setImportModalOpen] = useState(false)
    const [importFile, setImportFile] = useState<File | null>(null)
    const [importData, setImportData] = useState<{
        question_sets: any[]
        problems: any[]
    } | null>(null)
    const [importStrategy, setImportStrategy] = useState<'copy' | 'skip' | 'overwrite'>('copy')
    const [importing, setImporting] = useState(false)
    const [importError, setImportError] = useState<string | null>(null)

    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const [problemsRes, setsRes, langsRes] = await Promise.all([
                APIClient.get<Problem[]>('/api/coding/problems'),
                APIClient.get<QuestionSet[]>('/api/coding/question-sets'),
                APIClient.get<CodingLanguage[]>('/api/coding/languages').catch(() => null),
            ])
            setProblems(problemsRes || [])
            setQuestionSets(setsRes || [])
            if (Array.isArray(langsRes) && langsRes.length > 0) {
                setAvailableLanguages(langsRes)
            }
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

        const initialLangs = ['python3']
        setSelectedLangs(initialLangs)
        const initialStarters: Record<string, string> = {}
        const initialSolutions: Record<string, string> = {}
        availableLanguages.forEach(l => {
            initialStarters[l.id] = l.default_starter_code
            initialSolutions[l.id] = l.default_solution_template
        })
        setStarterCodes(initialStarters)
        setSolutionCodes(initialSolutions)
        setActiveCodeLang('python3')

        setTestCases([
            { input: '5\n1 2 3 4 5', expected_output: '15', weight: 1.0, is_hidden: false },
            { input: '3\n10 20 30', expected_output: '60', weight: 1.0, is_hidden: true },
        ])
        setProblemModalOpen(true)
    }

    const openEditProblem = async (p: Problem) => {
        setEditingProblem(p)
        try {
            const detail = await APIClient.get<any>(`/api/coding/problems/${p.id}`)
            setProblemTitle(detail.title)
            setProblemDesc(detail.description)
            setInputFormat(detail.input_format || '')
            setOutputFormat(detail.output_format || '')
            setConstraints(detail.constraints || '')
            setDifficulty(detail.difficulty)
            setTimeLimitMs(detail.time_limit_ms)
            setMemoryLimitMb(detail.memory_limit_mb)

            const langs: string[] = detail.supported_languages && detail.supported_languages.length > 0
                ? detail.supported_languages
                : (detail.starter_code && Object.keys(detail.starter_code).length > 0
                    ? Object.keys(detail.starter_code)
                    : ['python3', 'java21'])
            setSelectedLangs(langs)

            const sMap: Record<string, string> = {}
            availableLanguages.forEach(l => {
                sMap[l.id] = l.default_starter_code
            })
            if (detail.starter_code && typeof detail.starter_code === 'object') {
                Object.assign(sMap, detail.starter_code)
            }
            setStarterCodes(sMap)

            const solMap: Record<string, string> = {}
            availableLanguages.forEach(l => {
                solMap[l.id] = l.default_solution_template
            })
            if (detail.solution_codes && typeof detail.solution_codes === 'object') {
                Object.assign(solMap, detail.solution_codes)
            } else if (detail.solution_code) {
                try {
                    const parsed = JSON.parse(detail.solution_code)
                    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                        Object.assign(solMap, parsed)
                    } else {
                        solMap[langs[0] || 'python3'] = detail.solution_code
                    }
                } catch {
                    solMap[langs[0] || 'python3'] = detail.solution_code
                }
            }
            setSolutionCodes(solMap)
            setActiveCodeLang(langs[0] || 'python3')
            setTestCases(detail.test_cases || [])
            setProblemModalOpen(true)
        } catch (err: any) {
            toast.error(err.message || 'Failed to load problem details')
        }
    }

    const toggleProblemLanguage = (langId: string) => {
        if (selectedLangs.includes(langId)) {
            if (selectedLangs.length <= 1) {
                toast.error('A coding problem must support at least one programming language.')
                return
            }
            const updated = selectedLangs.filter(l => l !== langId)
            setSelectedLangs(updated)
            if (activeCodeLang === langId) {
                setActiveCodeLang(updated[0])
            }
        } else {
            const updated = [...selectedLangs, langId]
            setSelectedLangs(updated)
            if (!starterCodes[langId]) {
                const langObj = getLanguageById(langId, availableLanguages)
                setStarterCodes(prev => ({
                    ...prev,
                    [langId]: langObj.default_starter_code
                }))
            }
            if (!solutionCodes[langId]) {
                const langObj = getLanguageById(langId, availableLanguages)
                setSolutionCodes(prev => ({
                    ...prev,
                    [langId]: langObj.default_solution_template
                }))
            }
            setActiveCodeLang(langId)
        }
    }

    const handleSaveProblem = async () => {
        if (!problemTitle.trim() || !problemDesc.trim()) {
            toast.error('Title and description are required.')
            return
        }
        if (selectedLangs.length === 0) {
            toast.error('Please select at least one supported language.')
            return
        }
        const missingSolutions = selectedLangs.filter(l => !solutionCodes[l] || !solutionCodes[l].trim())
        if (missingSolutions.length > 0) {
            const names = missingSolutions.map(l => getLanguageLabel(l, availableLanguages)).join(', ')
            toast.error(`Please provide a reference solution for each selected language: ${names}`)
            return
        }
        if (testCases.length === 0) {
            toast.error('At least one test case is required.')
            return
        }

        setSavingProblem(true)
        try {
            const activeStarters: Record<string, string> = {}
            const activeSolutions: Record<string, string> = {}
            selectedLangs.forEach(langId => {
                activeStarters[langId] = starterCodes[langId] || ''
                activeSolutions[langId] = solutionCodes[langId] || ''
            })

            const payload = {
                title: problemTitle.trim(),
                description: problemDesc.trim(),
                input_format: inputFormat.trim() || null,
                output_format: outputFormat.trim() || null,
                constraints: constraints.trim() || null,
                difficulty,
                time_limit_ms: Number(timeLimitMs),
                memory_limit_mb: Number(memoryLimitMb),
                supported_languages: selectedLangs,
                starter_code: activeStarters,
                solution_codes: activeSolutions,
                solution_code: JSON.stringify(activeSolutions),
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

    const handleValidateSolution = async (problemId: number, lang?: string) => {
        setValidatingProblemId(problemId)
        setValidatingLang(lang || null)
        try {
            const body = lang ? { language: lang } : {}
            const report = await APIClient.post<any>(`/api/coding/problems/${problemId}/validate-solution`, body)
            setValidationReport(report)
            setValidationLangFilter(lang || 'all')
            setValidationModalOpen(true)
            fetchData()
        } catch (err: any) {
            toast.error(err.message || 'Solution validation failed')
        } finally {
            setValidatingProblemId(null)
            setValidatingLang(null)
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

    // Export & Import Handlers
    const downloadJsonFile = (data: any, filename: string) => {
        const jsonStr = JSON.stringify(data, null, 2)
        const blob = new Blob([jsonStr], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
    }

    const slugify = (text: string) => {
        return text
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'item'
    }

    const triggerExport = async (query: string, baseFilename: string, successMessage: string) => {
        if (exportFormat === 'xlsx') {
            await APIClient.downloadFile(`/api/coding/repository/export/?${query}&format=xlsx`, `${baseFilename}.xlsx`)
            toast.success(successMessage)
            return null
        }
        const data = await APIClient.get<any>(`/api/coding/repository/export/?${query}&format=json`)
        downloadJsonFile(data, `${baseFilename}.json`)
        return data
    }

    const handleExportAll = async () => {
        setExporting(true)
        try {
            const dateStr = new Date().toISOString().split('T')[0]
            await triggerExport('scope=all', `coding-repository-all-${dateStr}`, 'Repository exported successfully')
            if (exportFormat === 'json') toast.success('Repository exported successfully')
        } catch (err: any) {
            console.error('Export all failed:', err)
            toast.error(err.detail || err.message || 'Failed to export repository')
        } finally {
            setExporting(false)
        }
    }

    const handleExportProblems = async () => {
        setExporting(true)
        try {
            const dateStr = new Date().toISOString().split('T')[0]
            const data = await triggerExport('scope=problems', `coding-problems-${dateStr}`, 'Coding problems exported successfully')
            if (data) toast.success(`Exported ${data.problems?.length || 0} coding problem(s)`)
        } catch (err: any) {
            console.error('Export problems failed:', err)
            toast.error(err.detail || err.message || 'Failed to export problems')
        } finally {
            setExporting(false)
        }
    }

    const handleExportSets = async () => {
        setExporting(true)
        try {
            const dateStr = new Date().toISOString().split('T')[0]
            const data = await triggerExport('scope=sets', `coding-question-sets-${dateStr}`, 'Question sets exported successfully')
            if (data) toast.success(`Exported ${data.question_sets?.length || 0} question set(s)`)
        } catch (err: any) {
            console.error('Export question sets failed:', err)
            toast.error(err.detail || err.message || 'Failed to export question sets')
        } finally {
            setExporting(false)
        }
    }

    const handleExportSingleProblem = async (p: Problem) => {
        setExportingId(`p-${p.id}`)
        try {
            await triggerExport(`problem_id=${p.id}`, `problem-${slugify(p.title)}`, `Exported "${p.title}"`)
            if (exportFormat === 'json') toast.success(`Exported "${p.title}"`)
        } catch (err: any) {
            console.error('Export single problem failed:', err)
            toast.error(err.detail || err.message || 'Failed to export problem')
        } finally {
            setExportingId(null)
        }
    }

    const handleExportSingleSet = async (qs: QuestionSet) => {
        setExportingId(`s-${qs.id}`)
        try {
            await triggerExport(`set_id=${qs.id}`, `question-set-${slugify(qs.title)}`, `Exported "${qs.title}"`)
            if (exportFormat === 'json') toast.success(`Exported "${qs.title}"`)
        } catch (err: any) {
            console.error('Export single set failed:', err)
            toast.error(err.detail || err.message || 'Failed to export question set')
        } finally {
            setExportingId(null)
        }
    }

    const normalizeWorkbookLanguage = (raw: string): string | null => {
        const key = (raw || '').trim().toLowerCase()
        const map: Record<string, string> = {
            python3: 'python3', 'python 3': 'python3', python: 'python3', py: 'python3',
            java21: 'java21', 'java 21': 'java21', java: 'java21',
            cpp: 'cpp', 'c++': 'cpp', 'c++ (gcc 13)': 'cpp',
            javascript: 'javascript', 'javascript (node.js 20)': 'javascript', js: 'javascript', node: 'javascript',
            golang: 'golang', go: 'golang', 'go 1.22': 'golang',
            rust: 'rust', 'rust 1.77': 'rust',
        }
        return map[key] || null
    }

    const parseCodingWorkbook = (wb: XLSX.WorkBook) => {
        const findSheetName = (candidates: string[]) =>
            wb.SheetNames.find((n) => candidates.includes(n.trim().toLowerCase()))

        const problemSheetName = findSheetName(['problems', 'coding problems', 'questions']) || wb.SheetNames[0]
        if (!problemSheetName) {
            throw new Error('Excel workbook contains no sheets.')
        }

        const rawProblems = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[problemSheetName], { defval: '' })
        const problemsById = new Map<string, any>()
        const problemsByTitle = new Map<string, any>()
        const parsedProblems: any[] = []

        const starterRe = /^starter\s*(?:code)?\s*(?:\(([^)]+)\)|_([a-z0-9_+]+))$/i
        const solutionRe = /^(?:reference\s*solution|solution(?:\s*code)?)\s*(?:\(([^)]+)\)|_([a-z0-9_+]+))$/i

        for (const row of rawProblems) {
            const lower: Record<string, any> = {}
            for (const [k, v] of Object.entries(row)) {
                lower[k.trim().toLowerCase()] = v
            }
            const title = String(lower['title'] || lower['problem title'] || '').trim()
            if (!title) continue

            const rawId = lower['id'] ?? lower['problem id']
            const starter_code: Record<string, string> = {}
            const solution_codes: Record<string, string> = {}

            for (const [col, val] of Object.entries(row)) {
                if (val === '' || val === null || val === undefined) continue
                const mStart = col.trim().match(starterRe)
                if (mStart) {
                    const lang = normalizeWorkbookLanguage(mStart[1] || mStart[2] || '')
                    if (lang) starter_code[lang] = String(val)
                    continue
                }
                const mSol = col.trim().match(solutionRe)
                if (mSol) {
                    const lang = normalizeWorkbookLanguage(mSol[1] || mSol[2] || '')
                    if (lang) solution_codes[lang] = String(val)
                }
            }

            const rawLangs = String(lower['supported languages'] ?? lower['supported_languages'] ?? '')
            let supported_languages = rawLangs
                .split(/[,;\n]+/)
                .map((s) => normalizeWorkbookLanguage(s))
                .filter((s): s is string => Boolean(s))
            supported_languages = Array.from(new Set(supported_languages))
            if (supported_languages.length === 0) {
                supported_languages = Array.from(new Set([...Object.keys(solution_codes), ...Object.keys(starter_code)]))
            }
            if (supported_languages.length === 0) supported_languages = ['python3']

            const diffRaw = String(lower['difficulty'] || 'medium').trim().toLowerCase()
            const difficulty = ['easy', 'medium', 'hard'].includes(diffRaw) ? diffRaw : 'medium'

            const prob = {
                title,
                description: String(lower['description'] || ''),
                input_format: String(lower['input format'] ?? lower['input_format'] ?? '') || null,
                output_format: String(lower['output format'] ?? lower['output_format'] ?? '') || null,
                constraints: String(lower['constraints'] ?? '') || null,
                difficulty,
                time_limit_ms: Number(lower['time limit (ms)'] ?? lower['time_limit_ms']) || 2000,
                memory_limit_mb: Number(lower['memory limit (mb)'] ?? lower['memory_limit_mb']) || 256,
                supported_languages,
                starter_code,
                solution_codes,
                test_cases: [] as any[],
            }

            parsedProblems.push(prob)
            if (rawId !== '' && rawId !== null && rawId !== undefined) {
                problemsById.set(String(rawId).trim(), prob)
            }
            problemsByTitle.set(title.toLowerCase(), prob)
        }

        const tcSheetName = findSheetName(['test cases', 'test_cases', 'testcases'])
        if (tcSheetName) {
            const rawTcs = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[tcSheetName], { defval: '' })
            for (const row of rawTcs) {
                const lower: Record<string, any> = {}
                for (const [k, v] of Object.entries(row)) {
                    lower[k.trim().toLowerCase()] = v
                }
                const pidKey = String(lower['problem id'] ?? lower['problem_id'] ?? '').trim()
                const ptitleKey = String(lower['problem title'] ?? lower['problem_title'] ?? '').trim().toLowerCase()
                const target = problemsById.get(pidKey) || problemsByTitle.get(ptitleKey)
                if (!target) continue

                const rawHidden = lower['is hidden'] ?? lower['is_hidden']
                const is_hidden = typeof rawHidden === 'boolean'
                    ? rawHidden
                    : ['true', '1', 'yes', 'y'].includes(String(rawHidden).trim().toLowerCase())

                const rawWeight = String(lower['weight (%)'] ?? lower['weight'] ?? '1').replace('%', '').trim()
                const weight = parseFloat(rawWeight) || 1.0
                const display_order = Number(lower['test case #'] ?? lower['display_order'] ?? lower['order']) || (target.test_cases.length + 1)

                target.test_cases.push({
                    input: String(lower['input'] ?? ''),
                    expected_output: String(lower['expected output'] ?? lower['expected_output'] ?? ''),
                    is_hidden,
                    weight,
                    display_order,
                })
            }
        }

        const setsSheetName = findSheetName(['question sets', 'question_sets', 'sets'])
        const parsedSets: any[] = []
        const linkedTitles = new Set<string>()
        if (setsSheetName) {
            const rawSets = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[setsSheetName], { defval: '' })
            for (const row of rawSets) {
                const lower: Record<string, any> = {}
                for (const [k, v] of Object.entries(row)) {
                    lower[k.trim().toLowerCase()] = v
                }
                const qsTitle = String(lower['title'] || '').trim()
                if (!qsTitle) continue

                const rawTitles = String(lower['problem titles'] ?? lower['problem_titles'] ?? '')
                const linkedProbs = rawTitles
                    .split(/[\n;]+/)
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .map((t) => {
                        const match = problemsByTitle.get(t.toLowerCase())
                        if (match) linkedTitles.add(t.toLowerCase())
                        return match
                    })
                    .filter(Boolean)

                const qsLangs = String(lower['supported languages'] ?? lower['supported_languages'] ?? '')
                    .split(/[,;\n]+/)
                    .map((s) => normalizeWorkbookLanguage(s))
                    .filter((s): s is string => Boolean(s))

                parsedSets.push({
                    title: qsTitle,
                    description: String(lower['description'] || '') || null,
                    supported_languages: qsLangs.length > 0 ? Array.from(new Set(qsLangs)) : ['python3'],
                    problems: linkedProbs,
                })
            }
        }

        const standalone = parsedSets.length > 0
            ? parsedProblems.filter((p) => !linkedTitles.has(p.title.toLowerCase()))
            : parsedProblems

        return { question_sets: parsedSets, problems: standalone }
    }

    const openImportModal = () => {
        setImportFile(null)
        setImportData(null)
        setImportError(null)
        setImportStrategy('copy')
        setImportModalOpen(true)
    }

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        setImportFile(file)
        setImportError(null)

        const isExcel = /\.(xlsx|xls)$/i.test(file.name)
        const reader = new FileReader()
        reader.onload = (event) => {
            try {
                let normalizedSets: any[] = []
                let normalizedProblems: any[] = []

                if (isExcel) {
                    const data = new Uint8Array(event.target?.result as ArrayBuffer)
                    const wb = XLSX.read(data, { type: 'array' })
                    const parsed = parseCodingWorkbook(wb)
                    normalizedSets = parsed.question_sets
                    normalizedProblems = parsed.problems
                } else {
                    const text = event.target?.result as string
                    const json = JSON.parse(text)

                    if (Array.isArray(json)) {
                        normalizedProblems = json
                    } else if (json && typeof json === 'object') {
                        if (Array.isArray(json.question_sets)) {
                            normalizedSets = json.question_sets
                        }
                        if (Array.isArray(json.problems)) {
                            normalizedProblems = json.problems
                        } else if (Array.isArray(json.standalone_problems)) {
                            normalizedProblems = json.standalone_problems
                        } else if (json.title && (json.input_format || json.test_cases || json.difficulty)) {
                            normalizedProblems = [json]
                        } else if (json.title && (json.supported_languages || json.problems)) {
                            normalizedSets = [json]
                        }
                    }
                }

                if (normalizedSets.length === 0 && normalizedProblems.length === 0) {
                    setImportError(`No valid coding problems or question sets detected in this ${isExcel ? 'Excel' : 'JSON'} file.`)
                    setImportData(null)
                    return
                }

                setImportData({
                    question_sets: normalizedSets,
                    problems: normalizedProblems,
                })
            } catch (err: any) {
                setImportError(`Invalid ${isExcel ? 'Excel' : 'JSON'} format: ${err.message}`)
                setImportData(null)
            }
        }
        reader.onerror = () => {
            setImportError('Failed to read the selected file.')
            setImportData(null)
        }
        if (isExcel) {
            reader.readAsArrayBuffer(file)
        } else {
            reader.readAsText(file)
        }
    }

    const handleConfirmImport = async () => {
        if (!importData) return
        setImporting(true)
        try {
            const res = await APIClient.post<{
                success: boolean
                imported_sets_count: number
                imported_problems_count: number
                skipped_count: number
                messages: string[]
            }>('/api/coding/repository/import/', {
                strategy: importStrategy,
                question_sets: importData.question_sets,
                problems: importData.problems,
            })

            const parts = []
            if (res.imported_problems_count > 0) parts.push(`${res.imported_problems_count} problem(s)`)
            if (res.imported_sets_count > 0) parts.push(`${res.imported_sets_count} question set(s)`)
            if (res.skipped_count > 0) parts.push(`${res.skipped_count} skipped`)

            toast.success(`Import complete! ${parts.join(', ')}`)
            setImportModalOpen(false)
            fetchData()
        } catch (err: any) {
            console.error('Import repository failed:', err)
            toast.error(err.detail || err.message || 'Failed to import repository')
        } finally {
            setImporting(false)
        }
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <PageHeader
                title="Coding Assessment Repository"
                description="Manage algorithmic problems, test cases, and question sets for candidate coding assessments."
                icon={Code2}
            >
                <div className="flex items-center gap-2">
                    <Select value={exportFormat} onValueChange={(v) => setExportFormat(v as 'xlsx' | 'json')}>
                        <SelectTrigger className="h-8 w-[125px] text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="xlsx">Excel (.xlsx)</SelectItem>
                            <SelectItem value="json">JSON (.json)</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleExportAll}
                        disabled={exporting}
                        className="gap-1.5 text-xs font-medium"
                    >
                        {exporting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Download className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        Export All
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={openImportModal}
                        className="gap-1.5 text-xs font-medium bg-primary/5 hover:bg-primary/10 text-primary border-primary/20"
                    >
                        <Upload className="h-3.5 w-3.5" />
                        Import Repos
                    </Button>
                </div>
            </PageHeader>

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
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleExportProblems}
                                disabled={exporting || problems.length === 0}
                                className="gap-1.5 text-xs font-medium"
                            >
                                <Download className="h-3.5 w-3.5 text-muted-foreground" />
                                Export Problems
                            </Button>
                            <Button onClick={openCreateProblem} className="gap-2">
                                <Plus className="h-4 w-4" /> Create Problem
                            </Button>
                        </div>
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
                                        <TableHead>Supported Languages</TableHead>
                                        <TableHead>Limits</TableHead>
                                        <TableHead>Test Cases</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {problems.map((p) => {
                                        const langs = p.supported_languages && p.supported_languages.length > 0
                                            ? p.supported_languages
                                            : (p.starter_code ? Object.keys(p.starter_code) : ['python3'])
                                        return (
                                            <TableRow key={p.id}>
                                                <TableCell className="font-medium">
                                                    <div className="space-y-0.5">
                                                        <span className="text-foreground font-semibold">{p.title}</span>
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
                                                <TableCell>
                                                    <div className="flex flex-wrap gap-1 max-w-[220px]">
                                                        {langs.map(l => (
                                                            <Badge key={l} variant="outline" className="text-[10px] py-0 px-1.5 font-mono">
                                                                {getLanguageLabel(l, availableLanguages)}
                                                            </Badge>
                                                        ))}
                                                    </div>
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
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            title={`Export problem as ${exportFormat.toUpperCase()}`}
                                                            onClick={() => handleExportSingleProblem(p)}
                                                            disabled={exportingId === `p-${p.id}`}
                                                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                                        >
                                                            {exportingId === `p-${p.id}` ? (
                                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                            ) : (
                                                                <Download className="h-3.5 w-3.5" />
                                                            )}
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
                                        )
                                    })}
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
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleExportSets}
                                disabled={exporting || questionSets.length === 0}
                                className="gap-1.5 text-xs font-medium"
                            >
                                <Download className="h-3.5 w-3.5 text-muted-foreground" />
                                Export Sets
                            </Button>
                            <Button onClick={openCreateSet} className="gap-2">
                                <Plus className="h-4 w-4" /> Create Question Set
                            </Button>
                        </div>
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
                                                            {getLanguageLabel(lang, availableLanguages)}
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
                                                        title={`Export question set as ${exportFormat.toUpperCase()}`}
                                                        onClick={() => handleExportSingleSet(qs)}
                                                        disabled={exportingId === `s-${qs.id}`}
                                                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                                    >
                                                        {exportingId === `s-${qs.id}` ? (
                                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                        ) : (
                                                            <Download className="h-3.5 w-3.5" />
                                                        )}
                                                    </Button>
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

            {/* Problem Create/Edit Modal - 85% Screen Width */}
            <Dialog open={problemModalOpen} onOpenChange={setProblemModalOpen}>
                <DialogContent className="w-[92vw] max-w-[92vw] sm:w-[85vw] sm:max-w-[85vw] max-h-[92vh] overflow-y-auto p-6 md:p-8">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-bold">{editingProblem ? 'Edit Coding Problem' : 'Create Coding Problem'}</DialogTitle>
                        <DialogDescription>Configure problem statement, supported programming languages, starter codes, reference solutions, and test cases.</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-5 py-2">
                        {/* Basic Details */}
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

                        {/* Supported Languages Multi-select */}
                        <div className="space-y-2 pt-3 border-t border-border">
                            <div className="flex items-center justify-between">
                                <div>
                                    <Label className="text-sm font-semibold text-foreground">
                                        Supported Programming Languages *
                                    </Label>
                                    <p className="text-xs text-muted-foreground">
                                        Select which languages candidates can use for this problem. Configure starter code and reference solution for each.
                                    </p>
                                </div>
                                <span className="text-xs text-primary font-medium">
                                    {selectedLangs.length} of {availableLanguages.length} selected
                                </span>
                            </div>

                            <div className="flex flex-wrap gap-2 pt-1">
                                {availableLanguages.map((lang) => {
                                    const isSelected = selectedLangs.includes(lang.id)
                                    const hasSolution = Boolean(solutionCodes[lang.id]?.trim())
                                    return (
                                        <button
                                            key={lang.id}
                                            type="button"
                                            onClick={() => toggleProblemLanguage(lang.id)}
                                            className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs transition-all ${
                                                isSelected
                                                    ? 'border-primary bg-primary/10 text-primary font-medium shadow-sm ring-1 ring-primary/20'
                                                    : 'border-border bg-background text-muted-foreground hover:text-foreground hover:border-primary/40'
                                            }`}
                                        >
                                            <div className={`h-4 w-4 rounded flex items-center justify-center border ${
                                                isSelected ? 'bg-primary text-primary-foreground border-primary' : 'border-muted-foreground/40'
                                            }`}>
                                                {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                                            </div>
                                            <span>{lang.name || lang.label || lang.id}</span>
                                            {isSelected && (
                                                <span
                                                    className={`h-2 w-2 rounded-full ${
                                                        hasSolution ? 'bg-emerald-500' : 'bg-amber-500'
                                                    }`}
                                                    title={hasSolution ? 'Reference solution configured' : 'Reference solution missing'}
                                                />
                                            )}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

                        {/* Per-Language Starter Code & Reference Solution Configuration */}
                        <div className="space-y-4 pt-3 border-t border-border">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h4 className="text-sm font-semibold text-foreground">
                                        Starter Code & Reference Solution by Language
                                    </h4>
                                    <p className="text-xs text-muted-foreground">
                                        Customize starter code and server-side reference solutions for each enabled language.
                                    </p>
                                </div>
                                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                                    <span className="flex items-center gap-1.5">
                                        <span className="h-2 w-2 rounded-full bg-emerald-500" /> Solution Ready
                                    </span>
                                    <span className="flex items-center gap-1.5">
                                        <span className="h-2 w-2 rounded-full bg-amber-500" /> Missing Solution
                                    </span>
                                </div>
                            </div>

                            {/* Language Switcher Tabs */}
                            <div className="flex items-center gap-1 border-b border-border overflow-x-auto pb-1">
                                {selectedLangs.map((langId) => {
                                    const langObj = getLanguageById(langId, availableLanguages)
                                    const isActive = activeCodeLang === langId
                                    const hasSolution = Boolean(solutionCodes[langId]?.trim())
                                    return (
                                        <button
                                            key={langId}
                                            type="button"
                                            onClick={() => setActiveCodeLang(langId)}
                                            className={`flex items-center gap-2 px-3.5 py-1.5 text-xs rounded-t-lg font-medium transition-colors border-b-2 ${
                                                isActive
                                                    ? 'border-primary text-primary bg-primary/5'
                                                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30'
                                            }`}
                                        >
                                            <span className={`h-2 w-2 rounded-full ${hasSolution ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                                            <span>{langObj.name || langObj.label || langId}</span>
                                        </button>
                                    )
                                })}
                            </div>

                            {/* Active Language Editors */}
                            {activeCodeLang && (
                                <div className="space-y-4 p-4 rounded-xl border border-border bg-muted/20">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                                            <FileCode className="h-4 w-4 text-primary" />
                                            Language: {getLanguageLabel(activeCodeLang, availableLanguages)}
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    const defaultStarter = getLanguageById(activeCodeLang, availableLanguages).default_starter_code
                                                    setStarterCodes(prev => ({ ...prev, [activeCodeLang]: defaultStarter }))
                                                    toast.info(`Reset starter code for ${getLanguageLabel(activeCodeLang, availableLanguages)}`)
                                                }}
                                                className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                                            >
                                                <RotateCcw className="h-3 w-3" /> Reset Starter
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    const defaultSol = getLanguageById(activeCodeLang, availableLanguages).default_solution_template
                                                    setSolutionCodes(prev => ({ ...prev, [activeCodeLang]: defaultSol }))
                                                    toast.info(`Reset reference solution for ${getLanguageLabel(activeCodeLang, availableLanguages)}`)
                                                }}
                                                className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                                            >
                                                <RotateCcw className="h-3 w-3" /> Reset Solution
                                            </Button>
                                            {editingProblem && (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={validatingProblemId === editingProblem.id}
                                                    onClick={() => handleValidateSolution(editingProblem.id, activeCodeLang)}
                                                    className="h-7 text-[11px] gap-1 text-primary border-primary/30 hover:bg-primary/10"
                                                >
                                                    {validatingProblemId === editingProblem.id && validatingLang === activeCodeLang ? (
                                                        <Loader2 className="h-3 w-3 animate-spin" />
                                                    ) : (
                                                        <Play className="h-3 w-3" />
                                                    )}
                                                    Validate {getLanguageLabel(activeCodeLang, availableLanguages)}
                                                </Button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                        {/* Starter Code */}
                                        <div className="space-y-1.5">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-xs font-medium text-foreground">
                                                    Starter Code (Candidate Monaco Editor)
                                                </Label>
                                                <span className="text-[10px] text-muted-foreground font-mono">
                                                    .{getLanguageById(activeCodeLang, availableLanguages).extension}
                                                </span>
                                            </div>
                                            <textarea
                                                value={starterCodes[activeCodeLang] || ''}
                                                onChange={(e) => {
                                                    const val = e.target.value
                                                    setStarterCodes(prev => ({ ...prev, [activeCodeLang]: val }))
                                                }}
                                                rows={10}
                                                className="w-full font-mono text-xs p-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed"
                                                placeholder={`// Initial starter code for ${getLanguageLabel(activeCodeLang, availableLanguages)}...`}
                                            />
                                        </div>

                                        {/* Reference Solution Code */}
                                        <div className="space-y-1.5">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-xs font-medium text-foreground flex items-center gap-1">
                                                    Reference Solution (Server-side Docker evaluation) *
                                                </Label>
                                                <span className="text-[10px] text-muted-foreground">Encrypted at rest</span>
                                            </div>
                                            <textarea
                                                value={solutionCodes[activeCodeLang] || ''}
                                                onChange={(e) => {
                                                    const val = e.target.value
                                                    setSolutionCodes(prev => ({ ...prev, [activeCodeLang]: val }))
                                                }}
                                                rows={10}
                                                className="w-full font-mono text-xs p-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed"
                                                placeholder={`// Full working solution in ${getLanguageLabel(activeCodeLang, availableLanguages)} used to verify test cases...`}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Test Cases Manager */}
                        <div className="space-y-3 pt-3 border-t border-border">
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

                            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                                {testCases.map((tc, idx) => (
                                    <div key={idx} className="p-3.5 bg-muted/30 border border-border rounded-lg space-y-2.5">
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
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                                <span className="text-[11px] text-muted-foreground font-medium">Standard Input (stdin)</span>
                                                <textarea
                                                    value={tc.input}
                                                    onChange={(e) => {
                                                        const updated = [...testCases]
                                                        updated[idx].input = e.target.value
                                                        setTestCases(updated)
                                                    }}
                                                    placeholder="Standard Input (stdin)"
                                                    rows={3}
                                                    className="w-full font-mono text-xs p-2.5 bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <span className="text-[11px] text-muted-foreground font-medium">Expected Output (stdout)</span>
                                                <textarea
                                                    value={tc.expected_output}
                                                    onChange={(e) => {
                                                        const updated = [...testCases]
                                                        updated[idx].expected_output = e.target.value
                                                        setTestCases(updated)
                                                    }}
                                                    placeholder="Expected Output (stdout) — or leave blank to auto-generate from solution"
                                                    rows={3}
                                                    className="w-full font-mono text-xs p-2.5 bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                                                />
                                            </div>
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
                <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
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
                            Execution verification of the reference solution against configured test cases in Docker sandbox.
                        </DialogDescription>
                    </DialogHeader>

                    {validationReport && (
                        <div className="space-y-4 py-2 text-sm">
                            <div className="flex items-center justify-between p-3 bg-muted/40 rounded-lg">
                                <span className="font-medium">Validation Status:</span>
                                <Badge variant={validationReport.all_passed ? 'default' : 'destructive'}>
                                    {validationReport.all_passed ? 'All Test Cases Passed' : 'Discrepancy / Error Found'}
                                </Badge>
                            </div>

                            {/* Language Filter Tabs (when multiple languages tested) */}
                            {validationReport.validated_languages && validationReport.validated_languages.length > 1 && (
                                <div className="space-y-2">
                                    <span className="text-xs font-semibold text-foreground">Filter by Language:</span>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <button
                                            type="button"
                                            onClick={() => setValidationLangFilter('all')}
                                            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                                                validationLangFilter === 'all'
                                                    ? 'bg-primary text-primary-foreground shadow-sm'
                                                    : 'bg-muted/60 text-muted-foreground hover:text-foreground'
                                            }`}
                                        >
                                            All Languages ({validationReport.details?.length || 0})
                                        </button>
                                        {validationReport.validated_languages.map((l: string) => {
                                            const lDetails = validationReport.details?.filter((d: any) => d.language === l) || []
                                            const passed = lDetails.filter((d: any) => d.status === 'valid' || d.status === 'generated').length
                                            const total = lDetails.length
                                            const allPassed = passed === total && total > 0

                                            return (
                                                <button
                                                    key={l}
                                                    type="button"
                                                    onClick={() => setValidationLangFilter(l)}
                                                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                                                        validationLangFilter === l
                                                            ? 'bg-primary text-primary-foreground shadow-sm'
                                                            : 'bg-muted/60 text-muted-foreground hover:text-foreground'
                                                    }`}
                                                >
                                                    <span className={`h-2 w-2 rounded-full ${allPassed ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                                    <span>{getLanguageLabel(l, availableLanguages)}</span>
                                                    <span className="text-[10px] opacity-80">({passed}/{total})</span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                            )}

                            {validationReport.generated_count > 0 && (
                                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                                    Generated missing expected outputs for {validationReport.generated_count} test case(s).
                                </p>
                            )}

                            {/* Details List */}
                            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                                {(validationReport.details || [])
                                    .filter((d: any) => validationLangFilter === 'all' || d.language === validationLangFilter)
                                    .map((d: any, idx: number) => {
                                        // Display human-friendly Test Case #1, #2, #3
                                        const caseNum = d.test_case_number || d.display_order || (idx + 1)
                                        return (
                                            <div key={idx} className="p-3 border border-border rounded-lg text-xs space-y-2 bg-card/50">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-semibold text-foreground">
                                                            Test Case #{caseNum}
                                                        </span>
                                                        {d.language && (
                                                            <Badge variant="secondary" className="text-[10px] font-mono">
                                                                {getLanguageLabel(d.language, availableLanguages)}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <Badge
                                                        variant="outline"
                                                        className={
                                                            d.status === 'valid'
                                                                ? 'border-emerald-500/30 text-emerald-600 bg-emerald-500/10'
                                                                : d.status === 'generated'
                                                                ? 'border-blue-500/30 text-blue-600 bg-blue-500/10'
                                                                : 'border-rose-500/30 text-rose-600 bg-rose-500/10'
                                                        }
                                                    >
                                                        {d.status.toUpperCase()}
                                                    </Badge>
                                                </div>
                                                {d.error && (
                                                    <div className="space-y-1">
                                                        <span className="text-[10px] text-muted-foreground font-semibold">
                                                            Execution Error ({getLanguageLabel(d.language, availableLanguages)}):
                                                        </span>
                                                        <p className="font-mono text-[11px] text-rose-600 dark:text-rose-400 bg-rose-500/5 p-2 rounded border border-rose-500/20 whitespace-pre-wrap break-all">
                                                            {d.error}
                                                        </p>
                                                    </div>
                                                )}
                                                {d.status === 'mismatch' && (
                                                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono bg-muted/40 p-2 rounded">
                                                        <div>
                                                            <span className="text-muted-foreground block text-[10px]">Expected:</span>
                                                            <span className="text-emerald-600 dark:text-emerald-400">{d.expected}</span>
                                                        </div>
                                                        <div>
                                                            <span className="text-muted-foreground block text-[10px]">Actual:</span>
                                                            <span className="text-rose-600 dark:text-rose-400">{d.actual}</span>
                                                        </div>
                                                    </div>
                                                )}
                                                {d.status === 'generated' && (
                                                    <div className="text-[11px] font-mono bg-muted/40 p-2 rounded">
                                                        <span className="text-muted-foreground block text-[10px]">Generated Output:</span>
                                                        <span className="text-blue-600 dark:text-blue-400">{d.output}</span>
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                            </div>
                        </div>
                    )}

                    <DialogFooter className="flex items-center justify-between sm:justify-between">
                        <span className="text-xs text-muted-foreground">
                            {validationReport?.details?.length || 0} test case execution(s)
                        </span>
                        <Button onClick={() => setValidationModalOpen(false)}>Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Question Set Create/Edit Modal */}
            <Dialog open={setModalOpen} onOpenChange={setSetModalOpen}>
                <DialogContent className="w-[92vw] max-w-[92vw] sm:w-[680px] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
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
                            <div className="flex flex-wrap gap-2 pt-1">
                                {availableLanguages.map((lang) => {
                                    const isChecked = supportedLangs.includes(lang.id)
                                    return (
                                        <label
                                            key={lang.id}
                                            className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors text-xs font-medium ${
                                                isChecked ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background hover:border-primary/40'
                                            }`}
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
                                            <span>{lang.name || lang.label || lang.id}</span>
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
                                        const pLangs = p.supported_languages && p.supported_languages.length > 0
                                            ? p.supported_languages
                                            : (p.starter_code ? Object.keys(p.starter_code) : ['python3'])
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
                                                <div className="flex flex-wrap gap-1">
                                                    {pLangs.map(l => (
                                                        <Badge key={l} variant="outline" className="text-[9px] py-0 px-1 font-mono">
                                                            {getLanguageLabel(l, availableLanguages)}
                                                        </Badge>
                                                    ))}
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

            {/* Import Repository Modal */}
            <Dialog open={importModalOpen} onOpenChange={setImportModalOpen}>
                <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-lg">
                            <Upload className="h-5 w-5 text-primary" />
                            Import Coding Repository
                        </DialogTitle>
                        <DialogDescription>
                            Upload an Excel (.xlsx) or JSON (.json) file containing coding question sets and/or algorithmic problems.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        {/* File Upload Area */}
                        <div className="border-2 border-dashed border-border/80 hover:border-primary/50 transition-colors rounded-xl p-6 text-center bg-card/40">
                            <input
                                type="file"
                                id="repo-file-upload"
                                accept=".json,.xlsx,.xls,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                                onChange={handleFileChange}
                                className="hidden"
                            />
                            {importFile ? (
                                <div className="flex items-center justify-between bg-muted/40 p-3 rounded-lg border border-border">
                                    <div className="flex items-center gap-3 text-left">
                                        <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center text-primary">
                                            {/\.(xlsx|xls)$/i.test(importFile.name) ? (
                                                <FileSpreadsheet className="h-5 w-5" />
                                            ) : (
                                                <FileJson className="h-5 w-5" />
                                            )}
                                        </div>
                                        <div>
                                            <p className="text-sm font-semibold text-foreground truncate max-w-[280px]">{importFile.name}</p>
                                            <p className="text-xs text-muted-foreground">{(importFile.size / 1024).toFixed(1)} KB</p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => document.getElementById('repo-file-upload')?.click()}
                                        className="text-xs text-primary"
                                    >
                                        Change File
                                    </Button>
                                </div>
                            ) : (
                                <label
                                    htmlFor="repo-file-upload"
                                    className="cursor-pointer flex flex-col items-center justify-center gap-2 py-4"
                                >
                                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-1">
                                        <FileUp className="h-6 w-6" />
                                    </div>
                                    <p className="text-sm font-medium text-foreground">Click to upload or drag & drop Excel or JSON file</p>
                                    <p className="text-xs text-muted-foreground">Supports .xlsx workbooks and .json repository exports</p>
                                </label>
                            )}
                        </div>

                        {importError && (
                            <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-xs">
                                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                                <span>{importError}</span>
                            </div>
                        )}

                        {/* Import Preview */}
                        {importData && (
                            <div className="space-y-3 bg-muted/30 p-4 rounded-xl border border-border/60">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">File Content Preview</span>
                                    <div className="flex items-center gap-1.5">
                                        {importData.question_sets.length > 0 && (
                                            <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
                                                {importData.question_sets.length} Question Set(s)
                                            </Badge>
                                        )}
                                        {importData.problems.length > 0 && (
                                            <Badge variant="outline" className="text-xs bg-secondary">
                                                {importData.problems.length} Problem(s)
                                            </Badge>
                                        )}
                                    </div>
                                </div>

                                <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                                    {importData.question_sets.map((s: any, idx: number) => (
                                        <div key={idx} className="flex items-center justify-between p-2 rounded-md bg-background text-xs border border-border/40">
                                            <div className="flex items-center gap-2 truncate">
                                                <Layers className="h-3.5 w-3.5 text-primary shrink-0" />
                                                <span className="font-medium text-foreground truncate">{s.title || 'Untitled Set'}</span>
                                            </div>
                                            <span className="text-muted-foreground text-[11px] shrink-0">
                                                {s.problems?.length || 0} problems linked
                                            </span>
                                        </div>
                                    ))}
                                    {importData.problems.map((p: any, idx: number) => (
                                        <div key={idx} className="flex items-center justify-between p-2 rounded-md bg-background text-xs border border-border/40">
                                            <div className="flex items-center gap-2 truncate">
                                                <Code2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                                <span className="font-medium text-foreground truncate">{p.title || 'Untitled Problem'}</span>
                                            </div>
                                            <Badge variant="outline" className="text-[10px] capitalize shrink-0 py-0">
                                                {p.difficulty || 'medium'}
                                            </Badge>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Conflict Resolution Strategy */}
                        <div className="space-y-2">
                            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                Conflict Resolution Strategy
                            </Label>
                            <div className="grid grid-cols-3 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setImportStrategy('copy')}
                                    className={`p-2.5 rounded-lg border text-left transition-all text-xs flex flex-col gap-1 ${
                                        importStrategy === 'copy'
                                            ? 'border-primary bg-primary/10 text-foreground font-medium'
                                            : 'border-border/60 hover:border-border text-muted-foreground bg-card'
                                    }`}
                                >
                                    <span className="font-semibold text-foreground">Create Copy</span>
                                    <span className="text-[10px] opacity-80 leading-tight">Append &quot;(Imported)&quot; to conflicts</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setImportStrategy('skip')}
                                    className={`p-2.5 rounded-lg border text-left transition-all text-xs flex flex-col gap-1 ${
                                        importStrategy === 'skip'
                                            ? 'border-primary bg-primary/10 text-foreground font-medium'
                                            : 'border-border/60 hover:border-border text-muted-foreground bg-card'
                                    }`}
                                >
                                    <span className="font-semibold text-foreground">Skip Existing</span>
                                    <span className="text-[10px] opacity-80 leading-tight">Ignore items with same title</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setImportStrategy('overwrite')}
                                    className={`p-2.5 rounded-lg border text-left transition-all text-xs flex flex-col gap-1 ${
                                        importStrategy === 'overwrite'
                                            ? 'border-primary bg-primary/10 text-foreground font-medium'
                                            : 'border-border/60 hover:border-border text-muted-foreground bg-card'
                                    }`}
                                >
                                    <span className="font-semibold text-foreground">Overwrite</span>
                                    <span className="text-[10px] opacity-80 leading-tight">Update existing problems & sets</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setImportModalOpen(false)} disabled={importing}>
                            Cancel
                        </Button>
                        <Button onClick={handleConfirmImport} disabled={!importData || importing} className="gap-2">
                            {importing ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Importing...
                                </>
                            ) : (
                                <>
                                    <Upload className="h-4 w-4" />
                                    Import Items
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
