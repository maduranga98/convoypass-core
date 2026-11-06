import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { recordQualification } from '@/lib/api'
import { apiErrorMessage } from '@/lib/errors'
import { isExpiryDate } from '@/lib/expiry'
import { qualificationExpiry } from '@/lib/requirementLogic'
import { strings } from '@/lib/strings'

const t = strings.qualifications.dialog

export interface RecordTarget {
  driverId: string
  driverName: string
  typeId: string
  typeName: string
}

/** Admin or Officer: the training was completed on this day. The server adds one year; the date cannot be in the future. */
export function RecordQualificationDialog({ target, today, onClose }: { target: RecordTarget | null; today: string; onClose: () => void }) {
  return (
    <Modal open={target !== null} onClose={onClose} title={target ? t.title(target.typeName, target.driverName) : ''} variant="sheet">
      {target && <Form key={`${target.driverId}_${target.typeId}`} target={target} today={today} onClose={onClose} />}
    </Modal>
  )
}

function Form({ target, today, onClose }: { target: RecordTarget; today: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [date, setDate] = useState(today)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = isExpiryDate(date) && date <= today

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      await recordQualification({ driverId: target.driverId, typeId: target.typeId, completedOn: date })
      await queryClient.invalidateQueries({ queryKey: ['drivers'] })
      toast.success(t.saved)
      onClose()
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      {error && <NotificationBanner tone="error">{error}</NotificationBanner>}
      <Input label={t.date} type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} hint={valid ? `${t.hint} (${qualificationExpiry(date)})` : t.hint} />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {strings.common.cancel}
        </Button>
        <Button type="submit" loading={busy} disabled={!valid}>
          {t.submit}
        </Button>
      </div>
    </form>
  )
}
