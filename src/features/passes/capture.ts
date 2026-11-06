import imageCompression from 'browser-image-compression'
import { stampText } from '@/lib/stamp'

export const MAX_EDGE_PX = 1600
/** Aim for about this size; the Storage rules and `submitPass` hard-limit at 700 KB. */
export const TARGET_BYTES = 400 * 1024
export const HARD_MAX_BYTES = 690 * 1024

/** Scales down so the longest side is at most `max`; never scales up. */
export function fitWithin(width: number, height: number, max = MAX_EDGE_PX): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= max) return { width, height }
  const k = max / longest
  return { width: Math.round(width * k), height: Math.round(height * k) }
}

/** Dark translucent strip with the stamp, bottom-left, readable on any background. */
export function drawStamp(ctx: CanvasRenderingContext2D, width: number, height: number, text: string): void {
  const fontPx = Math.max(16, Math.round(Math.min(width, height) / 28))
  const pad = Math.round(fontPx * 0.5)
  ctx.save()
  ctx.font = `600 ${fontPx}px ui-monospace, Menlo, Consolas, monospace`
  ctx.textBaseline = 'middle'
  const textWidth = ctx.measureText(text).width
  const stripW = Math.min(width, Math.ceil(textWidth + pad * 2))
  const stripH = fontPx + pad * 2
  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)'
  ctx.fillRect(0, height - stripH, stripW, stripH)
  ctx.fillStyle = '#fff' // canvas pixels cannot read CSS variables: same value as --color-on-solid
  ctx.fillText(text, pad, height - stripH / 2, width - pad * 2)
  ctx.restore()
}

type Source = HTMLVideoElement | ImageBitmap | HTMLImageElement

/** Draws the source, scaled to at most 1600 px, with the stamp burned in. Synchronous, so a live frame is grabbed at once. */
export function renderStamped(source: Source, srcW: number, srcH: number, plateNo: string, now: Date): HTMLCanvasElement {
  const { width, height } = fitWithin(srcW, srcH)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(source, 0, 0, width, height)
  drawStamp(ctx, width, height, stampText(plateNo, now))
  return canvas
}

const toBlob = (canvas: HTMLCanvasElement, quality: number): Promise<Blob> =>
  new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', quality),
  )

/** JPEG export, then browser-image-compression down to about 400 KB when it is bigger. */
export async function encodeAndCompress(canvas: HTMLCanvasElement): Promise<Blob> {
  let blob = await toBlob(canvas, 0.85)
  if (blob.size > TARGET_BYTES) {
    blob = await imageCompression(new File([blob], 'photo.jpg', { type: 'image/jpeg' }), {
      maxSizeMB: TARGET_BYTES / 1024 / 1024,
      maxWidthOrHeight: MAX_EDGE_PX,
      fileType: 'image/jpeg',
      initialQuality: 0.8,
      useWebWorker: false, // the worker build loads its code from a CDN (blocked by the CSP, and unavailable offline)
    })
  }
  if (blob.size > HARD_MAX_BYTES) throw new Error('photo too large')
  return blob
}

async function decode(file: File): Promise<{ source: ImageBitmap | HTMLImageElement; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => undefined }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Camera fallback: a picked or captured file gets the same size cap, stamp and compression as a live frame. */
export async function processFile(file: File, plateNo: string, now = new Date()): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('not an image')
  const { source, width, height, release } = await decode(file)
  try {
    return await encodeAndCompress(renderStamped(source, width, height, plateNo, now))
  } finally {
    release()
  }
}
