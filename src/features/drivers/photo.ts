import imageCompression from 'browser-image-compression'
import { uploadPhoto } from '@/lib/storage'

export const PHOTO_MAX_BYTES = 150 * 1024
const PHOTO_EDGE_PX = 400

const options = (maxSizeMB: number, edge: number) => ({
  maxSizeMB,
  maxWidthOrHeight: edge,
  fileType: 'image/jpeg',
  initialQuality: 0.8,
  useWebWorker: false, // the worker build loads its code from a CDN (blocked by the CSP, and unavailable offline)
})

/** Resizes to about 400 px and re-encodes as JPEG under 150 KB. Throws when the file is not a usable image. */
export async function compressPhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('not an image')
  let out: Blob = await imageCompression(file, options(PHOTO_MAX_BYTES / 1024 / 1.1, PHOTO_EDGE_PX))
  if (out.size > PHOTO_MAX_BYTES) out = await imageCompression(new File([out], 'photo.jpg', { type: 'image/jpeg' }), options(0.08, 320))
  if (out.size > PHOTO_MAX_BYTES) throw new Error('photo too large')
  return out
}

export async function uploadDriverPhoto(path: string, photo: Blob): Promise<void> {
  await uploadPhoto(path, photo)
}
