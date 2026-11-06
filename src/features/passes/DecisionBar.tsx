import { Check, X } from 'lucide-react'
import { useRef } from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'

const t = strings.approvals.decision

interface Props {
  onApprove: () => void
  onReject: () => void
  /** The decision in flight, if any. Both buttons are locked while one is. */
  busy: 'approve' | 'reject' | null
  /** Locks both buttons (changed pass, expired pass, ...). */
  disabled?: boolean
  /** `sticky` pins it to the bottom of the screen (mobile review); `inline` sits in the flow (panel). */
  layout?: 'sticky' | 'inline'
  className?: string
}

/** Approve and Reject, large. A second tap while a decision is in flight is ignored. */
export function DecisionBar({ onApprove, onReject, busy, disabled = false, layout = 'sticky', className }: Props) {
  const locked = useRef(false)
  const locks = busy !== null || disabled

  const fire = (fn: () => void) => () => {
    if (locks || locked.current) return
    locked.current = true
    try {
      fn()
    } finally {
      // Released on the next frame: `busy` takes over from here.
      requestAnimationFrame(() => (locked.current = false))
    }
  }

  return (
    <div
      className={cn(
        'flex gap-3 bg-surface p-3',
        layout === 'sticky' ? 'sticky bottom-0 z-10 border-t border-slate-300 pb-[max(0.75rem,env(safe-area-inset-bottom))]' : 'rounded-xl border border-slate-300',
        className,
      )}
    >
      <Button
        variant="secondary"
        className="h-14 flex-1 border-2 border-danger-strong text-lg font-bold text-danger-ink hover:bg-danger-soft"
        disabled={locks}
        loading={busy === 'reject'}
        icon={busy === 'reject' ? undefined : <X aria-hidden className="size-5" />}
        onClick={fire(onReject)}
      >
        {t.reject}
      </Button>
      <Button
        className="h-14 flex-[1.4] bg-success-strong text-lg font-bold hover:bg-success-hover"
        disabled={locks}
        loading={busy === 'approve'}
        icon={busy === 'approve' ? undefined : <Check aria-hidden className="size-5" />}
        onClick={fire(onApprove)}
      >
        {t.approve}
      </Button>
    </div>
  )
}
