'use client'

import React, { useState, useEffect, Suspense, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getApiBaseUrl } from '@/lib/config'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function InterviewAccessForm() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [accessKey, setAccessKey] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (emailVal?: string, keyVal?: string) => {
    const finalEmail = emailVal ?? email
    const finalKey = keyVal ?? accessKey
    if (!finalEmail || !finalKey) return
    if (loading) return
    
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/interviews/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: finalEmail, access_key: finalKey })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Access failed')
      // Store interview JWT separately to avoid clobbering global HR/admin auth.
      sessionStorage.setItem('interview_token', data.access_token)
      if (data.proctoring_secret) {
        sessionStorage.setItem('proctoring_secret', data.proctoring_secret)
      }
      document.cookie = `interview_token=${data.access_token}; path=/; max-age=14400; SameSite=Strict`;
      router.push('/interview/' + data.interview_id)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const e = searchParams.get('email')
  const k = searchParams.get('key')

  useEffect(() => {
    if (e) setEmail(e)
    if (k) setAccessKey(k)
    if (e || k) {
      // Securely clear URL parameters from history to prevent plaintext key exposure in address bar
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [e, k])

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-accent/10 flex items-center justify-center p-4 relative overflow-hidden">
        {/* Subtle background decoration */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
           <div className="absolute top-[-10%] right-[-10%] w-[350px] h-[350px] bg-primary/8 rounded-full blur-[120px] animate-pulse duration-[8s]" />
           <div className="absolute bottom-[-10%] left-[-10%] w-[300px] h-[300px] bg-accent/8 rounded-full blur-[100px] animate-pulse duration-[8s] delay-1000" />
        </div>

        <Card className="max-w-md w-full bg-card/45 backdrop-blur-xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] rounded-2xl overflow-hidden relative z-10">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-primary to-accent" />
            <CardHeader className="text-center pt-8 pb-4">
                <CardTitle className="text-3xl font-black text-foreground tracking-tight">Interview Access</CardTitle>
                <CardDescription className="text-sm font-semibold text-muted-foreground mt-1">Enter your credentials to enter the assessment room.</CardDescription>
            </CardHeader>
            <CardContent>
                {(e || k) && (
                  <div className="bg-amber-500/10 border border-amber-500/25 rounded-2xl p-4 text-xs text-amber-800 dark:text-amber-300 mb-4 flex items-start gap-2 animate-in fade-in duration-300">
                    <span className="text-sm">⚠️</span>
                    <span className="font-semibold leading-relaxed"><strong>Security Notice:</strong> Please do not share this access link. It contains a unique key meant solely for your interview session.</span>
                  </div>
                )}
                <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="space-y-4">
                    {error && <p className="text-red-500 text-sm text-center font-bold">{error}</p>}
                    <div className="space-y-1">
                        <Label htmlFor="email" className="text-xs font-bold uppercase tracking-wider text-muted-foreground ml-1">Email</Label>
                        <Input
                            id="email"
                            type="email"
                            placeholder="you@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            disabled={loading}
                            className="h-12 bg-muted/40 focus:bg-background/80 border-border/80 focus-visible:ring-4 focus-visible:ring-primary/10 hover:border-primary/40 focus-visible:border-primary rounded-xl transition-all"
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="key" className="text-xs font-bold uppercase tracking-wider text-muted-foreground ml-1">Access Key</Label>
                        <Input
                            id="key"
                            type="text"
                            placeholder="Your access key"
                            value={accessKey}
                            onChange={(e) => setAccessKey(e.target.value.trim())}
                            required
                            disabled={loading}
                            className="h-12 bg-muted/40 focus:bg-background/80 border-border/80 focus-visible:ring-4 focus-visible:ring-primary/10 hover:border-primary/40 focus-visible:border-primary rounded-xl transition-all"
                        />
                    </div>
                    <Button type="submit" className="w-full h-12 rounded-xl font-bold bg-primary hover:bg-primary/95 text-primary-foreground active:scale-[0.99] hover:shadow-lg hover:shadow-primary/20 transition-all duration-200 cursor-pointer" disabled={loading || !email || !accessKey}>
                        {loading ? 'Verifying...' : 'Enter Interview'}
                    </Button>
                </form>
            </CardContent>
        </Card>
    </div>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <InterviewAccessForm />
    </Suspense>
  )
}
