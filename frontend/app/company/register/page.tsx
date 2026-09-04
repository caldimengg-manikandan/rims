'use client'

import React, { useState, useId } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getApiBaseUrl } from '@/lib/config'
import { toast } from 'sonner'
import {
  Building2,
  Globe,
  ShieldCheck,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Lock,
  Mail,
  User,
  Eye,
  EyeOff,
  Palette,
  Briefcase,
  Users,
  ChevronLeft,
  Loader2,
  AlertCircle
} from 'lucide-react'

const COLOR_PRESETS = [
  { name: 'Indigo Aura', hex: '#6366f1', gradient: 'from-indigo-500 to-purple-600' },
  { name: 'Emerald Growth', hex: '#10b981', gradient: 'from-emerald-500 to-teal-600' },
  { name: 'Electric Violet', hex: '#8b5cf6', gradient: 'from-violet-500 to-fuchsia-600' },
  { name: 'Ocean Cyan', hex: '#06b6d4', gradient: 'from-cyan-500 to-blue-600' },
  { name: 'Rose Quartz', hex: '#f43f5e', gradient: 'from-rose-500 to-pink-600' },
  { name: 'Amber Forge', hex: '#f59e0b', gradient: 'from-amber-500 to-orange-600' },
]

const INDUSTRIES = [
  'Technology & Software',
  'Healthcare & Biotechnology',
  'Finance & FinTech',
  'Artificial Intelligence & Robotics',
  'E-Commerce & Retail',
  'Consulting & Professional Services',
  'Education & EdTech',
  'Other'
]

const SIZES = ['1-10 employees', '11-50 employees', '51-200 employees', '201-1000 employees', '1000+ enterprise']

