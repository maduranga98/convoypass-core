import { BellRing, Share, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { useSession } from '@/features/auth/useAuth'
import { strings } from '@/lib/strings'
import { readPushEnv } from './push/env'
import { optInView } from './push/optIn'
import { enablePush, isPushEnabledHere } from './push/registration'
import { getDismissedAt, setDismissedAt } from './push/storage'

const t = strings.push

/**
 * "Get alerts for approvals": never asks on load. The browser prompt only follows a tap on Enable. Dismissed means
 * not again for 14 days. On an iPhone or iPad outside the installed app it explains Add to Home Screen instead.
 */
export function PushOptInCard() {
  const { uid, claims } = useSession()
  const [view, setView] = useState(() =>
    optInView({ env: readPushEnv(), role: claims.role, enabledHere: isPushEnabledHere(uid), dismissedAt: getDismissedAt(uid), now: Date.now() }),
  )
  const [busy, setBusy] = useState(false)

  if (view === 'hidden') return null

  const dismiss = () => {
    setDismissedAt(uid, Date.now())
    setView('hidden')
  }

  const enable = async () => {
    setBusy(true)
    const result = await enablePush(uid)
    setBusy(false)
    if (result === 'enabled') {
      toast.success(t.enabledToast)
      setView('hidden')
    } else if (result === 'denied') {
      toast.error(t.deniedToast)
      setView('hidden')
    } else if (result === 'unsupported') {
      toast.error(t.unsupported)
      setView('hidden')
    } else {
      toast.error(result === 'unconfigured' ? t.needsConfig : t.failedToast)
    }
  }

  return (
    <section aria-labelledby="push-card-h" className="relative flex items-start gap-3 rounded-2xl border border-slate-300 bg-surface p-4 print:hidden">
      <BellRing aria-hidden className="mt-0.5 size-6 shrink-0 text-ink" />
      <div className="min-w-0 flex-1 pr-8">
        <h2 id="push-card-h" className="font-semibold">{view === 'ios-install' ? t.iosTitle : t.cardTitle}</h2>
        {view === 'ios-install' ? (
          <>
            <p className="text-sm text-slate-700">{t.iosBody}</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-800">
              {t.iosSteps.map((step, i) => (
                <li key={step}>
                  {i === 0 && <Share aria-hidden className="mr-1 inline size-4 align-text-bottom" />}
                  {step}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-700">{t.cardBody}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button loading={busy} onClick={() => void enable()}>
                {busy ? t.enabling : t.enable}
              </Button>
              <Button variant="ghost" onClick={dismiss}>{t.notNow}</Button>
            </div>
          </>
        )}
      </div>
      <button
        type="button"
        aria-label={t.dismiss}
        onClick={dismiss}
        className="absolute right-1 top-1 inline-flex size-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-focus"
      >
        <X aria-hidden className="size-4" />
      </button>
    </section>
  )
}
