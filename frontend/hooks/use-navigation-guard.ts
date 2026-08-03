'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useConfirm } from '@/components/ui/confirm-dialog'

export function useNavigationGuard(
  isBlocked: boolean,
  options: {
    title?: string
    description?: string
    confirmLabel?: string
    cancelLabel?: string
  } = {}
) {
  const router = useRouter()
  const confirm = useConfirm()

  const isBlockedRef = useRef(isBlocked)
  const optionsRef = useRef(options)

  useEffect(() => {
    isBlockedRef.current = isBlocked
    optionsRef.current = options
  }, [isBlocked, options])

  // 1. Guard beforeunload (hard reload/tab close)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isBlockedRef.current) {
        e.preventDefault()
        e.returnValue = ''
        return ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // 2. Guard in-app link clicks
  useEffect(() => {
    const handleAnchorClick = async (e: MouseEvent) => {
      if (!isBlockedRef.current) return

      const target = e.target as HTMLElement
      const anchor = target.closest('a')

      if (anchor && anchor.href && anchor.target !== '_blank') {
        try {
          const url = new URL(anchor.href, window.location.origin)
          // If it is a client-side route navigation to a different path/search
          if (
            url.origin === window.location.origin &&
            (url.pathname !== window.location.pathname || url.search !== window.location.search)
          ) {
            e.preventDefault()
            e.stopPropagation()

            const confirmed = await confirm({
              title: optionsRef.current.title || 'Unsaved Changes',
              description:
                optionsRef.current.description ||
                'You have unsaved changes. Are you sure you want to leave this page?',
              confirmLabel: optionsRef.current.confirmLabel || 'Leave Page',
              cancelLabel: optionsRef.current.cancelLabel || 'Stay',
              variant: 'warning',
            })

            if (confirmed) {
              isBlockedRef.current = false
              router.push(url.pathname + url.search)
            }
          }
        } catch (err) {
          // Ignore invalid URLs
        }
      }
    }

    document.addEventListener('click', handleAnchorClick, { capture: true })
    return () => document.removeEventListener('click', handleAnchorClick, { capture: true })
  }, [router, confirm])

  // 3. Guard browser back/forward buttons (popstate)
  useEffect(() => {
    if (!isBlocked) return

    // Push state to history to absorb the back/forward transition
    window.history.pushState(window.history.state, '', window.location.href)

    const handlePopState = async () => {
      if (!isBlockedRef.current) return

      // Revert back URL instantly by re-pushing current location
      window.history.pushState(window.history.state, '', window.location.href)

      const confirmed = await confirm({
        title: optionsRef.current.title || 'Unsaved Changes',
        description:
          optionsRef.current.description ||
          'You have unsaved changes. Are you sure you want to leave this page?',
        confirmLabel: optionsRef.current.confirmLabel || 'Leave Page',
        cancelLabel: optionsRef.current.cancelLabel || 'Stay',
        variant: 'warning',
      })

      if (confirmed) {
        isBlockedRef.current = false
        // Go back two steps to bypass the extra pushState we did
        window.history.go(-2)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [isBlocked, confirm])
}
