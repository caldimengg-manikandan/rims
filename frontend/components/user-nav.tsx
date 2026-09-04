'use client'

import { useCallback, useMemo } from 'react'

import {
    Avatar,
    AvatarFallback,
    AvatarImage,
} from '@/components/ui/avatar'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/app/dashboard/lib/auth-context'
import { useRouter } from 'next/navigation'
import { LogOut, User as UserIcon, Settings, GitFork, Image as ImageIcon } from 'lucide-react'
import useSWR from 'swr'
import { APIClient } from '@/app/dashboard/lib/api-client'
import { getBranding } from '@/lib/branding'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { useState } from 'react'

export function UserNav() {
    const { user, logout } = useAuth()
    const router = useRouter()

    const handleLogout = useCallback(() => {
        logout()
    }, [logout])

    const [isLogoDialogOpen, setIsLogoDialogOpen] = useState(false)
    const [logoUrl, setLogoUrl] = useState('')
    const [isUpdating, setIsUpdating] = useState(false)

    // Memoized initials for efficiency
    const initials = useMemo(() => {
        if (!user?.full_name) return 'U'
        return user.full_name
            .trim()
            .split(/\s+/)
            .map((n) => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2)
    }, [user?.full_name])

    const { data: settings, mutate } = useSWR('/api/settings/branding', (url) => APIClient.get(url)) as { data: any, mutate: any }
    const branding = getBranding(settings)

    const avatarUrl = useMemo(() => {
        if (branding?.logoUrl) return branding.logoUrl
        if (user?.profile_image_url) return user.profile_image_url
        return `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(user?.email || 'default')}`
    }, [user?.profile_image_url, user?.email, branding?.logoUrl])

    const handleUpdateLogo = async () => {
        if (!logoUrl.trim()) {
            toast.error("Please enter a valid URL")
            return
        }
        setIsUpdating(true)
        try {
            await APIClient.post('/api/settings', { company_logo_url: logoUrl })
            toast.success("Brand logo updated successfully")
            setIsLogoDialogOpen(false)
            // Trigger SWR revalidation
            mutate('/api/settings/branding')
        } catch (error) {
            toast.error("Failed to update logo")
        } finally {
            setIsUpdating(false)
        }
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-10 w-10 rounded-full hover:bg-slate-800/10 hover:scale-105 active:scale-95 transition-all duration-300 focus-visible:ring-offset-0 focus-visible:ring-0 group hover:shadow-md">
                    <Avatar className="h-10 w-10 overflow-hidden border border-border group-hover:border-primary/50 transition-colors duration-300">
                        <AvatarImage 
                            src={avatarUrl} 
                            alt={user?.full_name || 'User'} 
                            className="bg-background object-cover"
                        />
                        <AvatarFallback className="bg-transparent font-bold animate-in fade-in duration-500 overflow-hidden">
                            {branding?.logoUrl ? (
                                <img src={branding.logoUrl} className="h-full w-full object-contain" alt="Logo Fallback" />
                            ) : (
                                <div className="h-full w-full flex items-center justify-center bg-primary/25 text-primary shadow-inner">
                                    {initials}
                                </div>
                            )}
                        </AvatarFallback>
                    </Avatar>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64 rounded-2xl border border-border/80 bg-card/95 backdrop-blur-xl shadow-2xl overflow-hidden" align="end" sideOffset={8} forceMount>
                <DropdownMenuLabel className="font-normal p-0">
                    <div className="flex flex-col space-y-0.5 p-4 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/40">
                        <p className="text-sm font-bold leading-none tracking-tight">{user?.full_name || 'User'}</p>
                        <p className="text-xs leading-none text-muted-foreground/80 truncate pt-1">
                            {user?.email || 'user@example.com'}
                        </p>
                    </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="opacity-50 my-1" />
                <DropdownMenuGroup className="p-1">
                    {['super_admin', 'root-admin', 'root_admin'].includes(user?.role || '') && (
                        <DropdownMenuItem className="cursor-pointer py-2.5 px-3 rounded-xl focus:bg-primary/5 focus:text-primary focus:pl-4 transition-all duration-200 gap-2.5" onClick={() => router.push('/dashboard/settings')}>
                            <Settings className="h-4 w-4 text-muted-foreground" />
                            <span>Settings</span>
                        </DropdownMenuItem>
                    )}
                    {['super_admin', 'root-admin', 'root_admin'].includes(user?.role || '') && (
                        <DropdownMenuItem
                            className="cursor-pointer py-2.5 px-3 rounded-xl focus:bg-primary/5 focus:text-primary focus:pl-4 transition-all duration-200 gap-2.5"
                            onClick={() => {
                                setLogoUrl(settings?.company_logo_url || '')
                                setIsLogoDialogOpen(true)
                            }}
                        >
                            <ImageIcon className="h-4 w-4 text-muted-foreground" />
                            <span>Update Brand Logo</span>
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuItem className="cursor-pointer py-2.5 px-3 rounded-xl focus:bg-primary/5 focus:text-primary focus:pl-4 transition-all duration-200 gap-2.5" onClick={() => router.push('/dashboard/repository')}>
                        <GitFork className="h-4 w-4 text-muted-foreground" />
                        <span>Repository</span>
                    </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator className="opacity-50 my-1" />
                <div className="p-1">
                <DropdownMenuItem
                    onClick={handleLogout}
                    className="text-destructive focus:text-destructive focus:bg-destructive/5 cursor-pointer py-2.5 px-3 rounded-xl focus:pl-4 transition-all duration-200 gap-2.5"
                >
                    <LogOut className="h-4 w-4" />
                    <span>Log out</span>
                </DropdownMenuItem>
                </div>
            </DropdownMenuContent>

            <Dialog open={isLogoDialogOpen} onOpenChange={setIsLogoDialogOpen}>
                <DialogContent className="sm:max-w-md rounded-2xl border border-border/80 bg-card/95 backdrop-blur-xl shadow-2xl overflow-hidden p-0">
                    <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/40 p-6">
                        <DialogHeader>
                            <DialogTitle className="font-black">Update Brand Logo</DialogTitle>
                            <DialogDescription className="text-muted-foreground">
                                Provide a direct URL to your company logo (PNG, SVG, or JPG).
                            </DialogDescription>
                        </DialogHeader>
                    </div>
                    <div className="space-y-4 p-6">
                        <div className="space-y-2">
                            <Label htmlFor="logo-url" className="font-semibold">Logo URL</Label>
                            <Input
                                id="logo-url"
                                placeholder="https://example.com/logo.png"
                                value={logoUrl}
                                onChange={(e) => setLogoUrl(e.target.value)}
                                className="rounded-xl hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all"
                            />
                        </div>
                        {logoUrl && (
                            <div className="flex flex-col items-center gap-2 p-4 border border-border/50 rounded-xl bg-muted/20">
                                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Preview</span>
                                <img
                                    src={logoUrl}
                                    alt="Preview"
                                    className="h-16 w-auto object-contain"
                                    onError={(e) => (e.currentTarget.style.display = 'none')}
                                />
                            </div>
                        )}
                    </div>
                    <DialogFooter className="px-6 pb-6 gap-2">
                        <Button variant="ghost" onClick={() => setIsLogoDialogOpen(false)} className="rounded-xl active:scale-95 transition-all">Cancel</Button>
                        <Button onClick={handleUpdateLogo} disabled={isUpdating} className="rounded-xl active:scale-[0.98] transition-all font-bold">
                            {isUpdating ? "Updating..." : "Save Changes"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </DropdownMenu>
    )
}
