'use client'

import React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import useSWR from 'swr'
import { fetcher } from '@/app/dashboard/lib/swr-fetcher'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft, User, Award, Users, Trophy, Medal, GitBranch } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { useRouter } from 'next/navigation'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface RankedCandidate {
    rank: number
    id: number
    candidate_name: string
    composite_score: number
    recommendation: string
    status: string
}

export default function LeaderboardPage() {
    const router = useRouter()
    const params = useParams()
    const jobId = params.id
    const { data: ranked = [], isLoading } = useSWR<RankedCandidate[]>(`/api/applications/ranking/${jobId}`, fetcher)

    const [rankingPage, setRankingPage] = React.useState(1)
    const [pageSize, setPageSize] = React.useState(10)

    const sortedRanked = React.useMemo(() => {
        return [...ranked].sort((a, b) => (b.composite_score || 0) - (a.composite_score || 0))
    }, [ranked])

    const totalPages = Math.ceil(sortedRanked.length / pageSize)
    const paginatedRanked = React.useMemo(() => {
        const start = (rankingPage - 1) * pageSize
        return sortedRanked.slice(start, start + pageSize)
    }, [sortedRanked, rankingPage, pageSize])

    if (isLoading) return (
        <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 animate-in fade-in duration-500">
            <div className="relative">
                <div className="animate-spin rounded-full h-16 w-16 border-4 border-primary/20 border-t-primary shadow-lg"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                    <Trophy className="h-6 w-6 text-primary animate-pulse" />
                </div>
            </div>
            <p className="text-sm font-bold text-muted-foreground animate-pulse tracking-widest uppercase mt-2">Computing Leaderboard...</p>
        </div>
    )

    const getRankIcon = (rank: number) => {
        if (rank === 1) return <Trophy className="h-5 w-5 text-yellow-500" />
        if (rank === 2) return <Medal className="h-5 w-5 text-muted-foreground" />
        if (rank === 3) return <Award className="h-5 w-5 text-amber-600" />
        return (
            <span className="h-6 w-6 rounded-full bg-muted border border-border/30 text-[11px] font-mono font-bold text-muted-foreground flex items-center justify-center shadow-sm">
                {rank}
            </span>
        )
    }

    const getRecommendationBadge = (rec: string) => {
        if (rec === 'Strong Hire') return <span className="capsule-badge capsule-badge-success">Strong Hire</span>
        if (rec === 'Hire') return <span className="capsule-badge capsule-badge-success">Hire</span>
        if (rec === 'Borderline') return <span className="capsule-badge capsule-badge-warning">Borderline</span>
        if (rec === 'Reject') return <span className="capsule-badge capsule-badge-destructive">Reject</span>
        return <span className="capsule-badge capsule-badge-neutral">N/A</span>
    }

    return (
        <div className="flex flex-col lg:h-[calc(100vh-7.5rem)] gap-6 overflow-hidden animate-in fade-in duration-700">
            <div className="flex flex-col gap-4 shrink-0 px-4 pt-4">
                <Button 
                    variant="ghost" 
                    onClick={() => router.push('/dashboard/hr/pipeline')} 
                    className="gap-2 text-muted-foreground hover:text-foreground h-auto p-0 flex items-center transition-colors group w-fit"
                >
                    <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
                    <span className="text-sm font-bold">Back to Pipeline</span>
                </Button>
                <div className="flex items-center justify-between gap-0">
                    <PageHeader
                        title="AI Candidate Ranking"
                        description="Weighted composite score: 40% Resume + 30% Aptitude + 30% AI Interview"
                        icon={Award}
                    />

                    <div className="inline-flex items-center rounded-xl border border-border/80 bg-muted/20 backdrop-blur-md p-1 shadow-sm">
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => router.push(`/dashboard/hr/pipelines/${jobId}`)}
                            className="rounded-lg h-8 px-3 text-muted-foreground active:scale-[0.98] hover:text-foreground transition-all duration-200"
                        >
                            <GitBranch className="h-4 w-4 mr-1.5" />
                            Pipeline View
                        </Button>
                        <Button
                            size="sm"
                            className="rounded-lg h-8 px-3 active:scale-[0.98] transition-all duration-200"
                        >
                            <Trophy className="h-4 w-4 mr-1.5" />
                            Candidate Ranking
                        </Button>
                    </div>
                </div>
            </div>
    
            <Card className="-mt-4 h-full flex flex-col shadow-[0_8px_30px_rgb(0,0,0,0.02)] border-border/80 !py-0 !gap-0 bg-card/80 backdrop-blur-md rounded-2xl overflow-hidden">
                <CardHeader className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/40 pb-4 shrink-0">
                    <CardTitle className="text-lg flex items-center pt-5 gap-2">
                        <Users className="h-5 w-5 text-primary"/>
                        Job Leaderboard
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 overflow-auto p-0">
                    <Table>
                        <TableHeader className="bg-muted/30 border-b border-border/40">
                            <TableRow className="hover:bg-transparent border-none">
                                <TableHead className="w-[100px] font-bold text-foreground">Rank</TableHead>
                                <TableHead className="font-bold text-foreground">Candidate Name</TableHead>
                                <TableHead className="font-bold text-foreground">Status</TableHead>
                                <TableHead className="font-bold text-foreground text-center">Composite Score</TableHead>
                                <TableHead className="font-bold text-foreground text-center">AI Recommendation</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody className="stagger-children">
                            {paginatedRanked.map((cand, index) => {
                                const actualRank = (rankingPage - 1) * pageSize + index + 1
                                return (
                                    <TableRow key={cand.id} className="premium-table-row border-b border-border/20 last:border-b-0 py-4 h-16">
                                        <TableCell className="font-medium align-middle">
                                            <div className="flex items-center  gap-3 pl-2">
                                                {getRankIcon(actualRank)}
                                            </div>
                                        </TableCell>
                                        <TableCell className="align-middle">
                                            
                                            <Link 
                                                href={`/dashboard/hr/applications/${cand.id}`} 
                                                className="flex items-center gap-3 group cursor-pointer"
                                            >
                                                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                                                    <User className="h-4 w-4 text-primary" />
                                                </div>
                                                <span className="font-semibold text-foreground group-hover:text-primary transition-colors">
                                                    {cand.candidate_name}
                                                </span>
                                            </Link>
                                        </TableCell>
                                        <TableCell className="align-middle capitalize text-muted-foreground font-medium">
                                            {cand.status.replace(/_/g, ' ')}
                                        </TableCell>
                                        <TableCell className="text-center align-middle">
                                            <div className="inline-flex items-center justify-center p-2 rounded-lg bg-primary/10 text-primary font-mono font-black text-lg min-w-[60px] border border-primary/20 shadow-sm hover:scale-105 transition-transform duration-200 cursor-default">
                                                {cand.composite_score || 0}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center align-middle">
                                            {getRecommendationBadge(cand.recommendation)}
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 pt-6 border-t border-border mx-4 mb-4">
                    <div className="text-sm text-muted-foreground font-medium">
                        Showing <span className="font-semibold text-foreground/80">{Math.min(pageSize, sortedRanked.length)}</span> of <span className="font-semibold text-foreground/80">{sortedRanked.length}</span> candidates
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-6">
                        <div className="text-sm font-medium text-muted-foreground">
                            Page <span className="text-foreground/80 font-semibold">{rankingPage}</span> of {totalPages}
                        </div>
                        
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setRankingPage(prev => Math.max(1, prev - 1))}
                                disabled={rankingPage <= 1 || isLoading}
                                className="h-8 px-4 rounded-xl font-bold bg-background dark:bg-muted border-border transition-all shadow-sm active:scale-95 disabled:opacity-50"
                            >
                                Previous
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setRankingPage(prev => Math.min(totalPages, prev + 1))}
                                disabled={rankingPage >= totalPages || isLoading}
                                className="h-8 px-4 rounded-xl font-bold bg-background dark:bg-muted border-border transition-all shadow-sm active:scale-95 disabled:opacity-50"
                            >
                                Next
                            </Button>
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-muted-foreground">Show</span>
                            <Select
                                value={String(pageSize)}
                                onValueChange={(val) => {
                                    setPageSize(Number(val));
                                    setRankingPage(1);
                                }}
                            >
                                <SelectTrigger className="h-8 w-[75px] rounded-xl border-border bg-background font-bold shadow-none focus:ring-0">
                                    <SelectValue placeholder="10" />
                                </SelectTrigger>
                                <SelectContent className="min-w-[70px]">
                                    {[5, 10, 20, 50, 100].map((size) => (
                                        <SelectItem key={size} value={String(size)} className="font-bold">
                                            {size}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>
        </div>
    )
}
