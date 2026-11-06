import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { strings } from '@/lib/strings'

const t = strings.platform.invites

const EXPIRY_OPTIONS = [1, 3, 7, 14, 30] as const
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface NewInviteValues {
  companyHint?: string
  lockEmail?: string
  expiresInDays: number
}

/** Plain controlled form: the values go to `onSubmit` and nowhere else. Disabled while a result card is open. */
export function NewInviteForm({ onSubmit, disabled }: { onSubmit: (v: NewInviteValues) => Promise<void>; disabled: boolean }) {
  const [company, setCompany] = useState('')
  const [email, setEmail] = useState('')
  const [days, setDays] = useState<number>(7)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<{ company?: string; email?: string }>({})

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const c = company.trim()
    const m = email.trim().toLowerCase()
    const next: typeof errors = {}
    if (c.length > 80) next.company = t.companyTooLong
    if (m && !EMAIL.test(m)) next.email = t.invalidEmail
    setErrors(next)
    if (next.company || next.email) return
    setBusy(true)
    try {
      await onSubmit({ ...(c ? { companyHint: c } : {}), ...(m ? { lockEmail: m } : {}), expiresInDays: days })
      setCompany('')
      setEmail('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="space-y-4 rounded-xl border border-slate-200 bg-surface p-5" aria-label={t.newTitle}>
      <h2 className="text-base font-semibold">{t.newTitle}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t.company} hint={t.companyHint} optional value={company} onChange={(e) => setCompany(e.target.value)} error={errors.company} maxLength={200} disabled={disabled} autoComplete="off" />
        <Input label={t.email} hint={t.emailHint} optional type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} disabled={disabled} autoComplete="off" />
      </div>
      <div className="sm:max-w-48">
        <Select label={t.expiry} value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={disabled}>
          {EXPIRY_OPTIONS.map((d) => (
            <option key={d} value={d}>{t.days(d)}</option>
          ))}
        </Select>
      </div>
      <Button type="submit" loading={busy} disabled={disabled}>{busy ? t.creating : t.create}</Button>
    </form>
  )
}
