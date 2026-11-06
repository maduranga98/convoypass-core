import { BarChart3, ClipboardX, DoorOpen, Gauge, Ticket, Truck, UserRound } from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { REPORT_TYPES, type ReportType } from '@/types/reports'

const ICONS: Record<ReportType, ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  gate_log: DoorOpen,
  contractor_activity: BarChart3,
  turnaround: Gauge,
  rejections: ClipboardX,
  vehicle_history: Truck,
  driver_history: UserRound,
  gate_passes: Ticket,
}

/** A list of cards, one line each. The current report is marked with `aria-current`. */
export function ReportPicker({ current, onPick }: { current: ReportType | null; onPick: (type: ReportType) => void }) {
  return (
    <ul aria-label={strings.reports.pickerLabel} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 print:hidden">
      {REPORT_TYPES.map((type) => {
        const Icon = ICONS[type]
        const info = strings.reports.types[type]
        const active = current === type
        return (
          <li key={type}>
            <button
              type="button"
              aria-current={active ? 'true' : undefined}
              onClick={() => onPick(type)}
              className={cn(
                'flex h-full w-full items-start gap-3 rounded-xl border bg-surface p-4 text-left focus-visible:outline-2 focus-visible:outline-focus',
                active ? 'border-brand bg-accent-soft' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
              )}
            >
              <Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', active ? 'text-ink' : 'text-slate-500')} />
              <span>
                <span className="block font-medium text-ink">{info.title}</span>
                <span className="block text-sm text-slate-500">{info.description}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
