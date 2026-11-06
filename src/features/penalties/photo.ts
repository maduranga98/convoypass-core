import imageCompression from 'browser-image-compression'

/** Server accepts 2 KB to 700 KB (Storage rules: under 700 KB); aim well under it. */
export const PENALTY_PHOTO_MAX_BYTES = 650 * 1024
const EDGE_PX = 1600

const options = (maxSizeMB: number, edge: number) => ({
  maxSizeMB,
  maxWidthOrHeight: edge,
  fileType: 'image/jpeg',
  initialQuality: 0.8,
  useWebWorker: false, // the worker build loads its code from a CDN (blocked by the CSP, and unavailable offline)
})

/** Resizes to at most 1600 px and re-encodes as JPEG under about 650 KB. Throws when the file is not a usable image. */
export async function compressPenaltyPhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('not an image')
  let out: Blob = await imageCompression(file, options(0.45, EDGE_PX))
  if (out.size > PENALTY_PHOTO_MAX_BYTES) out = await imageCompression(new File([out], 'photo.jpg', { type: 'image/jpeg' }), options(0.3, 1200))
  if (out.size > PENALTY_PHOTO_MAX_BYTES) throw new Error('photo too large')
  return out
}

/** The only path a penalty photo may be stored at (Storage rules and `issuePenalty` accept exactly this). */
export const penaltyPhotoPath = (tenantId: string, penaltyId: string): string => `tenants/${tenantId}/penalties/${penaltyId}/evidence.jpg`
