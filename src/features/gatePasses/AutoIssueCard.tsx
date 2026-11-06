import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useSession } from '@/features/auth/useAuth'
import { useTenant } from '@/features/passes/queries'
import { apiErrorMessage } from '@/lib/errors'
import { strings } from '@/lib/strings'
import { useGatePassMutations } from './queries'

const t = strings.gatePasses.auto

/**
 * The company-level choice between reviewing the month-end list (the default) and issuing passes to everyone qualified
 * automatically at month rollover. Changing it changes what happens next month with nobody watching, so it asks first.
 */
export function AutoIssueCard() {
  const { claims } = useSession()
  const tenant = useTenant(claims.tenantId)
  const { setAutoIssue } = useGatePassMutations()
  const [confirming, setConfirming] = useState(false)
  const on = tenant.data?.autoIssueGatePasses === true

  const apply = () =>
    setAutoIssue.mutate(!on, {
      onSuccess: () => {
        toast.success(on ? t.savedOff : t.savedOn)
        setConfirming(false)
      },
      onError: (e) => {
        toast.error(apiErrorMessage(e))
        setConfirming(false)
      },
    })

  return (
    <section aria-labelledby="auto-issue-title" className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-surface p-4">
      <div className="min-w-0 flex-1">
        <h2 id="auto-issue-title" className="text-sm font-semibold">{t.title}</h2>
        <p id="auto-issue-hint" className="mt-0.5 text-sm text-slate-600">{on ? t.onHint : t.offHint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={t.label}
        aria-describedby="auto-issue-hint"
        disabled={tenant.isPending || setAutoIssue.isPending}
        onClick={() => setConfirming(true)}
        className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50 pointer-coarse:h-11 ${on ? 'border-success-strong bg-success-strong' : 'border-slate-400 bg-slate-200'}`}
      >
        <span aria-hidden className={`inline-block size-6 rounded-full bg-surface shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-0.5'}`} />
        <span className="sr-only">{on ? strings.gatePasses.status.active : t.offHint}</span>
      </button>
      <ConfirmDialog
        open={confirming}
        title={on ? t.confirmOffTitle : t.confirmOnTitle}
        body={on ? t.confirmOffBody : t.confirmOnBody}
        confirmLabel={on ? t.confirmOff : t.confirmOn}
        tone={on ? 'primary' : 'danger'}
        loading={setAutoIssue.isPending}
        onConfirm={apply}
        onCancel={() => setConfirming(false)}
      />
    </section>
  )
}
