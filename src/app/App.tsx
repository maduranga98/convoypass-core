import type React from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { Toaster } from 'sonner'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { queryClient } from '@/lib/queryClient'
import { ConfigGate } from './ConfigGate'
import { router } from './router'

/** sonner reads these variables; they point at the brand tokens so toasts match the inline banners. */
const TOAST_THEME = {
  '--normal-bg': 'var(--color-surface)',
  '--normal-text': 'var(--color-brand)',
  '--normal-border': 'var(--color-slate-300)',
  '--success-bg': 'var(--color-success-soft)',
  '--success-text': 'var(--color-success-ink)',
  '--success-border': 'var(--color-success)',
  '--error-bg': 'var(--color-danger-soft)',
  '--error-text': 'var(--color-danger-ink)',
  '--error-border': 'var(--color-danger-strong)',
  '--warning-bg': 'var(--color-warning-soft)',
  '--warning-text': 'var(--color-warning-ink)',
  '--warning-border': 'var(--color-accent)',
  '--info-bg': 'var(--color-slate-100)',
  '--info-text': 'var(--color-brand)',
  '--info-border': 'var(--color-slate-500)',
} as React.CSSProperties

export default function App() {
  return (
    <ErrorBoundary variant="app">
      <ConfigGate>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RouterProvider router={router} />
            <Toaster
              position="top-center"
              richColors
              closeButton
              style={TOAST_THEME}
              toastOptions={{ classNames: { toast: 'font-sans' } }}
            />
          </AuthProvider>
        </QueryClientProvider>
      </ConfigGate>
    </ErrorBoundary>
  )
}
