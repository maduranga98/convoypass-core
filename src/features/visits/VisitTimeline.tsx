import { CircleCheckBig, CircleDashed, LogIn, LogOut, PackageCheck, PackageX } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import type { Visit } from '@/types/visits'
import { dateTime } from './time'

const t = strings.visits.detail

interface Stage {
  key: string
  title: string
  done: boolean
  icon: ReactNode
  when: string | null
  who: string | null
  detail: string | null
}

/** The three stages of a visit with the time and the person who did each. A stage that has not happened yet says so. */
export function VisitTimeline({ visit }: { visit: Visit }) {
  const u = visit.unloadingCheck
  const stages: Stage[] = [
    {
      key: 'in',
      title: t.checkIn,
      done: true,
      icon: <LogIn aria-hidden className="size-5" />,
      when: dateTime(visit.checkIn.timestamp.toMillis()),
      who: t.by(visit.checkIn.securityUserName),
      detail: visit.checkIn.gateLocation ? t.at(visit.checkIn.gateLocation) : null,
    },
    {
      key: 'unload',
      title: t.unloading,
      done: u !== null,
      icon: u && !u.unloaded ? <PackageX aria-hidden className="size-5" /> : <PackageCheck aria-hidden className="size-5" />,
      when: u ? dateTime(u.timestamp.toMillis()) : null,
      who: u ? t.by(u.officerName) : null,
      detail: u ? [u.unloaded ? t.unloaded : t.notUnloaded, u.unloadLocation ? t.location(u.unloadLocation) : null].filter(Boolean).join(' · ') : null,
    },
    {
      key: 'out',
      title: t.checkOut,
      done: visit.checkOut !== null,
      icon: <LogOut aria-hidden className="size-5" />,
      when: visit.checkOut ? dateTime(visit.checkOut.timestamp.toMillis()) : null,
      who: visit.checkOut ? t.by(visit.checkOut.securityUserName) : null,
      detail: visit.checkOut ? null : t.onSiteNow,
    },
  ]
  return (
    <ol aria-label={t.timeline} className="space-y-0">
      {stages.map((s, i) => (
        <li key={s.key} className="relative flex gap-3 pb-6 last:pb-0">
          {i < stages.length - 1 && <span aria-hidden className="absolute top-9 bottom-0 left-[1.0625rem] w-0.5 bg-slate-200" />}
          <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', s.done ? 'bg-success-strong text-on-solid' : 'border-2 border-slate-300 bg-surface text-slate-600')}>
            {s.done ? s.icon : <CircleDashed aria-hidden className="size-5" />}
          </span>
          <div className="min-w-0 pt-0.5">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              {s.title}
              {s.done && <CircleCheckBig aria-hidden className="size-4 text-success-strong" />}
            </p>
            {s.when ? (
              <>
                <p className="text-sm text-slate-800 tabular-nums">{s.when}</p>
                <p className="text-sm text-slate-700">{s.who}</p>
              </>
            ) : (
              <p className="text-sm text-slate-700">{t.waiting}</p>
            )}
            {s.detail && <p className="text-sm font-medium text-slate-800">{s.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}
