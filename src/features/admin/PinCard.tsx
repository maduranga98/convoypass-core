import { Check, Copy, MessageCircle, Printer } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import { whatsAppShareLink, type IssuedPin } from './pinCardState'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { appBase } from '@/lib/appUrl'
import { formatPin } from '@/lib/pin'
import { strings } from '@/lib/strings'

const t = strings.pinCard

const appUrl = (): string => appBase?.url ?? window.location.origin

const PRINT_CLASS = 'printing-pin-card'

/**
 * Prints only the A6 card: everything else on the page is hidden while printing, and an A6 `@page` rule is added for
 * that one print. The card carries the app address as text and as a QR code; the QR NEVER encodes the PIN.
 */
function printCard(): void {
  const style = document.createElement('style')
  style.textContent = `@page { size: A6; margin: 8mm } html.${PRINT_CLASS} body > *:not(#pin-print) { display: none !important } html.${PRINT_CLASS} #pin-print { display: block !important }`
  document.head.appendChild(style)
  document.documentElement.classList.add(PRINT_CLASS)
  const done = () => {
    document.documentElement.classList.remove(PRINT_CLASS)
    style.remove()
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)
  try {
    window.print()
  } finally {
    // Most browsers block in print(); the afterprint listener covers the ones that do not.
    if (!window.matchMedia?.('print').matches) setTimeout(done, 0)
  }
}

/** The A6 card that `printCard` shows: company, name, role, PIN, the app address and a QR code of the app address. */
export function PrintableCard({ issued }: { issued: IssuedPin }) {
  const url = appUrl()
  return createPortal(
    <div id="pin-print" data-testid="pin-print" className="hidden text-ink">
      <p className="text-sm font-semibold uppercase tracking-wide">{issued.company}</p>
      <p className="mt-1 text-xs">{t.printHeading}</p>
      <p className="mt-4 text-2xl font-bold">{issued.name}</p>
      <p className="text-base">{strings.roles[issued.role]}</p>
      <p className="mt-4 text-xs uppercase tracking-wide">{t.pinLabel}</p>
      <p className="font-mono text-4xl font-extrabold tracking-widest">{formatPin(issued.pin)}</p>
      <div className="mt-4 flex items-center gap-4">
        <QRCodeSVG value={url} size={96} level="Q" title={t.qrLabel} data-testid="pin-print-qr" data-value={url} />
        <p className="text-sm break-all">{t.printSteps(url)}</p>
      </div>
      <p className="mt-3 text-xs">{t.printPrivate}</p>
    </div>,
    document.body,
  )
}

/**
 * The one-time PIN card (Module 12): large `1234 5678`, name, role and company, with Copy, Share by WhatsApp and Print
 * card. It can only be closed with "I've given it to them"; the caller then drops the PIN from memory.
 */
export function PinCardModal({ issued, onDone }: { issued: IssuedPin | null; onDone: () => void }) {
  return (
    <Modal open={issued !== null} onClose={onDone} dismissible={false} title={issued?.viewed ? t.viewedTitle : issued?.reissued ? t.reissuedTitle : t.title}>
      {issued && <PinCard issued={issued} onDone={onDone} />}
    </Modal>
  )
}

export function PinCard({ issued, onDone }: { issued: IssuedPin; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  const message = t.message(issued.name, formatPin(issued.pin), appUrl())

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      toast.success(t.copied)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t.copyFailed)
    }
  }

  return (
    <div className="space-y-5">
      <p className="rounded-lg bg-warning-soft px-3 py-2.5 text-sm text-warning-ink">{issued.viewed ? t.viewedWarning : t.warning}</p>
      <div className="rounded-xl border-2 border-brand p-4 text-center">
        <p className="text-sm font-medium text-slate-600">{t.pinLabel}</p>
        <p data-testid="pin-value" className="font-mono text-5xl font-extrabold tracking-widest text-ink">
          {formatPin(issued.pin)}
        </p>
      </div>
      <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
        {[
          [t.name, issued.name],
          [t.role, strings.roles[issued.role]],
          [t.company, issued.company],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 px-4 py-3">
            <dt className="text-slate-600">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-2 sm:grid-cols-3">
        <Button variant="secondary" onClick={() => void copy()} icon={copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}>
          {copied ? t.copied : t.copy}
        </Button>
        <a
          href={whatsAppShareLink(message)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <MessageCircle aria-hidden className="size-4" />
          {t.whatsapp}
        </a>
        <Button variant="secondary" onClick={printCard} icon={<Printer aria-hidden className="size-4" />}>
          {t.print}
        </Button>
      </div>
      <Button className="w-full" onClick={onDone}>
        {issued.viewed ? strings.common.close : t.confirm}
      </Button>
      <PrintableCard issued={issued} />
    </div>
  )
}
