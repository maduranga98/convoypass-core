import { daysUntil } from '@/lib/expiry'
import { strings } from '@/lib/strings'
import { useTenantDocuments } from './documents'

const t = strings.eligibility

/** One expiry date with how far away it is, e.g. "2026-11-02 · in 11 days". */
export function ExpiryRow({ label, date }: { label: string; date: string | null | undefined }) {
  const { today } = useTenantDocuments()
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">
        {date ? (
          <>
            <span className="font-mono">{date}</span> <span className="font-normal text-slate-500">· {t.daysLeft(daysUntil(date, today))}</span>
          </>
        ) : (
          <span className="font-normal text-slate-500">{t.notTracked}</span>
        )}
      </dd>
    </div>
  )
}
