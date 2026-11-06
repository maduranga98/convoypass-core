import { CircleCheckBig, CloudUpload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { strings } from '@/lib/strings'

const t = strings.gate
const SECONDS = 3

export interface SuccessInfo {
  plateNo: string
  /** Server time (online) or device time (offline, unverified). */
  atMs: number
  offline: boolean
  guardName: string
  gateName: string
}

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/**
 * Full-screen green confirmation. Counts down 3 seconds, then `onNext` (back to the scanner, or the list when the
 * vehicle was opened from it). A tap anywhere cancels the countdown and keeps the screen until "Continue".
 */
export function CheckInSuccess({ info, next, onNext }: { info: SuccessInfo; next: 'scan' | 'home'; onNext: () => void }) {
  const [left, setLeft] = useState(SECONDS)
  const [stayed, setStayed] = useState(false)

  useEffect(() => {
    if (stayed) return
    if (left <= 0) {
      onNext()
      return
    }
    const id = setTimeout(() => setLeft((n) => n - 1), 1000)
    return () => clearTimeout(id)
  }, [left, stayed, onNext])

  return (
    // Any tap or key press means "I am still reading this": it stops the auto-advance. The real actions are the buttons below.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <main
      onClick={() => setStayed(true)}
      onKeyDown={() => setStayed(true)}
      className="flex min-h-dvh flex-col items-center justify-between gap-6 bg-success-strong px-6 pt-12 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center text-on-solid"
    >
      <div role="status" className="flex flex-col items-center gap-4">
        <CircleCheckBig aria-hidden className="size-28" strokeWidth={2.5} />
        <h1 className="text-5xl font-black tracking-tight">{t.successTitle}</h1>
        <p className="text-[clamp(2.5rem,13vw,4rem)] leading-none font-black tracking-tight break-words">{info.plateNo}</p>
        <p className="text-3xl font-bold">
          {hhmm(info.atMs)}
          {info.offline && <span className="ml-2 align-middle text-base font-semibold">({t.deviceTime})</span>}
        </p>
        <p className="text-xl font-semibold">{t.successBy(info.guardName)}</p>
        <p className="text-xl font-semibold">{t.successGate(info.gateName)}</p>
        {info.offline && (
          <p className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-lg font-extrabold text-ink">
            <CloudUpload aria-hidden className="size-6" />
            {t.savedOffline}
          </p>
        )}
      </div>

      <div className="w-full max-w-sm space-y-3">
        {stayed ? (
          <>
            <p className="text-base font-semibold">{t.stayed}</p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onNext()
              }}
              className="h-16 w-full rounded-2xl bg-surface text-2xl font-black text-success-strong focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-on-solid"
            >
              {t.continue}
            </button>
          </>
        ) : (
          <>
            <p aria-live="polite" className="text-xl font-bold">{next === 'scan' ? t.nextIn(left) : t.homeIn(left)}</p>
            <button
              type="button"
              onClick={() => setStayed(true)}
              className="h-16 w-full rounded-2xl border-4 border-on-solid text-xl font-extrabold focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-on-solid"
            >
              {t.stay}
            </button>
          </>
        )}
      </div>
    </main>
  )
}
