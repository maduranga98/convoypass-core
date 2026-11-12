import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { useSession } from '@/features/auth/useAuth'
import { useTenant } from '@/features/passes/queries'
import { updateVisitorSettings } from '@/lib/api'
import { apiErrorMessage } from '@/lib/errors'
import { strings } from '@/lib/strings'
import { visitorStrings } from '@/lib/visitorStrings'
import { MAX_MAX_DWELL_MINUTES, MAX_VALID_DAYS, MIN_MAX_DWELL_MINUTES, maxDwellOk, validDaysOk, visitorSettingsOf } from '@/lib/visitorLogic'

const t = visitorStrings.settings

/** Admin only: the longest stay (a flag, never a block) and the default validity of a new pass. */
export function VisitorSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={t.title}>
      {open && <SettingsForm onClose={onClose} />}
    </Modal>
  )
}

function SettingsForm({ onClose }: { onClose: () => void }) {
  const { claims } = useSession()
  const tenant = useTenant(claims.tenantId)
  const current = visitorSettingsOf(tenant.data)
  const [maxDwell, setMaxDwell] = useState(current.maxDwellMinutes)
  const [validDays, setValidDays] = useState(current.defaultValidDays)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  const save = async () => {
    setShowErrors(true)
    if (!maxDwellOk(maxDwell) || !validDaysOk(validDays)) return
    setSaving(true)
    setError(null)
    try {
      await updateVisitorSettings({ maxDwellMinutes: maxDwell, defaultValidDays: validDays })
      toast.success(t.saved)
      onClose()
    } catch (e) {
      setError(apiErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 p-6">
      <p className="text-sm text-slate-600">{t.intro}</p>
      {error && <NotificationBanner tone="error">{error}</NotificationBanner>}
      <Input
        label={t.maxDwell}
        type="number"
        inputMode="numeric"
        min={MIN_MAX_DWELL_MINUTES}
        max={MAX_MAX_DWELL_MINUTES}
        value={Number.isNaN(maxDwell) ? '' : maxDwell}
        hint={t.maxDwellHint(MIN_MAX_DWELL_MINUTES, MAX_MAX_DWELL_MINUTES)}
        error={showErrors && !maxDwellOk(maxDwell) ? t.maxDwellHint(MIN_MAX_DWELL_MINUTES, MAX_MAX_DWELL_MINUTES) : undefined}
        onChange={(e) => setMaxDwell(e.target.value === '' ? Number.NaN : Number(e.target.value))}
      />
      <Input
        label={t.validDays}
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_VALID_DAYS}
        value={Number.isNaN(validDays) ? '' : validDays}
        hint={t.validDaysHint(MAX_VALID_DAYS)}
        error={showErrors && !validDaysOk(validDays) ? t.validDaysHint(MAX_VALID_DAYS) : undefined}
        onChange={(e) => setValidDays(e.target.value === '' ? Number.NaN : Number(e.target.value))}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{strings.common.cancel}</Button>
        <Button loading={saving} onClick={() => void save()}>{t.save}</Button>
      </div>
    </div>
  )
}
