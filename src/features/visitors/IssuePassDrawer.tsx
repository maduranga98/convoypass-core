import { zodResolver } from '@hookform/resolvers/zod'
import { Search } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { useSession } from '@/features/auth/useAuth'
import { PhotoField } from '@/features/drivers/PhotoField'
import { todayKey, useTenant } from '@/features/passes/queries'
import { apiErrorMessage } from '@/lib/errors'
import { gatesOf } from '@/lib/gates'
import { isoFromDateKey } from '@/lib/expiry'
import { newVisitorId, newVisitorPassId, visitorPhotoPath } from '@/lib/ids'
import { issueVisitorPass } from '@/lib/api'
import { uploadPhoto } from '@/lib/storage'
import { visitorStrings } from '@/lib/visitorStrings'
import { addDaysIso, visitorSettingsOf } from '@/lib/visitorLogic'
import { z } from '@/lib/zod'
import type { WithId } from '@/types'
import type { IssueVisitorPassResult, Visitor } from '@/types/visitors'
import { PassActions, PassSlipCard, type SlipData } from './PassSlip'
import { PlanUsage } from './PlanUsage'
import { usePlanUsage, useVisitors } from './queries'
import { validLabel } from './format'

const t = visitorStrings.form

const schema = z
  .object({
    fullName: z.string().trim().min(2, t.errors.name).max(100),
    phone: z.string().trim().min(7, t.errors.phone).max(30, t.errors.phone),
    idNumber: z.string().trim().max(30),
    organization: z.string().trim().max(100),
    hostName: z.string().trim().max(100),
    purposeOfVisit: z.string().trim().min(3, t.errors.purpose).max(200),
    siteId: z.string().min(1),
    validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t.errors.dates),
    validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t.errors.dates),
    notes: z.string().trim().max(500),
  })
  .refine((v) => v.validUntil >= v.validFrom, { path: ['validUntil'], message: t.errors.dates })
type Values = z.infer<typeof schema>

/** `94771234567` -> `0771234567`: the number as the form takes it. */
const localPhone = (p: string): string => (/^94\d{9}$/.test(p) ? `0${p.slice(2)}` : p)

/** Issue a visitor pass. On success the same drawer shows the QR, the code and print / WhatsApp actions. */
export function IssuePassDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={t.title} variant="drawer">
      {open && <IssueFlow onClose={onClose} />}
    </Modal>
  )
}

