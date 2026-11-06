import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import type { PassStatus, PassDoc } from '@/types/passes'
import { formatTime, toMs } from './passView'

const t = strings.pass.status

/** How many of the 4 steps are complete for a status. A rejected pass has only "Submitted" behind it. */
const stepsDone = (status: PassStatus): number =>
  ({ submitted: 1, supervisor_approved: 2, officer_approved: 3, checked_in: 4, rejected: 1 })[status]

const STEPS = [t.steps.submitted, t.steps.supervisor, t.steps.officer, t.steps.gate] as const

type Detail = Pick<PassDoc, 'submittedAt' | 'supervisor' | 'officer'> & Partial<Pick<PassDoc, 'checkIn'>>

/** Who did a step and when: shown under the step label when the pass itself is given. */
function stepNote(i: number, detail: Detail | undefined): string | null {
  if (!detail) return null
  const stamp = i === 1 ? detail.supervisor : i === 2 ? detail.officer : i === 3 ? detail.checkIn : null
  if (i === 0) return formatTime(toMs(detail.submittedAt))
  return stamp ? `${stamp.name} · ${formatTime(toMs(stamp.at))}` : null
}

/** Submitted → Supervisor → Officer → Gate. With `pass`, each done step also shows the name and time. */
export function PassTimeline({ status, tone = 'neutral', pass }: { status: PassStatus; tone?: 'neutral' | 'success'; pass?: Detail }) {
  const done = stepsDone(status)
  return (
    <ol aria-label={t.timeline} className="flex w-full items-start">
      {STEPS.map((label, i) => {
        const complete = i < done
        const current = i === done && status !== 'rejected'
        return (
          <li key={label} className="relative flex flex-1 flex-col items-center gap-2 text-center" aria-current={current ? 'step' : undefined}>
            {i > 0 && (
              <span aria-hidden className={cn('absolute top-4 right-1/2 h-0.5 w-full -translate-y-1/2', i <= done - 1 ? (tone === 'success' ? 'bg-surface' : 'bg-success') : tone === 'success' ? 'bg-on-solid/40' : 'bg-slate-300')} />
            )}
            <span
              className={cn(
                'relative z-10 grid size-8 place-items-center rounded-full border-2 text-sm font-bold',
                complete
                  ? tone === 'success' ? 'border-on-solid bg-surface text-success-strong' : 'border-success bg-success text-on-solid'
                  : current
                    ? tone === 'success' ? 'border-on-solid bg-transparent text-on-solid' : 'border-brand bg-surface text-ink'
                    : tone === 'success' ? 'border-on-solid/70 text-on-solid' : 'border-slate-500 bg-surface text-slate-700',
              )}
            >
              {complete ? <Check aria-hidden className="size-4" /> : i + 1}
            </span>
            <span className={cn('text-xs font-semibold', tone === 'success' ? 'text-on-solid' : complete ? 'text-ink' : 'text-slate-500')}>
              {label}
              <span className="sr-only">{complete ? ' (done)' : current ? ' (waiting)' : ''}</span>
            </span>
            {complete && stepNote(i, pass) && (
              <span className={cn('max-w-full break-words text-xs', tone === 'success' ? 'text-on-solid/90' : 'text-slate-600')}>{stepNote(i, pass)}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
