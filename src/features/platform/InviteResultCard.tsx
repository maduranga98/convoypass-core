import { Check, Copy, Mail, MessageCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { strings } from '@/lib/strings'
import type { CreatedInvite } from '@/types/platform'
import { formatExpiry, inviteMessage, mailtoUrl, whatsappUrl } from './share'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.platform.invites

export interface InviteResult {
  invite: CreatedInvite
  company?: string | undefined
  lockEmail?: string | undefined
}

const linkClass =
  'inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-surface px-4 text-sm font-medium text-ink hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

/**
 * The one place an invite link is ever shown. It lives in this component's props only (the parent drops it on close or
 * navigation); nothing is written to storage, a query cache or the console.
 */
export function InviteResultCard({ result, onClose }: { result: InviteResult; onClose: () => void }) {
  const { invite, company, lockEmail } = result
  const [copied, setCopied] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
  }, [])

  const text = inviteMessage({ company, link: invite.link, expiresAt: invite.expiresAt })

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite.link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      input.current?.select() // no clipboard permission: the link is selected, copy it by hand
    }
  }

  return (
    <section aria-labelledby="invite-result-title" className="space-y-4 rounded-xl border border-accent/50 bg-warning-soft/60 p-5">
      <h2 id="invite-result-title" className="text-base font-semibold">{t.resultTitle}</h2>
      <NotificationBanner tone="warning" role="alert">{t.oneTimeWarning}</NotificationBanner>
      <div className="space-y-1.5">
        <label htmlFor="invite-link" className="text-sm font-medium text-slate-700">{t.linkLabel}</label>
        <input
          id="invite-link"
          ref={input}
          readOnly
          value={invite.link}
          onFocus={(e) => e.currentTarget.select()}
          className="block h-11 w-full rounded-lg border border-slate-300 bg-surface px-3 font-mono text-sm text-ink focus-visible:outline-2 focus-visible:outline-focus"
        />
        <p className="text-xs text-slate-600">
          {t.expiresOn(formatExpiry(invite.expiresAt))}
          {lockEmail ? ` · ${t.lockedTo(lockEmail)}` : ''}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void copy()} icon={copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}>
          {copied ? t.linkCopied : t.copyLink}
        </Button>
        <a className={linkClass} href={whatsappUrl(text)} target="_blank" rel="noopener noreferrer">
          <MessageCircle aria-hidden className="size-4" />
          {t.whatsapp}
        </a>
        <a className={linkClass} href={mailtoUrl({ to: lockEmail, subject: t.emailSubject(company), body: text })}>
          <Mail aria-hidden className="size-4" />
          {t.emailButton}
        </a>
      </div>
      <div className="flex justify-end">
        <Button onClick={onClose}>{t.closeCard}</Button>
      </div>
    </section>
  )
}
