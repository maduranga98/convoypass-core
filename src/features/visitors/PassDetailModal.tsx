import { useState } from 'react'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { useDriverPhotoUrl } from '@/features/shared/queries'
import { appBase } from '@/lib/appUrl'
import { revokeVisitorPass, updateVisitor } from '@/lib/api'
import { apiErrorMessage } from '@/lib/errors'
import { strings } from '@/lib/strings'
import { visitorStrings } from '@/lib/visitorStrings'
import { effectiveStatus, isOverstay, visitorQrPayload } from '@/lib/visitorLogic'
import type { WithId } from '@/types'
import type { Visitor, VisitorPass } from '@/types/visitors'
import { isoDay, stamp, validLabel } from './format'
import { PassActions, PassSlipCard } from './PassSlip'
import { useVisitors } from './queries'
import { OverTimeChip, VisitorStatusBadge } from './VisitorStatus'

const t = visitorStrings.detail

/** One pass: its details, the slip (to print or share again), and Cancel pass while it is still unused. */
export function PassDetailModal({ pass, now, onClose }: { pass: WithId<VisitorPass> | null; now: number; onClose: () => void }) {
  return (
    <Modal open={pass !== null} onClose={onClose} title={t.title} variant="drawer">
      {pass && <Detail pass={pass} now={now} onClose={onClose} />}
    </Modal>
  )
}

function Detail({ pass, now, onClose }: { pass: WithId<VisitorPass>; now: number; onClose: () => void }) {
  const visitors = useVisitors()
  const visitor = visitors.data?.find((v) => v.id === pass.visitorId) ?? null
  const photo = useDriverPhotoUrl(pass.photoPath, visitor?.updatedAt?.seconds)
  const [revoking, setRevoking] = useState(false)
  const [editing, setEditing] = useState(false)
  const status = effectiveStatus({ status: pass.status, validUntil: pass.validUntil.toMillis() }, now)
  const over = isOverstay({ status: pass.status, checkInAt: pass.checkInAt?.toMillis() ?? null, maxDwellMinutes: pass.maxDwellMinutes }, now)
  const shareable = status === 'active' || status === 'checked_in'
  const slip = {
    visitorName: pass.visitorName,
    organization: pass.visitorOrganization,
    hostName: pass.hostName,
    purposeOfVisit: pass.purposeOfVisit,
    passCode: pass.passCode,
    qrPayload: visitorQrPayload(appBase?.url ?? window.location.origin, pass.passCode),
    siteName: pass.siteName,
    validLabel: validLabel(isoDay(pass.validFrom.toMillis()), isoDay(pass.validUntil.toMillis())),
  }

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center gap-3">
        <Avatar name={pass.visitorName} src={photo.data ?? null} alt="" className="size-14 text-base" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold text-ink">{pass.visitorName}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <VisitorStatusBadge status={status} />
            {over && <OverTimeChip />}
          </div>
        </div>
      </div>

      {shareable && (
        <>
          <PassSlipCard slip={slip} />
          <PassActions slip={slip} />
        </>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <Row label={visitorStrings.columns.valid} value={slip.validLabel} />
        <Row label={visitorStrings.columns.site} value={pass.siteName} />
        {pass.hostName && <Row label={visitorStrings.slip.host} value={pass.hostName} />}
        <Row label={visitorStrings.slip.purpose} value={pass.purposeOfVisit} />
        <Row label={t.issuedBy} value={`${pass.issuedBy.name} · ${stamp(pass.issuedAt.toMillis())}`} />
        <Row label={t.stayLimit} value={t.minutes(pass.maxDwellMinutes)} />
        {pass.checkInAt && <Row label={t.checkedIn} value={`${stamp(pass.checkInAt.toMillis())}${pass.checkInBy ? ` · ${pass.checkInBy.name}` : ''}`} />}
        {pass.checkOutAt && <Row label={t.checkedOut} value={`${stamp(pass.checkOutAt.toMillis())}${pass.checkOutBy ? ` · ${pass.checkOutBy.name}` : ''}`} />}
        {pass.revokeReason && <Row label={t.revokeReason} value={pass.revokeReason} />}
        {pass.notes && <Row label={visitorStrings.form.notes} value={pass.notes} />}
      </dl>

      {editing && visitor ? (
        <EditVisitorForm visitor={visitor} onDone={() => setEditing(false)} />
      ) : (
        <div className="flex flex-wrap gap-2 print:hidden">
          {visitor && <Button variant="secondary" onClick={() => setEditing(true)}>{t.edit}</Button>}
          {status === 'active' && <Button variant="danger" onClick={() => setRevoking(true)}>{t.revoke}</Button>}
          <Button variant="ghost" onClick={onClose}>{strings.common.close}</Button>
        </div>
      )}

      <RevokeDialog pass={revoking ? pass : null} onClose={() => setRevoking(false)} onDone={onClose} />
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-600">{label}</dt>
      <dd className="font-medium break-words text-ink">{value}</dd>
    </>
  )
}

function RevokeDialog({ pass, onClose, onDone }: { pass: WithId<VisitorPass> | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirm = async () => {
    if (!pass) return
    setBusy(true)
    setError(null)
    try {
      await revokeVisitorPass({ passId: pass.id, ...(reason.trim() ? { reason: reason.trim() } : {}) })
      toast.success(t.revoked)
      onClose()
      onDone()
    } catch (e) {
      setError(apiErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={pass !== null} onClose={onClose} title={t.revokeTitle}>
      <div className="space-y-4 p-6">
        <p className="text-sm text-slate-700">{t.revokeBody}</p>
        {error && <NotificationBanner tone="error">{error}</NotificationBanner>}
        <Textarea label={t.revokeReason} optional rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t.keep}</Button>
          <Button variant="danger" loading={busy} onClick={() => void confirm()}>{t.revokeConfirm}</Button>
        </div>
      </div>
    </Modal>
  )
}

function EditVisitorForm({ visitor, onDone }: { visitor: WithId<Visitor>; onDone: () => void }) {
  const [name, setName] = useState(visitor.fullName)
  const [phone, setPhone] = useState(/^94\d{9}$/.test(visitor.phone) ? `0${visitor.phone.slice(2)}` : visitor.phone)
  const [idNumber, setIdNumber] = useState(visitor.idNumber ?? '')
  const [organization, setOrganization] = useState(visitor.organization ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = name.trim().length >= 2 && phone.trim().length >= 7

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await updateVisitor({ visitorId: visitor.id, fullName: name.trim(), phone: phone.trim(), idNumber: idNumber.trim() || null, organization: organization.trim() || null })
      toast.success(t.saved)
      onDone()
    } catch (e) {
      setError(apiErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="space-y-4 border-t border-slate-100 pt-4 print:hidden"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) void save()
      }}
    >
      {error && <NotificationBanner tone="error">{error}</NotificationBanner>}
      <Input label={visitorStrings.form.fullName} value={name} onChange={(e) => setName(e.target.value)} />
      <Input label={visitorStrings.form.phone} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <Input label={visitorStrings.form.idNumber} optional value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
      <Input label={visitorStrings.form.organization} optional value={organization} onChange={(e) => setOrganization(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>{strings.common.cancel}</Button>
        <Button type="submit" loading={busy} disabled={!valid}>{t.saveVisitor}</Button>
      </div>
    </form>
  )
}
