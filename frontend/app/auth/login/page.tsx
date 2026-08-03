  'use client'

import React, { useState, useEffect } from "react"
import { useAuth } from '@/app/dashboard/lib/auth-context'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Zap, Mail, Lock, ArrowRight, Loader2, Sparkles, Brain, Cpu, Globe, ShieldCheck, CheckCircle2, Eye, EyeOff, LucideIcon } from 'lucide-react'
import { cn } from '@/app/dashboard/lib/utils'
import { getSessionData } from '@/lib/session-store'
import useSWR from 'swr'
import { APIClient } from '@/app/dashboard/lib/api-client'
import { useBranding } from '@/lib/branding-client'

function LoginContent() {
  const router = useRouter()
  const { login, logout, isLoading, isAuthenticated, user } = useAuth()
  const searchParams = useSearchParams()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const hasSubmitted = React.useRef(false)

  const { branding } = useBranding()
  const companyLogo = branding.logoUrl
  const companyName = branding.companyName
  const productName = branding.productName

  useEffect(() => {
    if (searchParams.get('expired') === 'true') {
      setError('Session expired. Please login again.')
    }
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const emailRegex = /^(?!\d+@)(?![^@]*\.\.)(?!^\.)[A-Za-z0-9_\-+]+(?:\.[A-Za-z0-9_\-+]+)*@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}$/;
    if (!emailRegex.test(email)) {
      if (!email.includes('@')) {
        setError('Email must contain "@" symbol (e.g. name@domain.com)');
      } else if (!email.split('@')[1]?.includes('.')) {
        setError('Email must have a valid domain (e.g. name@gmail.com)');
      } else if (/^\d+@/.test(email)) {
        setError('Email username cannot be numbers only');
      } else {
        setError('Enter a valid email address (e.g. name@domain.com)');
      }
      return;
    }

    setIsSubmitting(true)
    hasSubmitted.current = true

    try {
      await login(email, password)
      
      // Small delay to let auth context update with the user data from the login response
      // so subsequent /me calls include the cookie
      await new Promise(resolve => setTimeout(resolve, 100))
      
      const session = getSessionData()
      let restoreUrl = '/dashboard/hr'
      
      // 1. Check if 'from' query param exists (from middleware)
      const from = searchParams.get('from')
      if (from && (from.startsWith('/dashboard') || from.startsWith('/company') || from.startsWith('/offer'))) {
        restoreUrl = from
      } 
      // 2. Fallback to session last visited page
      else if (session.lastVisitedPage && session.lastVisitedPage.startsWith('/dashboard')) {
        restoreUrl = session.lastVisitedPage
      }
      
      router.push(restoreUrl)
    } catch (err) {
      hasSubmitted.current = false
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const hasLoggedOutOnMount = React.useRef(false)

  useEffect(() => {
    // Enforce strict security: navigating to the login page terminates any active session.
    // This ensures HR must explicitly authenticate every time they want to access the system.
    if (!hasLoggedOutOnMount.current) {
      hasLoggedOutOnMount.current = true
      if (isAuthenticated && !hasSubmitted.current) {
        logout()
      }
    }
  }, [isAuthenticated, logout])

  // Removed the Active Session Detected UI to enforce manual login.

  return (
    <div className="h-[calc(100vh-4rem)] flex-1 w-full flex flex-col lg:flex-row bg-background selection:bg-primary/20 relative overflow-hidden">

      {/* LEFT COLUMN: Hero Imagery (Hidden on Mobile) */}
      <div className="hidden lg:flex lg:flex-col lg:justify-between lg:w-1/2 relative overflow-hidden bg-slate-950 p-12">
        {/* The generated AI/HR image */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: 'url(/calrims/auth-bg-1.png)' }}
        />
        {/* Heavy gradient overlay to make text readable and blend edges */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/60 to-transparent" />

        {/* Content overlaid on image (Top Left Corner) */}
        <div className="z-20">
          <div className="flex flex-col gap-5 w-full max-w-[55rem]">
            <h2 className="text-4xl lg:text-[2.75rem] font-light uppercase tracking-[0.15em] leading-[1.3] text-white/90">
              Recruitment Intelligence & <br /> Management System
            </h2>
            <div className="inline-flex w-max items-center justify-center rounded-lg border border-white/10 bg-slate-950/40 px-4 py-2 backdrop-blur-md">
              <span className="text-xs font-bold tracking-[0.2em] uppercase text-white/90">
                BY {companyName.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        {/* Content overlaid on image (Bottom) */}
        <div className="relative z-10 mt-8 flex flex-col justify-end w-full max-w-2xl text-slate-100">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="space-y-6"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/20 border border-primary/30 backdrop-blur-md">
              <Sparkles className="h-4 w-4 text-primary-foreground" />
              <span className="text-sm font-semibold tracking-wide uppercase text-primary-foreground">Next-Gen Hiring</span>
            </div>

            <h1 className="text-3xl xl:text-4xl font-semibold leading-tight tracking-normal text-white mb-4">
              Intelligence meets intention.
            </h1>

            <p className="text-lg xl:text-xl text-slate-300 max-w-lg mb-8 leading-relaxed">
              Experience the advanced AI-driven talent acquisition platform.
            </p>

            <div className="grid grid-cols-2 gap-6 pt-6 border-t border-slate-700/50">
              <div className="flex items-start gap-4">
                <div className="mt-1 bg-emerald-500/20 p-2 rounded-lg text-emerald-400">
                  <Brain className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-white">Smart Parsing</h4>
                  <p className="text-sm text-slate-400">Contextual talent mapping</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="mt-1 bg-blue-500/20 p-2 rounded-lg text-blue-400">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-white">Unbiased Scoring</h4>
                  <p className="text-sm text-slate-400">Pure signal, zero noise</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* RIGHT COLUMN: Interactive Form */}
      <div className="w-full lg:w-1/2 flex flex-col items-center justify-center p-8 sm:p-12 lg:p-16 xl:p-24 relative overflow-y-auto lg:min-h-0 bg-background/95">
        
        {/* Subtle background decoration for right side */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
           <div className="absolute inset-0 bg-muted/20" />
        </div>

        <div className="w-full max-w-md relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            {/* Logo for mobile only (desktop has the massive image) */}
            <div className="flex items-center gap-3 lg:hidden mb-12">
               <img src={companyLogo} alt="Logo" className="h-8 w-auto object-contain max-w-[120px]" />
               <span className="text-lg font-semibold tracking-normal">{companyName}</span>
            </div>

            <div className="space-y-2 mb-10">
              <h2 className="text-2xl font-semibold tracking-normal text-foreground">Sign In</h2>
              <p className="text-muted-foreground">
                {searchParams.get('role') === 'hr' 
                  ? 'Log into your secure administrative portal.' 
                  : 'Log into your candidate portal.'}
              </p>
            </div>
          </motion.div>

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                  animate={{ opacity: 1, height: 'auto', marginBottom: 20 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  className="overflow-hidden"
                >
                  <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-sm font-semibold flex items-center gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse shrink-0" />
                    {error}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              <InputField
                id="email" label="Email Address" type="email"
                placeholder="name@company.com" value={email}
                onChange={(e) => setEmail(e.target.value)}
                icon={Mail} disabled={isSubmitting}
                autoComplete="email"
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="space-y-1.5"
            >
              <div className="flex justify-between items-center px-1">
                <label htmlFor="password" className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Password
                </label>
                <Link href="/auth/forgot-password" className="text-xs font-bold text-primary hover:underline transition-all">
                  Forgot?
                </Link>
              </div>
              <div className="relative group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/70 group-focus-within:text-primary transition-colors z-10 pointer-events-none">
                  <Lock className="h-5 w-5" />
                </div>
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  disabled={isSubmitting}
                  required
                  className={cn("h-11 pl-10 pr-10", isSubmitting && "opacity-50 cursor-not-allowed")}
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    setShowPassword(!showPassword)
                  }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-primary transition-colors focus:outline-none z-10"
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
            </motion.div>

            <motion.div 
               initial={{ opacity: 0, y: 20 }}
               animate={{ opacity: 1, y: 0 }}
               transition={{ duration: 0.5, delay: 0.3 }}
               className="pt-4"
            >
              <Button
                type="submit"
                disabled={isSubmitting || isLoading}
                className="w-full h-11 font-semibold shadow-md shadow-primary/10 flex items-center justify-center gap-2 group"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Signing In...</span>
                  </>
                ) : (
                  <>
                    <span>Sign In</span>
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </Button>
            </motion.div>
          </form>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="mt-10 text-center"
          >
            <p className="text-sm font-medium text-muted-foreground">
              Don't have an enterprise account?{' '}
              <Link href="/auth/register" className="text-foreground font-bold hover:text-primary transition-colors underline underline-offset-4">
                Register here
              </Link>
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  )
}

function InputField({ id, label, type, placeholder, value, onChange, icon: Icon, disabled, autoComplete }: {
  id: string,
  label: string,
  type: string,
  placeholder: string,
  value: string,
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void,
  icon: LucideIcon,
  disabled: boolean,
  autoComplete?: string,
}) {
  return (
    <div className="group space-y-1.5">
      <label htmlFor={id} className="text-xs font-bold text-muted-foreground uppercase tracking-wider px-1 inline-block group-focus-within:text-primary transition-colors">
        {label}
      </label>
      <div className="relative">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/70 group-focus-within:text-primary transition-colors z-10 pointer-events-none">
          <Icon className="h-5 w-5" />
        </div>
        <Input
          id={id}
          name={id}
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete={autoComplete ?? id}
          required
          className={cn(
            "h-11 pl-10",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        />
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <React.Suspense fallback={
      <div className="min-h-screen flex-1 flex items-center justify-center bg-background w-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    }>
      <LoginContent />
    </React.Suspense>
  )
}
