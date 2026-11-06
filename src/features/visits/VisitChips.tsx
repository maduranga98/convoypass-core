import { CircleCheckBig, CircleDashed, Clock, PackageX } from 'lucide-react'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import type { Visit } from '@/types/visits'

const t = strings.visits

/** Unloading state of a visit. Always a word plus an icon; the same colours as the rest of the app (done = green, waiting = amber, not done = red outline). */
export function UnloadChip({ visit }: { visit: Pick<Visit, 'unloadingCheck'> }) {
  const u = visit.unloadingCheck
  const [label, Icon, tone] = !u
    ? [t.unloadState.notLogged, CircleDashed, 'bg-accent text-ink']
    : u.unloaded
      ? [t.unloadState.unloaded, CircleCheckBig, 'bg-success-strong text-on-solid']
      : [t.unloadState.notUnloaded, PackageX, 'border-2 border-danger-strong text-danger-ink']
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-sm font-extrabold', tone)}>
      <Icon aria-hidden className="size-4" />
      {label}
    </span>
  )
}

/** "Long stay": the dwell warning. Informational only. */
export function DwellChip() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-sm font-extrabold text-ink">
      <Clock aria-hidden className="size-4" />
      {t.dwellChip}
    </span>
  )
}