function IssueFlow({ onClose }: { onClose: () => void }) {
  const { claims } = useSession()
  const tenant = useTenant(claims.tenantId)
  const gates = gatesOf(tenant.data)
  const settings = visitorSettingsOf(tenant.data)
  const today = isoFromDateKey(todayKey(tenant.data))
  const plan = usePlanUsage()
  const visitors = useVisitors()

  // Chosen once per opening: a retry of a failed call reuses them (the server recognises a repeat), a new pass gets new ones.
  const passId = useRef(newVisitorPassId())
  const [visitorId, setVisitorId] = useState(() => newVisitorId())
  const [returning, setReturning] = useState<WithId<Visitor> | null>(null)
  const [needle, setNeedle] = useState('')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [done, setDone] = useState<{ result: IssueVisitorPassResult; slip: SlipData } | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: '', phone: '', idNumber: '', organization: '', hostName: '', purposeOfVisit: '', notes: '',
      siteId: gates[0]?.id ?? '',
      validFrom: today,
      validUntil: addDaysIso(today, settings.defaultValidDays - 1),
    },
  })

  const matches = useMemo(() => {
    const n = needle.trim().toLowerCase()
    if (n.length < 2) return []
    const digits = n.replace(/\D/g, '')
    return (visitors.data ?? [])
      .filter((v) => v.fullName.toLowerCase().includes(n) || (digits.length >= 3 && v.phone.includes(digits)) || (v.idKey ?? '').toLowerCase().includes(n.replace(/[^a-z0-9]/g, '')))
      .slice(0, 5)
  }, [visitors.data, needle])

  const pick = (v: WithId<Visitor>) => {
    setReturning(v)
    setVisitorId(v.id)
    setNeedle('')
    setPhoto(null)
    reset((cur) => ({ ...cur, fullName: v.fullName, phone: localPhone(v.phone), idNumber: v.idNumber ?? '', organization: v.organization ?? '' }))
  }

  const submit = async (v: Values) => {
    setFormError(null)
    try {
      if (photo) await uploadPhoto(visitorPhotoPath(claims.tenantId, visitorId), photo)
      const result = await issueVisitorPass({
        passId: passId.current,
        visitorId,
        visitor: { fullName: v.fullName, phone: v.phone, idNumber: v.idNumber || null, organization: v.organization || null },
        ...(photo ? { hasPhoto: true } : {}),
        ...(v.hostName ? { hostName: v.hostName } : {}),
        purposeOfVisit: v.purposeOfVisit,
        siteId: v.siteId,
        validFrom: v.validFrom,
        validUntil: v.validUntil,
        ...(v.notes ? { notes: v.notes } : {}),
      })
      setDone({
        result,
        slip: {
          visitorName: v.fullName,
          organization: v.organization || null,
          hostName: v.hostName || null,
          purposeOfVisit: v.purposeOfVisit,
          passCode: result.passCode,
          qrPayload: result.qrPayload,
          siteName: result.siteName,
          validLabel: validLabel(v.validFrom, v.validUntil),
        },
      })
      toast.success(visitorStrings.slip.issued)
    } catch (e) {
      setFormError(apiErrorMessage(e))
    }
  }

  if (done) {
    return (
      <div className="space-y-4 p-6">
        <PassSlipCard slip={done.slip} />
        <PassActions slip={done.slip} />
        <PlanUsageAfter result={done.result} />
        <div className="flex justify-end print:hidden">
          <Button onClick={onClose}>{visitorStrings.slip.done}</Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={(e) => void handleSubmit(submit)(e)} noValidate className="space-y-5 p-6">
      <PlanUsage />
      {plan.full && <NotificationBanner tone="warning">{visitorStrings.usage.full}</NotificationBanner>}
      {formError && <NotificationBanner tone="error">{formError}</NotificationBanner>}

      <div className="space-y-2">
        <label htmlFor="returning-search" className="text-sm font-medium text-slate-700">{t.returning}</label>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
          <input
            id="returning-search"
            type="search"
            autoComplete="off"
            value={needle}
            onChange={(e) => setNeedle(e.target.value)}
            placeholder={t.returningHint}
            className="block h-11 w-full rounded-lg border border-slate-300 bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-focus"
          />
        </div>
        {needle.trim().length >= 2 && (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-surface" aria-live="polite">
            {matches.length === 0 ? (
              <li className="px-3 py-2 text-sm text-slate-600">{t.returningNone}</li>
            ) : (
              matches.map((v) => (
                <li key={v.id}>
                  <button type="button" onClick={() => pick(v)} className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-focus">
                    <span className="text-sm font-semibold text-ink">{v.fullName}</span>
                    <span className="text-xs text-slate-600">{[v.organization, localPhone(v.phone)].filter(Boolean).join(' · ')}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      <Input label={t.fullName} autoComplete="off" error={errors.fullName?.message} {...register('fullName')} />
      <Input label={t.phone} type="tel" inputMode="tel" autoComplete="off" hint={t.phoneHint} error={errors.phone?.message} {...register('phone')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t.idNumber} optional autoComplete="off" error={errors.idNumber?.message} {...register('idNumber')} />
        <Input label={t.organization} optional autoComplete="off" error={errors.organization?.message} {...register('organization')} />
      </div>
      <PhotoField name={returning?.fullName ?? ''} value={photo} onChange={setPhoto} />
      <Input label={t.host} optional hint={t.hostHint} autoComplete="off" error={errors.hostName?.message} {...register('hostName')} />
      <Input label={t.purpose} autoComplete="off" error={errors.purposeOfVisit?.message} {...register('purposeOfVisit')} />
      {gates.length > 1 && (
        <Select label={t.site} {...register('siteId')}>
          {gates.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </Select>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t.validFrom} type="date" min={today} error={errors.validFrom?.message} {...register('validFrom')} />
        <Input label={t.validUntil} type="date" min={today} error={errors.validUntil?.message} {...register('validUntil')} />
      </div>
      <Textarea label={t.notes} optional rows={2} error={errors.notes?.message} {...register('notes')} />

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onClose}>{t.cancel}</Button>
        <Button type="submit" loading={isSubmitting} disabled={plan.full}>{t.submit}</Button>
      </div>
    </form>
  )
}

/** The count straight from the server's answer (the live counter catches up a moment later). */
function PlanUsageAfter({ result }: { result: IssueVisitorPassResult }) {
  if (result.cap === null) return null
  return <p className="text-sm text-slate-600 print:hidden">{visitorStrings.usage.label(result.used, result.cap)}</p>
}
