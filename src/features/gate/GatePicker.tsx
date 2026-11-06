import { Check, MapPin } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/cn'
import type { GateDef } from '@/lib/gates'
import { strings } from '@/lib/strings'

const t = strings.gate

/** Bottom sheet listing the tenant's gates as large buttons. The choice is remembered on this phone. */
export function GatePicker({ open, gates, current, onPick, onClose }: {
  open: boolean
  gates: readonly GateDef[]
  current: string | null
  onPick: (id: string) => void
  onClose: () => void
}) {
  return (
    <Modal open={open} onClose={onClose} title={t.pickGateTitle} variant="sheet">
      <p className="mb-4 text-sm text-slate-700">{t.pickGateIntro}</p>
      <ul className="space-y-2">
        {gates.map((g) => (
          <li key={g.id}>
            <button
              type="button"
              onClick={() => onPick(g.id)}
              aria-pressed={current === g.id}
              className={cn(
                'flex min-h-14 w-full items-center gap-3 rounded-xl border-2 px-4 text-left text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                current === g.id ? 'border-brand bg-brand text-on-solid' : 'border-slate-300 bg-surface text-ink',
              )}
            >
              <MapPin aria-hidden className="size-5 shrink-0" />
              <span className="flex-1">{g.name}</span>
              {current === g.id && <Check aria-hidden className="size-6" />}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
