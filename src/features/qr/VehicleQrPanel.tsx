import { Check, Copy, Download, Printer } from 'lucide-react'
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { shortUrl, vehicleUrl } from '@/lib/appUrl'
import { strings } from '@/lib/strings'
import { scopePath, type Scope } from '@/features/shared/scope'
import type { Vehicle, WithId } from '@/types'
import { canvasToPng, fileSafe, saveBlob, svgToBlob } from './download'
import { QrGate } from './QrGate'

const t = strings.vehicles.drawer

export const QR_PNG_PX = 1024

/** QR preview with Download PNG / SVG, Copy link and Print label. The QR encodes only the vehicle URL. */
export function VehicleQrPanel({ vehicle, scope }: { vehicle: WithId<Vehicle>; scope: Scope }) {
  return <QrGate>{(base) => <Panel url={vehicleUrl(base.url, vehicle.id)} vehicle={vehicle} scope={scope} />}</QrGate>
}

function Panel({ url, vehicle, scope }: { url: string; vehicle: WithId<Vehicle>; scope: Scope }) {
  const navigate = useNavigate()
  const svgRef = useRef<SVGSVGElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [copied, setCopied] = useState(false)
  const name = `ConvoyPass-${fileSafe(vehicle.plateNo)}-${vehicle.id}`

  const downloadPng = async () => {
    if (!canvasRef.current) return
    try {
      saveBlob(await canvasToPng(canvasRef.current, QR_PNG_PX), `${name}.png`)
    } catch {
      toast.error(strings.common.somethingWrong)
    }
  }
  const downloadSvg = () => {
    if (svgRef.current) saveBlob(svgToBlob(svgRef.current), `${name}.svg`)
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success(t.linkCopied)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(strings.common.somethingWrong)
    }
  }

  return (
    <section aria-label={t.qrTitle} className="space-y-4">
      <div className="mx-auto w-fit rounded-xl border border-slate-200 bg-surface p-3">
        <QRCodeSVG ref={svgRef} value={url} size={224} level="Q" marginSize={2} title={`${t.qrTitle}: ${vehicle.plateNo}`} />
      </div>
      {/* Off-screen canvas used only to render the 1024 px PNG. */}
      <div hidden aria-hidden>
        <QRCodeCanvas ref={canvasRef} value={url} size={QR_PNG_PX} level="Q" marginSize={4} />
      </div>
      <dl className="space-y-1 text-center text-xs text-slate-500">
        <div>
          <dt className="sr-only">{t.permanentId}</dt>
          <dd className="font-mono">{vehicle.id}</dd>
        </div>
        <div>
          <dt className="sr-only">URL</dt>
          <dd className="break-all font-mono">{shortUrl(url)}</dd>
        </div>
      </dl>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="sm" icon={<Download aria-hidden className="size-4" />} onClick={() => void downloadPng()}>
          {t.downloadPng}
        </Button>
        <Button variant="secondary" size="sm" icon={<Download aria-hidden className="size-4" />} onClick={downloadSvg}>
          {t.downloadSvg}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
          onClick={() => void copy()}
        >
          {copied ? strings.common.copied : t.copyLink}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<Printer aria-hidden className="size-4" />}
          onClick={() => void navigate(`${scopePath(scope, 'qr')}?vehicle=${encodeURIComponent(vehicle.id)}`)}
        >
          {t.print}
        </Button>
      </div>
    </section>
  )
}
