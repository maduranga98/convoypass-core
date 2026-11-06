import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { strings } from '@/lib/strings'

const t = strings.approvals.decision

/** "This pass changed. Please review it again." with the one action that unlocks the decision buttons. */
export function PassChangedBanner({ onAcknowledge }: { onAcknowledge: () => void }) {
  return (
    <div role="alert" className="space-y-2 rounded-xl border-2 border-accent bg-warning-soft p-4">
      <p className="flex items-center gap-2 text-base font-bold text-warning-ink">
        <TriangleAlert aria-hidden className="size-5" />
        {t.changedTitle}
      </p>
      <p className="text-sm text-warning-ink">{t.changedBody}</p>
      <Button className="h-12 w-full text-base" onClick={onAcknowledge}>{t.reviewAgain}</Button>
    </div>
  )
}
