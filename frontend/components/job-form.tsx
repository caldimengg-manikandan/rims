'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { APIClient } from '@/app/dashboard/lib/api-client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useNavigationGuard } from '@/hooks/use-navigation-guard'
import { Sparkles, UploadCloud, Loader2, FileText, X, PlusCircle, ArrowLeft, CheckCircle2, BookOpen, Plus, Minus, GripVertical, Trophy, Code2, Brain, ClipboardList, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react'
import { getApiBaseUrl } from '@/lib/config'
import { toast } from 'sonner'
import { Slider } from '@/components/ui/slider'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { getLanguageLabel } from '@/lib/coding-languages'

// Ã¢â€â‚¬Ã¢â€â‚¬ Repository types Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
interface RepoSet {
    id: number
    title: string
    round_type: string
    job_roles: string[]
    question_count: number
    topic_tags: string[]
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Repo picker sub-component Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function RepoPicker({
    roundType,
    jobTitle,
    selectedId,
    onSelect,
}: {
    roundType: 'aptitude' | 'technical' | 'behavioural'
    jobTitle: string
    selectedId: number | null
    onSelect: (id: number | null, set: RepoSet | null) => void
}) {
    const [sets, setSets] = useState<RepoSet[]>([])
    const [loading, setLoading] = useState(false)
    const [selectedSet, setSelectedSet] = useState<RepoSet | null>(null)

    useEffect(() => {
        const fetchSets = async () => {
            setLoading(true)
            try {
                const params = new URLSearchParams({ round_type: roundType })
                if (jobTitle.trim()) params.set('job_role', jobTitle.trim())
                const data = await APIClient.get<RepoSet[]>(`/api/repository/sets?${params}`)
                setSets(Array.isArray(data) ? data : [])
            } catch {
                setSets([])
            } finally {
                setLoading(false)
            }
        }
        const timer = setTimeout(fetchSets, jobTitle ? 400 : 0)
        return () => clearTimeout(timer)
    }, [roundType, jobTitle])

    useEffect(() => {
        if (selectedId) {
            const found = sets.find(s => s.id === selectedId) || null
            setSelectedSet(found)
        } else {
            setSelectedSet(null)
        }
    }, [selectedId, sets])

    const handleSelectSet = (val: string) => {
        const id = val === "none" ? null : parseInt(val)
        const set = id ? sets.find(s => s.id === id) || null : null
        setSelectedSet(set)
        onSelect(id, set)
    }

    return (
        <div className="space-y-2 mt-3 animate-in fade-in slide-in-from-top-2 duration-200">
            {loading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading repository setsÃ¢â‚¬Â¦
                </div>
            ) : sets.length === 0 ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                    No matching sets found in the repository for this role. Add sets via the Repository page first.
                </p>
            ) : (
                <>
                    <Select
                        value={selectedId ? String(selectedId) : "none"}
                        onValueChange={handleSelectSet}
                    >
                        <SelectTrigger className="w-full h-10 border border-border rounded-xl bg-background/50 text-foreground text-sm">
                            <SelectValue placeholder="Ã¢â‚¬â€ Select a question set Ã¢â‚¬â€" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                            <SelectItem value="none">Ã¢â‚¬â€ Select a question set Ã¢â‚¬â€</SelectItem>
                            {sets.map(s => (
                                <SelectItem key={s.id} value={String(s.id)}>
                                    {s.title} ({s.question_count} questions)
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    {selectedSet && selectedSet.topic_tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                            {selectedSet.topic_tags.map((tag, i) => (
                                <span
                                    key={i}
                                    className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary border border-primary/20"
                                >
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}

                    {selectedSet && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                            <BookOpen className="h-3 w-3 shrink-0" />
                            Questions will be pulled from the selected set. No file upload needed.
                        </p>
                    )}
                </>
            )}
        </div>
    )
}

const MAX_QUESTION_FILE_SIZE = 5 * 1024 * 1024 // 5MB

// Ã¢â€â‚¬Ã¢â€â‚¬ Round types Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export type RoundType = 'aptitude' | 'first_level' | 'coding'

export interface Round {
    id: string
    type: RoundType
    // First-level / behavioral
    interview_mode?: 'ai' | 'upload' | 'mixed'
    behavioral_role?: string
    uploaded_question_file?: string | null
    technical_repo_set_id?: number | null
    behavioural_repo_set_id?: number | null
    // Aptitude
    aptitude_mode?: 'ai' | 'upload'
    aptitude_questions_file?: string | null
    aptitude_repo_set_id?: number | null
    // Coding
    coding_repo_set_id?: number | null
    coding_problem_count?: number | null
    coding_allowed_languages?: string[]
    coding_round_duration_minutes?: number
}

interface RoundTypeMeta {
    value: RoundType
    label: string
    desc: string
    icon: React.ReactNode
    color: string
    borderColor: string
    bgColor: string
}

const ROUND_TYPE_META: RoundTypeMeta[] = [
    {
        value: 'aptitude',
        label: 'Aptitude Round',
        desc: 'Screen candidates with MCQ / AI aptitude questions. (Junior & Intern only)',
        icon: <Trophy className="h-4 w-4" />,
        color: 'text-amber-600 dark:text-amber-400',
        borderColor: 'border-amber-500/40',
        bgColor: 'bg-amber-500/5',
    },
    {
        value: 'first_level',
        label: 'First Level Interview',
        desc: 'AI-driven technical & behavioral interview with adaptive questions.',
        icon: <Brain className="h-4 w-4" />,
        color: 'text-blue-600 dark:text-blue-400',
        borderColor: 'border-blue-500/40',
        bgColor: 'bg-blue-500/5',
    },
    {
        value: 'coding',
        label: 'Coding Round',
        desc: 'Automated sandboxed programming challenges with code execution.',
        icon: <Code2 className="h-4 w-4" />,
        color: 'text-violet-600 dark:text-violet-400',
        borderColor: 'border-violet-500/40',
        bgColor: 'bg-violet-500/5',
    },
]

/** Convert legacy flat flags (from initialData / existing job) into a rounds array. */
function buildRoundsFromLegacy(data: any): Round[] {
    if (!data) return []
    // If the job already has interview_rounds JSON, use it directly.
    if (data.interview_rounds) {
        try {
            const parsed = JSON.parse(data.interview_rounds)
            if (Array.isArray(parsed) && parsed.length > 0) return parsed
        } catch { /* ignore parse errors, fall through to legacy */ }
    }
    const rounds: Round[] = []
    const nano = () => Math.random().toString(36).slice(2, 9)
    // Standard IT ordering: Aptitude Ã¢â€ â€™ Coding Ã¢â€ â€™ First Level
    if (data.aptitude_enabled) {
        rounds.push({
            id: nano(),
            type: 'aptitude',
            aptitude_mode: data.aptitude_mode || 'ai',
            aptitude_questions_file: data.aptitude_questions_file || null,
            aptitude_repo_set_id: data.aptitude_repo_set_id || null,
        })
    }
    if (data.coding_round_enabled) {
        rounds.push({
            id: nano(),
            type: 'coding',
            coding_repo_set_id: data.coding_repo_set_id || null,
            coding_problem_count: data.coding_problem_count || null,
            coding_allowed_languages: data.coding_allowed_languages || [],
            coding_round_duration_minutes: data.coding_round_duration_minutes || 60,
        })
    }
    if (data.first_level_enabled) {
        rounds.push({
            id: nano(),
            type: 'first_level',
            interview_mode: data.interview_mode || 'ai',
            behavioral_role: data.behavioral_role || 'general',
            uploaded_question_file: data.uploaded_question_file || null,
            technical_repo_set_id: data.technical_repo_set_id || null,
            behavioural_repo_set_id: data.behavioural_repo_set_id || null,
        })
    }
    return rounds
}

/** Derive legacy flat fields from rounds so the backend stays backward-compatible. */
function deriveFormDataFromRounds(rounds: Round[]) {
    const apt = rounds.find(r => r.type === 'aptitude')
    const fl = rounds.find(r => r.type === 'first_level')
    const coding = rounds.find(r => r.type === 'coding')
    return {
        aptitude_enabled: Boolean(apt),
        aptitude_mode: apt?.aptitude_mode || 'ai',
        aptitude_questions_file: apt?.aptitude_questions_file || null,
        aptitude_repo_set_id: apt?.aptitude_repo_set_id || null,
        first_level_enabled: Boolean(fl),
        interview_mode: fl?.interview_mode || (fl ? 'ai' : null),
        behavioral_role: fl?.behavioral_role || 'general',
        uploaded_question_file: fl?.uploaded_question_file || null,
        technical_repo_set_id: fl?.technical_repo_set_id || null,
        behavioural_repo_set_id: fl?.behavioural_repo_set_id || null,
        coding_round_enabled: Boolean(coding),
        coding_repo_set_id: coding?.coding_repo_set_id || null,
        coding_problem_count: coding?.coding_problem_count || null,
        coding_allowed_languages: coding?.coding_allowed_languages || [],
        coding_round_duration_minutes: coding?.coding_round_duration_minutes || 60,
        interview_rounds: JSON.stringify(rounds),
    }
}

interface JobFormProps {
    mode: 'create' | 'edit'
    initialData?: any
    onSubmit: (formData: any) => Promise<void>
    isSubmitting: boolean
}


export function JobForm({ mode, initialData, onSubmit, isSubmitting }: JobFormProps) {
    const router = useRouter()
    const [isAILoading, setIsAILoading] = useState(false)
    const [showValidationErrors, setShowValidationErrors] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)
    const [aiFillError, setAiFillError] = useState('')
    const [questionFileError, setQuestionFileError] = useState('')
    const [aptitudeFileError, setAptitudeFileError] = useState('')
    const [isUploadingQuestions, setIsUploadingQuestions] = useState(false)
    const [questionFileName, setQuestionFileName] = useState('')
    const fileInputRef = useRef<HTMLInputElement>(null)
    const questionFileRef = useRef<HTMLInputElement>(null)
    const aptitudeFileRef = useRef<HTMLInputElement>(null)

    const [formData, setFormData] = useState({
        title: initialData?.title || '',
        description: initialData?.description || '',
        experience_level: initialData?.experience_level || 'junior',
        location: initialData?.location || '',
        mode_of_work: initialData?.mode_of_work || 'Remote',
        job_type: initialData?.job_type || 'Full-Time',
        domain: initialData?.domain || 'Engineering',
        status: initialData?.status || 'open',

        // Interview pipeline
        aptitude_enabled: initialData?.aptitude_enabled || false,
        aptitude_mode: initialData?.aptitude_mode || 'ai',
        first_level_enabled: initialData?.first_level_enabled ?? true,
        interview_mode: initialData?.interview_mode || 'ai',
        behavioral_role: initialData?.behavioral_role || 'general',
        uploaded_question_file: initialData?.uploaded_question_file || null,
        aptitude_questions_file: initialData?.aptitude_questions_file || null,
        primary_evaluated_skills: initialData?.primary_evaluated_skills || [],
        duration_minutes: initialData?.duration_minutes || 60,

        // Repository Picker IDs
        aptitude_repo_set_id: initialData?.aptitude_repo_set_id || null,
        technical_repo_set_id: initialData?.technical_repo_set_id || null,
        behavioural_repo_set_id: initialData?.behavioural_repo_set_id || null,
        coding_round_enabled: initialData?.coding_round_enabled || false,
        coding_round_duration_minutes: initialData?.coding_round_duration_minutes || 60,
        coding_repo_set_id: initialData?.coding_repo_set_id || null,
        coding_allowed_languages: initialData?.coding_allowed_languages || [],
        coding_problem_count: initialData?.coding_problem_count ?? (initialData?.coding_problem_count || null),
    })

    const [isUploadingAptitude, setIsUploadingAptitude] = useState(false)
    const [aptitudeFileName, setAptitudeFileName] = useState(initialData?.aptitude_questions_file ? 'Existing File' : '')
    const [aptitudeQuestionCount, setAptitudeQuestionCount] = useState(0)

    // Repository picker state
    const [technicalRepoSetId, setTechnicalRepoSetId] = useState<number | null>(initialData?.technical_repo_set_id || null)
    const [aptitudeRepoSetId, setAptitudeRepoSetId] = useState<number | null>(initialData?.aptitude_repo_set_id || null)
    const [behaviouralRepoSetId, setBehaviouralRepoSetId] = useState<number | null>(initialData?.behavioural_repo_set_id || null)
    const [codingRepoSetId, setCodingRepoSetId] = useState<number | null>(initialData?.coding_repo_set_id || null)
    const [codingQuestionSets, setCodingQuestionSets] = useState<any[]>([])

    // Ã¢â€â‚¬Ã¢â€â‚¬ Rounds state (new multi-round builder) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    const [rounds, setRounds] = useState<Round[]>(() => buildRoundsFromLegacy(initialData))
    // Per-round coding set cache (round id Ã¢â€ â€™ set object)
    const [codingSetCache, setCodingSetCache] = useState<Record<string, any>>({})

    const [locationSuggestions, setLocationSuggestions] = useState<string[]>([])
    const [showSuggestions, setShowSuggestions] = useState(false)
    const suggestionRef = useRef<HTMLDivElement>(null)

    const [domainsList, setDomainsList] = useState<string[]>([
        "Engineering", "Software", "Support", "Design",
        "Structural Engineering", "Civil Engineering",
        "Electrical Engineering", "Mechanical Engineering",
        "Automobile Engineering", "HR"
    ])
    const [showDomainSuggestions, setShowDomainSuggestions] = useState(false)
    const domainRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (initialData) {
            setFormData({
                ...formData,
                ...initialData,
                primary_evaluated_skills: typeof initialData.primary_evaluated_skills === 'string' 
                    ? JSON.parse(initialData.primary_evaluated_skills) 
                    : (initialData.primary_evaluated_skills || [])
            })
            if (initialData.uploaded_question_file) setQuestionFileName('Existing File')
            if (initialData.aptitude_questions_file) setAptitudeFileName('Existing File')
            
            setTechnicalRepoSetId(initialData.technical_repo_set_id || null)
            setAptitudeRepoSetId(initialData.aptitude_repo_set_id || null)
            setBehaviouralRepoSetId(initialData.behavioural_repo_set_id || null)
            setCodingRepoSetId(initialData.coding_repo_set_id || null)
            // Rebuild rounds from initialData on edit
            setRounds(buildRoundsFromLegacy(initialData))
        }
    }, [initialData])

    // Fetch coding question sets
    useEffect(() => {
        const fetchCodingSets = async () => {
            try {
                const res = await APIClient.get<any[]>('/api/coding/question-sets')
                setCodingQuestionSets(res || [])
            } catch (e) {
                console.error('Failed to load coding question sets', e)
            }
        }
        fetchCodingSets()
    }, [])




    // Warning for unsaved changes (H020)
    const isFormModified = () => {
        if (mode === 'create') {
            return !!(formData.title || formData.description || formData.location);
        }
        if (!initialData) return false;
        return (
            formData.title !== (initialData.title || '') ||
            formData.description !== (initialData.description || '') ||
            formData.location !== (initialData.location || '') ||
            formData.experience_level !== (initialData.experience_level || 'junior') ||
            formData.mode_of_work !== (initialData.mode_of_work || 'Remote') ||
            formData.job_type !== (initialData.job_type || 'Full-Time') ||
            formData.domain !== (initialData.domain || 'Engineering') ||
            formData.aptitude_enabled !== (initialData.aptitude_enabled || false) ||
            formData.first_level_enabled !== (initialData.first_level_enabled ?? true)
        );
    };
    const isDirty = isFormModified() && !isSubmitting;

    useNavigationGuard(isDirty, {
        title: 'Unsaved Job Changes',
        description: 'You have unsaved changes in your job form. If you leave, your changes will be lost.',
        confirmLabel: 'Leave',
        cancelLabel: 'Stay'
    });

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (suggestionRef.current && !suggestionRef.current.contains(e.target as Node)) {
                setShowSuggestions(false)
            }
            if (domainRef.current && !domainRef.current.contains(e.target as Node)) {
                setShowDomainSuggestions(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    useEffect(() => {
        const fetchLocations = async () => {
            if (!formData.location || formData.location.length < 2) {
                setLocationSuggestions([])
                return
            }
            try {
                const res = await fetch(`/api/geocode?q=${encodeURIComponent(formData.location)}`)
                if (!res.ok) return
                const data = await res.json()
                if (Array.isArray(data)) {
                    setLocationSuggestions(Array.from(new Set(data.map((item: any) => item.display_name))))
                }
            } catch (error) {
                console.error("Location fetch error", error)
            }
        }
        const timer = setTimeout(fetchLocations, 400)
        return () => clearTimeout(timer)
    }, [formData.location])

    const prevExpRef = useRef(formData.experience_level)
    useEffect(() => {
        if (prevExpRef.current !== formData.experience_level) {
            let newBehavioralRole = formData.behavioral_role;
            if (formData.experience_level === 'intern' || formData.experience_level === 'junior') {
                newBehavioralRole = 'junior';
            } else if (formData.experience_level === 'mid') {
                newBehavioralRole = 'mid';
            } else if (formData.experience_level === 'senior' || formData.experience_level === 'lead') {
                newBehavioralRole = 'lead';
            }

            setFormData(prev => ({
                ...prev,
                behavioral_role: newBehavioralRole,
                ...(prevExpRef.current === 'junior' && formData.experience_level !== 'junior' && { aptitude_enabled: false }),
            }))
            prevExpRef.current = formData.experience_level
        }
    }, [formData.experience_level])

    // Sync repo IDs back to formData
    useEffect(() => {
        setFormData(prev => ({
            ...prev,
            technical_repo_set_id: technicalRepoSetId,
            aptitude_repo_set_id: aptitudeRepoSetId,
            behavioural_repo_set_id: behaviouralRepoSetId,
            coding_repo_set_id: codingRepoSetId,
        }))
    }, [technicalRepoSetId, aptitudeRepoSetId, behaviouralRepoSetId, codingRepoSetId])

    const handleAIFill = async (file?: File) => {
        setIsAILoading(true)
        setAiFillError('')
        try {
            const data = new FormData()
            if (file) {
                data.append('file', file)
            } else if (formData.description) {
                data.append('text_content', formData.description)
            } else {
                setAiFillError('Please provide a job description or upload a file to extract details.')
                setIsAILoading(false)
                return
            }

            const baseUrl = getApiBaseUrl()

            const response = await fetch(`${baseUrl}/api/jobs/extract`, {
                method: 'POST',
                credentials: 'include',
                body: data,
            })

            if (!response.ok) {
                const errData = await response.json()
                throw new Error(errData.detail || 'Failed to extract job details')
            }

            const result = await response.json()

            const expLevelMap: Record<string, string> = {
                'intern': 'intern',
                'junior': 'junior',
                'mid-level': 'mid',
                'senior': 'senior',
                'lead / manager': 'lead'
            }

            setFormData(prev => ({
                ...prev,
                title: result.title || prev.title,
                experience_level: result.experience_level ? (expLevelMap[result.experience_level.toLowerCase()] || prev.experience_level) : prev.experience_level,
                domain: result.domain || prev.domain,
                job_type: result.job_type || prev.job_type,
                mode_of_work: result.mode_of_work || prev.mode_of_work,
                location: result.location || prev.location,
                description: result.description || prev.description,
                primary_evaluated_skills: result.primary_evaluated_skills || prev.primary_evaluated_skills
            }))

            const warnings: string[] = Array.isArray(result.warnings) ? result.warnings : []
            if (warnings.length > 0) {
                toast.warning(warnings.join(" "), { duration: 8000 })
            }

        } catch (err: any) {
            setAiFillError(err.message || 'Error occurred during AI extraction.')
        } fileInputRef.current && (fileInputRef.current.value = '')
        setIsAILoading(false)
    }

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            handleAIFill(e.target.files[0])
        }
    }

    const handleQuestionFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return
        const file = e.target.files[0]

        const ext = file.name.split('.').pop()?.toLowerCase()
        if (!ext || !['txt', 'pdf', 'docx'].includes(ext)) {
            setQuestionFileError('Invalid file type. Only .txt, .pdf, .docx are allowed.')
            return
        }
        if (file.size > MAX_QUESTION_FILE_SIZE) {
            setQuestionFileError('File is too large. Maximum size is 5MB.')
            return
        }

        setIsUploadingQuestions(true)
        setQuestionFileError('')

        try {
            const data = new FormData()
            data.append('file', file)
            const result = await APIClient.postFormData<{ file_path: string; original_name: string }>(
                '/api/jobs/upload-questions',
                data
            )
            setFormData(prev => ({ ...prev, uploaded_question_file: result.file_path }))
            setQuestionFileName(result.original_name)
        } catch (err: any) {
            setQuestionFileError(err.message || 'Failed to upload question file.')
        } finally {
            setIsUploadingQuestions(false)
            if (questionFileRef.current) questionFileRef.current.value = ''
        }
    }

    const removeQuestionFile = () => {
        setFormData(prev => ({ ...prev, uploaded_question_file: null }))
        setQuestionFileName('')
        if (questionFileRef.current) questionFileRef.current.value = ''
    }

    const handleAptitudeFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return
        const file = e.target.files[0]

        const ext = file.name.split('.').pop()?.toLowerCase()
        if (!ext || !['xlsx', 'xls'].includes(ext)) {
            setAptitudeFileError('Invalid file type. Only Excel (.xlsx, .xls) files are allowed for aptitude questions.')
            return
        }
        if (file.size > MAX_QUESTION_FILE_SIZE) {
            setAptitudeFileError('File is too large. Maximum size is 5MB.')
            return
        }

        setIsUploadingAptitude(true)
        setAptitudeFileError('')

        try {
            const data = new FormData()
            data.append('file', file)
            const result = await APIClient.postFormData<{ file_path: string; original_name: string; questions_count: number }>(
                '/api/jobs/upload-aptitude-questions',
                data
            )
            setFormData(prev => ({ ...prev, aptitude_questions_file: result.file_path }))
            setAptitudeFileName(result.original_name)
            setAptitudeQuestionCount(result.questions_count)
        } catch (err: any) {
            setAptitudeFileError(err.message || 'Failed to upload aptitude question file.')
        } finally {
            setIsUploadingAptitude(false)
            if (aptitudeFileRef.current) aptitudeFileRef.current.value = ''
        }
    }

    const removeAptitudeFile = () => {
        setFormData(prev => ({ ...prev, aptitude_questions_file: null }))
        setAptitudeFileName('')
        setAptitudeQuestionCount(0)
        if (aptitudeFileRef.current) aptitudeFileRef.current.value = ''
    }

    const [titleError, setTitleError] = useState<string | null>(null)
    const [descError, setDescError] = useState<string | null>(null)
    const [durationError, setDurationError] = useState<string | null>(null)

    const validateTitle = (value: string) => {
        const v = (value || '').trim()
        if (!v) { setTitleError(null); return }
        if (v.length < 3 || v.length > 100) { setTitleError('Job title must contain 3-100 characters'); return }
        if (!/[A-Za-z]/.test(v)) { setTitleError('Job title must contain text'); return }
        setTitleError(null)
    }

    const validateDescription = (value: string) => {
        const v = (value || '').trim()
        if (!v) { setDescError(null); return }
        if (v.length < 10) { setDescError('Description must be at least 10 characters'); return }
        setDescError(null)
    }

    const validateDuration = (value: number) => {
        if (!value) { setDurationError('Duration is required'); return }
        if (value < 60 || value > 300) { setDurationError('Duration must be between 60 and 300 minutes'); return }
        setDurationError(null)
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ Round validation helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    const isJunior = formData.experience_level === 'junior' || formData.experience_level === 'intern'

    // When experience level changes away from junior/intern, drop any aptitude round
    const prevExpRef2 = useRef(formData.experience_level)
    useEffect(() => {
        if (prevExpRef2.current !== formData.experience_level) {
            if (formData.experience_level !== 'junior' && formData.experience_level !== 'intern') {
                setRounds(prev => prev.filter(r => r.type !== 'aptitude'))
            }
            prevExpRef2.current = formData.experience_level
        }
    }, [formData.experience_level])

    const getRoundMeta = (type: RoundType) => ROUND_TYPE_META.find(m => m.value === type)!

    const updateRound = (id: string, patch: Partial<Round>) => {
        setRounds(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
    }

    const removeRound = (id: string) => {
        setRounds(prev => prev.filter(r => r.id !== id))
    }

    const moveRound = (id: string, dir: -1 | 1) => {
        setRounds(prev => {
            const idx = prev.findIndex(r => r.id === id)
            if (idx < 0) return prev
            const next = idx + dir
            if (next < 0 || next >= prev.length) return prev
            const arr = [...prev]
            const tmp = arr[idx]; arr[idx] = arr[next]; arr[next] = tmp
            return arr
        })
    }

    const addRound = (type: RoundType) => {
        // Only one round of each type allowed
        if (rounds.some(r => r.type === type)) {
            toast.error(`A ${getRoundMeta(type).label} round is already added.`)
            return
        }
        const id = Math.random().toString(36).slice(2, 9)
        const defaults: Round = { id, type }
        if (type === 'first_level') {
            defaults.interview_mode = 'ai'
            defaults.behavioral_role = 'general'
        } else if (type === 'aptitude') {
            defaults.aptitude_mode = 'ai'
        } else if (type === 'coding') {
            defaults.coding_round_duration_minutes = 60
            defaults.coding_allowed_languages = []
        }
        setRounds(prev => [...prev, defaults])
    }

    // Per-round file upload handlers
    const uploadFirstLevelFile = async (roundId: string, file: File) => {
        const ext = file.name.split('.').pop()?.toLowerCase()
        if (!ext || !['txt', 'pdf', 'docx'].includes(ext)) {
            toast.error('Invalid file type. Only .txt, .pdf, .docx are allowed.')
            return
        }
        if (file.size > MAX_QUESTION_FILE_SIZE) { toast.error('File too large (max 5MB).'); return }
        try {
            const fd = new FormData(); fd.append('file', file)
            const result = await APIClient.postFormData<{ file_path: string; original_name: string }>('/api/jobs/upload-questions', fd)
            updateRound(roundId, { uploaded_question_file: result.file_path })
            toast.success(`Uploaded: ${result.original_name}`)
        } catch (err: any) { toast.error(err.message || 'Upload failed') }
    }

    const uploadAptitudeFile = async (roundId: string, file: File) => {
        const ext = file.name.split('.').pop()?.toLowerCase()
        if (!ext || !['xlsx', 'xls'].includes(ext)) {
            toast.error('Invalid file type. Only .xlsx files are allowed.')
            return
        }
        if (file.size > MAX_QUESTION_FILE_SIZE) { toast.error('File too large (max 5MB).'); return }
        try {
            const fd = new FormData(); fd.append('file', file)
            const result = await APIClient.postFormData<{ file_path: string; original_name: string; questions_count: number }>('/api/jobs/upload-aptitude-questions', fd)
            updateRound(roundId, { aptitude_questions_file: result.file_path })
            toast.success(`Uploaded: ${result.original_name} (${result.questions_count} questions)`)
        } catch (err: any) { toast.error(err.message || 'Upload failed') }
    }

    // Round-level validation: returns error string or null
    const validateRound = (r: Round): string | null => {
        if (r.type === 'aptitude') {
            if (!isJunior) return 'Aptitude round is only available for Junior/Intern experience levels.'
            if (r.aptitude_mode === 'upload' && !r.aptitude_questions_file && !r.aptitude_repo_set_id)
                return 'Please upload an aptitude file or select a repository set.'
        }
        if (r.type === 'first_level') {
            const mode = r.interview_mode || 'ai'
            if (!['ai', 'upload', 'mixed'].includes(mode)) return 'Select a valid interview mode.'
            if ((mode === 'upload' || mode === 'mixed') && !r.uploaded_question_file && !r.technical_repo_set_id)
                return 'Please upload a question file or select a repository set for this mode.'
        }
        if (r.type === 'coding') {
            if (!r.coding_repo_set_id) return 'Select a Coding Question Set.'
            if (!r.coding_allowed_languages || r.coding_allowed_languages.length === 0) return 'Select at least one allowed programming language.'
        }
        return null
    }

    const roundErrors: Record<string, string | null> = {}
    rounds.forEach(r => { roundErrors[r.id] = validateRound(r) })
    const allRoundsValid = Object.values(roundErrors).every(e => e === null)

    const isFormValid =
        formData.title.trim().length >= 3 &&
        formData.description.trim().length >= 10 &&
        !titleError && !descError && !durationError &&
        (formData.mode_of_work === 'Remote' || formData.location.trim().length > 0) &&
        allRoundsValid

    // Ã¢â€â‚¬Ã¢â€â‚¬ Collapsed-round state Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    const [collapsedRounds, setCollapsedRounds] = useState<Set<string>>(new Set())
    const toggleCollapse = (id: string) =>
        setCollapsedRounds(prev => {
            const s = new Set(prev)
            s.has(id) ? s.delete(id) : s.add(id)
            return s
        })

    // Ã¢â€â‚¬Ã¢â€â‚¬ Build submit payload Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    const buildSubmitPayload = () => ({
        ...formData,
        ...deriveFormDataFromRounds(rounds),
    })

    return (
        <div className="p-4 sm:p-6 md:p-8 max-w-3xl mx-auto overflow-x-hidden">
            <Card className="bg-card/45 backdrop-blur-xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] rounded-2xl animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out fill-mode-both w-full">
                <CardHeader className="space-y-4">
                    <div className="mb-2">
                        <Button
                            variant="ghost"
                            onClick={() => router.back()}
                            className="gap-2 text-muted-foreground hover:text-foreground h-auto p-0 flex items-center transition-colors group"
                        >
                            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
                            <span className="text-sm font-bold">Back to Job Listings</span>
                        </Button>
                    </div>
                    <CardTitle className="text-xl sm:text-2xl font-bold text-blue-600 dark:text-blue-400 break-words">
                        {mode === 'create' ? 'Create New Job Position' : 'Edit Job Position'}
                    </CardTitle>
                    <div className="flex flex-col gap-4 pt-2 text-slate-600 dark:text-slate-400">
                        <p className="text-sm">Tip: Give hints about the role in Job Description
 field and use AI to auto-fill the other fields.</p>
                        <div className="flex flex-wrap gap-2">
                            <input
                                type="file"
                                accept=".pdf,.doc,.docx,.txt"
                                className="hidden"
                                ref={fileInputRef}
                                onChange={handleFileUpload}

                            />
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isAILoading || isSubmitting}
                                className="gap-2 text-xs flex-1 sm:flex-none"
                            >
                                <UploadCloud className="h-4 w-4" /> Upload JD
                            </Button>
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => handleAIFill()}
                                disabled={isAILoading || isSubmitting}
                                className="gap-2 bg-primary/10 text-primary hover:bg-primary/20 border-primary/20 text-xs flex-1 sm:flex-none"
                            >
                                {isAILoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                                AI Auto-Fill
                            </Button>
                        </div>
                        {aiFillError && <p className="text-xs text-destructive mt-2" role="alert">{aiFillError}</p>}
                    </div>
                </CardHeader>
                <CardContent>
                    <form onSubmit={(e) => { 
                        e.preventDefault(); 
                        setAiFillError(''); setQuestionFileError(''); setAptitudeFileError('');
                        if (!isFormValid) {
                            setShowValidationErrors(true);
                            toast.error("Please fill all the required fields correctly.");
                            return;
                        }
                        setShowValidationErrors(false);
                        setShowConfirm(true); 
                    }} className="space-y-6">

                        <div>
                            <label htmlFor="title" className="block text-sm font-bold text-foreground mb-1.5 uppercase tracking-wider px-1">
                                Job Title
                            </label>
                            <input
                                id="title"
                                type="text"
                                required
                                className="w-full h-11 px-4 border border-border rounded-xl focus:outline-none focus:ring-4 focus:ring-primary/10 hover:border-primary/40 focus:border-primary bg-background/50 text-foreground text-base transition-all"
                                placeholder="e.g. Senior Frontend Engineer"
                                value={formData.title}
                                aria-invalid={Boolean(titleError)}
                                onChange={(e) => { const v = e.target.value; setFormData({ ...formData, title: v }); validateTitle(v) }}
                            />
                            {titleError && <p className="text-xs text-destructive mt-1" role="alert">{titleError}</p>}
                            {showValidationErrors && formData.title.trim().length < 3 && !titleError && <p className="text-xs text-destructive mt-1">Job title is missing or too short.</p>}
                        </div>

                        <div className="grid md:grid-cols-2 gap-6">
                            <div>
                                <label htmlFor="experience" className="block text-sm font-bold text-foreground mb-1.5 uppercase tracking-wider px-1">
                                    Experience Level
                                </label>
                                <Select 
                                    value={formData.experience_level} 
                                    onValueChange={(val) => setFormData({ ...formData, experience_level: val })}
                                >
                                    <SelectTrigger id="experience" className="w-full h-11 border border-border rounded-xl bg-background/50 text-foreground text-base">
                                        <SelectValue placeholder="Select experience level" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl">
                                        <SelectItem value="intern">Intern</SelectItem>
                                        <SelectItem value="junior">Junior (0-2 years)</SelectItem>
                                        <SelectItem value="mid">Mid-Level (3-5 years)</SelectItem>
                                        <SelectItem value="senior">Senior (5+ years)</SelectItem>
                                        <SelectItem value="lead">Lead / Manager</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="relative" ref={domainRef}>
                                <label htmlFor="domain" className="block text-sm font-bold text-foreground mb-1.5 uppercase tracking-wider px-1">
                                    Domain
                                </label>
                                <input
                                    id="domain"
                                    type="text"
                                    autoComplete="off"
                                    required
                                    className="w-full px-4 py-2 border border-border rounded-xl focus:outline-none focus:ring-4 focus:ring-primary/10 hover:border-primary/40 focus:border-primary bg-background/50 text-foreground shadow-sm transition-all"
                                    placeholder="Type or select a domain"
                                    value={formData.domain}
                                    onChange={(e) => {
                                        setFormData({ ...formData, domain: e.target.value })
                                        setShowDomainSuggestions(true)
                                    }}
                                    onFocus={() => setShowDomainSuggestions(true)}
                                />
                                {showDomainSuggestions && (
                                    <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                                        {(() => {
                                            const searchLower = formData.domain.toLowerCase()
                                            const filtered = domainsList.filter(d => d.toLowerCase().includes(searchLower))
                                            const exactMatch = domainsList.some(d => d.toLowerCase() === searchLower)

                                            return (
                                                <>
                                                    {filtered.map((suggestion, idx) => (
                                                        <div
                                                            key={idx}
                                                            className="px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-sm text-foreground transition-colors border-b border-border/50 last:border-0"
                                                            onClick={() => {
                                                                setFormData({ ...formData, domain: suggestion })
                                                                setShowDomainSuggestions(false)
                                                            }}
                                                        >
                                                            {suggestion}
                                                        </div>
                                                    ))}
                                                    {!exactMatch && formData.domain.trim() !== '' && (
                                                        <div
                                                            className="px-4 py-3 hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-pointer text-sm font-medium text-blue-600 dark:text-blue-400 transition-colors flex items-center gap-2"
                                                            onClick={() => {
                                                                const newDomain = formData.domain.trim()
                                                                setDomainsList(prev => [...prev, newDomain])
                                                                setFormData({ ...formData, domain: newDomain })
                                                                setShowDomainSuggestions(false)
                                                            }}
                                                        >
                                                            <PlusCircle className="h-4 w-4" /> Add "{formData.domain.trim()}"
                                                        </div>
                                                    )}
                                                </>
                                            )
                                        })()}
                                    </div>
                                )}
                            </div>
                            <div>
                                <label htmlFor="job_type" className="block text-sm font-bold text-foreground mb-1.5 uppercase tracking-wider px-1">
                                    Job Type
                                </label>
                                <Select 
                                    value={formData.job_type} 
                                    onValueChange={(val) => setFormData({ ...formData, job_type: val })}
                                >
                                    <SelectTrigger id="job_type" className="w-full h-10 border border-border rounded-xl bg-background/50 text-foreground text-sm">
                                        <SelectValue placeholder="Select job type" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl">
                                        <SelectItem value="Full-Time">Full-Time</SelectItem>
                                        <SelectItem value="Part-Time">Part-Time</SelectItem>
                                        <SelectItem value="Contract">Contract</SelectItem>
                                        <SelectItem value="Internship">Internship</SelectItem>
                                        <SelectItem value="Temporary">Temporary</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <label htmlFor="mode_of_work" className="block text-sm font-bold text-foreground mb-1.5 uppercase tracking-wider px-1">
                                    Mode of Work
                                </label>
                                <Select 
                                    value={formData.mode_of_work} 
                                    onValueChange={(val) => {
                                        setFormData({
                                            ...formData,
                                            mode_of_work: val,
                                            location: formData.location === 'On-Site' ? '' : formData.location
                                        });
                                    }}
                                >
                                    <SelectTrigger id="mode_of_work" className="w-full h-10 border border-border rounded-xl bg-background/50 text-foreground text-sm">
                                        <SelectValue placeholder="Select work mode" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl">
                                        <SelectItem value="On-Site">On-Site</SelectItem>
                                        <SelectItem value="Remote">Remote</SelectItem>
                                        <SelectItem value="Hybrid">Hybrid</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {formData.mode_of_work !== 'Remote' && (
                                <div className="relative" ref={suggestionRef}>
                                    <label htmlFor="location" className="block text-sm font-bold text-foreground mb-1.5 uppercase tracking-wider px-1">
                                        Location
                                    </label>
                                    <input
                                        id="location"
                                        type="text"
                                        autoComplete="off"
                                        required={formData.mode_of_work !== 'Remote'}
                                        className="w-full h-11 px-4 border border-border rounded-xl focus:outline-none focus:ring-4 focus:ring-primary/10 hover:border-primary/40 focus:border-primary bg-background/50 text-foreground text-base transition-all"
                                        placeholder="e.g. TN, Bangalore, India"
                                        value={formData.location}
                                        onChange={(e) => {
                                            setFormData({ ...formData, location: e.target.value })
                                            setShowSuggestions(true)
                                        }}
                                        onFocus={() => setShowSuggestions(true)}
                                    />
                                    {showValidationErrors && formData.location.trim().length === 0 && <p className="text-xs text-destructive mt-1">Location is required for non-remote roles.</p>}
                                    {showSuggestions && locationSuggestions.length > 0 && (
                                        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                                            {locationSuggestions.map((suggestion, idx) => (
                                                <div
                                                    key={idx}
                                                    className="px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-sm text-foreground transition-colors border-b border-border/50 last:border-0"
                                                    onClick={() => {
                                                        setFormData({ ...formData, location: suggestion })
                                                        setShowSuggestions(false)
                                                    }}
                                                >
                                                    {suggestion}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                            {mode === 'edit' && (
                                <div>
                                    <label htmlFor="status" className="block text-sm font-bold text-foreground mb-1.5 uppercase tracking-wider px-1">
                                        Job Status
                                    </label>
                                    <Select 
                                        value={formData.status} 
                                        onValueChange={(val) => setFormData({ ...formData, status: val })}
                                    >
                                        <SelectTrigger id="status" className="w-full h-10 border border-border rounded-xl bg-background/50 text-foreground text-sm">
                                            <SelectValue placeholder="Select job status" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-xl">
                                            <SelectItem value="open">Active / Open</SelectItem>
                                            <SelectItem value="closed">Closed / Finalized</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </div>

                        <div>
                            <label htmlFor="description" className="block text-sm font-bold text-foreground mb-1.5 uppercase tracking-wider px-1">
                                Job Description
                            </label>
                            <textarea
                                id="description"
                                required
                                rows={6}
                                className="w-full px-4 py-3 border border-border rounded-xl focus:outline-none focus:ring-4 focus:ring-primary/10 hover:border-primary/40 focus:border-primary bg-background/50 text-foreground text-base transition-all leading-relaxed"
                                placeholder="Describe the role responsibilities, team culture, and key expectations..."
                                value={formData.description}
                                aria-invalid={Boolean(descError)}
                                onChange={(e) => { const v = e.target.value; setFormData({ ...formData, description: v }); validateDescription(v) }}
                            />
                            {descError && <p className="text-xs text-destructive mt-1" role="alert">{descError}</p>}
                            {showValidationErrors && formData.description.trim().length < 10 && !descError && <p className="text-xs text-destructive mt-1">Job description is missing or too short.</p>}
                        </div>

                        {/* Ã¢â€â‚¬Ã¢â€â‚¬ Interview Rounds (Round Builder) Ã¢â€â‚¬Ã¢â€â‚¬ */}
                        <div className="rounded-xl border border-border bg-muted/30 p-5 space-y-5">
                            <div>
                                <h3 className="text-sm font-semibold text-foreground tracking-wide uppercase flex items-center gap-2">
                                    <ClipboardList className="h-4 w-4 text-primary" />
                                    Interview Rounds
                                </h3>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Define evaluation rounds in order. Candidates will progress through them sequentially.
                                </p>
                            </div>

                            {/* Interview Duration (global) */}
                            <div className="space-y-3">
                                <label htmlFor="duration_minutes" className="block text-sm font-medium text-foreground">
                                    Total Interview Duration (minutes)
                                </label>
                                <div className="flex flex-col sm:flex-row sm:items-center gap-4 bg-muted/20 p-4 rounded-xl border border-border/60">
                                    <div className="flex-1 py-2">
                                        <Slider
                                            id="duration_slider"
                                            min={60}
                                            max={300}
                                            step={5}
                                            value={[
                                                typeof formData.duration_minutes === 'number' && !isNaN(formData.duration_minutes)
                                                    ? formData.duration_minutes
                                                    : 60
                                            ]}
                                            onValueChange={(val) => {
                                                const n = val[0];
                                                setFormData({ ...formData, duration_minutes: n });
                                                validateDuration(n);
                                            }}
                                            className="w-full cursor-pointer"
                                        />
                                        <div className="flex justify-between text-[10px] text-muted-foreground mt-2 font-medium px-1 select-none">
                                            <span>60 mins</span>
                                            <span>120 mins</span>
                                            <span>180 mins</span>
                                            <span>240 mins</span>
                                            <span>300 mins</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <input
                                            id="duration_minutes"
                                            type="number"
                                            min="60"
                                            max="300"
                                            required
                                            className="w-20 h-10 px-2 text-center border border-border rounded-xl focus:outline-none focus:ring-4 focus:ring-primary/10 hover:border-primary/40 focus:border-primary bg-background text-foreground font-semibold transition-all"
                                            value={formData.duration_minutes === undefined || formData.duration_minutes === null ? '' : formData.duration_minutes}
                                            aria-invalid={Boolean(durationError)}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                if (val === '') {
                                                    setFormData({ ...formData, duration_minutes: '' as any });
                                                    setDurationError('Duration is required');
                                                } else {
                                                    const n = parseInt(val);
                                                    setFormData({ ...formData, duration_minutes: isNaN(n) ? '' as any : n });
                                                    validateDuration(n);
                                                }
                                            }}
                                        />
                                        <span className="text-sm font-medium text-muted-foreground select-none">mins</span>
                                    </div>
                                </div>
                                <p className="text-xs text-muted-foreground">Sets the timer for the First Level Interview. Default is 60 minutes.</p>
                                {durationError && <p className="text-xs text-destructive" role="alert">{durationError}</p>}
                            </div>

                            {/* Rounds list */}
                            <div className="space-y-3">
                                {rounds.length === 0 && (
                                    <div className="flex flex-col items-center gap-2 py-8 text-center border border-dashed border-border/60 rounded-xl bg-background/30">
                                        <ClipboardList className="h-8 w-8 text-muted-foreground/40" />
                                        <p className="text-sm text-muted-foreground">No rounds added yet.</p>
                                        <p className="text-xs text-muted-foreground/70">Add rounds below to configure the interview pipeline.</p>
                                    </div>
                                )}

                                {rounds.map((round, idx) => {
                                    const meta = getRoundMeta(round.type)
                                    const isCollapsed = collapsedRounds.has(round.id)
                                    const err = showValidationErrors ? roundErrors[round.id] : null

                                    return (
                                        <div
                                            key={round.id}
                                            className={`rounded-xl border ${meta.borderColor} ${meta.bgColor} overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200`}
                                        >
                                            {/* Round header */}
                                            <div className="flex items-center gap-2 px-4 py-3">
                                                {/* Order controls */}
                                                <div className="flex flex-col gap-0.5 shrink-0">
                                                    <button
                                                        type="button"
                                                        onClick={() => moveRound(round.id, -1)}
                                                        disabled={idx === 0}
                                                        className="p-0.5 rounded hover:bg-foreground/10 disabled:opacity-30 transition-opacity"
                                                        title="Move up"
                                                    >
                                                        <ChevronUp className="h-3 w-3" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => moveRound(round.id, 1)}
                                                        disabled={idx === rounds.length - 1}
                                                        className="p-0.5 rounded hover:bg-foreground/10 disabled:opacity-30 transition-opacity"
                                                        title="Move down"
                                                    >
                                                        <ChevronDown className="h-3 w-3" />
                                                    </button>
                                                </div>

                                                <span className="text-xs font-bold text-muted-foreground w-5 shrink-0 text-center">{idx + 1}</span>

                                                <span className={`shrink-0 ${meta.color}`}>{meta.icon}</span>

                                                <div className="flex-1 min-w-0">
                                                    <span className={`text-sm font-semibold ${meta.color}`}>{meta.label}</span>
                                                    {err && (
                                                        <div className="flex items-center gap-1 mt-0.5">
                                                            <AlertCircle className="h-3 w-3 text-destructive shrink-0" />
                                                            <p className="text-xs text-destructive truncate">{err}</p>
                                                        </div>
                                                    )}
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => toggleCollapse(round.id)}
                                                    className="p-1.5 rounded-lg hover:bg-foreground/10 transition-colors shrink-0"
                                                    title={isCollapsed ? 'Expand' : 'Collapse'}
                                                >
                                                    {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={() => removeRound(round.id)}
                                                    className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                                                    title="Remove round"
                                                >
                                                    <X className="h-4 w-4" />
                                                </button>
                                            </div>

                                            {/* Round config panel */}
                                            {!isCollapsed && (
                                                <div className="px-4 pb-4 pt-1 border-t border-border/30 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">

                                                    {/* APTITUDE config */}
                                                    {round.type === 'aptitude' && (
                                                        <>
                                                            {!isJunior && (
                                                                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                                                                    <AlertCircle className="h-3 w-3 shrink-0" />
                                                                    Aptitude round is only available for Junior and Intern experience levels.
                                                                </p>
                                                            )}
                                                            <div className="space-y-2">
                                                                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Generation Mode</p>
                                                                {(['ai', 'upload'] as const).map(m => (
                                                                    <label key={m} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                                                                        round.aptitude_mode === m
                                                                            ? 'border-amber-500/50 bg-amber-500/5 ring-1 ring-amber-500/20'
                                                                            : 'border-border hover:border-amber-500/30 bg-background'
                                                                    }`}>
                                                                        <input
                                                                            type="radio" name={`apt_mode_${round.id}`} value={m}
                                                                            checked={round.aptitude_mode === m}
                                                                            onChange={() => updateRound(round.id, { aptitude_mode: m, ...(m === 'ai' && { aptitude_questions_file: null, aptitude_repo_set_id: null }) })}
                                                                            className="mt-0.5 h-4 w-4 text-amber-600 focus:ring-amber-500"
                                                                        />
                                                                        <div>
                                                                            <span className="text-sm font-medium">{m === 'ai' ? 'AI Generated' : 'Upload Excel / Repository'}</span>
                                                                            <p className="text-xs text-muted-foreground">{m === 'ai' ? 'AI generates 10 aptitude questions automatically.' : 'Upload .xlsx file or pick from repository.'}</p>
                                                                        </div>
                                                                    </label>
                                                                ))}
                                                            </div>
                                                            {round.aptitude_mode === 'upload' && (
                                                                <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                                                                    <RepoPicker
                                                                        roundType="aptitude"
                                                                        jobTitle={formData.title}
                                                                        selectedId={round.aptitude_repo_set_id || null}
                                                                        onSelect={(id) => updateRound(round.id, { aptitude_repo_set_id: id })}
                                                                    />
                                                                    {!round.aptitude_repo_set_id && (
                                                                        <>
                                                                            <div className="flex items-center gap-2">
                                                                                <div className="flex-1 h-px bg-border" />
                                                                                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">or upload Excel</span>
                                                                                <div className="flex-1 h-px bg-border" />
                                                                            </div>
                                                                            {round.aptitude_questions_file ? (
                                                                                <div className="flex items-center gap-3 p-3 rounded-lg border border-green-500/30 bg-green-500/5">
                                                                                    <FileText className="h-5 w-5 text-green-600" />
                                                                                    <p className="text-sm flex-1 truncate">Aptitude file uploaded</p>
                                                                                    <button type="button" onClick={() => updateRound(round.id, { aptitude_questions_file: null })} className="p-1 hover:text-destructive transition-colors">
                                                                                        <X className="h-4 w-4" />
                                                                                    </button>
                                                                                </div>
                                                                            ) : (
                                                                                <label className="cursor-pointer">
                                                                                    <input type="file" accept=".xlsx,.xls" className="hidden"
                                                                                        onChange={(e) => e.target.files?.[0] && uploadAptitudeFile(round.id, e.target.files[0])}
                                                                                    />
                                                                                    <Button type="button" variant="outline" size="sm" className="gap-2 pointer-events-none">
                                                                                        <UploadCloud className="h-4 w-4" /> Upload Aptitude Questions (.xlsx)
                                                                                    </Button>
                                                                                </label>
                                                                            )}
                                                                        </>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </>
                                                    )}

                                                    {/* FIRST LEVEL config */}
                                                    {round.type === 'first_level' && (
                                                        <>
                                                            <div className="space-y-2">
                                                                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Interview Mode</p>
                                                                {([
                                                                    { value: 'ai' as const, label: 'AI Generated', desc: 'AI automatically generates technical + behavioral questions.' },
                                                                    { value: 'upload' as const, label: 'Upload Questions (AI Evaluated)', desc: 'Only your uploaded questions are asked. File or repository required.' },
                                                                    { value: 'mixed' as const, label: 'Mixed Questions', desc: '50% uploaded + 50% AI-generated. File or repository required.' },
                                                                ] as const).map(m => (
                                                                    <label key={m.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                                                                        round.interview_mode === m.value
                                                                            ? 'border-blue-500/50 bg-blue-500/5 ring-1 ring-blue-500/20'
                                                                            : 'border-border hover:border-blue-500/30 bg-background'
                                                                    }`}>
                                                                        <input
                                                                            type="radio" name={`fl_mode_${round.id}`} value={m.value}
                                                                            checked={round.interview_mode === m.value}
                                                                            onChange={() => updateRound(round.id, { interview_mode: m.value, ...(m.value === 'ai' && { uploaded_question_file: null, technical_repo_set_id: null }) })}
                                                                            className="mt-0.5 h-4 w-4 text-blue-600 focus:ring-blue-500"
                                                                        />
                                                                        <div className="flex-1">
                                                                            <span className="text-sm font-medium">{m.label}</span>
                                                                            <p className="text-xs text-muted-foreground">{m.desc}</p>
                                                                            {(m.value === 'upload' || m.value === 'mixed') && round.interview_mode === m.value && (
                                                                                <div className="mt-3 animate-in fade-in duration-200">
                                                                                    <RepoPicker
                                                                                        roundType="technical"
                                                                                        jobTitle={formData.title}
                                                                                        selectedId={round.technical_repo_set_id || null}
                                                                                        onSelect={(id) => updateRound(round.id, { technical_repo_set_id: id })}
                                                                                    />
                                                                                    {!round.technical_repo_set_id && (
                                                                                        <>
                                                                                            <div className="flex items-center gap-2 my-2">
                                                                                                <div className="flex-1 h-px bg-border" />
                                                                                                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">or upload file</span>
                                                                                                <div className="flex-1 h-px bg-border" />
                                                                                            </div>
                                                                                            {round.uploaded_question_file ? (
                                                                                                <div className="flex items-center gap-3 p-3 rounded-lg border border-green-500/30 bg-green-500/5">
                                                                                                    <FileText className="h-5 w-5 text-green-600" />
                                                                                                    <p className="text-sm flex-1 truncate">Question file uploaded</p>
                                                                                                    <button type="button" onClick={() => updateRound(round.id, { uploaded_question_file: null })} className="p-1 hover:text-destructive transition-colors">
                                                                                                        <X className="h-4 w-4" />
                                                                                                    </button>
                                                                                                </div>
                                                                                            ) : (
                                                                                                <label className="cursor-pointer">
                                                                                                    <input type="file" accept=".txt,.pdf,.docx" className="hidden"
                                                                                                        onChange={(e) => e.target.files?.[0] && uploadFirstLevelFile(round.id, e.target.files[0])}
                                                                                                    />
                                                                                                    <Button type="button" variant="outline" size="sm" className="gap-2 pointer-events-none">
                                                                                                        <UploadCloud className="h-4 w-4" /> Upload Question File
                                                                                                    </Button>
                                                                                                </label>
                                                                                            )}
                                                                                        </>
                                                                                    )}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </label>
                                                                ))}
                                                            </div>

                                                            {/* Behavioral selector */}
                                                            <div className="space-y-2 pt-2 border-t border-border/40">
                                                                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Behavioral Role Evaluation</p>
                                                                <Select
                                                                    value={round.behavioral_role || 'general'}
                                                                    onValueChange={(val) => updateRound(round.id, { behavioral_role: val })}
                                                                >
                                                                    <SelectTrigger className="w-full md:w-1/2 h-10 border border-border rounded-xl bg-background/50 text-sm">
                                                                        <SelectValue />
                                                                    </SelectTrigger>
                                                                    <SelectContent className="rounded-xl">
                                                                        <SelectItem value="general">General (Standard Questions)</SelectItem>
                                                                        <SelectItem value="junior">Junior (Learning, Adaptability)</SelectItem>
                                                                        <SelectItem value="mid">Mid-Level (Ownership, Problem Solving)</SelectItem>
                                                                        <SelectItem value="lead">Lead/Manager (Leadership, Mentorship)</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                                <div className="mt-2">
                                                                    <RepoPicker
                                                                        roundType="behavioural"
                                                                        jobTitle={formData.title}
                                                                        selectedId={round.behavioural_repo_set_id || null}
                                                                        onSelect={(id) => updateRound(round.id, { behavioural_repo_set_id: id })}
                                                                    />
                                                                </div>
                                                            </div>
                                                        </>
                                                    )}

                                                    {/* CODING config */}
                                                    {round.type === 'coding' && (
                                                        <>
                                                            <div className="space-y-2">
                                                                <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Coding Question Set *</p>
                                                                {codingQuestionSets.length === 0 ? (
                                                                    <p className="text-xs text-amber-600 dark:text-amber-400">No Coding Question Sets found. Create one in the Coding Repository first.</p>
                                                                ) : (
                                                                    <Select
                                                                        value={round.coding_repo_set_id ? String(round.coding_repo_set_id) : 'none'}
                                                                        onValueChange={(val) => {
                                                                            const id = val === 'none' ? null : parseInt(val)
                                                                            const found = codingQuestionSets.find(s => s.id === id) || null
                                                                            setCodingSetCache(prev => ({ ...prev, [round.id]: found }))
                                                                            const totalItems = found?.items?.length || 0
                                                                            updateRound(round.id, {
                                                                                coding_repo_set_id: id,
                                                                                coding_allowed_languages: found?.supported_languages || [],
                                                                                coding_problem_count: totalItems > 0 ? Math.min(round.coding_problem_count || totalItems, totalItems) : null,
                                                                            })
                                                                        }}
                                                                    >
                                                                        <SelectTrigger className="w-full h-11 border border-border rounded-xl bg-background/50 text-sm">
                                                                            <SelectValue placeholder="Ã¢â‚¬â€ Select a Coding Question Set Ã¢â‚¬â€" />
                                                                        </SelectTrigger>
                                                                        <SelectContent className="rounded-xl">
                                                                            <SelectItem value="none">Ã¢â‚¬â€ Select a Coding Question Set Ã¢â‚¬â€</SelectItem>
                                                                            {codingQuestionSets.map(qs => (
                                                                                <SelectItem key={qs.id} value={String(qs.id)}>
                                                                                    {qs.title} ({qs.items?.length || 0} problems)
                                                                                </SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                )}
                                                            </div>

                                                            {/* Languages */}
                                                            {(() => {
                                                                const cset = codingSetCache[round.id] || codingQuestionSets.find(s => s.id === round.coding_repo_set_id)
                                                                if (!cset) return null
                                                                return (
                                                                    <div className="space-y-2 p-3.5 rounded-xl border border-border bg-card/40">
                                                                        <p className="text-xs font-semibold text-foreground">Allowed Programming Languages *</p>
                                                                        <div className="flex flex-wrap gap-2">
                                                                            {cset.supported_languages?.map((lang: string) => {
                                                                                const isSelected = (round.coding_allowed_languages || []).includes(lang)
                                                                                const label = getLanguageLabel(lang)
                                                                                return (
                                                                                    <label key={lang} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer transition-all text-xs font-medium ${
                                                                                        isSelected ? 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-400' : 'border-border text-foreground hover:border-violet-400/50'
                                                                                    }`}>
                                                                                        <input type="checkbox" checked={isSelected}
                                                                                            onChange={(e) => {
                                                                                                const cur = round.coding_allowed_languages || []
                                                                                                updateRound(round.id, { coding_allowed_languages: e.target.checked ? [...cur, lang] : cur.filter(l => l !== lang) })
                                                                                            }}
                                                                                            className="h-3.5 w-3.5"
                                                                                        />
                                                                                        {label}
                                                                                    </label>
                                                                                )
                                                                            })}
                                                                        </div>
                                                                        <div className="grid grid-cols-2 gap-4 pt-2">
                                                                            <div className="space-y-1">
                                                                                <p className="text-xs font-semibold text-foreground">Problems *</p>
                                                                                <Input
                                                                                    type="number" min={1} max={cset.items?.length || 10}
                                                                                    value={round.coding_problem_count ?? (cset.items?.length ? Math.min(cset.items.length, 2) : 1)}
                                                                                    onChange={(e) => updateRound(round.id, { coding_problem_count: parseInt(e.target.value) || 1 })}
                                                                                    className="h-10 border border-border rounded-xl bg-background/50 text-sm"
                                                                                />
                                                                                <p className="text-[11px] text-muted-foreground">Available: {cset.items?.length || 0}</p>
                                                                            </div>
                                                                            <div className="space-y-1">
                                                                                <p className="text-xs font-semibold text-foreground">Duration (mins)</p>
                                                                                <Input
                                                                                    type="number" min={15} max={180}
                                                                                    value={round.coding_round_duration_minutes || 60}
                                                                                    onChange={(e) => updateRound(round.id, { coding_round_duration_minutes: Number(e.target.value) || 60 })}
                                                                                    className="h-10 border border-border rounded-xl bg-background/50 text-sm"
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                )
                                                            })()}
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>

                            {/* Add Round picker */}
                            <div className="pt-2 border-t border-border/40">
                                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Add Round</p>
                                <div className="flex flex-wrap gap-2">
                                    {ROUND_TYPE_META.map(meta => {
                                        const alreadyAdded = rounds.some(r => r.type === meta.value)
                                        const isAptitudeBlocked = meta.value === 'aptitude' && !isJunior
                                        const disabled = alreadyAdded || isAptitudeBlocked
                                        return (
                                            <button
                                                key={meta.value}
                                                type="button"
                                                onClick={() => addRound(meta.value)}
                                                disabled={disabled}
                                                title={isAptitudeBlocked ? 'Aptitude is only for Junior/Intern' : alreadyAdded ? 'Already added' : `Add ${meta.label}`}
                                                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
                                                    alreadyAdded
                                                        ? 'border-border bg-muted/50 text-muted-foreground cursor-not-allowed opacity-60'
                                                        : isAptitudeBlocked
                                                        ? 'border-border bg-muted/30 text-muted-foreground cursor-not-allowed opacity-40'
                                                        : `${meta.borderColor} ${meta.bgColor} ${meta.color} hover:opacity-80 cursor-pointer`
                                                }`}
                                            >
                                                {alreadyAdded ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                                                {meta.label}
                                            </button>
                                        )
                                    })}
                                </div>
                                {showValidationErrors && !allRoundsValid && (
                                    <p className="text-xs text-destructive mt-2">Please fix the errors in the rounds above before submitting.</p>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4">
                            <Link href="/dashboard/hr/jobs" className="w-full sm:w-auto">
                                <Button type="button" variant="outline" className="w-full" disabled={isSubmitting || isAILoading}>Cancel</Button>
                            </Link>
                            <Button
                                type="submit"
                                className="bg-blue-600 hover:bg-blue-700 text-white min-w-[150px] w-full sm:w-auto shadow-lg"
                                disabled={isSubmitting || isAILoading}
                            >
                                {isSubmitting ? (mode === 'create' ? 'Creating...' : 'Saving...') : (mode === 'create' ? 'Review & Post Job' : 'Review & Update Job')}
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>

            <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
                <AlertDialogContent className="rounded-2xl">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure you want to {mode === 'create' ? 'post' : 'update'} this job?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Please verify the details below. Once {mode === 'create' ? 'posted' : 'updated'}, changes will be live.
                        </AlertDialogDescription>
                        <ul className="mt-4 space-y-2 text-foreground font-medium bg-secondary/20 p-4 rounded-xl border border-border text-left text-sm">
                            <li><span className="text-muted-foreground mr-2 font-normal">Title:</span> {formData.title}</li>
                            <li><span className="text-muted-foreground mr-2 font-normal">Experience:</span> {formData.experience_level}</li>
                            <li><span className="text-muted-foreground mr-2 font-normal">Domain:</span> {formData.domain}</li>
                        </ul>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => onSubmit(buildSubmitPayload())} className="bg-primary text-primary-foreground rounded-xl">
                            Yes, {mode === 'create' ? 'Post Job' : 'Update Job'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
