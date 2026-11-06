import { Check, Circle, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { IMPORT_LINK, ONBOARDING_STEPS, stepLink, stepsDone } from './model'
import { dismissOnboarding, hasVisitedSettings, isDismissed } from './storage'
import { useOnboardingCounts } from './useOnboardingCounts'

const t = strings.onboarding
const linkClass =
  'inline-flex min-h-9 items-center rounded-lg border border-slate-300 bg-surface px-3 text-sm font-medium text-ink hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus pointer-coarse:min-h-11'

/**
 * "Get ConvoyPass ready": shown to admins until every step is done or the card is dismissed (remembered per tenant on
 * this device). Steps come from live counts, so they tick themselves as the admin works.
 */
export function OnboardingCard({ tenantId }: { tenantId: string }) {
  const counts = useOnboardingCounts(tenantId)
  const [dismissed, setDismissed] = useState(() => isDismissed(tenantId))
  if (dismissed || !counts.data) return null // loading and errors stay quiet: this card is a help, not a gate

  const done = stepsDone(counts.data, hasVisitedSettings(tenantId))
  const doneCount = ONBOARDING_STEPS.filter((s) => done[s]).length
  if (doneCount === ONBOARDING_STEPS.length) return null

  return (
    <section aria-labelledby="onboarding-h" className="rounded-xl border border-slate-200 bg-surface p-4 lg:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="onboarding-h" className="font-semibold">{t.title}</h2>
          <p className="mt-0.5 text-sm text-slate-500">{t.intro}</p>
          <p role="status" className="mt-1 text-xs font-medium text-slate-600">{t.progress(doneCount, ONBOARDING_STEPS.length)}</p>
        </div>
        <button
          type="button"
          aria-label={t.dismissLabel}
          onClick={() => {
            dismissOnboarding(tenantId)
            setDismissed(true)
          }}
          className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-focus pointer-coarse:size-11"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>

      <ol className="mt-4 divide-y divide-slate-100">
        {ONBOARDING_STEPS.map((step) => {
          const copy = t.steps[step]
          return (
            <li key={step} data-done={done[step]} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
              {done[step] ? <Check aria-hidden className="size-5 shrink-0 text-success" /> : <Circle aria-hidden className="size-5 shrink-0 text-slate-500" />}
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm font-medium', done[step] && 'text-slate-500 line-through')}>{copy.title}</p>
                <p className="text-xs text-slate-500">{copy.hint}</p>
              </div>
              <span className="sr-only">{done[step] ? t.done : ''}</span>
              <div className="flex gap-2">
                {step === 'vehicles' && !done[step] && (
                  <Link to={IMPORT_LINK} className={linkClass}>{t.importCsv}</Link>
                )}
                <Link to={stepLink[step]} className={linkClass}>
                  {t.open}
                  <span className="sr-only">: {copy.title}</span>
                </Link>
              </div>
            </li>
          )
        })}
      </ol>
      <p className="mt-3 text-xs text-slate-500">
        {t.qrTip} <Link to="/admin/qr" className="font-medium text-slate-700 underline underline-offset-2">{t.qrLink}</Link>
      </p>
    </section>
  )
}
