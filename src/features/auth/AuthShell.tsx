import type { ReactNode } from 'react'
import { BrandMark } from '@/components/BrandMark'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { strings } from '@/lib/strings'

/** Centered card used by the public auth screens (forgot password, reset link, workspace setup). */
export function AuthShell({ title, intro, children }: { title: string; intro?: string | undefined; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <BrandMark className="size-10" />
          <p className="text-base font-semibold tracking-tight text-ink">{strings.app.name}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {intro && <p className="mt-1 text-sm text-slate-500">{intro}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </main>
  )
}

export function Notice({ tone = 'error', children }: { tone?: 'error' | 'info'; children: ReactNode }) {
  return <NotificationBanner tone={tone}>{children}</NotificationBanner>
}
