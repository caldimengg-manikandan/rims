'use client'

import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckCircle2, XCircle, Loader2, PartyPopper, Building2, ShieldAlert, AlertCircle, FileText, Calendar, Briefcase } from 'lucide-react'
import { toast } from 'sonner'
import { APIClient } from '@/app/dashboard/lib/api-client'

interface OfferData {
    company_name?: string
    candidate_name?: string
    job_title?: string
    joining_date?: string
    candidate_email?: string
    pdf_url?: string
}

export default function OfferRespondPage() {
    const searchParams = useSearchParams()
    const token = searchParams.get('token')
    const type = searchParams.get('type') // initial intent
    
    const [view, setView] = useState<'loading' | 'preview' | 'success' | 'error'>('loading')
    const [offerData, setOfferData] = useState<OfferData | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [message, setMessage] = useState('')
    const [finalStatus, setFinalStatus] = useState<'accept' | 'reject' | null>(null)

    useEffect(() => {
        if (!token) {
            setView('error')
            setMessage('Invalid response link. Please contact HR.')
            return
        }
        fetchOfferDetails()
    }, [token])

    const fetchOfferDetails = async () => {
        try {
            const data = await APIClient.get<OfferData>(`/api/onboarding/offer?token=${token}`)
            setOfferData(data)
            setView('preview')
        } catch (error: any) {
            console.error('Fetch error:', error)
            setView('error')
            setMessage(error.message || 'Network error while loading offer.')
        }
    }

    const submitResponse = async (decisionType: 'accept' | 'reject') => {
        setIsSubmitting(true)
        try {
            await APIClient.post('/api/onboarding/respond', { 
                token, 
                response_type: decisionType 
            })
            setFinalStatus(decisionType)
            setView('success')
        } catch (error: any) {
            setView('error')
            setMessage(error.message || 'Failed to submit response')
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="min-h-screen bg-gradient-to-tr from-primary/10 via-background to-accent/10 flex items-center justify-center p-6 relative overflow-hidden">
            {/* Subtle background decoration */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
               <div className="absolute top-[-10%] right-[-10%] w-[400px] h-[400px] bg-primary/8 rounded-full blur-[120px] animate-pulse duration-[8s]" />
               <div className="absolute bottom-[-10%] left-[-10%] w-[350px] h-[350px] bg-accent/8 rounded-full blur-[100px] animate-pulse duration-[8s] delay-1000" />
            </div>

            <Card className="max-w-3xl w-full bg-card/45 backdrop-blur-xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] rounded-2xl overflow-hidden relative z-10">
                <div className="h-1.5 bg-gradient-to-r from-primary to-accent w-full" />
                
                {view === 'loading' && (
                    <CardContent className="py-20 text-center">
                        <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto opacity-70" />
                        <p className="mt-4 text-muted-foreground font-bold animate-pulse">Loading your offer details...</p>
                    </CardContent>
                )}

                {view === 'preview' && offerData && (
                    <>
                        <CardHeader className="text-center pt-10 pb-6 border-b border-border/50 bg-gradient-to-b from-muted/30 to-transparent">
                            <div className="flex justify-center mb-4">
                                <div className="p-4 bg-primary/10 border border-primary/20 rounded-2xl">
                                    <FileText className="h-8 w-8 text-primary" />
                                </div>
                            </div>
                            <CardTitle className="text-3xl font-black text-foreground tracking-tight">{offerData.company_name}</CardTitle>
                            <CardDescription className="font-semibold text-muted-foreground text-sm uppercase tracking-wider mt-1">Official Employment Offer Letter</CardDescription>
                        </CardHeader>
                        <CardContent className="py-10 px-10">
                            <div className="space-y-8">
                                <div className="bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/25 p-6 rounded-2xl shadow-sm">
                                    <h3 className="text-emerald-800 dark:text-emerald-300 font-extrabold flex items-center gap-2 mb-4">
                                        <CheckCircle2 className="h-5 w-5" />
                                        Offer Summary
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-1">
                                            <p className="text-xs text-emerald-600/90 dark:text-emerald-400 font-bold uppercase tracking-wider">Candidate Name</p>
                                            <p className="text-lg font-black text-foreground">{offerData.candidate_name}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-xs text-emerald-600/90 dark:text-emerald-400 font-bold uppercase tracking-wider">Role</p>
                                            <p className="text-lg font-black text-foreground">{offerData.job_title}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-xs text-emerald-600/90 dark:text-emerald-400 font-bold uppercase tracking-wider">Joining Date</p>
                                            <p className="text-lg font-black text-foreground">
                                                {offerData.joining_date 
                                                    ? new Date(offerData.joining_date).toLocaleDateString(undefined, { dateStyle: 'long' }) 
                                                    : 'TBD'}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {offerData.pdf_url && (
                                    <div className="flex justify-end">
                                        <Button
                                            variant="link"
                                            size="sm"
                                            className="text-xs text-primary font-bold hover:no-underline"
                                            onClick={() => window.open(offerData.pdf_url, '_blank')}
                                        >
                                            Download PDF Document
                                        </Button>

                                    </div>
                                )}

                                <div className="text-center space-y-4">
                                    <p className="text-sm text-muted-foreground px-4 leading-relaxed font-semibold">
                                        Please review the details above. By clicking **Accept Offer**, you agree to the terms mentioned in the offer letter PDF shown above.
                                    </p>
                                    
                                    <div className="flex flex-col md:flex-row gap-4 pt-4">
                                        <Button 
                                            size="lg"
                                            className="flex-1 h-14 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold rounded-xl shadow-lg hover:shadow-emerald-600/20 active:scale-[0.99] transition-all cursor-pointer"
                                            onClick={() => submitResponse('accept')}
                                            disabled={isSubmitting}
                                        >
                                            {isSubmitting ? <Loader2 className="animate-spin h-5 w-5" /> : 'Accept Offer'}
                                        </Button>
                                        <Button 
                                            size="lg"
                                            variant="outline"
                                            className="flex-1 h-14 border-border/80 hover:bg-red-500/10 hover:text-red-600 hover:border-red-200 font-extrabold rounded-xl active:scale-[0.99] transition-all cursor-pointer"
                                            onClick={() => submitResponse('reject')}
                                            disabled={isSubmitting}
                                        >
                                            Decline Offer
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </>
                )}

                {view === 'success' && (
                    <CardContent className="py-20 px-10 text-center space-y-6 animate-in zoom-in-95 duration-500">
                        {finalStatus === 'accept' ? (
                            <>
                                <div className="flex justify-center">
                                    <div className="relative">
                                        <CheckCircle2 className="h-24 w-24 text-emerald-500" />
                                        <PartyPopper className="absolute -top-4 -right-4 h-12 w-12 text-amber-500 animate-bounce" />
                                    </div>
                                </div>
                                <h2 className="text-3xl font-black text-foreground tracking-tight">Welcome Aboard!</h2>
                                <p className="text-muted-foreground text-base leading-relaxed font-medium">
                                    You have successfully <strong>Accepted</strong> the offer. 
                                    Our HR team will be in touch shortly to begin your onboarding journey.
                                </p>
                            </>
                        ) : (
                            <>
                                <div className="flex justify-center">
                                    <XCircle className="h-24 w-24 text-slate-300" />
                                </div>
                                <h2 className="text-3xl font-black text-foreground tracking-tight">Offer Declined</h2>
                                <p className="text-muted-foreground text-base leading-relaxed font-medium">
                                    We respect your decision and wish you the very best in your future endeavors.
                                </p>
                            </>
                        )}
                        <div className="pt-8 text-sm text-muted-foreground font-bold">
                            You can close this window now
                        </div>
                    </CardContent>
                )}

                {view === 'error' && (
                    <CardContent className="py-16 px-10 text-center space-y-6 animate-in zoom-in-95 duration-500">
                        <div className="flex justify-center">
                            <div className="p-4 bg-red-500/10 border border-red-500/25 rounded-2xl">
                                <ShieldAlert className="h-12 w-12 text-destructive" />
                            </div>
                        </div>
                        <h2 className="text-3xl font-black text-foreground tracking-tight">Unable to Proceed</h2>
                        <div className="p-4 bg-destructive/10 text-destructive border border-destructive/20 rounded-xl text-sm font-semibold">
                            {message}
                        </div>
                        
                        {!isSubmitting ? (
                            <div className="space-y-4 pt-6 border-t border-border/50">
                                <p className="text-muted-foreground text-xs font-semibold leading-relaxed">
                                    Experiencing an issue? Raise a support ticket and our team will get back to you.
                                </p>
                                
                                <div className="space-y-4 text-left">
                                    <div className="space-y-1">
                                        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider ml-1">Your Registered Email</p>
                                        <input 
                                            type="email"
                                            className="w-full p-3 text-sm border border-border/80 bg-muted/30 focus:bg-background/80 rounded-xl focus:ring-4 focus:ring-primary/10 hover:border-primary/40 focus:border-primary outline-none transition-all"
                                            placeholder="Enter the email you applied with..."
                                            value={offerData?.candidate_email || ''}
                                            onChange={(e) => setOfferData(prev => ({ ...prev, candidate_email: e.target.value }))}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider ml-1">Describe the Problem</p>
                                        <textarea 
                                            className="w-full min-h-[100px] p-4 text-sm border border-border/80 bg-muted/30 focus:bg-background/80 rounded-xl focus:ring-4 focus:ring-primary/10 hover:border-primary/40 focus:border-primary outline-none transition-all"
                                            placeholder="e.g. My joining date is incorrect, or the Accept button is showing an error..."
                                            value={message}
                                            onChange={(e) => setMessage(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <Button 
                                    disabled={!message || !(offerData?.candidate_email)}
                                    onClick={async () => {
                                        setIsSubmitting(true)
                                        const emailToUse = offerData?.candidate_email?.trim()
                                        try {
                                            const d = await APIClient.post<any>('/api/support/ticket', { 
                                                email: emailToUse, 
                                                access_key: token || 'onboarding_error', 
                                                grievance_type: 'Onboarding Issue', 
                                                description: message 
                                            })
                                            setMessage('')
                                            setOfferData(prev => ({...prev, candidate_email: emailToUse}))
                                            setView('error')
                                            toast.success("Ticket #" + d.id + " has been raised successfully. We will contact you at " + emailToUse)
                                        } catch (e: any) {
                                            // Auto-fallback if it fails (using magic key)
                                            try {
                                                const d2 = await APIClient.post<any>('/api/support/ticket', { 
                                                    email: emailToUse, 
                                                    access_key: 'onboarding_error', 
                                                    grievance_type: 'Onboarding Issue (Link Error)', 
                                                    description: `[AUTO_FALLBACK_LINK_ERROR]\nOriginal Token: ${token}\nMessage: ${message}` 
                                                 })
                                                toast.success("Ticket #" + d2.id + " raised using onboarding fallback. We found your record.")
                                            } catch (e2: any) {
                                                toast.error(e.message || 'Failed to raise ticket.')
                                            }
                                        } finally {
                                            setIsSubmitting(false)
                                        }
                                    }} 
                                    className="w-full h-12 rounded-xl font-bold bg-primary hover:bg-primary/90 text-primary-foreground active:scale-[0.99] transition-all cursor-pointer"
                                >
                                    Raise Support Ticket
                                </Button>
                            </div>
                        ) : (
                            <div className="flex justify-center py-4">
                                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            </div>
                        )}
                    </CardContent>
                )}
            </Card>
        </div>
    )
}
