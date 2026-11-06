import { describe, expect, it } from 'vitest'
import { inviteMessage, mailtoUrl, whatsappUrl } from './share'

const LINK = 'https://convoypass.com/setup#code=Abc_def-123'
const EXPIRES = new Date(2026, 9, 14, 12).getTime() // 14 Oct 2026, local noon: timezone-proof

describe('invite sharing', () => {
  it('the message carries the company, the link, the expiry date and the device hint', () => {
    expect(inviteMessage({ company: 'Acme Quarry', link: LINK, expiresAt: EXPIRES })).toBe(
      ['ConvoyPass setup for Acme Quarry', '', `Open this link to set up your workspace: ${LINK}`, '', 'The link expires on 14 Oct 2026.', "Open the link on the device you'll use as admin."].join('\n'),
    )
    expect(inviteMessage({ link: LINK, expiresAt: EXPIRES }).split('\n')[0]).toBe('ConvoyPass setup')
  })
  it('WhatsApp gets the whole message percent-encoded after ?text= (the # and & of the link cannot break it)', () => {
    const text = inviteMessage({ company: 'Smith & Sons #1', link: LINK, expiresAt: EXPIRES })
    const url = whatsappUrl(text)
    expect(url.startsWith('https://wa.me/?text=')).toBe(true)
    const raw = url.slice('https://wa.me/?text='.length)
    expect(raw).not.toMatch(/[\s#&]/)
    expect(raw).toContain('%23code%3DAbc_def-123')
    expect(decodeURIComponent(raw)).toBe(text)
    expect(new URL(url).searchParams.get('text')).toBe(text)
  })
  it('mailto uses the locked email as the recipient and encodes subject and body', () => {
    const body = inviteMessage({ company: 'Acme', link: LINK, expiresAt: EXPIRES })
    const url = mailtoUrl({ to: 'ada+ops@acme.test', subject: 'Your ConvoyPass setup link for Acme', body })
    expect(url.startsWith('mailto:ada%2Bops@acme.test?subject=')).toBe(true)
    const q = new URL(url).searchParams
    expect(q.get('subject')).toBe('Your ConvoyPass setup link for Acme')
    expect(q.get('body')).toBe(body)
    expect(url).not.toMatch(/ |\n/)
  })
  it('mailto has no recipient when the invite is not locked', () => {
    expect(mailtoUrl({ subject: 'S', body: 'B' })).toBe('mailto:?subject=S&body=B')
  })
})