export default function CompanyRegisterPage() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{
    companyName?: string
    slug?: string
    adminName?: string
    adminEmail?: string
    adminPassword?: string
    confirmPassword?: string
  }>({})
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)

  // Form State
  const [formData, setFormData] = useState({
    companyName: '',
    slug: '',
    industry: 'Technology & Software',
    companySize: '11-50 employees',
    logoUrl: '',
    primaryColor: '#6366f1',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
    confirmPassword: '',
  })

  // Unique IDs for SEO & accessibility
  const companyNameId = useId()
  const slugId = useId()
  const industryId = useId()
  const sizeId = useId()
  const logoId = useId()
  const adminNameId = useId()
  const adminEmailId = useId()
  const adminPasswordId = useId()
  const confirmPasswordId = useId()

  const handleCompanyNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setFormData((prev) => {
      const updated = { ...prev, companyName: val }
      if (!slugManuallyEdited) {
        let genSlug = val
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 30)
        updated.slug = genSlug
      }
      return updated
    })
    if (fieldErrors.companyName) {
      setFieldErrors((prev) => ({ ...prev, companyName: undefined }))
    }
    if (error) setError(null)
  }

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSlugManuallyEdited(true)
    const cleaned = e.target.value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 30)
    setFormData((prev) => ({ ...prev, slug: cleaned }))
    if (fieldErrors.slug) {
      setFieldErrors((prev) => ({ ...prev, slug: undefined }))
    }
    if (error) setError(null)
  }

  const validateStep1 = () => {
    const trimmedName = formData.companyName.trim()
    let slugVal = formData.slug.trim().toLowerCase()

    // If slug is empty or missing but company name was provided, generate slug now
    if (!slugVal && trimmedName) {
      slugVal = trimmedName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 30)
      if (slugVal.length === 1) slugVal = `${slugVal}-org`
      setFormData((prev) => ({ ...prev, slug: slugVal }))
    }

    const errors: { companyName?: string; slug?: string } = {}
    if (!trimmedName) {
      errors.companyName = 'Please enter your company or organization name.'
    }
    if (!slugVal) {
      errors.slug = 'Workspace subdomain slug is required.'
    } else if (slugVal.length < 2) {
      errors.slug = 'Subdomain slug must be at least 2 characters.'
    } else if (!/^[a-z0-9-]+$/.test(slugVal)) {
      errors.slug = 'Subdomain can only contain lowercase letters, numbers, and hyphens.'
    } else if (slugVal.startsWith('-') || slugVal.endsWith('-')) {
      errors.slug = 'Subdomain cannot start or end with a hyphen.'
    }

    setFieldErrors((prev) => ({ ...prev, ...errors }))

    if (errors.companyName || errors.slug) {
      const msg = errors.companyName || errors.slug || 'Please complete the required workspace fields.'
      setError(msg)
      toast.error(msg)
      return false
    }

    setError(null)
    setFieldErrors((prev) => ({ ...prev, companyName: undefined, slug: undefined }))
    return true
  }

  const validateStep2 = () => {
    const trimmedAdmin = formData.adminName.trim()
    const trimmedEmail = formData.adminEmail.trim().toLowerCase()
    const errors: { adminName?: string; adminEmail?: string; adminPassword?: string; confirmPassword?: string } = {}

    if (!trimmedAdmin) {
      errors.adminName = 'Please enter the administrator full name.'
    }
    if (!trimmedEmail) {
      errors.adminEmail = 'Please enter a work email address.'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      errors.adminEmail = 'Please enter a valid work email address (e.g. admin@company.com).'
    }
    if (!formData.adminPassword) {
      errors.adminPassword = 'Password is required.'
    } else if (formData.adminPassword.length < 8) {
      errors.adminPassword = 'Password must be at least 8 characters long.'
    }
    if (formData.adminPassword && formData.adminPassword !== formData.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.'
    }

    setFieldErrors((prev) => ({ ...prev, ...errors }))

    if (errors.adminName || errors.adminEmail || errors.adminPassword || errors.confirmPassword) {
      const msg = errors.adminName || errors.adminEmail || errors.adminPassword || errors.confirmPassword || 'Please complete all required fields.'
      setError(msg)
      toast.error(msg)
      return false
    }

    setError(null)
    setFieldErrors((prev) => ({ ...prev, adminName: undefined, adminEmail: undefined, adminPassword: undefined, confirmPassword: undefined }))
    return true
  }

  const handleContinueToAdminSetup = (e?: React.MouseEvent | React.FormEvent) => {
    if (e) e.preventDefault()
    if (validateStep1()) {
      setError(null)
      setStep(2)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const handleContinueToCustomization = (e?: React.MouseEvent | React.FormEvent) => {
    if (e) e.preventDefault()
    if (validateStep2()) {
      setError(null)
      setStep(3)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (step === 1) {
      handleContinueToAdminSetup(e)
    } else if (step === 2) {
      handleContinueToCustomization(e)
    } else {
      handleSubmit(e)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validateStep1() || !validateStep2()) return

    setLoading(true)
    setError(null)

    try {
      const apiBase = getApiBaseUrl()
      const res = await fetch(`${apiBase}/api/auth/company-register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          company_name: formData.companyName.trim(),
          slug: formData.slug.trim().toLowerCase(),
          logo_url: formData.logoUrl.trim() || null,
          industry: formData.industry,
          company_size: formData.companySize,
          primary_color: formData.primaryColor,
          admin_name: formData.adminName.trim(),
          admin_email: formData.adminEmail.trim().toLowerCase(),
          admin_password: formData.adminPassword,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.detail || data.error || 'Registration failed. Please try again.')
      }

      setIsSubmitted(true)
    } catch (err: any) {
      const msg = err.message || 'An unexpected error occurred.'
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col justify-between selection:bg-primary/20">
      {/* Ambient background glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div
          className="absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[500px] rounded-full blur-[120px] opacity-25"
          style={{ background: `radial-gradient(circle, ${formData.primaryColor}, transparent 70%)` }}
        />
        <div className="absolute top-1/3 -right-40 w-[450px] h-[450px] bg-purple-500/10 rounded-full blur-[100px]" />
        <div className="absolute -bottom-20 -left-20 w-[450px] h-[450px] bg-blue-500/10 rounded-full blur-[100px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 w-full border-b border-border/40 bg-background/60 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:scale-105 transition-transform">
              <Building2 className="w-4 h-4 text-primary" />
            </div>
            <span className="font-extrabold tracking-tight text-lg">CALRIMS <span className="text-primary text-sm font-semibold">Enterprise</span></span>
          </Link>

          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground hidden sm:inline">Already have an organization?</span>
            <Link href="/auth/login">
              <Button variant="ghost" size="sm" className="font-medium hover:bg-muted">
                Sign In
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 max-w-7xl mx-auto px-6 py-12 lg:py-16 w-full flex-1">
        {isSubmitted ? (
          <div className="flex items-center justify-center py-8 sm:py-12">
            <Card className="max-w-xl w-full border-border/60 bg-card/90 backdrop-blur-2xl shadow-2xl p-8 sm:p-12 text-center space-y-8 animate-in fade-in zoom-in-95 duration-500">
              <div className="w-20 h-20 rounded-3xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle2 className="w-10 h-10 text-primary animate-pulse" />
              </div>

              <div className="space-y-4">
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 px-3 py-1 text-xs font-semibold rounded-full">
                  Registration Submitted
                </Badge>
                <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
                  Thank you for registering.
                </h2>
                <p className="text-base sm:text-lg text-muted-foreground leading-relaxed px-2 font-medium">
                  Please wait while we set things up for you. We’ll contact you soon.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-muted/40 border border-border/50 text-left space-y-2.5">
                <div className="flex justify-between items-center text-xs text-muted-foreground font-bold uppercase tracking-wider">
                  <span>Organization</span>
                  <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">
                    Setup In Progress
                  </Badge>
                </div>
                <p className="font-extrabold text-lg text-foreground truncate">{formData.companyName}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                  <Globe className="w-3.5 h-3.5 text-primary" />
                  <span>{formData.slug}.calrims.com</span>
                </div>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row gap-3 justify-center">
                <Link href="/" className="w-full sm:w-auto">
                  <Button variant="outline" className="w-full h-11 px-6 font-semibold rounded-xl">
                    Return to Home
                  </Button>
                </Link>
                <Link href="/auth/login" className="w-full sm:w-auto">
                  <Button className="w-full h-11 px-6 font-semibold rounded-xl shadow-lg shadow-primary/25">
                    Go to Sign In
                  </Button>
                </Link>
              </div>
            </Card>
          </div>
        ) : (
        <div className="grid lg:grid-cols-12 gap-12 items-start">
          
          {/* Left Column: Form & Stepper */}
          <div className="lg:col-span-7 space-y-8">
            <div className="space-y-3">
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/25 px-3 py-1 font-semibold text-xs rounded-full">
                <Sparkles className="w-3.5 h-3.5 mr-1.5" /> Instant Dedicated Workspace
              </Badge>
              <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-foreground">
                Set up your Organization in <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-purple-500">seconds</span>
              </h1>
              <p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
                Create a dedicated multi-tenant hiring portal with Row-Level Security (RLS), AI interview intelligence, and custom domain branding.
              </p>
            </div>

            {/* Stepper Tabs */}
            <div className="grid grid-cols-3 gap-2 p-1.5 bg-muted/60 backdrop-blur-md rounded-2xl border border-border/50 text-xs sm:text-sm font-medium">
              <button
                type="button"
                onClick={() => setStep(1)}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl transition-all ${
                  step === 1 ? 'bg-card text-foreground shadow-sm font-bold border border-border/40' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  step === 1 ? 'bg-primary text-primary-foreground' : 'bg-muted-foreground/20'
                }`}>1</span>
                <span>Workspace</span>
              </button>

              <button
                type="button"
                onClick={() => handleContinueToAdminSetup()}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl transition-all ${
                  step === 2 ? 'bg-card text-foreground shadow-sm font-bold border border-border/40' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  step === 2 ? 'bg-primary text-primary-foreground' : 'bg-muted-foreground/20'
                }`}>2</span>
                <span>Super Admin</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (validateStep1() && validateStep2()) {
                    setStep(3)
                  }
                }}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl transition-all ${
                  step === 3 ? 'bg-card text-foreground shadow-sm font-bold border border-border/40' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  step === 3 ? 'bg-primary text-primary-foreground' : 'bg-muted-foreground/20'
                }`}>3</span>
                <span>Brand & Launch</span>
              </button>
            </div>

            {/* Error Notification Alert */}
            {error && (
              <div className="p-4 bg-destructive/10 border border-destructive/25 text-destructive rounded-2xl flex items-start gap-3 text-sm animate-in fade-in">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="flex-1 font-semibold">{error}</div>
              </div>
            )}

            {/* Form Card */}
            <Card className="bg-card/70 backdrop-blur-xl border-border/60 shadow-xl rounded-3xl overflow-hidden">
              <form onSubmit={handleFormSubmit}>
                <CardContent className="p-6 sm:p-8 space-y-6">
                  
                  {/* STEP 1: Organization Details */}
                  {step === 1 && (
                    <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="space-y-1.5">
                        <label htmlFor={companyNameId} className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          Company / Organization Name <span className="text-destructive">*</span>
                        </label>
                        <div className="relative">
                          <Building2 className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${fieldErrors.companyName ? 'text-destructive' : 'text-muted-foreground'}`} />
                          <Input
                            id={companyNameId}
                            placeholder="e.g. Acme Corporation or Helix BioLabs"
                            value={formData.companyName}
                            onChange={handleCompanyNameChange}
                            required
                            aria-invalid={!!fieldErrors.companyName}
                            className={`pl-10 h-12 bg-background/50 rounded-xl text-base ${fieldErrors.companyName ? 'border-destructive focus-visible:ring-destructive/30' : ''}`}
                          />
                        </div>
                        {fieldErrors.companyName && (
                          <p className="text-xs text-destructive font-medium mt-1 animate-in fade-in">
                            {fieldErrors.companyName}
                          </p>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <label htmlFor={slugId} className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                          <span>Workspace Subdomain <span className="text-destructive">*</span></span>
                          <span className="text-[11px] text-muted-foreground font-normal">Auto-generated</span>
                        </label>
                        <div className={`flex rounded-xl overflow-hidden border bg-background/50 focus-within:ring-2 ${fieldErrors.slug ? 'border-destructive focus-within:ring-destructive/30' : 'border-input focus-within:ring-ring'}`}>
                          <div className="pl-3.5 pr-1 flex items-center text-muted-foreground">
                            <Globe className={`w-4 h-4 mr-2 ${fieldErrors.slug ? 'text-destructive' : 'text-primary'}`} />
                            <span className="text-xs font-mono text-muted-foreground">https://</span>
                          </div>
                          <input
                            id={slugId}
                            type="text"
                            value={formData.slug}
                            onChange={handleSlugChange}
                            placeholder="acme"
                            aria-invalid={!!fieldErrors.slug}
                            className="flex-1 bg-transparent py-2.5 text-sm font-semibold text-foreground focus:outline-none"
                          />
                          <div className="pr-3.5 flex items-center text-xs font-mono text-muted-foreground/80 bg-muted/40 px-2 border-l border-border/40">
                            .calrims.com
                          </div>
                        </div>
                        {fieldErrors.slug ? (
                          <p className="text-xs text-destructive font-medium mt-1 animate-in fade-in">
                            {fieldErrors.slug}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Your candidates and recruiters will access your isolated portal at this link.
                          </p>
                        )}
                      </div>

                      <div className="grid sm:grid-cols-2 gap-4 pt-2">
                        <div className="space-y-1.5">
                          <label htmlFor={industryId} className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            Industry
                          </label>
                          <select
                            id={industryId}
                            value={formData.industry}
                            onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                            className="w-full h-12 px-3.5 rounded-xl border border-input bg-background/50 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring"
                          >
                            {INDUSTRIES.map((ind) => (
                              <option key={ind} value={ind}>{ind}</option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-1.5">
                          <label htmlFor={sizeId} className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            Company Size
                          </label>
                          <select
                            id={sizeId}
                            value={formData.companySize}
                            onChange={(e) => setFormData({ ...formData, companySize: e.target.value })}
                            className="w-full h-12 px-3.5 rounded-xl border border-input bg-background/50 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring"
                          >
                            {SIZES.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {error && (
                        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-xs font-semibold flex items-center gap-2 animate-in fade-in">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span>{error}</span>
                        </div>
                      )}

                      <div className="pt-4 flex justify-end">
                        <Button
                          type="button"
                          onClick={handleContinueToAdminSetup}
                          size="lg"
                          className="h-12 px-6 rounded-xl font-bold gap-2 shadow-lg shadow-primary/20"
                        >
                          Continue to Admin Setup <ArrowRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* STEP 2: Super Administrator */}
                  {step === 2 && (
                    <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="p-3.5 bg-primary/5 border border-primary/15 rounded-2xl flex items-center gap-3 text-xs text-muted-foreground">
                        <ShieldCheck className="w-5 h-5 text-primary shrink-0" />
                        <span>This account will be the <strong>Root Super Admin</strong> for <strong>{formData.companyName || 'your organization'}</strong> with full workspace authority.</span>
                      </div>

                      <div className="space-y-1.5">
                        <label htmlFor={adminNameId} className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          Administrator Full Name <span className="text-destructive">*</span>
                        </label>
                        <div className="relative">
                          <User className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${fieldErrors.adminName ? 'text-destructive' : 'text-muted-foreground'}`} />
                          <Input
                            id={adminNameId}
                            placeholder="e.g. Sarah Jenkins or Alex Mercer"
                            value={formData.adminName}
                            onChange={(e) => {
                              setFormData({ ...formData, adminName: e.target.value })
                              if (fieldErrors.adminName) setFieldErrors(prev => ({ ...prev, adminName: undefined }))
                              if (error) setError(null)
                            }}
                            required
                            aria-invalid={!!fieldErrors.adminName}
                            className={`pl-10 h-12 bg-background/50 rounded-xl ${fieldErrors.adminName ? 'border-destructive focus-visible:ring-destructive/30' : ''}`}
                          />
                        </div>
                        {fieldErrors.adminName && (
                          <p className="text-xs text-destructive font-medium mt-1 animate-in fade-in">
                            {fieldErrors.adminName}
                          </p>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <label htmlFor={adminEmailId} className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          Work Email Address <span className="text-destructive">*</span>
                        </label>
                        <div className="relative">
                          <Mail className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${fieldErrors.adminEmail ? 'text-destructive' : 'text-muted-foreground'}`} />
                          <Input
                            id={adminEmailId}
                            type="email"
                            placeholder="admin@yourcompany.com"
                            value={formData.adminEmail}
                            onChange={(e) => {
                              setFormData({ ...formData, adminEmail: e.target.value })
                              if (fieldErrors.adminEmail) setFieldErrors(prev => ({ ...prev, adminEmail: undefined }))
                              if (error) setError(null)
                            }}
                            required
                            aria-invalid={!!fieldErrors.adminEmail}
                            className={`pl-10 h-12 bg-background/50 rounded-xl ${fieldErrors.adminEmail ? 'border-destructive focus-visible:ring-destructive/30' : ''}`}
                          />
                        </div>
                        {fieldErrors.adminEmail && (
                          <p className="text-xs text-destructive font-medium mt-1 animate-in fade-in">
                            {fieldErrors.adminEmail}
                          </p>
                        )}
                      </div>

                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label htmlFor={adminPasswordId} className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            Password <span className="text-destructive">*</span>
                          </label>
                          <div className="relative">
                            <Lock className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${fieldErrors.adminPassword ? 'text-destructive' : 'text-muted-foreground'}`} />
                            <Input
                              id={adminPasswordId}
                              type={showPassword ? 'text' : 'password'}
                              placeholder="Min. 8 characters"
                              value={formData.adminPassword}
                              onChange={(e) => {
                                setFormData({ ...formData, adminPassword: e.target.value })
                                if (fieldErrors.adminPassword) setFieldErrors(prev => ({ ...prev, adminPassword: undefined }))
                                if (error) setError(null)
                              }}
                              required
                              aria-invalid={!!fieldErrors.adminPassword}
                              className={`pl-10 pr-10 h-12 bg-background/50 rounded-xl ${fieldErrors.adminPassword ? 'border-destructive focus-visible:ring-destructive/30' : ''}`}
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            >
                              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                          {fieldErrors.adminPassword && (
                            <p className="text-xs text-destructive font-medium mt-1 animate-in fade-in">
                              {fieldErrors.adminPassword}
                            </p>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <label htmlFor={confirmPasswordId} className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            Confirm Password <span className="text-destructive">*</span>
                          </label>
                          <div className="relative">
                            <Lock className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${fieldErrors.confirmPassword ? 'text-destructive' : 'text-muted-foreground'}`} />
                            <Input
                              id={confirmPasswordId}
                              type={showPassword ? 'text' : 'password'}
                              placeholder="Re-enter password"
                              value={formData.confirmPassword}
                              onChange={(e) => {
                                setFormData({ ...formData, confirmPassword: e.target.value })
                                if (fieldErrors.confirmPassword) setFieldErrors(prev => ({ ...prev, confirmPassword: undefined }))
                                if (error) setError(null)
                              }}
                              required
                              aria-invalid={!!fieldErrors.confirmPassword}
                              className={`pl-10 h-12 bg-background/50 rounded-xl ${fieldErrors.confirmPassword ? 'border-destructive focus-visible:ring-destructive/30' : ''}`}
                            />
                          </div>
                          {fieldErrors.confirmPassword && (
                            <p className="text-xs text-destructive font-medium mt-1 animate-in fade-in">
                              {fieldErrors.confirmPassword}
                            </p>
                          )}
                        </div>
                      </div>

                      {error && (
                        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-xs font-semibold flex items-center gap-2 animate-in fade-in">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span>{error}</span>
                        </div>
                      )}

                      <div className="pt-4 flex justify-between items-center">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setStep(1)}
                          className="gap-2 text-muted-foreground"
                        >
                          <ChevronLeft className="w-4 h-4" /> Back
                        </Button>
                        <Button
                          type="button"
                          onClick={handleContinueToCustomization}
                          size="lg"
                          className="h-12 px-6 rounded-xl font-bold gap-2 shadow-lg shadow-primary/20"
                        >
                          Continue to Customization <ArrowRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* STEP 3: Brand & Launch */}
                  {step === 3 && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                      
                      {/* Brand Color Preset */}
                      <div className="space-y-3">
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                          <Palette className="w-3.5 h-3.5 text-primary" />
                          Brand Primary Color
                        </label>
                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
                          {COLOR_PRESETS.map((preset) => {
                            const isSelected = formData.primaryColor === preset.hex
                            return (
                              <button
                                key={preset.hex}
                                type="button"
                                onClick={() => setFormData({ ...formData, primaryColor: preset.hex })}
                                className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all ${
                                  isSelected ? 'border-primary bg-primary/10 shadow-sm scale-105' : 'border-border/60 hover:bg-muted/40'
                                }`}
                              >
                                <div className="w-6 h-6 rounded-full shadow-inner" style={{ backgroundColor: preset.hex }} />
                                <span className="text-[10px] font-medium text-muted-foreground truncate w-full text-center">
                                  {preset.name.split(' ')[0]}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      {/* Logo URL */}
                      <div className="space-y-1.5">
                        <label htmlFor={logoId} className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          Company Logo URL (Optional)
                        </label>
                        <Input
                          id={logoId}
                          type="url"
                          placeholder="https://yourcompany.com/logo.png"
                          value={formData.logoUrl}
                          onChange={(e) => setFormData({ ...formData, logoUrl: e.target.value })}
                          className="h-12 bg-background/50 rounded-xl"
                        />
                        <p className="text-xs text-muted-foreground">
                          Leave blank to use an automatic stylized monogram logo.
                        </p>
                      </div>

                      {/* Summary Checklist */}
                      <div className="p-4 bg-muted/40 border border-border/60 rounded-2xl space-y-2.5 text-xs text-muted-foreground">
                        <div className="font-bold text-foreground flex items-center gap-2 text-sm">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          Ready to deploy your hiring cloud
                        </div>
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <div>• <strong>Org:</strong> {formData.companyName || 'Not specified'}</div>
                          <div>• <strong>Slug:</strong> {formData.slug}.calrims.com</div>
                          <div>• <strong>Super Admin:</strong> {formData.adminEmail || 'Not specified'}</div>
                          <div>• <strong>RLS Security:</strong> Enforced</div>
                        </div>
                      </div>

                      <div className="pt-4 flex justify-between items-center">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setStep(2)}
                          className="gap-2 text-muted-foreground"
                        >
                          <ChevronLeft className="w-4 h-4" /> Back
                        </Button>
                        <Button
                          type="submit"
                          disabled={loading}
                          size="lg"
                          className="h-12 px-8 rounded-xl font-bold gap-2 bg-gradient-to-r from-primary to-purple-600 text-primary-foreground shadow-xl hover:opacity-95 active:scale-[0.99] transition-all"
                        >
                          {loading ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Launching Organization...
                            </>
                          ) : (
                            <>
                              Complete & Launch Workspace <Sparkles className="w-4 h-4 ml-1" />
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}

                </CardContent>
              </form>
            </Card>
          </div>

          {/* Right Column: Live Interactive Portal Preview */}
          <div className="lg:col-span-5 space-y-6">
            <div className="sticky top-24 space-y-6">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-primary" /> Live Portal Preview
                </span>
                <Badge variant="secondary" className="text-[10px] font-mono">
                  {formData.slug || 'your-org'}.calrims.com
                </Badge>
              </div>

              {/* Mock Browser Frame */}
              <div className="rounded-3xl border border-border/80 bg-card/80 backdrop-blur-2xl shadow-2xl overflow-hidden">
                {/* Window top bar */}
                <div className="px-4 py-3 bg-muted/70 border-b border-border/50 flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
                  </div>
                  <div className="flex-1 text-center font-mono text-[11px] text-muted-foreground bg-background/60 py-1 px-3 rounded-lg truncate">
                    https://{formData.slug || 'workspace'}.calrims.com/jobs
                  </div>
                </div>

                {/* Simulated Portal Content */}
                <div className="p-6 space-y-6">
                  {/* Branded Nav */}
                  <div className="flex items-center justify-between pb-4 border-b border-border/40">
                    <div className="flex items-center gap-2.5">
                      {formData.logoUrl ? (
                        <img
                          src={formData.logoUrl}
                          alt="Company Logo"
                          className="w-7 h-7 rounded-lg object-cover"
                          onError={(e) => {
                            ;(e.currentTarget as HTMLElement).style.display = 'none'
                          }}
                        />
                      ) : (
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs text-white shadow-sm"
                          style={{ backgroundColor: formData.primaryColor }}
                        >
                          {(formData.companyName || 'C')[0].toUpperCase()}
                        </div>
                      )}
                      <span className="font-extrabold text-sm tracking-tight text-foreground truncate max-w-[140px]">
                        {formData.companyName || 'Your Organization'}
                      </span>
                    </div>

                    <Badge className="text-[10px] px-2 py-0.5 text-white" style={{ backgroundColor: formData.primaryColor }}>
                      Verified Tenant
                    </Badge>
                  </div>

                  {/* Hero banner in mock */}
                  <div
                    className="p-5 rounded-2xl text-white space-y-2 relative overflow-hidden"
                    style={{
                      background: `linear-gradient(135deg, ${formData.primaryColor}, #1e1b4b)`,
                    }}
                  >
                    <div className="text-xs font-semibold uppercase tracking-wider opacity-80">
                      {formData.industry}
                    </div>
                    <div className="font-black text-lg sm:text-xl leading-tight">
                      Careers at {formData.companyName || 'Your Company'}
                    </div>
                    <p className="text-xs opacity-90 line-clamp-2">
                      Join our team of high-performing innovators shaping the next generation.
                    </p>
                  </div>

                  {/* Sample Mock Jobs */}
                  <div className="space-y-2.5">
                    <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                      Featured Roles
                    </div>
                    
                    <div className="p-3 bg-muted/40 rounded-xl border border-border/50 flex items-center justify-between">
                      <div>
                        <div className="font-bold text-xs text-foreground">Lead AI Systems Engineer</div>
                        <div className="text-[10px] text-muted-foreground">San Francisco, CA • Remote</div>
                      </div>
                      <span className="text-[11px] font-semibold text-primary">Apply →</span>
                    </div>

                    <div className="p-3 bg-muted/40 rounded-xl border border-border/50 flex items-center justify-between">
                      <div>
                        <div className="font-bold text-xs text-foreground">Principal Product Designer</div>
                        <div className="text-[10px] text-muted-foreground">New York, NY • Hybrid</div>
                      </div>
                      <span className="text-[11px] font-semibold text-primary">Apply →</span>
                    </div>
                  </div>

                  {/* Bottom specs */}
                  <div className="pt-2 border-t border-border/40 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Isolated Database RLS
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-blue-500" /> Multi-Tenant DNS Ready
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border/40 py-6 bg-background/50 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} CALRIMS Inc. Enterprise Cloud Multi-Tenancy.</p>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
            <Link href="/support" className="hover:text-foreground transition-colors">Enterprise Support</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
