import { CircleAlert, LogIn, ScanLine, ShieldX } from 'lucide-react'
import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import { EmptyState } from '@/components/ui/EmptyState'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { useNow } from '@/features/passes/useToday'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { visitorStrings } from '@/lib/visitorStrings'
import { formatPassCode } from '@/lib/visitorLogic'
import { hhmm } from './format'
import { useInsideVisitors } from './queries'
import { useVisitorLookup } from './useVisitorLookup'
import { VisitorPassCard } from './VisitorPassCard'

const t = visitorStrings.gate

// The same scanner component as the vehicle mode; started loading as soon as the visitor mode opens.
const loadScanner = () => import('@/features/scan/QrScanner').then((m) => ({ default: m.QrScanner }))
const QrScanner = lazy(loadScanner)

/**
 * Security's Visitor mode: scan a visitor pass QR or type its code, see who it is, and check them in or out with one large
 * button. Below: the visitors inside right now (tap one to check them out). Same large, plain standard as the vehicle mode.
 */
export default function VisitorGate() {
  const { lookup, find, reset } = useVisitorLookup()
  const inside = useInsideVisitors()
  const now = useNow(30_000)
  const [scanning, setScanning] = useState(false)
  const [code, setCode] = useState('')

  useEffect(() => {
    void loadScanner().catch(() => undefined)
  }, [])

  const next = () => {
    setCode('')
    reset()
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (code.trim()) void find({ code })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-4">
      {lookup.state === 'idle' || lookup.state === 'loading' ? (
        <>
          <button
            type="button"
            onClick={() => setScanning(true)}
            className="flex h-24 w-full items-center justify-center gap-4 rounded-3xl bg-brand text-3xl font-black tracking-tight text-on-solid shadow-sm hover:bg-brand-hover focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <ScanLine aria-hidden className="size-10" />
            {strings.scanner.visitorTitle}
          </button>

          <form onSubmit={submit} className="space-y-2">
            <label htmlFor="visitor-code" className="text-base font-bold text-ink">{t.codeLabel}</label>
            <div className="flex gap-2">
              <input
                id="visitor-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={12}
                placeholder={t.codePlaceholder}
                className="h-16 min-w-0 flex-1 rounded-2xl border-2 border-slate-300 bg-surface px-4 font-mono text-2xl font-bold tracking-widest uppercase placeholder:text-base placeholder:font-medium placeholder:tracking-normal focus-visible:border-brand focus-visible:outline-none"
              />
              <button
                type="submit"
                disabled={lookup.state === 'loading' || code.trim() === ''}
                className="h-16 shrink-0 rounded-2xl bg-brand px-5 text-lg font-black text-on-solid hover:bg-brand-hover focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60"
              >
                {t.find}
              </button>
            </div>
          </form>

          {lookup.state === 'loading' && <p role="status" className="text-base font-semibold text-slate-700">{visitorStrings.page.loading}</p>}

          <section aria-label={t.inside} className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-extrabold text-ink">{t.inside}</h2>
              {inside.data && <span className="text-base font-bold text-slate-700">{t.insideCount(inside.data.length)}</span>}
            </div>
            {inside.isPending ? (
              <ListSkeleton rows={2} />
            ) : inside.isError ? (
              <p role="alert" className="text-base font-semibold text-danger-ink">{visitorStrings.onSite.loadFailed}</p>
            ) : inside.data.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-surface">
                <EmptyState title={t.insideEmpty} />
              </div>
            ) : (
              <ul className="space-y-2">
                {inside.data.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => void find({ passId: p.id })}
                      className="flex min-h-16 w-full items-center gap-3 rounded-2xl border-2 border-slate-200 bg-surface px-4 py-3 text-left hover:border-slate-400 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-xl leading-tight font-black break-words text-ink">{p.visitorName}</span>
                        <span className="block text-sm font-semibold text-slate-700">
                          {[p.hostName ? `→ ${p.hostName}` : null, p.checkInAt ? t.since(hhmm(p.checkInAt.toMillis())) : null].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-sm font-extrabold', p.dwellWarning ? 'border-2 border-danger-strong text-danger-ink' : 'bg-success-strong text-on-solid')}>
                        <LogIn aria-hidden className="size-4" />
                        {p.dwellWarning ? visitorStrings.overTime : visitorStrings.status.checked_in}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : lookup.state === 'found' ? (
        <VisitorPassCard key={lookup.view.passId} view={lookup.view} now={now} onNext={next} />
      ) : lookup.state === 'notFound' ? (
        <section className="space-y-4">
          <div role="status" className="flex items-center gap-3 rounded-3xl bg-danger-strong px-5 py-5 text-on-solid">
            <ShieldX aria-hidden className="size-10 shrink-0" />
            <div>
              <p className="text-2xl font-black">{t.state.notFound}</p>
              <p className="text-base font-semibold">{t.reason.notFound}</p>
            </div>
          </div>
          <button type="button" onClick={next} className="h-16 w-full rounded-2xl bg-brand text-xl font-black text-on-solid hover:bg-brand-hover focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus">
            {t.back}
          </button>
        </section>
      ) : (
        <section className="space-y-4">
          <p role="alert" className="flex items-start gap-2 rounded-2xl bg-danger-soft px-4 py-4 text-lg font-bold text-danger-ink">
            <CircleAlert aria-hidden className="mt-0.5 size-6 shrink-0" />
            {lookup.message || t.loadFailed}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => void find(lookup.target)} className="h-16 rounded-2xl bg-brand text-lg font-black text-on-solid focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus">
              {strings.common.retry}
            </button>
            <button type="button" onClick={next} className="h-16 rounded-2xl border-2 border-slate-300 bg-surface text-lg font-bold text-ink focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus">
              {t.back}
            </button>
          </div>
        </section>
      )}

      {scanning && (
        <Suspense fallback={<div role="status" className="fixed inset-0 z-50 grid place-items-center bg-scrim text-lg font-semibold text-on-solid">{strings.scanner.starting}</div>}>
          <QrScanner
            onClose={() => setScanning(false)}
            onVisitorPass={(c) => {
              setScanning(false)
              setCode(formatPassCode(c))
              void find({ code: c })
            }}
          />
        </Suspense>
      )}
    </div>
  )
}
