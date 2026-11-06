import { format } from 'date-fns'
import { strings } from '@/lib/strings'

const t = strings.platform.invites

export const formatExpiry = (ms: number): string => format(new Date(ms), 'd MMM yyyy')

/** The message sent with the link. The same text goes out by WhatsApp and by email. */
export const inviteMessage = (p: { company?: string | undefined; link: string; expiresAt: number }): string =>
  t.message({ company: p.company, link: p.link, expires: formatExpiry(p.expiresAt) })

/** `wa.me` with no number: WhatsApp lets the operator pick the chat. The text is fully percent-encoded. */
export const whatsappUrl = (text: string): string => `https://wa.me/?text=${encodeURIComponent(text)}`

/** `mailto:` with the expected admin as the recipient when the invite is locked to one. */
export const mailtoUrl = (p: { to?: string | undefined; subject: string; body: string }): string => {
  const to = p.to ? encodeURIComponent(p.to).replace(/%40/g, '@') : ''
  return `mailto:${to}?subject=${encodeURIComponent(p.subject)}&body=${encodeURIComponent(p.body)}`
}

/** The hand-over message for a new or reset admin (same text for copy, WhatsApp and email). */
export const credentialsMessage = (p: { company: string; loginUrl: string; email: string; password: string }): string =>
  strings.platform.credentials.message(p)
