import { CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { strings } from '@/lib/strings'
import type { BulkItemResult, PassWithId } from '@/types/passes'

const t = strings.approvals.bulk

interface Props {
  /** `null` = closed. */
  results: BulkItemResult[] | null
  /** The passes that were sent, to show plates instead of ids. */
  passes: readonly PassWithId[]
  onClose: () => void
}

/** Per-item outcome of a bulk approval: successes are counted (they are gone from the list), failures are listed. */
export function BulkResultsDialog({ results, passes, onClose }: Props) {
  const failed = results?.filter((r) => !r.ok) ?? []
  const ok = (results?.length ?? 0) - failed.length
  const plate = (id: string): string => passes.find((p) => p.id === id)?.plateNo ?? id

  return (
    <Modal
      open={results !== null}
      onClose={onClose}
      title={t.resultsTitle}
      footer={<Button className="h-11 w-full sm:w-auto" onClick={onClose}>{t.close}</Button>}
    >
      <div className="space-y-4">
        <p role="status" className="flex items-center gap-2 text-base font-semibold">
          {failed.length === 0 ? <CheckCircle2 aria-hidden className="size-6 text-success-strong" /> : <XCircle aria-hidden className="size-6 text-danger-strong" />}
          {t.resultsSummary(ok, failed.length)}
        </p>
        {failed.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t.failedHeading}</h3>
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-300">
              {failed.map((r) => (
                <li key={r.passId} className="px-3 py-2">
                  <p className="font-semibold">{plate(r.passId)}</p>
                  <p className="text-sm text-danger-ink">{t.itemError[r.error ?? 'internal']}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}
