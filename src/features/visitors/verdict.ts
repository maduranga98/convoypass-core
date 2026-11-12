import { CircleCheckBig, Clock, LogIn, ShieldX } from 'lucide-react'
import type { GateDef } from '@/lib/gates'
import { visitorStrings } from '@/lib/visitorStrings'
import type { VisitorPassView } from '@/types/visitors'
import { isoDay } from './format'

const t = visitorStrings.gate

export type Tone = 'go' | 'wait' | 'stop' | 'info'
export const TONE: Record<Tone, string> = {
  go: 'bg-success-strong text-on-solid',
  wait: 'bg-accent text-ink',
  stop: 'bg-danger-strong text-on-solid',
  info: 'bg-slate-200 text-ink',
}

export interface Verdict {
  tone: Tone
  label: string
  reason: string | null
  Icon: typeof LogIn
}

/** What the guard sees, from the pass alone (the server enforces every one of these again). */
export function verdictOf(view: VisitorPassView, gate: GateDef | null): Verdict {
  if (view.status === 'checked_in') return { tone: 'info', label: t.state.inside, reason: t.reason.insideShort, Icon: LogIn }
  if (view.status === 'checked_out') return { tone: 'stop', label: t.state.left, reason: t.reason.left, Icon: ShieldX }
  if (view.status === 'revoked') return { tone: 'stop', label: t.state.revoked, reason: t.reason.revoked, Icon: ShieldX }
  if (view.entry === 'expired' || view.status === 'expired') return { tone: 'stop', label: t.state.expired, reason: t.reason.expired, Icon: Clock }
  if (view.entry === 'not-yet-valid') return { tone: 'wait', label: t.state.notYet, reason: t.reason.notYet(isoDay(view.validFrom)), Icon: Clock }
  if (gate && view.siteId !== gate.id) return { tone: 'stop', label: t.state.wrongSite, reason: t.reason.wrongSite(view.siteName), Icon: ShieldX }
  return { tone: 'go', label: t.state.ok, reason: null, Icon: CircleCheckBig }
}

