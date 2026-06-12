'use client'

import React from 'react'
import { useAuth } from '@/app/dashboard/lib/auth-context'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { User, Mail, Shield, Calendar, Activity, CheckCircle2, Building, TrendingUp, Award, Users, CheckCircle, Camera, Link as LinkIcon, RefreshCw } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import useSWR from 'swr'
import { fetcher } from '@/app/dashboard/lib/swr-fetcher'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { APIClient } from '@/app/dashboard/lib/api-client'
import { toast } from 'sonner'
import { useBranding } from '@/lib/branding-client'

const AVATAR_STYLES = ['avataaars', 'bottts', 'adventurer', 'fun-emoji', 'pixel-art', 'lorelei']

export default function ProfilePage() {
    const { user, refreshUser } = useAuth()
    const { branding } = useBranding()
    const [isUpdating, setIsUpdating] = React.useState(false)
    const [customUrl, setCustomUrl] = React.useState('')
    const [isPickerOpen, setIsPickerOpen] = React.useState(false)
    
    // Fetch dashboard data to show user impact
    const { data: dashboardData } = useSWR<any>(
        '/api/analytics/dashboard',
        (url: string) => fetcher<any>(url)
    )

    if (!user) return null

    const handleUpdateAvatar = async (url: string) => {
        setIsUpdating(true)
        try {
            await APIClient.put('/api/auth/me', { profile_image_url: url })
            await refreshUser()
            toast.success('Profile logo updated successfully')
            setIsPickerOpen(false)
        } catch (error) {
            toast.error('Failed to update profile logo')
        } finally {
            setIsUpdating(false)
        }
    }

    const metrics = dashboardData?.recruitment_metrics || {
        total_candidates: dashboardData?.total_applications || 0,
        hiring_success_rate: dashboardData?.success_rate || 0,
        offers_released: dashboardData?.offers_released || 0
    }

    const avgScore = dashboardData?.candidate_metrics?.avg_composite_score || dashboardData?.average_score || 0

    const initials = user.full_name
        .trim()
        .split(/\s+/)
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)

    const avatarUrl = user.profile_image_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(user.email)}`

    const formatDate = (dateStr: string) => {
        try {
            return new Date(dateStr).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            })
        } catch (e) {
            return dateStr
        }
    }

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header / Hero Section */}
            <div className="relative h-64 rounded-3xl bg-gradient-to-br from-[oklch(0.14_0.04_260)] via-[oklch(0.18_0.05_255)] to-[oklch(0.12_0.03_250)] border border-white/10 overflow-hidden shadow-2xl shadow-black/30">
                {/* Grid overlay */}
                <div className="absolute inset-0 opacity-[0.07]" style={{backgroundImage:'linear-gradient(to right,rgba(255,255,255,0.3)1px,transparent 0),linear-gradient(to bottom,rgba(255,255,255,0.3)1px,transparent 0)',backgroundSize:'48px 48px'}} />
                {/* Color orbs */}
                <div className="absolute -top-12 -left-12 w-56 h-56 rounded-full bg-primary/30 blur-3xl opacity-60" />
                <div className="absolute -bottom-8 right-10 w-48 h-48 rounded-full bg-blue-600/20 blur-3xl opacity-50" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                
                <div className="absolute bottom-10 left-10 flex items-center gap-6 z-10">
                    <div className="relative group">
                        <div className="absolute -inset-1 bg-gradient-to-tr from-primary to-accent rounded-full blur opacity-40" />
                        
                        <Dialog open={isPickerOpen} onOpenChange={setIsPickerOpen}>
                            <DialogTrigger asChild>
                                <button className="relative block group active:scale-[0.99] transition-all duration-200">
                                    <Avatar className="h-28 w-28 border-4 border-slate-900 shadow-2xl transition-transform group-hover:scale-105">
                                        <AvatarImage src={avatarUrl} alt={user.full_name} className="object-cover bg-slate-800" />
                                        <AvatarFallback className="text-3xl font-black bg-primary/10 text-primary">{initials}</AvatarFallback>
                                    </Avatar>
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Camera className="h-8 w-8 text-white" />
                                    </div>
                                </button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[500px] rounded-3xl border border-border/80 bg-background/95 backdrop-blur-xl shadow-2xl p-6">
                                <DialogHeader>
                                    <DialogTitle>Customize Profile Logo</DialogTitle>
                                    <DialogDescription>
                                        Select a professional avatar style or provide a custom image URL.
                                    </DialogDescription>
                                </DialogHeader>
                                
                                <div className="space-y-6 py-4">
                                    <div className="grid grid-cols-3 gap-4">
                                        {AVATAR_STYLES.map((style) => {
                                            const url = `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(user.email + style)}`
                                            return (
                                                <button
                                                    key={style}
                                                    onClick={() => handleUpdateAvatar(url)}
                                                    className="flex flex-col items-center gap-2 p-3 rounded-2xl hover:bg-primary/5 active:scale-[0.97] transition-all duration-300 border border-transparent hover:border-primary/20 group/avatar"
                                                >
                                                    <Avatar className="h-16 w-16 shadow-sm group-hover/avatar:scale-110 group-hover/avatar:shadow-md transition-all duration-300">
                                                        <AvatarImage src={url} className="bg-slate-100" />
                                                    </Avatar>
                                                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground group-hover/avatar:text-primary transition-colors mt-1">{style.replace('-', ' ')}</span>
                                                </button>
                                            )
                                        })}
                                    </div>

                                    <div className="space-y-2 pt-4 border-t">
                                        <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Custom Image URL</Label>
                                        <div className="flex gap-2">
                                            <Input 
                                                placeholder="https://example.com/photo.jpg" 
                                                value={customUrl}
                                                onChange={(e) => setCustomUrl(e.target.value)}
                                                className="flex-1"
                                            />
                                            <Button 
                                                size="sm" 
                                                disabled={!customUrl || isUpdating}
                                                onClick={() => handleUpdateAvatar(customUrl)}
                                            >
                                                {isUpdating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </DialogContent>
                        </Dialog>
                    </div>
                    <div className="space-y-1">
                        <h1 className="text-3xl font-black text-white tracking-tight">{user.full_name}</h1>
                        <div className="flex items-center gap-2">
                            <Badge className="bg-primary/20 text-primary-foreground border-primary/30 font-bold uppercase tracking-widest text-[10px]">
                                {user.role.replace('_', ' ')}
                            </Badge>
                            <span className="text-slate-400 text-sm flex items-center gap-1">
                                <Mail className="h-3.5 w-3.5" /> {user.email}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Column: Stats & Info */}
                <div className="space-y-6">
                <Card className="bg-card/45 backdrop-blur-xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden rounded-2xl">
                        <CardHeader className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/40">
                            <CardTitle className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground">Account Information</CardTitle>
                        </CardHeader>
                        <CardContent className="pt-6 space-y-6">
                            <div className="space-y-4">
                                <InfoRow icon={Shield} label="Account Status" value="Active & Verified" valueClass="text-emerald-500 font-bold" />
                                <InfoRow icon={Calendar} label="Member Since" value={formatDate(user.created_at)} />
                                <InfoRow icon={Building} label="Department" value="Human Resources" />
                                <InfoRow icon={CheckCircle2} label="Email Verified" value="Yes" valueClass="text-blue-500" />
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-card/45 backdrop-blur-xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden rounded-2xl">
                        <CardHeader className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/40">
                            <CardTitle className="text-sm font-black uppercase tracking-[0.2em] text-primary">Your Impact</CardTitle>
                        </CardHeader>
                        <CardContent className="pt-4 space-y-6 stagger-children">
                            <ImpactMetric icon={Users} label="Candidates Managed" value={metrics.total_candidates} color="text-blue-500" />
                            <ImpactMetric icon={TrendingUp} label="Hiring Success Rate" value={`${metrics.hiring_success_rate}%`} color="text-emerald-500" />
                            <ImpactMetric icon={CheckCircle} label="Offers Released" value={metrics.offers_released} color="text-primary" />
                            <ImpactMetric icon={Award} label="Avg. Candidate Score" value={avgScore} color="text-amber-500" />
                        </CardContent>
                    </Card>
                </div>

                {/* Right Column: Narrative & Governance */}
                <div className="lg:col-span-2 space-y-6">
                    <Card className="bg-card/45 backdrop-blur-xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden rounded-2xl h-full">
                        <CardHeader className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/40">
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="text-xl font-black">Role & Governance</CardTitle>
                                    <CardDescription>Administrative privileges and system authority</CardDescription>
                                </div>
                                <Shield className="h-8 w-8 text-primary/20" />
                            </div>
                        </CardHeader>
                        <CardContent className="p-8 space-y-8">
                            <div className="prose prose-slate dark:prose-invert max-w-none">
                                <p className="text-lg leading-relaxed text-muted-foreground">
                                    As a <span className="text-foreground font-bold underline decoration-primary/30 decoration-4 underline-offset-4">{user.role.replace('_', ' ')}</span> in the {branding.productName} platform, you are granted high-level administrative access to the recruitment lifecycle. Your actions directly influence the talent acquisition strategy and organizational growth.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <FeatureBox 
                                    title="Talent Evaluation" 
                                    description="Review AI-parsed resumes and composite scores to identify top-tier talent efficiently." 
                                />
                                <FeatureBox 
                                    title="Process Management" 
                                    description="Control interview pipelines, manage stage transitions, and ensure a smooth candidate experience." 
                                />
                                <FeatureBox 
                                    title="Strategic Decisions" 
                                    description="Issue formal offers, track acceptance rates, and generate data-driven hiring reports." 
                                />
                                <FeatureBox 
                                    title="System Security" 
                                    description="All administrative actions are cryptographically logged for audit compliance and security." 
                                />
                            </div>

                            <div className="pt-6 border-t border-border/50 flex flex-col md:flex-row items-center justify-between gap-4">
                                <div className="text-xs text-muted-foreground font-medium">
                                    Last Login: {new Date().toLocaleDateString()} • Session Secure
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Administrative Link Active</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}

function InfoRow({ icon: Icon, label, value, valueClass }: any) {
    return (
        <div className="flex items-center justify-between group cursor-default">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-muted rounded-lg group-hover:bg-primary/10 group-hover:scale-105 transition-all duration-300">
                    <Icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">{label}</span>
            </div>
            <span className={`text-sm font-semibold transition-transform duration-300 group-hover:translate-x-[-2px] ${valueClass || 'text-foreground'}`}>{value}</span>
        </div>
    )
}

function ImpactMetric({ icon: Icon, label, value, color }: any) {
    return (
        <div className="flex items-center gap-4 group cursor-default">
            <div className={`p-3 rounded-2xl bg-card dark:bg-slate-900/60 shadow-sm border border-border/80 ${color} group-hover:shadow-md group-hover:scale-110 group-hover:bg-primary/5 transition-all duration-300`}>
                <Icon className="h-5 w-5" />
            </div>
            <div className="transition-transform duration-300 group-hover:translate-x-1">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{label}</p>
                <p className="text-xl font-black tabular-nums mt-0.5">{value}</p>
            </div>
        </div>
    )
}

function FeatureBox({ title, description }: any) {
    return (
        <div className="p-5 rounded-2xl bg-muted/30 border border-border/50 shadow-[0_8px_30px_rgb(0,0,0,0.02)] group cursor-default hover-premium-lift hover:border-primary/20 hover:bg-primary/[0.02] transition-all duration-300">
            <div className="flex items-start gap-3 mb-2">
                <div className="h-1.5 w-1.5 rounded-full bg-primary mt-2 shrink-0 group-hover:scale-125 transition-transform duration-200" />
                <h4 className="font-bold text-foreground group-hover:text-primary transition-colors duration-200">{title}</h4>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed pl-[18px]">{description}</p>
        </div>
    )
}

