'use client'

import React, { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Calendar } from 'lucide-react'
import { APIClient } from '@/app/dashboard/lib/api-client'
import { toast } from "sonner"
import { useRouter } from 'next/navigation'
import { useAuth } from '@/app/dashboard/lib/auth-context'

export function SendOfferDialog({ applicationId, candidateName, onSuccess, trigger, initialDate }: { applicationId: number, candidateName: string, onSuccess: () => void, trigger: React.ReactNode, initialDate?: string }) {
    const router = useRouter()
    const { user } = useAuth()
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [joiningDate, setJoiningDate] = useState(initialDate ? initialDate.split('T')[0] : '')

    const handleSend = async () => {
        if (!joiningDate) {
            toast.error("Please select a joining date")
            return
        }

        const selectedDate = new Date(joiningDate)
        selectedDate.setHours(0, 0, 0, 0)
        const today = new Date()
        today.setHours(0, 0, 0, 0)

        if (selectedDate < today) {
            toast.error("Joining date cannot be in the past")
            return
        }

        setLoading(true)
        try {
            // Always auto_approve for job owners as requested
            const url = `/api/onboarding/applications/${applicationId}/send-offer?joining_date=${joiningDate}&auto_approve=true`
            await APIClient.post(url, {})
            toast.success(`Offer letter has been sent directly to ${candidateName}.`)
            setOpen(false)
            onSuccess()
        } catch (error: any) {
            const msg = error.message || "Could not process offer"
            const isConfigError = msg.toLowerCase().includes('settings') || 
                                  msg.toLowerCase().includes('template') || 
                                  msg.toLowerCase().includes('configured') ||
                                  msg.toLowerCase().includes('missing')
            if (['super_admin', 'root-admin', 'root_admin'].includes(user?.role || '') && isConfigError) {
                toast.error(msg, {
                    action: {
                        label: 'Go to Settings',
                        onClick: () => {
                            setOpen(false)
                            router.push('/dashboard/settings')
                        }
                    },
                    duration: 10000
                })
            } else {
                toast.error(msg)
            }
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Issue Offer Letter</DialogTitle>
                    <DialogDescription className="text-sm text-muted-foreground">
                        Set the joining date and release the offer letter to <strong className="font-semibold text-foreground">{candidateName}</strong> immediately.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="joining_date" className="text-sm font-semibold text-foreground">Joining Date</Label>
                        <div className="relative">
                            <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
                            <Input 
                                id="joining_date" 
                                type="date" 
                                min={new Date().toISOString().split('T')[0]}
                                className="pl-10 h-10"
                                value={joiningDate}
                                onChange={(e) => setJoiningDate(e.target.value)}
                            />
                        </div>
                    </div>
                </div>
                <DialogFooter className="mt-2">
                    <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
                        Cancel
                    </Button>
                    <Button 
                        onClick={handleSend} 
                        disabled={loading} 
                        className="px-6 shadow-md shadow-primary/10"
                    >
                        {loading ? "Releasing..." : "Release Offer"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
