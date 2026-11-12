import { Copy, MessageCircle, Printer } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { strings } from '@/lib/strings'
import { visitorStrings } from '@/lib/visitorStrings'
import { formatPassCode } from '@/lib/visitorLogic'

const t = visitorStrings.slip

export interface SlipData {
  visitorName: string
  organization?: string | null
  hostName?: string | null
  purposeOfVisit: string
  passCode: string
  /** The QR content: the app address plus the code. */
  qrPayload: string
  siteName: string
  validLabel: string
}

/** The pass itself: QR, the short code and the details the guard and the visitor need. This block is what a printed slip contains. */
export function PassSlipCard({ slip }: { slip: SlipData }) {
  return (
    <div id="visitor-slip" className="space-y-4 rounded-2xl border border-slate-200 bg-surface p-5 text-ink">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-slate-600 uppercase">{t.title}</p>
          <p className="text-xl font-bold break-words">{slip.visitorName}</p>
          {slip.organization && <p className="text-sm text-slate-700">{slip.organization}</p>}
        </div>
      </div>
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center">
        {/* The QR sits on a light surface so it stays scannable in dark mode and on paper. */}
        <div className="shrink-0 rounded-xl border border-slate-200 bg-surface p-3" role="img" aria-label={t.qrLabel}>
          <QRCodeSVG value={slip.qrPayload} size={168} level="Q" marginSize={0} />
        </div>
        <div className="min-w-0 text-center sm:text-left">
          <p className="text-xs font-semibold tracking-wide text-slate-600 uppercase">{t.codeLabel}</p>
          <p className="font-mono text-3xl font-black tracking-widest" data-testid="pass-code">{formatPassCode(slip.passCode)}</p>
          <p className="mt-1 text-sm text-slate-700">{t.scanHint}</p>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-slate-600">{t.validFor}</dt>
        <dd className="font-semibold">{slip.validLabel}</dd>
        <dt className="text-slate-600">{t.gate}</dt>
        <dd className="font-semibold">{slip.siteName}</dd>
        {slip.hostName && (
          <>
            <dt className="text-slate-600">{t.host}</dt>
            <dd className="font-semibold">{slip.hostName}</dd>
          </>
        )}
        <dt className="text-slate-600">{t.purpose}</dt>
        <dd className="font-semibold">{slip.purposeOfVisit}</dd>
      </dl>
    </div>
  )
}

/** Print, copy and WhatsApp for one pass. */
export function PassActions({ slip }: { slip: SlipData }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatPassCode(slip.passCode))
      toast.success(t.copied)
    } catch {
      toast.error(strings.common.somethingWrong)
    }
  }
  const text = t.whatsappText({ name: slip.visitorName, code: formatPassCode(slip.passCode), link: slip.qrPayload, valid: slip.validLabel, gate: slip.siteName })
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <Button variant="secondary" icon={<Printer aria-hidden className="size-4" />} onClick={() => window.print()}>
        {t.print}
      </Button>
      <Button variant="secondary" icon={<Copy aria-hidden className="size-4" />} onClick={() => void copy()}>
        {t.copy}
      </Button>
      <a
        href={`https://wa.me/?text=${encodeURIComponent(text)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-300 bg-surface px-4 text-sm font-medium text-ink hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <MessageCircle aria-hidden className="size-4" />
        {t.whatsapp}
      </a>
    </div>
  )
}
