import { Check, Copy, Eye, EyeOff, Mail, MessageCircle } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { strings } from '@/lib/strings'
import { credentialsMessage, mailtoUrl, whatsappUrl } from './share'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.platform.credentials

export interface CredentialsView {
  company: string
  loginUrl: string
  email: string
  /** Shown once. Lives in this card's props only; the parent drops it when the card is confirmed or the page is left. */
  tempPassword: string
}

const linkClass =
  'inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-surface px-4 text-sm font-medium text-ink hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

function Row({ id, label, value, masked, onCopy, copied }: { id: string; label: string; value: string; masked?: boolean; onCopy: () => void; copied: boolean }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">{label}</label>
      <div className="flex gap-2">
        <input
          id={id}
          readOnly
          type={masked && !shown ? 'password' : 'text'}
          value={value}
          autoComplete="off"
          onFocus={(e) => e.currentTarget.select()}
          className="block h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-surface px-3 font-mono text-sm text-ink focus-visible:outline-2 focus-visible:outline-focus"
        />
        {masked && (
          <Button variant="secondary" aria-label={`${shown ? t.hide : t.show}: ${label}`} onClick={() => setShown((v) => !v)} icon={shown ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}>
            {shown ? t.hide : t.show}
          </Button>
        )}
        <Button variant="secondary" aria-label={`${t.copy}: ${label}`} onClick={onCopy} icon={copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}>
          {copied ? t.copied : t.copy}
        </Button>
      </div>
    </div>
  )
}

/**
 * The one place a temporary password is ever shown. It is held by the caller in state only (never a query cache, storage
 * or the console). The ONLY way to dismiss the card is "I've shared it", so the hand-over cannot be skipped by accident.
 */
export function CredentialsCard({ title = t.title, view, onConfirm }: { title?: string; view: CredentialsView; onConfirm: () => void }) {
  const [copied, setCopied] = useState<string | null>(null)
  const message = credentialsMessage({ company: view.company, loginUrl: view.loginUrl, email: view.email, password: view.tempPassword })

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000)
    } catch {
      /* no clipboard permission: show the value and copy it by hand */
    }
  }

  return (
    <section aria-labelledby="credentials-title" className="space-y-4 rounded-xl border border-accent/50 bg-warning-soft/60 p-5">
      <h2 id="credentials-title" className="text-base font-semibold">{title}</h2>
      <NotificationBanner tone="warning" role="alert">{t.warning}</NotificationBanner>
      <Row id="cred-url" label={t.loginUrl} value={view.loginUrl} onCopy={() => void copy('url', view.loginUrl)} copied={copied === 'url'} />
      <Row id="cred-email" label={t.email} value={view.email} onCopy={() => void copy('email', view.email)} copied={copied === 'email'} />
      <Row id="cred-password" label={t.password} value={view.tempPassword} masked onCopy={() => void copy('password', view.tempPassword)} copied={copied === 'password'} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void copy('all', message)} icon={copied === 'all' ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}>
          {copied === 'all' ? t.copied : t.copyAll}
        </Button>
        <a className={linkClass} href={whatsappUrl(message)} target="_blank" rel="noopener noreferrer">
          <MessageCircle aria-hidden className="size-4" />
          {t.whatsapp}
        </a>
        <a className={linkClass} href={mailtoUrl({ to: view.email, subject: t.emailSubject(view.company), body: message })}>
          <Mail aria-hidden className="size-4" />
          {t.emailButton}
        </a>
      </div>
      <div className="flex justify-end">
        <Button onClick={onConfirm}>{t.confirm}</Button>
      </div>
    </section>
  )
}
