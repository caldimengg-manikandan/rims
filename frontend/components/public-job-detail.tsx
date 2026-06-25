'use client'

import React, { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Briefcase, MapPin, Clock, UploadCloud, CheckCircle2, Loader2, AlertCircle, Edit2, XCircle, Trash2 } from 'lucide-react'
import { useAuth } from '@/app/dashboard/lib/auth-context'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { APIClient } from '@/app/dashboard/lib/api-client'
import { toast } from 'sonner'

export interface Job {
    id: number
    title: string
    description: string
    experience_level: string
    location?: string
    mode_of_work?: string
    job_type?: string
    domain?: string
    status: string
    closed_at?: string | null
    created_at: string
    aptitude_enabled?: boolean
    first_level_enabled?: boolean
    interview_mode?: string
    aptitude_config?: string
    behavioral_role?: string
    interview_token?: string
}

const COUNTRY_CODES = [
    { name: "India", code: "+91", format: /^\d{10}$/, placeholder: "9876543210", display: "🇮🇳 (+91)" },
    { name: "United States", code: "+1", format: /^\d{10}$/, placeholder: "5551234567", display: "🇺🇸 (+1)" },
    { name: "United Kingdom", code: "+44", format: /^\d{10}$/, placeholder: "7911123456", display: "🇬🇧 (+44)" },
    { name: "Australia", code: "+61", format: /^\d{9}$/, placeholder: "412345678", display: "🇦🇺 (+61)" },
    { name: "Canada", code: "+1", format: /^\d{10}$/, placeholder: "5551234567", display: "🇨🇦 (+1)" },
    { name: "Germany", code: "+49", format: /^\d{10,11}$/, placeholder: "15123456789", display: "🇩🇪 (+49)" },
    { name: "France", code: "+33", format: /^\d{9}$/, placeholder: "612345678", display: "🇫🇷 (+33)" }
]

const jobDetailsInFlight = new Map<string, Promise<Job>>()

