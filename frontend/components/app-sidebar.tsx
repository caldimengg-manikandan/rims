'use client'
import { useState, useEffect } from 'react'
import { cn } from '@/app/dashboard/lib/utils'

import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
    useSidebar,
} from '@/components/animate-ui/components/radix/sidebar'
import {
    LayoutDashboard,
    Briefcase,
    FileText,
    Users,
    BarChart,
    UserCheck,
    PanelLeft,
    PanelRight,
    LogOut,
    LifeBuoy,
    CheckCircle2,
    Settings,
    Activity,
    Database,
    Mail,
} from 'lucide-react'
import {
    Avatar,
    AvatarFallback,
    AvatarImage,
} from '@/components/ui/avatar'
import { useAuth } from '@/app/dashboard/lib/auth-context'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import useSWR from 'swr'
import { fetcher } from '@/app/dashboard/lib/swr-fetcher'
import { APIClient } from '@/app/dashboard/lib/api-client'
import { useBranding } from '@/lib/branding-client'
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip'

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const { user, logout } = useAuth()
    const pathname = usePathname()
    const { toggleSidebar, state } = useSidebar()

    const { data: pendingApps } = useSWR<{ count: number }>(
        user?.role === 'hr' ? '/api/applications/pending-count' : null,
        (url: string) => fetcher<{ count: number }>(url),
        {
            refreshInterval: 300000, // 5 min — badge counts don't need real-time updates
            dedupingInterval: 60000,
            revalidateOnFocus: false,
            revalidateOnReconnect: false,
        },
    )

    // Use SWR for ticket count
    const { data: ticketData } = useSWR<{ count: number }>(
        user?.role === 'hr' ? '/api/tickets/count' : null,
        (url: string) => fetcher<{ count: number }>(url),
        {
            refreshInterval: 15000,  // 15s — keeps badge live after ticket actions
            dedupingInterval: 8000,
            revalidateOnFocus: true,
            revalidateOnReconnect: true,
        }
    )

    const pendingCount = pendingApps?.count ?? 0
    const ticketCount = ticketData?.count || 0

    const { branding } = useBranding()
    const companyLogo = branding.logoUrl || null



    // Get initials for avatar fallback
    const initials = user?.full_name
        ? user.full_name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2)
        : 'U'

    // Determine navigation links based on user role and groups
    const groups = [
        {
            title: 'Overview',
            items: [
                { href: '/dashboard/hr', label: 'Dashboard', icon: LayoutDashboard },
                { href: '/dashboard/onboarding', label: 'Onboarding', icon: CheckCircle2 },
                { href: '/dashboard/repository', label: 'Repository', icon: Database },
            ]
        },
        {
            title: 'Recruitment',
            items: [
                { href: '/dashboard/hr/jobs', label: 'Job Postings', icon: Briefcase },
                ...(user?.role === 'super_admin' ? [{ href: '/dashboard/hr/approvals', label: 'HR Management', icon: UserCheck }] : []),
                { href: '/dashboard/hr/applications', label: 'Applications', icon: Users },
                { href: '/dashboard/hr/ingested-emails', label: 'Email Ingestion Inbox', icon: Mail },
                { href: '/dashboard/hr/pipeline', label: 'Hiring Pipeline', icon: UserCheck },
            ]
        },
        {
            title: 'Analytics & Support',
            items: [
                { href: '/dashboard/hr/reports', label: 'Reports', icon: BarChart },
                { href: '/dashboard/hr/tickets', label: 'Tickets', icon: LifeBuoy },
                { href: '/dashboard/hr/batch-analysis', label: 'Batch Analysis', icon: FileText },
            ]
        },
        ...(user?.role === 'super_admin' ? [
            {
                title: 'Administration',
                items: [
                    { href: '/dashboard/settings', label: 'Settings', icon: Settings },
                ]
            }
        ] : [])
    ]

    return (
        <Sidebar collapsible="icon" {...props} className="border-r border-sidebar-border bg-sidebar/90 backdrop-blur-2xl text-sidebar-foreground shadow-[2px_0_20px_-4px_rgba(0,0,0,0.12)] transition-colors duration-300">
            <SidebarHeader className="border-b border-sidebar-border/60 px-4 py-5 group-data-[collapsible=icon]:px-2">
                <div className="flex items-center justify-between group-data-[collapsible=icon]:justify-center gap-2">

                    {/* Collapse Button - shown in both states */}
                    {state === 'collapsed' ? (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={toggleSidebar}
                                    className="h-8 w-8 text-muted-foreground hover:text-sidebar-primary hover:bg-sidebar-accent rounded-xl hover:scale-110 active:scale-95 transition-all duration-200"
                                >
                                    <PanelLeft className="h-4 w-4 transition-transform duration-300 rotate-180" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="right">
                                Expand Sidebar
                            </TooltipContent>
                        </Tooltip>
                    ) : (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={toggleSidebar}
                            className="h-8 w-8 text-muted-foreground hover:text-sidebar-primary hover:bg-sidebar-accent rounded-xl hover:scale-110 active:scale-95 transition-all duration-200"
                        >
                            <PanelLeft className="h-4 w-4 transition-transform duration-300" />
                        </Button>
                    )}
                </div>
            </SidebarHeader>

            <SidebarContent className="px-3 py-4 group-data-[collapsible=icon]:px-2 overflow-y-auto scrollbar-none">
                {groups.map((group) => (
                    <div key={group.title} className="mb-6 last:mb-2">
                        {/* Group Header */}
                        <div className="px-3 mb-2 text-[10px] font-black text-muted-foreground/50 tracking-wider uppercase group-data-[collapsible=icon]:hidden">
                            {group.title}
                        </div>
                        <SidebarMenu className="gap-1">
                            {group.items.map((link) => {
                                const Icon = link.icon
                                // Robust matching for dashboard routes (handles sub-routes and singular/plural variants)
                                const isActive = pathname === link.href || 
                                               (link.href !== '/dashboard/hr' && pathname.startsWith(link.href)) ||
                                               (link.href.includes('pipeline') && pathname.includes('pipeline'))

                                const isCollapsed = state === 'collapsed'
                                const buttonContent = (
                                    <SidebarMenuButton
                                        asChild
                                        isActive={isActive}
                                        className={cn(
                                            "relative gap-3 rounded-lg transition-all duration-200 group/item h-10",
                                            "text-sidebar-foreground hover:bg-sidebar-accent/30",
                                            isActive && "bg-sidebar-accent/60 text-primary font-bold shadow-sm"
                                        )}
                                    >
                                        <Link href={link.href} prefetch={false} className="flex items-center justify-between w-full">
                                            {isActive && (
                                                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-7 bg-gradient-to-b from-primary to-primary/60 rounded-r-full z-20 shadow-[2px_0_8px_color-mix(in_oklab,var(--primary)_40%,transparent)] animate-in fade-in slide-in-from-left-1 duration-300" />
                                            )}
                                            <div className="flex items-center gap-3">
                                                <Icon className={cn(
                                                    "h-5 w-5 shrink-0 transition-all duration-200 group-hover/item:scale-110 group-hover/item:rotate-[4deg]",
                                                    isActive ? "text-primary" : "text-muted-foreground group-hover/item:text-sidebar-foreground"
                                                )} />
                                                <span className={cn(
                                                    "group-data-[collapsible=icon]:hidden transition-colors",
                                                    isActive ? "text-primary font-bold" : "text-sidebar-foreground"
                                                )}>
                                                    {link.label}
                                                </span>
                                            </div>
                                            {link.label === 'Applications' && pendingCount > 0 && (
                                                <Badge
                                                    variant="secondary"
                                                    className="ml-auto h-5 min-w-5 flex items-center justify-center rounded-full px-1 text-[10px] font-bold bg-primary text-primary-foreground group-data-[collapsible=icon]:hidden animate-pulse shadow-sm shadow-primary/25"
                                                >
                                                    {pendingCount}
                                                </Badge>
                                            )}
                                            {link.label === 'Tickets' && ticketCount > 0 && (
                                                <Badge
                                                    variant="secondary"
                                                    className="ml-auto h-5 min-w-5 flex items-center justify-center rounded-full px-1 text-[10px] font-bold bg-destructive text-destructive-foreground animate-pulse group-data-[collapsible=icon]:hidden"
                                                >
                                                    {ticketCount}
                                                </Badge>
                                            )}
                                        </Link>
                                    </SidebarMenuButton>
                                )

                                return (
                                    <SidebarMenuItem key={link.href}>
                                        {isCollapsed ? (
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    {buttonContent}
                                                </TooltipTrigger>
                                                <TooltipContent side="right">
                                                    {link.label}
                                                </TooltipContent>
                                            </Tooltip>
                                        ) : (
                                            buttonContent
                                        )}
                                    </SidebarMenuItem>
                                )
                            })}
                        </SidebarMenu>
                    </div>
                ))}
            </SidebarContent>


            <SidebarFooter className="border-t border-sidebar-border/60 p-3 group-data-[collapsible=icon]:p-1.5 bg-gradient-to-t from-sidebar-accent/10 to-transparent">
                <div className="flex items-center justify-between gap-3 overflow-hidden group-data-[collapsible=icon]:justify-center w-full">
                    {/* User Info (Visible when expanded) */}
                    <div className="flex items-center gap-3 overflow-hidden group-data-[collapsible=icon]:hidden flex-1">
                        <div className="relative">
                            <Avatar className="h-9 w-9 border-2 border-primary/20 shadow-sm ring-2 ring-primary/5 hover:ring-primary/20 hover:scale-105 transition-all duration-200 cursor-pointer">
                                <AvatarImage 
                                    src={user?.profile_image_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(user?.email || '')}`} 
                                    alt={user?.full_name} 
                                    className="object-cover bg-slate-800"
                                />
                                <AvatarFallback className="bg-gradient-to-br from-primary via-primary/80 to-accent text-primary-foreground font-black text-xs">
                                    {initials}
                                </AvatarFallback>
                            </Avatar>
                            {/* Online indicator dot */}
                            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-sidebar ring-1 ring-emerald-500/30 animate-pulse" />
                        </div>
                        <div className="flex flex-col overflow-hidden min-w-0">
                            <span className="font-bold text-xs text-sidebar-foreground truncate leading-tight">
                                {user?.full_name}
                            </span>
                            <span className="text-[10px] text-primary/60 truncate uppercase tracking-wider font-bold mt-0.5">
                                {user?.role === 'hr' ? 'HR Manager' : user?.role === 'super_admin' ? 'Super Admin' : 'User'}
                            </span>
                        </div>
                    </div>

                    {/* Collapsed Avatar / Sign Out trigger */}
                    <div className="hidden group-data-[collapsible=icon]:flex">
                        {state === 'collapsed' ? (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={logout}
                                        className="h-9 w-9 rounded-xl hover:bg-destructive/10 text-muted-foreground hover:text-destructive hover:scale-110 active:scale-95 transition-all duration-200"
                                    >
                                        <LogOut className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="right">
                                    Sign Out
                                </TooltipContent>
                            </Tooltip>
                        ) : (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={logout}
                                className="h-9 w-9 rounded-xl hover:bg-destructive/10 text-muted-foreground hover:text-destructive hover:scale-110 active:scale-95 transition-all duration-200"
                            >
                                <LogOut className="h-4 w-4" />
                            </Button>
                        )}
                    </div>

                    {/* Sign Out Button (Visible when expanded) */}
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={logout}
                        title="Sign Out"
                        className="h-8 w-8 text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 rounded-lg hover:scale-110 active:scale-95 transition-all duration-200 group-data-[collapsible=icon]:hidden shrink-0"
                    >
                        <LogOut className="h-4 w-4" />
                    </Button>
                </div>
            </SidebarFooter>

            <SidebarRail />
        </Sidebar>
    )
}
