import { uploadEvidencePhoto } from '@/lib/storage'

/** Uploads one evidence photo. Rejects when it fails or when `signal` aborts (the upload is cancelled). */
export const uploadEvidence = (path: string, blob: Blob, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<void> =>
  uploadEvidencePhoto(path, blob, onProgress, signal)
