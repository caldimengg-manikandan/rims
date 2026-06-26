'use client'

import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { APIClient } from '@/app/dashboard/lib/api-client'
import { useAuth } from '@/app/dashboard/lib/auth-context'
import useSWR, { mutate as globalMutate } from 'swr'
import { fetcher } from '@/app/dashboard/lib/swr-fetcher'
import { cn } from '@/app/dashboard/lib/utils'

import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Bell, ChevronRight, X } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'

interface Notification {
    id: number
    notification_type: string
    title: string
    message: string
    is_read: boolean
    related_application_id?: number
    created_at: string
}

function formatNotificationDate(dateStr: string) {
    try {
        const date = new Date(dateStr)
        const now = new Date()
        const diffMs = now.getTime() - date.getTime()
        const diffMins = Math.floor(diffMs / 60000)
        const diffHours = Math.floor(diffMins / 60)
        const diffDays = Math.floor(diffHours / 24)

        if (diffMins < 1) return 'Just now'
        if (diffMins < 60) return `${diffMins}m ago`
        if (diffHours < 24) return `${diffHours}h ago`
        if (diffDays === 1) return 'Yesterday'
        if (diffDays < 7) return `${diffDays}d ago`
        
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    } catch {
        return ''
    }
}

export function NotificationBell() {
    const { user } = useAuth()
    const router = useRouter()
    const [isOpen, setIsOpen] = useState(false)
    const canViewNotifications = ['super_admin', 'hr'].includes(user?.role || '')

    const { data: notifications = [], mutate } = useSWR<Notification[]>(
        canViewNotifications ? '/api/notifications?limit=50' : null,
        (url: string) => fetcher<Notification[]>(url),
        {
            refreshInterval: 300000,
            dedupingInterval: 60000,
            revalidateOnFocus: false,
            revalidateOnReconnect: false,
        }
    )

    const markAsRead = useCallback(async (id: number) => {
        // Instantly update the local SWR cache (optimistic update)
        mutate(prev =>
            prev?.map(n => n.id === id ? { ...n, is_read: true } : n),
            false
        )

        try {
            await APIClient.put(`/api/notifications/${id}/read`, {})
            mutate() // Background revalidation to sync with the server
        } catch {
            mutate() // Revert local cache on failure
        }
    }, [mutate])

    const deleteNotification = useCallback(async (id: number) => {
        // Instantly update the local SWR cache (optimistic update)
        mutate(prev => prev?.filter(n => n.id !== id), false)

        try {
            await APIClient.delete(`/api/notifications/${id}`)
            mutate() // Background revalidation to sync with the server
        } catch {
            mutate() // Revert local cache on failure
        }
    }, [mutate])

    const notificationsArray = Array.isArray(notifications) ? notifications : []
    const unreadCount = useMemo(() => notificationsArray.filter(n => !n.is_read).length, [notificationsArray])

    const markAllAsRead = useCallback(async () => {
        const unreadIds = notificationsArray.filter(n => !n.is_read).map(n => n.id)
        if (unreadIds.length === 0) return

        try {
            mutate(prev => prev?.map(n => ({ ...n, is_read: true })), false)
            await Promise.all(unreadIds.map(id => APIClient.put(`/api/notifications/${id}/read`, {})))
            mutate()
        } catch {
            mutate()
        }
    }, [notificationsArray, mutate])

    const sortedNotifications = [...notificationsArray].sort((a, b) => {
        if (a.is_read !== b.is_read) return a.is_read ? 1 : -1
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

    if (!canViewNotifications) return null

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="group relative h-10 w-10 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all active:scale-95 duration-200">
                    <style>{`
                        @keyframes bell-ring {
                            0%, 100% { transform: rotate(0); }
                            15% { transform: rotate(12deg); }
                            30% { transform: rotate(-12deg); }
                            45% { transform: rotate(8deg); }
                            60% { transform: rotate(-8deg); }
                            75% { transform: rotate(4deg); }
                            90% { transform: rotate(-4deg); }
                        }
                        .group:hover .animate-bell {
                            animation: bell-ring 0.6s ease-in-out;
                            transform-origin: top center;
                        }
                    `}</style>
                    <Bell className="h-5 w-5 animate-bell transition-transform" />
                    {unreadCount > 0 && (
                        <span 
                            key={unreadCount} 
                            className="absolute -top-0.5 -right-0.5 flex min-w-[18px] h-[18px] px-1 items-center justify-center rounded-full bg-destructive text-[9px] font-black text-destructive-foreground ring-2 ring-background animate-in zoom-in duration-300 pointer-events-none shadow-sm shadow-destructive/25 animate-pulse"
                        >
                            {unreadCount}
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[360px] sm:w-[410px] p-0 shadow-2xl border border-border/80 bg-card/95 backdrop-blur-xl overflow-hidden rounded-2xl" align="end" sideOffset={8}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent">
                    <h4 className="font-bold text-sm text-foreground">Notifications</h4>
                    {unreadCount > 0 && (
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-primary bg-primary/10 px-2.5 py-0.5 rounded-full border border-primary/20">
                                {unreadCount} new
                            </span>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={markAllAsRead}
                                className="text-[10px] h-7 font-bold text-muted-foreground hover:text-primary hover:bg-primary/5 px-2 rounded-lg transition-colors"
                            >
                                Mark all as read
                            </Button>
                        </div>
                    )}
                </div>
                <ScrollArea className={cn(notificationsArray.length > 0 ? "h-[450px]" : "h-auto")}>
                    {notificationsArray.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 px-6 text-center animate-in fade-in zoom-in-95 duration-400">
                            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary/10 to-blue-500/10 flex items-center justify-center mb-4 ring-4 ring-primary/5 border border-primary/10">
                                <Bell className="h-6 w-6 text-primary/60" />
                            </div>
                            <p className="text-sm font-bold text-foreground">All caught up!</p>
                            <p className="text-xs text-muted-foreground mt-1">No new notifications right now.</p>
                        </div>
                    ) : (
                        <div className="flex flex-col w-[358px] sm:w-[408px]">
                            {sortedNotifications.map((n, idx) => (
                                <div
                                    key={n.id}
                                    style={{ animationDelay: `${idx * 40}ms` }}
                                    className={cn(
                                        "w-full text-left pl-4 py-4 pr-12 hover:bg-muted/40 transition-all border-l-4 group border-b border-border/50 last:border-b-0 relative animate-in fade-in slide-in-from-top-2 duration-300 flex items-start justify-between gap-2",
                                        !n.is_read 
                                            ? 'bg-primary/5 border-l-primary' 
                                            : 'bg-transparent border-l-transparent'
                                    )}
                                >
                                    <div 
                                        className="flex-1 min-w-0 pr-2 cursor-pointer"
                                        onClick={() => {
                                            if (!n.is_read) markAsRead(n.id)
                                            if (n.related_application_id) {
                                                router.push(`/dashboard/hr/applications/${n.related_application_id}`)
                                                setIsOpen(false)
                                            }
                                        }}
                                    >
                                        <div className="flex items-center justify-between gap-3 mb-1">
                                            <p className={cn(
                                                "text-sm truncate flex-1 min-w-0 pr-1",
                                                !n.is_read 
                                                    ? 'font-bold text-foreground' 
                                                    : 'font-normal text-muted-foreground'
                                            )}>
                                                {n.title}
                                            </p>
                                            <span className="text-[10px] font-semibold text-muted-foreground/60 whitespace-nowrap shrink-0">
                                                {formatNotificationDate(n.created_at)}
                                            </span>
                                        </div>
                                        <p className={cn(
                                            "text-xs line-clamp-2 leading-relaxed pr-2",
                                            !n.is_read 
                                                ? 'text-foreground/80 font-medium' 
                                                : 'text-muted-foreground/80 font-normal'
                                        )}>
                                            {n.message}
                                        </p>
                                    </div>
                                    
                                    <div className="absolute right-2 top-1/2 -translate-y-1/2 z-20">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={async (e) => {
                                                e.stopPropagation()
                                                await deleteNotification(n.id)
                                            }}
                                            title="Clear notification"
                                            className="h-7 w-7 rounded-full text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors shadow-sm bg-background border border-border"
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>

                                    {!n.is_read && (
                                        <span className="absolute right-3.5 top-[22px] h-2 w-2 rounded-full bg-primary shadow-sm shadow-primary/40 block animate-pulse shrink-0 pointer-events-none group-hover:hidden" />
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </ScrollArea>
            </PopoverContent>
        </Popover>
    )
}