export function PublicJobDetail({ initialJob, jobId }: { initialJob: Job, jobId: string }) {
    const router = useRouter()
    const [job, setJob] = useState<Job | null>(initialJob)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const { user } = useAuth()

    // Application Form State
    const [candidateName, setCandidateName] = useState('')
    const [candidateEmail, setCandidateEmail] = useState('')
    const [candidatePhone, setCandidatePhone] = useState('')
    const [selectedCountry, setSelectedCountry] = useState(COUNTRY_CODES[0].name)
    const [resumeFile, setResumeFile] = useState<File | null>(null)
    const [photoFile, setPhotoFile] = useState<File | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const photoInputRef = useRef<HTMLInputElement>(null)
    const submitInFlightRef = useRef(false)

    const [isSubmitting, setIsSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [isSuccess, setIsSuccess] = useState(false)
    const [hasApplied, setHasApplied] = useState(false)
    const [isExtracting, setIsExtracting] = useState(false)

    // Inline validation state
    const [emailError, setEmailError] = useState<string | null>(null)
    const [phoneError, setPhoneError] = useState<string | null>(null)
    const [extractedPhone, setExtractedPhone] = useState<string | null>(null)
    const [phoneWarning, setPhoneWarning] = useState<string | null>(null)
    const [confirmAction, setConfirmAction] = useState<'close' | 'delete' | null>(null)

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/

    const validateEmail = (value: string) => {
        if (!value.trim()) { setEmailError(null); return }
        const parts = value.split('@')
        if (parts.length !== 2) { 
            setEmailError('Enter a valid email (e.g., user@example.com)'); 
            return 
        }
        const [local, domain] = parts
        if (!local || !domain || !domain.includes('.')) { 
            setEmailError('Enter a valid email (e.g., user@example.com)'); 
            return 
        }
        if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) {
            setEmailError('Enter a valid email (e.g., user@example.com)');
            return
        }
        const domainParts = domain.split('.')
        const tld = domainParts[domainParts.length - 1]
        if (!tld || tld.length < 2) { 
            setEmailError('Enter a valid email (e.g., user@example.com)'); 
            return 
        }
        if (!emailRegex.test(value)) { 
            setEmailError('Enter a valid email (e.g., user@example.com)'); 
            return 
        }
        setEmailError(null)
    }

    const validatePhone = (value: string) => {
        if (!value.trim()) { setPhoneError(null); return }
        if (!/^\d+$/.test(value)) {
            setPhoneError('Phone number must be 10–15 digits');
            return
        }
        if (value.length < 10 || value.length > 15) {
            setPhoneError('Phone number must be 10–15 digits');
            return
        }
        setPhoneError(null)
    }

    const emailValidationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const phoneValidationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const debouncedValidateEmail = (value: string) => {
        if (emailValidationTimerRef.current) clearTimeout(emailValidationTimerRef.current)
        if (!value.trim()) { setEmailError(null); return }
        emailValidationTimerRef.current = setTimeout(() => validateEmail(value), 300)
    }

    const debouncedValidatePhone = (value: string) => {
        if (phoneValidationTimerRef.current) clearTimeout(phoneValidationTimerRef.current)
        if (!value.trim()) { setPhoneError(null); return }
        phoneValidationTimerRef.current = setTimeout(() => validatePhone(value), 300)
    }

    // Pre-check for duplicate application (Point 7)
    useEffect(() => {
        const checkDuplicate = async () => {
            if (candidateEmail.trim() && candidateEmail.includes('@') && candidateEmail.includes('.')) {
                try {
                    const countryInfo = COUNTRY_CODES.find(c => c.name === selectedCountry)
                    const fullPhone = `${(countryInfo?.code || '').replace(/\D/g, '')}${candidatePhone.replace(/\D/g, '')}`
                    
                    const response = await APIClient.get<{hasApplied: boolean}>(
                        `/api/applications/has-applied?job_id=${jobId}&candidate_email=${encodeURIComponent(candidateEmail)}&candidate_phone=${encodeURIComponent(fullPhone)}`
                    );
                    setHasApplied(response.hasApplied);
                } catch (err) {
                    console.error("Duplicate Check Error:", err);
                }
            }
        };

        const timer = setTimeout(checkDuplicate, 800);
        return () => clearTimeout(timer);
    }, [candidateEmail, candidatePhone, selectedCountry, jobId]);

    // Resume/Form Phone Mismatch Warning (Point 5)
    useEffect(() => {
        if (extractedPhone && candidatePhone && candidatePhone.length >= 10) {
            const cleanExtracted = extractedPhone.replace(/\D/g, '');
            const cleanEntered = candidatePhone.replace(/\D/g, '');
            
            if (cleanExtracted !== cleanEntered && !cleanExtracted.endsWith(cleanEntered) && !cleanEntered.endsWith(cleanExtracted)) {
                setPhoneWarning("Entered phone differs from phone extracted from resume.");
            } else {
                setPhoneWarning(null);
            }
        } else {
            setPhoneWarning(null);
        }
    }, [candidatePhone, extractedPhone]);

    // Warning for unsaved changes
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (isSubmitting || isSuccess || (!candidateName && !candidateEmail && !candidatePhone)) return
            e.preventDefault()
            e.returnValue = ''
        }
        window.addEventListener('beforeunload', handleBeforeUnload)
        return () => window.removeEventListener('beforeunload', handleBeforeUnload)
    }, [isSubmitting, isSuccess, candidateName, candidateEmail, candidatePhone])

    const fetchJobDetails = async () => {
        try {
            setIsLoading(true)
            const existing = jobDetailsInFlight.get(jobId)
            const promise =
                existing ??
                APIClient.get<Job>(`/api/jobs/public/${jobId}`)
                  .finally(() => {
                      jobDetailsInFlight.delete(jobId)
                  })
            jobDetailsInFlight.set(jobId, promise)
            const data = await promise
            setJob(data)
        } catch (err: any) {
            setError(err.message)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        if (!job) {
            fetchJobDetails()
        }
    }, [jobId])

    const handleCloseJob = async () => {
        setConfirmAction('close')
    }

    const handleDeleteJob = async () => {
        setConfirmAction('delete')
    }

    const handleConfirmAction = async () => {
        if (!confirmAction) return
        const action = confirmAction
        setConfirmAction(null)

        if (action === 'close') {
            try {
                await APIClient.put(`/api/jobs/${jobId}`, { status: 'closed' })
                fetchJobDetails()
            } catch (err) {
                console.error("Close Error:", err)
                toast.error('Failed to close job')
            }
        } else {
            try {
                await APIClient.delete(`/api/jobs/${jobId}`)
                router.push('/dashboard/hr/jobs')
            } catch (err) {
                console.error("Delete Error:", err)
                toast.error('Failed to delete job')
            }
        }
    }

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0]
            const allowedExtensions = ['.pdf', '.docx', '.doc']
            const fileExtension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()

            if (!allowedExtensions.includes(fileExtension)) {
                setSubmitError('Invalid file type. Only .pdf, .docx, and .doc are allowed.')
                if (fileInputRef.current) fileInputRef.current.value = ''
                setResumeFile(null)
                return
            }

            if (file.size === 0) {
                setSubmitError('Invalid or empty file.')
                if (fileInputRef.current) fileInputRef.current.value = ''
                setResumeFile(null)
                return
            }
            if (file.size > 5 * 1024 * 1024) {
                setSubmitError('File is too large. Maximum size is 5MB.')
                if (fileInputRef.current) fileInputRef.current.value = ''
                setResumeFile(null)
                return
            }
            setResumeFile(file)
            setSubmitError(null)

            setIsExtracting(true)
            try {
                const formData = new FormData()
                formData.append('resume_file', file)
                const data = await APIClient.postFormData<{name: string, phone: string}>('/api/applications/extract-basic-info', formData)
                if (data) {
                    if (data.name) setCandidateName(data.name)
                    else setCandidateName("")

                    if (data.phone) {
                        let matchedCountry = COUNTRY_CODES[0].name;
                        let phoneNum = data.phone;
                        
                        const cleanExtracted = data.phone.replace(/[\s-()]/g, '');
                        for (const c of COUNTRY_CODES) {
                            const cleanCode = c.code.replace('+', '');
                            if (cleanExtracted.startsWith('+' + cleanCode) || cleanExtracted.startsWith('00' + cleanCode)) {
                                matchedCountry = c.name;
                                phoneNum = cleanExtracted.replace(new RegExp(`^(\\+|00)${cleanCode}`), '');
                                break;
                            } else if (cleanExtracted.length === 10 && c.code === '+91') {
                                matchedCountry = "India";
                                phoneNum = cleanExtracted;
                                break;
                            } else if (cleanExtracted.length === 10 && c.code === '+1') {
                                matchedCountry = "United States";
                                phoneNum = cleanExtracted;
                                break;
                            }
                        }
                        
                        setSelectedCountry(matchedCountry);
                        const cleanPhone = phoneNum.replace(/\D/g, '');
                        setCandidatePhone(cleanPhone);
                        setExtractedPhone(cleanPhone);
                    } else {
                        setCandidatePhone('')
                        setExtractedPhone(null)
                    }
                } else {
                    setCandidateName('')
                    setCandidatePhone('')
                }
            } catch (err: any) {
                console.error("Extraction failed:", err)
            } finally {
                setIsExtracting(false)
            }
        }
    }

    const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0]
            if (file.size > 5 * 1024 * 1024) {
                setSubmitError('Photo is too large. Maximum size is 5MB.')
                if (photoInputRef.current) photoInputRef.current.value = ''
                setPhotoFile(null)
                return
            }
            setPhotoFile(file)
            setSubmitError(null)
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (submitInFlightRef.current || isSubmitting) return

        // Re-validate email (H003)
        if (!candidateEmail.trim()) {
            setSubmitError("Email is required.");
            setEmailError("Please enter a valid email address (e.g., user@example.com)");
            return;
        }

        const emailParts = candidateEmail.split('@');
        if (emailParts.length !== 2 || !emailParts[1].includes('.') || !emailRegex.test(candidateEmail)) {
            const errMsg = 'Please enter a valid email address (e.g., user@example.com)';
            setSubmitError(errMsg);
            setEmailError(errMsg);
            return;
        }

        // Name check for backend compatibility
        const trimmedName = candidateName.trim()
        if (trimmedName.length < 2 || !/^[A-Za-z\s\-'\.]+$/.test(trimmedName)) {
            const errMsg = "Please enter a valid full name containing only letters, spaces, hyphens, periods, or apostrophes."
            setSubmitError(errMsg)
            return
        }

        // Validate phone (H004)
        if (candidatePhone.trim()) {
            if (/[^0-9]/.test(candidatePhone)) {
                const errMsg = 'Phone number must contain numeric characters only';
                setSubmitError(errMsg);
                setPhoneError(errMsg);
                return;
            }

            if (candidatePhone.length < 10 || candidatePhone.length > 15) {
                const errMsg = 'Phone number must be 10–15 digits';
                setSubmitError(errMsg);
                setPhoneError(errMsg);
                return;
            }
        }

        if (!resumeFile) {
            setSubmitError("Please upload a resume.")
            return
        }
        const resumeExt = resumeFile.name.substring(resumeFile.name.lastIndexOf('.')).toLowerCase()
        const allowedResumeExtensions = ['.pdf', '.docx', '.doc']
        if (!allowedResumeExtensions.includes(resumeExt)) {
            setSubmitError('Invalid resume file type. Only .pdf, .docx, and .doc are allowed.')
            return
        }
        if (resumeFile.size > 5 * 1024 * 1024) {
            setSubmitError('File is too large. Maximum size is 5MB.')
            return
        }

        if (!photoFile) {
            setSubmitError("Please upload a candidate photo.")
            toast.error("Photo upload is mandatory")
            return
        }
        if (photoFile.size > 5 * 1024 * 1024) {
            setSubmitError('Photo is too large. Maximum size is 5MB.')
            return
        }

        setIsSubmitting(true)
        submitInFlightRef.current = true
        setSubmitError(null)

        try {
            const formData = new FormData()
            const countryInfo = COUNTRY_CODES.find(c => c.name === selectedCountry)
            const fullPhone = `${(countryInfo?.code || '').replace(/\D/g, '')}${candidatePhone.replace(/\D/g, '')}`

            formData.append('job_id', jobId)
            formData.append('candidate_name', candidateName)
            formData.append('candidate_email', candidateEmail)
            formData.append('candidate_phone', fullPhone)
            formData.append('resume_file', resumeFile)
            if (photoFile) formData.append('photo_file', photoFile)

            try {
                await APIClient.postFormData('/api/applications/apply', formData)
                setIsSuccess(true)
            } catch (err: any) {
                const errorMsg = err.message || 'An unexpected error occurred.'
                if (errorMsg.toLowerCase().includes('already applied')) {
                    setHasApplied(true)
                    setSubmitError(null)
                } else if (errorMsg.toLowerCase().includes('already been submitted')) {
                    setSubmitError('This resume has already been submitted for this job. Please use a different file.')
                } else {
                    setSubmitError(errorMsg)
                }
            }
        } finally {
            setIsSubmitting(false)
            submitInFlightRef.current = false
        }
    }

    if (isLoading) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center">
                <Loader2 className="h-12 w-12 text-indigo-600 animate-spin mb-4" />
                <p className="text-muted-foreground animate-pulse">Loading job details...</p>
            </div>
        )
    }

    if (error || !job) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
                <div className="bg-destructive/10 border border-destructive/20 text-destructive p-8 rounded-2xl max-w-md w-full text-center">
                    <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-80" />
                    <h2 className="text-2xl font-bold mb-2">Position Unavailable</h2>
                    <p className="mb-6">{error || 'Could not load job details.'}</p>
                    <Link href="/jobs">
                        <Button variant="outline" className="w-full border-destructive/30 hover:bg-destructive/10 text-destructive">
                            View Other Openings
                        </Button>
                    </Link>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-background/50 font-sans relative">
            <div className="pointer-events-none absolute inset-0 z-0 flex justify-center">
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:40px_40px] dark:bg-[linear-gradient(to_right,#ffffff0c_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0c_1px,transparent_1px)]" />
            </div>

            <main className="max-w-7xl mx-auto px-6 py-12 lg:flex lg:gap-12 relative z-10">
                <div className="absolute top-4 left-6 z-20">
                    <Link href="/jobs" className="flex items-center gap-2 text-sm font-bold text-foreground hover:text-primary transition-colors group">
                        <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
                        <span className="hidden sm:inline">Back to Openings</span>
                    </Link>
                </div>

                {/* Job Details Column */}
                <div className="lg:w-2/3 space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700 bg-card/45 backdrop-blur-xl border border-border/80 rounded-2xl p-8 md:p-10 shadow-[0_8px_30px_rgb(0,0,0,0.02)] mt-8 lg:mt-0">
                    <div>
                        <div className="flex flex-wrap items-center gap-3 mb-4">
                            {job.status === 'closed' && (
                                <Badge className="capsule-badge bg-red-100/80 text-red-600 border border-red-200 capitalize px-3 py-1 font-bold tracking-wide shadow-sm">
                                    CLOSED
                                </Badge>
                            )}
                            <Badge className="capsule-badge capsule-badge-primary capitalize px-3 py-1 font-bold tracking-wide">
                                {job.experience_level || 'Open Level'}
                            </Badge>
                            <Badge className="capsule-badge capsule-badge-neutral font-medium px-3 py-1">
                                {job.mode_of_work || 'Remote'}
                            </Badge>
                            {job.status === 'closed' && job.closed_at && (
                                <span className="text-xs text-muted-foreground mr-1">
                                    Closed on {new Date(job.closed_at).toLocaleDateString()}
                                </span>
                            )}
                        </div>

                        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
                            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-foreground leading-[1.1]">
                                {job.title}
                            </h1>

                            {/* HR Actions Panel */}
                            {user?.role === 'hr' && (
                                <div className="flex items-center gap-2 p-2 bg-muted/40 border border-border/60 rounded-xl shrink-0">
                                    <Link href={`/dashboard/hr/jobs/${job.id}/edit`}>
                                        <Button variant="ghost" size="sm" className="h-8 text-primary hover:bg-primary/10 active:scale-[0.99] transition-all">
                                            <Edit2 className="w-4 h-4 mr-2" /> Edit
                                        </Button>
                                    </Link>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 text-muted-foreground hover:bg-muted active:scale-[0.99] transition-all"
                                        onClick={handleCloseJob}
                                    >
                                        <XCircle className="w-4 h-4 mr-2" /> Close
                                    </Button>
                                    <div className="w-px h-4 bg-border mx-1"></div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 text-destructive hover:bg-destructive/10 active:scale-[0.99] transition-all"
                                        onClick={handleDeleteJob}
                                    >
                                        <Trash2 className="w-4 h-4 mr-2" /> Delete
                                    </Button>
                                </div>
                            )}
                        </div>
                        <div className="flex flex-wrap gap-6 text-sm text-muted-foreground mb-12">
                            <span className="flex items-center gap-2 font-medium">
                                <MapPin className="h-5 w-5 text-primary opacity-85" /> {job.mode_of_work || 'Remote'}
                            </span>
                            {(job.mode_of_work !== 'Remote' && job.location) && (
                                <span className="flex items-center gap-2 text-muted-foreground/80 font-medium">
                                    {job.location}
                                </span>
                            )}
                            <span className="flex items-center gap-2 font-medium">
                                <Clock className="h-5 w-5 text-accent opacity-85" /> {job.job_type || 'Full-Time'}
                            </span>
                            <span className="flex items-center gap-2 font-medium">
                                <Briefcase className="h-5 w-5 text-primary opacity-85" /> {job.domain || 'Engineering'}
                            </span>
                        </div>
                    </div>

                    <div className="prose prose-slate dark:prose-invert max-w-none text-foreground leading-relaxed text-lg">
                        <div className="whitespace-pre-wrap">{job.description}</div>
                    </div>

                    {/* Interview Pipeline Info */}
                    {(job.aptitude_enabled || job.first_level_enabled || job.behavioral_role) && (
                        <div className="mt-10 p-6 bg-primary/5 border border-primary/20 rounded-2xl space-y-4 animate-in fade-in duration-500">
                            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                                <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                                Interview Pipeline
                            </h3>
                            <p className="text-sm text-muted-foreground font-medium">Here's what to expect during the interview process for this role:</p>
                            <div className="flex flex-col gap-3">
                                {job.aptitude_enabled && (
                                    <div className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                                        <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                                            <span className="text-amber-600 dark:text-amber-400 font-bold text-sm">1</span>
                                        </div>
                                        <div>
                                            <p className="font-semibold text-foreground text-sm">Aptitude Round</p>
                                        </div>
                                    </div>
                                )}
                                {job.first_level_enabled && (
                                    <div className="flex items-start gap-3 p-3 bg-primary/10 border border-primary/20 rounded-xl">
                                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                                            <span className="text-primary font-bold text-sm">
                                                {job.aptitude_enabled ? '2' : '1'}
                                            </span>
                                        </div>
                                        <div>
                                            <p className="font-semibold text-foreground text-sm">Technical Interview</p>
                                            <p className="text-xs text-muted-foreground">
                                                {job.interview_mode === 'ai_questions' && 'AI-generated technical questions tailored to your skills and the role requirements.'}
                                                {job.interview_mode === 'mixed_questions' && 'A mix of AI-generated and recruiter-curated questions covering technical aspects.'}
                                                {job.interview_mode === 'upload_questions' && 'Recruiter-curated questions specifically designed for this position.'}
                                                {!job.interview_mode && 'Questions covering technical skills and domain knowledge.'}
                                            </p>
                                        </div>
                                    </div>
                                )}
                                {job.behavioral_role && (
                                    <div className="flex items-start gap-3 p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl">
                                        <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                                            <span className="text-purple-600 dark:text-purple-400 font-bold text-sm">
                                                {(job.aptitude_enabled && job.first_level_enabled) ? '3' : (job.aptitude_enabled || job.first_level_enabled) ? '2' : '1'}
                                            </span>
                                        </div>
                                        <div>
                                            <p className="font-semibold text-foreground text-sm">Behavioral Assessment</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Application Form Column (Sticky Sidebar) */}
                <div className="lg:w-1/3 w-full mt-16 lg:mt-0">
                    <div className="lg:sticky lg:top-12 z-10 w-full pb-12">
                        {user?.role === 'hr' ? (
                            <Card className="bg-card/40 backdrop-blur-md border-dashed border-2 border-border/60 shadow-none rounded-[2rem]">
                                <CardContent className="pt-10 pb-10 text-center space-y-4">
                                    <div className="w-16 h-16 bg-muted/60 rounded-full flex items-center justify-center mx-auto mb-2">
                                        <Briefcase className="h-8 w-8 text-primary" />
                                    </div>
                                    <h3 className="text-lg font-bold text-foreground/80">HR Preview Mode</h3>
                                    <p className="text-sm text-muted-foreground leading-relaxed px-2 font-medium">
                                        You are viewing this job posting as an administrator. Standard users and candidates will see the application form here.
                                    </p>

                                    {job.interview_token && (
                                        <div className="mt-6 pt-6 border-t border-border/50 text-left">
                                            <h4 className="text-sm font-semibold text-foreground mb-2">Job Link</h4>
                                            <p className="text-xs text-muted-foreground mb-3 leading-relaxed font-medium">
                                                Share this job link online.
                                            </p>
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    type="text"
                                                    readOnly
                                                    value={`${typeof window !== 'undefined' ? window.location.origin : ''}/jobs/${job.id}`}
                                                    className="flex-1 text-xs px-3 py-2 bg-background border border-border/80 rounded-lg text-muted-foreground font-mono focus:outline-none h-9"
                                                />
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    className="active:scale-95 transition-all font-bold"
                                                    onClick={async () => {
                                                        const link = `${window.location.origin}/jobs/${job.id}`;
                                                        // Cross-browser clipboard copy with fallback
                                                        let copied = false;
                                                        try {
                                                            if (navigator.clipboard && window.isSecureContext) {
                                                                await navigator.clipboard.writeText(link);
                                                                copied = true;
                                                            }
                                                        } catch (_) {}
                                                        // Fallback: document.execCommand (works in older Safari & HTTP)
                                                        if (!copied) {
                                                            try {
                                                                const ta = document.createElement('textarea');
                                                                ta.value = link;
                                                                ta.style.position = 'fixed';
                                                                ta.style.opacity = '0';
                                                                document.body.appendChild(ta);
                                                                ta.focus();
                                                                ta.select();
                                                                copied = document.execCommand('copy');
                                                                document.body.removeChild(ta);
                                                            } catch (_) {}
                                                        }
                                                        if (copied) {
                                                            toast.success('Job link copied to clipboard');
                                                        } else {
                                                            toast.info(`Copy this link: ${link}`);
                                                        }
                                                        setTimeout(() => { toast.dismiss(); }, 3000);
                                                    }}
                                                >
                                                    Copy
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        ) : isSuccess ? (
                            <Card className="bg-primary/5 border-primary/20 text-center p-8 animate-in zoom-in-95 duration-500 shadow-xl rounded-[2rem]">
                                <CardContent className="pt-6 space-y-6">
                                    <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto ring-8 ring-primary/5">
                                        <CheckCircle2 className="h-10 w-10 text-primary" />
                                    </div>
                                    <h2 className="text-2xl font-bold text-foreground">Application Received!</h2>
                                    <p className="text-muted-foreground leading-relaxed font-medium">
                                        Thank you, {candidateName.split(' ')[0]}. We've sent a confirmation email to <span className="text-foreground font-semibold">{candidateEmail}</span>. Our AI system will begin reviewing your resume shortly.
                                    </p>
                                    <Link href="/jobs" className="block w-full">
                                        <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-12 text-lg font-bold transition-all active:scale-98">
                                            Return to Openings
                                        </Button>
                                    </Link>
                                </CardContent>
                            </Card>
                        ) : job.status === 'closed' ? (
                            <Card className="bg-red-500/5 border-red-500/20 text-center p-8 shadow-xl rounded-[2rem]">
                                <CardContent className="pt-6 space-y-6">
                                    <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto ring-8 ring-red-500/5">
                                        <XCircle className="h-8 w-8 text-red-500" />
                                    </div>
                                    <h2 className="text-2xl font-bold text-foreground">Position Closed</h2>
                                    <p className="text-muted-foreground leading-relaxed font-medium">
                                        We are no longer accepting applications for this listing. Please check out our other open positions.
                                    </p>
                                    <Link href="/jobs" className="block w-full">
                                        <Button className="w-full bg-slate-900 border border-slate-700 hover:bg-slate-800 text-white rounded-xl h-12 text-lg font-bold transition-all active:scale-98">
                                            View Other Openings
                                        </Button>
                                    </Link>
                                </CardContent>
                            </Card>
                        ) : (
                            <Card className="relative shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-border/80 bg-card/45 backdrop-blur-xl rounded-2xl overflow-hidden">
                                <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-primary to-accent"></div>
                                <CardHeader className="pt-8 pb-4">
                                    <CardTitle className="text-2xl font-bold text-slate-900 dark:text-white">Apply Now</CardTitle>
                                    <p className="text-sm text-slate-600 dark:text-slate-400 font-medium">Submit your resume and we'll process your application immediately.</p>
                                </CardHeader>
                                <CardContent>
                                    <form onSubmit={handleSubmit} className="space-y-6">
                                        {submitError && (
                                            <div className="p-4 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg text-sm font-medium animate-in fade-in slide-in-from-top-2">
                                                {submitError}
                                            </div>
                                        )}

                                        <div className="space-y-4">
                                            <div className="space-y-2">
                                                <Label htmlFor="name" className="text-sm font-bold">Full Name *</Label>
                                                <Input
                                                    id="name"
                                                    required
                                                    value={candidateName}
                                                    onChange={(e) => setCandidateName(e.target.value)}
                                                    className="h-12 bg-muted/40 focus:bg-background/80 border-border/80 focus-visible:ring-4 focus-visible:ring-primary/10 hover:border-primary/40 focus-visible:border-primary rounded-xl transition-all"
                                                    placeholder="Jane Doe"
                                                />
                                            </div>

                                            <div className="space-y-1">
                                                <Label htmlFor="email" className="text-sm font-bold">Email *</Label>
                                                <Input
                                                    id="email"
                                                    type="email"
                                                    required
                                                    aria-invalid={Boolean(emailError)}
                                                    aria-describedby={emailError ? 'email-error' : undefined}
                                                    value={candidateEmail}
                                                    onChange={(e) => {
                                                        const v = e.target.value
                                                        setCandidateEmail(v)
                                                        setHasApplied(false)
                                                        setSubmitError(null)
                                                        debouncedValidateEmail(v)
                                                    }}
                                                    onBlur={() => validateEmail(candidateEmail)}
                                                    className={`h-12 bg-muted/40 focus:bg-background/80 border-border/80 focus-visible:ring-4 focus-visible:ring-primary/10 hover:border-primary/40 focus-visible:border-primary rounded-xl transition-all ${emailError ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                                                    placeholder="jane@example.com"
                                                />
                                                {emailError && (
                                                    <p id="email-error" role="alert" className="text-xs text-red-500 font-medium flex items-center gap-1 animate-in fade-in slide-in-from-top-1 duration-200">
                                                        <AlertCircle className="h-3 w-3 shrink-0" />{emailError}
                                                    </p>
                                                )}
                                            </div>

                                            <div className="space-y-2">
                                                <Label htmlFor="phone" className="text-sm font-bold">Phone *</Label>
                                                <div className="flex gap-2">
                                                    <Select value={selectedCountry} onValueChange={setSelectedCountry}>
                                                        <SelectTrigger className="w-[125px] h-12 bg-muted/40 border-border/80 focus:ring-4 focus:ring-primary/10 hover:border-primary/40 focus:border-primary rounded-xl shrink-0 px-3 transition-all">
                                                            <SelectValue placeholder="Country" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {COUNTRY_CODES.map(c => (
                                                                <SelectItem key={c.name} value={c.name}>
                                                                    {c.display}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                    <Input
                                                        id="phone"
                                                        type="tel"
                                                        inputMode="numeric"
                                                        aria-invalid={Boolean(phoneError)}
                                                        aria-describedby={phoneError ? 'phone-error' : undefined}
                                                        value={candidatePhone}
                                                        onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setCandidatePhone(v); debouncedValidatePhone(v); }}
                                                        onBlur={() => validatePhone(candidatePhone)}
                                                        maxLength={COUNTRY_CODES.find(c => c.name === selectedCountry)?.placeholder.length || 15}
                                                        className={`flex-1 h-12 bg-muted/40 focus:bg-background/80 transition-all border-border/80 focus-visible:ring-4 focus-visible:ring-primary/10 hover:border-primary/40 focus-visible:border-primary rounded-xl ${phoneError ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                                                        placeholder={COUNTRY_CODES.find(c => c.name === selectedCountry)?.placeholder}
                                                    />
                                                </div>
                                                {phoneWarning && (
                                                    <p role="alert" className="text-xs text-amber-500 font-medium flex items-center gap-1 mt-1 animate-in fade-in">
                                                        <AlertCircle className="h-3 w-3 shrink-0" />{phoneWarning}
                                                    </p>
                                                )}
                                                {phoneError && (
                                                    <p id="phone-error" role="alert" className="text-xs text-red-500 font-medium flex items-center gap-1 mt-1 animate-in fade-in slide-in-from-top-1 duration-200">
                                                        <AlertCircle className="h-3 w-3 shrink-0" />{phoneError}
                                                    </p>
                                                )}
                                            </div>

                                            <div className="space-y-2 pt-2">
                                                <Label htmlFor="resume" className="text-sm font-bold">Resume/CV *</Label>
                                                <div
                                                    className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all duration-300 ${resumeFile
                                                        ? 'border-primary bg-primary/5'
                                                        : 'border-border/80 hover:border-primary/50 hover:bg-primary/5 bg-muted/20'
                                                        }`}
                                                >
                                                    <input
                                                        id="resume"
                                                        type="file"
                                                        required
                                                        accept=".pdf,.docx,.doc"
                                                        className="hidden"
                                                        ref={fileInputRef}
                                                        onChange={handleFileChange}
                                                    />

                                                    {resumeFile ? (
                                                        <div className="space-y-2 animate-in fade-in duration-300">
                                                            <div className="w-10 h-10 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-1">
                                                                {isExtracting ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                                                            </div>
                                                            <p className="text-xs font-semibold text-primary break-words line-clamp-1">
                                                                {isExtracting ? "Extracting info..." : resumeFile.name}
                                                            </p>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="sm"
                                                                className="text-muted-foreground hover:text-destructive h-7 text-[10px] active:scale-95 transition-all"
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    setResumeFile(null);
                                                                    if (fileInputRef.current) fileInputRef.current.value = '';
                                                                }}
                                                            >
                                                                Remove
                                                            </Button>
                                                        </div>
                                                    ) : (
                                                        <div
                                                            className="flex flex-col items-center gap-2 cursor-pointer group"
                                                            onClick={() => fileInputRef.current?.click()}
                                                        >
                                                            <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                                                                <UploadCloud className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                                                            </div>
                                                            <div className="space-y-0.5">
                                                                <p className="text-xs font-bold text-foreground">Click to upload resume</p>
                                                                <p className="text-[10px] text-muted-foreground font-semibold">PDF, DOCX or DOC</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="space-y-2 pt-2">
                                                <Label htmlFor="photo" className="text-sm font-bold">Candidate Photo *</Label>
                                                <div
                                                    className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all duration-300 ${photoFile
                                                        ? 'border-primary bg-primary/5'
                                                        : 'border-border/80 hover:border-primary/50 hover:bg-primary/5 bg-muted/20'
                                                        }`}
                                                >
                                                    <input
                                                        id="photo"
                                                        type="file"
                                                        accept="image/*"
                                                        className="hidden"
                                                        ref={photoInputRef}
                                                        onChange={handlePhotoChange}
                                                    />

                                                    {photoFile ? (
                                                        <div className="space-y-2 animate-in fade-in duration-300">
                                                            <div className="w-10 h-10 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-1">
                                                                <CheckCircle2 className="h-5 w-5" />
                                                            </div>
                                                            <p className="text-xs font-semibold text-primary break-words line-clamp-1">
                                                                {photoFile.name}
                                                            </p>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="sm"
                                                                className="text-muted-foreground hover:text-destructive h-7 text-[10px] active:scale-95 transition-all"
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    setPhotoFile(null);
                                                                    if (photoInputRef.current) photoInputRef.current.value = '';
                                                                }}
                                                            >
                                                                Remove
                                                            </Button>
                                                        </div>
                                                    ) : (
                                                        <div
                                                            className="flex flex-col items-center gap-2 cursor-pointer group"
                                                            onClick={() => photoInputRef.current?.click()}
                                                        >
                                                            <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                                                                <UploadCloud className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                                                            </div>
                                                            <div className="space-y-0.5">
                                                                <p className="text-xs font-bold text-foreground">Click to upload photo</p>
                                                                <p className="text-[10px] text-muted-foreground font-semibold">JPG/PNG (Max 5MB)</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {hasApplied && (
                                            <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/25 rounded-2xl flex items-start gap-3 animate-in fade-in slide-in-from-top-2 duration-500">
                                                <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                                                <div>
                                                    <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
                                                        You have already applied for this job using this email or phone number.
                                                    </p>
                                                    <p className="text-xs text-amber-700/90 dark:text-amber-400/90 leading-relaxed font-semibold">
                                                        To ensure fair opportunities for everyone, we only allow one application per candidate for each role. Please check your inbox for details on your existing application.
                                                    </p>
                                                </div>
                                            </div>
                                        )}

                                        <Button
                                            type="submit"
                                            className="w-full h-14 text-base font-bold bg-gradient-to-r from-primary to-accent hover:from-primary/95 hover:to-accent/95 text-primary-foreground rounded-xl shadow-lg hover:shadow-primary/25 transition-all transform hover:-translate-y-0.5 active:scale-[0.98] active:translate-y-0 cursor-pointer"
                                            disabled={isSubmitting || hasApplied || Boolean(emailError) || Boolean(phoneError) || !resumeFile}
                                        >
                                            {isSubmitting ? (
                                                <span className="flex items-center gap-2">
                                                    <Loader2 className="h-5 w-5 animate-spin" />
                                                    Submitting...
                                                </span>
                                            ) : hasApplied ? (
                                                <span className="flex items-center gap-2">
                                                    <AlertCircle className="h-5 w-5" />
                                                    Already Applied
                                                </span>
                                            ) : (
                                                "Submit Application"
                                            )}
                                        </Button>
                                    </form>
                                </CardContent>
                            </Card>
                        )}
                    </div>
                </div>

            </main>

            <Dialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
                <DialogContent className="border border-border/80 bg-background/90 backdrop-blur-xl shadow-2xl rounded-3xl">
                    <DialogHeader>
                        <DialogTitle className="font-extrabold text-xl">Confirm Action</DialogTitle>
                        <DialogDescription className="font-medium text-muted-foreground">
                            {confirmAction === 'close'
                                ? 'Are you sure you want to close this job? Applications will be retained.'
                                : 'Are you sure you want to DELETE this job? All applications will be permanently removed.'}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="outline" className="rounded-xl font-bold" onClick={() => setConfirmAction(null)}>Cancel</Button>
                        <Button variant="destructive" className="rounded-xl font-bold active:scale-[0.99] transition-all" onClick={handleConfirmAction}>Confirm</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
