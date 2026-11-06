import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { strings } from '@/lib/strings'

interface Props {
  loginId: string
  secret: string
  onDone: () => void
}

/** Shown once, right after a credential is set. Nothing here is persisted. */
/** Office staff only (drivers and security get the PIN card, Module 12). */
export function CredentialsReveal({ loginId, secret, onDone }: Props) {
  const [copied, setCopied] = useState(false)
  const t = strings.admin.createUser

  const copy = async () => {
    const text = `${loginId}\n${secret}`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success(t.credentialsCopied)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(strings.common.somethingWrong)
    }
  }

  return (
    <div className="space-y-5">
      <p className="rounded-lg bg-warning-soft px-3 py-2.5 text-sm text-warning-ink">{t.credentialsWarning}</p>
      <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <dt className="text-slate-500">{t.loginId}</dt>
          <dd className="break-all font-mono">{loginId}</dd>
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <dt className="text-slate-500">{t.secretPassword}</dt>
          <dd className="font-mono text-base tracking-wider">{secret}</dd>
        </div>
      </dl>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={() => void copy()} icon={copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}>
          {copied ? strings.common.copied : t.copyCredentials}
        </Button>
        <Button className="flex-1" onClick={onDone}>
          {strings.common.done}
        </Button>
      </div>
    </div>
  )
}
