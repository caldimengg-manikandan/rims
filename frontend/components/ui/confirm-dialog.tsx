'use client'

/**
 * useConfirm – React context-based replacement for window.confirm()
 *
 * Usage:
 *   const confirm = useConfirm()
 *   const ok = await confirm({ title: '...', description: '...', confirmLabel: 'Delete', variant: 'destructive' })
 *   if (ok) { ... }
 *
 * Provider is registered once in app/layout.tsx via <ConfirmProvider>.
 */

import React, { createContext, useCallback, useContext, useRef, useState } from 'react'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/app/dashboard/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConfirmOptions {
    title?: string
    description?: string
    confirmLabel?: string
    cancelLabel?: string
    /** 'destructive' renders the confirm button in red */
    variant?: 'default' | 'destructive' | 'warning'
}

type ConfirmFn = (options?: ConfirmOptions) => Promise<boolean>

// ── Context ───────────────────────────────────────────────────────────────────

const ConfirmContext = createContext<ConfirmFn | null>(null)

// ── Provider ──────────────────────────────────────────────────────────────────

interface DialogState {
    open: boolean
    options: ConfirmOptions
    resolve: (value: boolean) => void
}

const defaultState: DialogState = {
    open: false,
    options: {},
    resolve: () => {},
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
    const [state, setState] = useState<DialogState>(defaultState)
    // Keep a ref so confirm() doesn't stale-close over old state
    const resolveRef = useRef<(v: boolean) => void>(() => {})

    const confirm = useCallback<ConfirmFn>((options = {}) => {
        return new Promise<boolean>((resolve) => {
            resolveRef.current = resolve
            setState({ open: true, options, resolve })
        })
    }, [])

    const handleClose = (value: boolean) => {
        resolveRef.current(value)
        setState((s) => ({ ...s, open: false }))
    }

    const { options, open } = state
    const variant = options.variant ?? 'default'

    const confirmButtonClass = cn(
        'min-w-[80px] rounded-lg font-semibold h-9 px-4 text-sm transition-all duration-150',
        variant === 'destructive' &&
            'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm shadow-destructive/20',
        variant === 'warning' &&
            'bg-amber-600 text-white hover:bg-amber-500 shadow-sm shadow-amber-600/20',
        variant === 'default' && 'bg-primary text-primary-foreground hover:bg-primary/90',
    )

    return (
        <ConfirmContext.Provider value={confirm}>
            {children}

            <AlertDialog open={open} onOpenChange={(v) => { if (!v) handleClose(false) }}>
                <AlertDialogContent
                    className={cn(
                        'gap-5 rounded-2xl border border-border/60 shadow-2xl shadow-black/10',
                        'bg-background/95 backdrop-blur-xl',
                        'sm:max-w-md w-[calc(100%-2rem)] p-6',
                        'data-[state=open]:animate-in data-[state=closed]:animate-out',
                        'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
                        'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
                        'data-[state=open]:slide-in-from-bottom-4',
                    )}
                >
                    <AlertDialogHeader className="gap-1.5 space-y-0">
                        {options.title && (
                            <AlertDialogTitle className="text-base font-bold leading-tight text-foreground">
                                {options.title}
                            </AlertDialogTitle>
                        )}
                        {options.description && (
                            <AlertDialogDescription className="text-sm text-muted-foreground leading-relaxed">
                                {options.description}
                            </AlertDialogDescription>
                        )}
                    </AlertDialogHeader>

                    <AlertDialogFooter className="gap-2 sm:gap-2 flex-row justify-end">
                        <AlertDialogCancel
                            onClick={() => handleClose(false)}
                            className="min-w-[80px] h-9 px-4 rounded-lg font-semibold text-sm border border-border/60 bg-transparent hover:bg-muted/60 transition-all duration-150"
                        >
                            {options.cancelLabel ?? 'Cancel'}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => handleClose(true)}
                            className={confirmButtonClass}
                        >
                            {options.confirmLabel ?? 'Confirm'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </ConfirmContext.Provider>
    )
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useConfirm(): ConfirmFn {
    const ctx = useContext(ConfirmContext)
    if (!ctx) {
        throw new Error('useConfirm must be used inside <ConfirmProvider>')
    }
    return ctx
}
