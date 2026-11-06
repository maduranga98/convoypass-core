export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** The QR as a stand-alone SVG file. */
export function svgToBlob(svg: SVGSVGElement): Blob {
  const xml = new XMLSerializer().serializeToString(svg)
  return new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`], { type: 'image/svg+xml;charset=utf-8' })
}

/**
 * Re-draws a (possibly high-DPI) canvas onto an exactly `px` x `px` canvas without smoothing, so modules stay sharp,
 * and encodes it as PNG.
 */
export function canvasToPng(source: HTMLCanvasElement, px = 1024): Promise<Blob> {
  const out = document.createElement('canvas')
  out.width = px
  out.height = px
  const ctx = out.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas is not supported'))
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(source, 0, 0, px, px)
  return new Promise((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode PNG'))), 'image/png'),
  )
}

/** `WP LJ-4821` -> `WP-LJ-4821`, safe for file names. */
export const fileSafe = (s: string): string => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
