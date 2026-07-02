'use client'

import { Toaster as Sonner, ToasterProps } from 'sonner'

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--success-bg': 'var(--popover)',
          '--success-text': 'var(--popover-foreground)',
          '--error-bg': 'var(--popover)',
          '--error-text': 'var(--popover-foreground)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
