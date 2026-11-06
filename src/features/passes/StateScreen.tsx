import type { ReactNode } from 'react'

/** One full-screen state: a clear icon, one sentence, one action. High contrast for sunlight. */
export function StateScreen({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 py-10 text-center">
      <div className="text-slate-700 [&>svg]:size-20">{icon}</div>
      <div className="space-y-2">
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        <p className="mx-auto max-w-xs text-lg text-slate-800">{body}</p>
      </div>
      {action && <div className="w-full max-w-xs [&>*]:w-full">{action}</div>}
    </main>
  )
}
