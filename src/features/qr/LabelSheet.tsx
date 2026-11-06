import { QRCodeSVG } from 'qrcode.react'
import { shortUrl, vehicleUrl } from '@/lib/appUrl'
import { strings } from '@/lib/strings'
import { chunk, LABEL_SPEC, labelsPerPage, plateFontMm, type LabelData, type LabelSize } from './labelLayout'

/** Black on white only. Each page is one A4 sheet; `break-inside-avoid` keeps every label whole. */
export function LabelSheet({ labels, size, baseUrl }: { labels: LabelData[]; size: LabelSize; baseUrl: string }) {
  const spec = LABEL_SPEC[size]
  const pageHeight = spec.rows * spec.mm + (spec.rows - 1) * spec.gap
  const pages = chunk(labels, labelsPerPage(size))

  return (
    <div className="space-y-6 print:space-y-0">
      {pages.map((page, i) => (
        <section
          key={i}
          aria-label={`${strings.qr.preview} ${i + 1}`}
          className="mx-auto w-fit bg-surface p-4 shadow-sm ring-1 ring-slate-200 print:p-0 print:shadow-none print:ring-0 [&:not(:last-child)]:break-after-page"
        >
          <div
            className="grid content-start justify-center"
            style={{ gridTemplateColumns: `repeat(${spec.cols}, ${spec.mm}mm)`, gap: `${spec.gap}mm`, minHeight: `${pageHeight}mm` }}
          >
            {page.map((l) => (
              <Label key={l.id} label={l} size={size} url={vehicleUrl(baseUrl, l.id)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function Label({ label, size, url }: { label: LabelData; size: LabelSize; url: string }) {
  const spec = LABEL_SPEC[size]
  return (
    <div
      className="flex break-inside-avoid flex-col items-center justify-between overflow-hidden bg-surface text-center text-scrim"
      style={{ width: `${spec.mm}mm`, height: `${spec.mm}mm`, padding: `${spec.pad}mm`, border: '0.2mm dashed var(--color-scrim)' }}
    >
      <QRCodeSVG
        value={url}
        size={256}
        level="Q"
        marginSize={2}
        // Scanner-critical pure black on white (the same values as --color-scrim / --color-surface); not themeable.
        fgColor="#000000"
        bgColor="#ffffff"
        title={label.plateNo}
        style={{ width: `${spec.qr}mm`, height: `${spec.qr}mm` }}
      />
      <p className="whitespace-nowrap font-extrabold leading-none tracking-wide" style={{ fontSize: `${plateFontMm(label.plateNo, size)}mm` }}>
        {label.plateNo}
      </p>
      <div className="w-full leading-tight">
        <p className="font-bold uppercase tracking-[0.18em]" style={{ fontSize: `${spec.brand}mm` }}>
          {strings.qr.brand}
        </p>
        <p className="truncate" style={{ fontSize: `${spec.small}mm` }}>
          {label.contractorName}
        </p>
        <p className="break-all font-mono" style={{ fontSize: `${spec.url}mm` }}>
          {shortUrl(url)}
        </p>
      </div>
    </div>
  )
}
