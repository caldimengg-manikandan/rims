'use client'

import React from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { useAuth } from '@/app/dashboard/lib/auth-context'
import { APIClient } from '@/app/dashboard/lib/api-client'
import { fetcher } from '@/app/dashboard/lib/swr-fetcher'
import { performMutation } from '@/app/dashboard/lib/swr-utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Check, ArrowRight, Trash2, UserCheck } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'

interface HRUser {
  id: number
  email: string
  full_name: string
  approval_status: 'pending' | 'approved' | 'rejected'
  is_active: boolean
}

export default function ApprovalsPage() {
  const { user, isLoading: isAuthLoading } = useAuth()
  const [processingId, setProcessingId] = React.useState<number | null>(null)
  const [status, setStatus] = React.useState<string>('pending')
  const [confirmAction, setConfirmAction] = React.useState<{ type: 'reject' | 'remove'; userId: number; message: string } | null>(null)
  const [otpConfirmUser, setOtpConfirmUser] = React.useState<HRUser | null>(null)
  const [isSendingOtp, setIsSendingOtp] = React.useState(false)

  const handleSendOTP = async () => {
    if (!otpConfirmUser) return
    setIsSendingOtp(true)
    try {
      // We use the public forgot-password endpoint to trigger the OTP
      await APIClient.post('/api/auth/forgot-password', { email: otpConfirmUser.email })
      toast.success(`Password reset OTP sent to ${otpConfirmUser.email}`)
      setOtpConfirmUser(null)
    } catch (err) {
      console.error('Failed to send OTP', err instanceof Error ? err.message : String(err))
      toast.error('Failed to send password reset email. Please try again.')
    } finally {
      setIsSendingOtp(false)
    }
  }

  const isSuperAdmin = user?.role === 'super_admin'
  const shouldFetch = isSuperAdmin
  const fetchUrl = `/api/auth/hr-requests?status=${status}`
  const { data: hrUsers = [], error, isValidating, mutate } = useSWR<HRUser[]>(
    shouldFetch ? fetchUrl : null,
    (url: string) => fetcher<HRUser[]>(url)
  )

  const userCount = hrUsers.length

  const handleApprove = async (userId: number) => {
    setProcessingId(userId)
    try {
      await performMutation<HRUser[]>(
        fetchUrl,
        mutate,
        () => APIClient.post(`/api/auth/approve/${userId}`, {}),
        {
          lockKey: `approval-${userId}`,
          successMessage: 'HR user approved successfully',
          invalidateKeys: [fetchUrl, '/api/analytics/dashboard']
        }
      )
    } catch (err) {
      console.error('Failed to approve user', err instanceof Error ? err.message : String(err))
    } finally {
      setProcessingId(null)
    }
  }

  const handleReject = async (userId: number) => {
    setConfirmAction({ type: 'reject', userId, message: 'Are you sure you want to reject this HR registration?' })
  }

  const handleRemove = async (userId: number) => {
    setConfirmAction({ type: 'remove', userId, message: 'Are you sure you want to deactivate this HR account? They will no longer be able to log in.' })
  }

  const handleConfirm = async () => {
    if (!confirmAction) return
    const { type, userId } = confirmAction
    setConfirmAction(null)
    setProcessingId(userId)
    try {
      if (type === 'reject') {
        await performMutation<HRUser[]>(
          fetchUrl,
          mutate,
          () => APIClient.post(`/api/auth/reject/${userId}`, {}),
          {
            lockKey: `approval-${userId}`,
            successMessage: 'HR user rejected',
            invalidateKeys: [fetchUrl, '/api/analytics/dashboard']
          }
        )
      } else {
        await performMutation<HRUser[]>(
          fetchUrl,
          mutate,
          () => APIClient.delete(`/api/auth/remove/${userId}`),
          {
            lockKey: `approval-remove-${userId}`,
            successMessage: 'HR user deactivated',
            invalidateKeys: [fetchUrl, '/api/analytics/dashboard']
          }
        )
      }
    } catch (err) {
      console.error('Failed to process action', err instanceof Error ? err.message : String(err))
    } finally {
      setProcessingId(null)
    }
  }

  if (isAuthLoading || (shouldFetch && isValidating && hrUsers.length === 0)) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-primary/20 border-t-primary shadow-lg" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-8 w-8 rounded-full bg-primary/10 animate-pulse" />
            </div>
          </div>
          <p className="text-sm font-bold text-muted-foreground animate-pulse tracking-widest uppercase">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user || !isSuperAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-xl w-full">
          <CardHeader>
            <CardTitle>Access denied</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              This page is reserved for Super Admin accounts only.
            </p>
            <div className="mt-4">
              <Link href="/dashboard/hr">
                <Button>Return to dashboard</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const getStatusBadge = (user: HRUser) => {
    if (user.approval_status === 'pending') {
      return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20 font-semibold">Pending</Badge>
    }
    if (user.approval_status === 'approved' && user.is_active) {
      return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 font-semibold">Approved</Badge>
    }
    if (user.approval_status === 'approved' && !user.is_active) {
      return <Badge variant="outline" className="bg-slate-500/10 text-slate-600 border-slate-500/20 font-semibold">Deactivated</Badge>
    }
    if (user.approval_status === 'rejected') {
      return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 font-semibold">Rejected</Badge>
    }
    return <Badge variant="outline">{user.approval_status}</Badge>
  }
  return (
    <div className="space-y-8">
      <PageHeader
        title="HR Management"
        description="Manage HR access, approve requests, and deactivate accounts."
        icon={UserCheck}
      >
        <Tabs value={status} onValueChange={setStatus}>
          <TabsList className="grid w-full grid-cols-3 max-w-md">
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
          </TabsList>
        </Tabs>
      </PageHeader>
      <Card className="bg-card/60 backdrop-blur-md rounded-2xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] pt-0 overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/40 pb-4 pt-6">
          <div>
            <CardTitle>{status.charAt(0).toUpperCase() + status.slice(1)} HR Users</CardTitle>
            <CardDescription>
              {status === 'pending' && "Confirm and enable verified HR users."}
              {status === 'approved' && "Manage active HR accounts."}
              {status === 'rejected' && "View rejected registration requests."}
            </CardDescription>
          </div>
          <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20">
            {userCount} {status}
          </Badge>
        </CardHeader>
        <CardContent className="pt-6">
          {error ? (
            <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
              Failed to load users. Please refresh the page.
            </div>
          ) : userCount === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-12 text-center flex flex-col items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
                <UserCheck className="h-6 w-6 text-primary/60" />
              </div>
              <p className="text-sm font-bold text-foreground">No {status} HR accounts</p>
              <p className="text-xs text-muted-foreground">All {status} requests will appear here.</p>
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/30 border-b border-border/40">
                <TableRow className="hover:bg-transparent border-none">
                  <TableHead>ID</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Full Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="stagger-children">
                {hrUsers.map((hrUser) => (
                  <TableRow key={hrUser.id} className="border-b border-border/10 last:border-b-0 premium-table-row cursor-pointer">
                    <TableCell>{hrUser.id}</TableCell>
                    <TableCell>
                      <Button 
                        variant="link" 
                        className="p-0 h-auto font-medium text-primary hover:underline decoration-primary/30"
                        onClick={() => setOtpConfirmUser(hrUser)}
                      >
                        {hrUser.email}
                      </Button>
                    </TableCell>
                    <TableCell>{hrUser.full_name}</TableCell>
                    <TableCell>
                      {getStatusBadge(hrUser)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {status === 'approved' && hrUser.is_active && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs border-primary/20 hover:bg-primary/5 text-primary font-bold rounded-lg active:scale-[0.99] transition-all duration-200"
                            onClick={() => setOtpConfirmUser(hrUser)}
                          >
                            Reset Password
                          </Button>
                        )}
                        {status === 'pending' && (
                          <>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-8 text-xs font-bold rounded-lg active:scale-[0.99] transition-all duration-200"
                              disabled={processingId === hrUser.id}
                              onClick={() => handleReject(hrUser.id)}
                            >
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              className="h-8 text-xs font-bold shadow-sm shadow-primary/20 rounded-lg active:scale-[0.99] transition-all duration-200"
                              disabled={processingId === hrUser.id}
                              onClick={() => handleApprove(hrUser.id)}
                            >
                              <Check className="mr-1.5 h-3.5 w-3.5" />
                              Approve
                            </Button>
                          </>
                        )}
                        {status === 'approved' && hrUser.is_active && (
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-8 text-xs font-bold rounded-lg active:scale-[0.99] transition-all duration-200"
                            disabled={processingId === hrUser.id}
                            onClick={() => handleRemove(hrUser.id)}
                          >
                            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                            Deactivate
                          </Button>
                        )}
                        {status === 'approved' && !hrUser.is_active && (
                          <Button
                            size="sm"
                            className="h-8 text-xs font-bold shadow-sm shadow-primary/20 rounded-lg active:scale-[0.99] transition-all duration-200"
                            disabled={processingId === hrUser.id}
                            onClick={() => handleApprove(hrUser.id)}
                          >
                            <Check className="mr-1.5 h-3.5 w-3.5" />
                            Reactivate
                          </Button>
                        )}
                        {status === 'rejected' && (
                          <span className="text-xs text-muted-foreground italic">No actions available</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <DialogContent className="max-w-md rounded-3xl border border-border/80 bg-background/95 backdrop-blur-xl shadow-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Confirm Action</DialogTitle>
            <DialogDescription className="text-base">{confirmAction?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" className="rounded-xl font-bold h-11" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button variant="destructive" className="rounded-xl font-bold h-11 shadow-lg shadow-destructive/20" onClick={handleConfirm} disabled={!!processingId}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password Reset OTP Confirmation Dialog */}
      <Dialog open={!!otpConfirmUser} onOpenChange={() => setOtpConfirmUser(null)}>
        <DialogContent className="max-w-md rounded-3xl border border-border/80 bg-background/95 backdrop-blur-xl shadow-2xl p-6">
          <DialogHeader className="space-y-3">
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center border border-primary/20">
              <UserCheck className="h-6 w-6 text-primary" />
            </div>
            <DialogTitle className="text-2xl font-black tracking-tight">Send Password Reset?</DialogTitle>
            <DialogDescription className="text-base text-muted-foreground leading-relaxed">
              You are about to trigger a password reset OTP for <strong className="text-foreground">{otpConfirmUser?.full_name}</strong> ({otpConfirmUser?.email}). 
              <br /><br />
              The user will receive an email with a 6-digit code to update their password.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6 flex gap-2">
            <Button 
              variant="ghost" 
              className="flex-1 font-bold h-12 rounded-xl text-muted-foreground" 
              onClick={() => setOtpConfirmUser(null)}
              disabled={isSendingOtp}
            >
              Cancel
            </Button>
            <Button 
              className="flex-1 font-bold h-12 rounded-xl bg-primary shadow-lg shadow-primary/25 hover:scale-[1.02] active:scale-[0.99] transition-all" 
              onClick={handleSendOTP}
              disabled={isSendingOtp}
            >
              {isSendingOtp ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Sending...
                </>
              ) : (
                'Reset Password'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
