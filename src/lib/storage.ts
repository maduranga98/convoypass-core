import type * as StorageSdk from 'firebase/storage'
import { app } from './firebase'

type Loaded = { sdk: typeof StorageSdk; storage: StorageSdk.FirebaseStorage }
let loading: Promise<Loaded> | null = null

/**
 * The Storage SDK (about 30 KB gzipped) loads the first time a photo is read or uploaded, not with the app shell:
 * the login, home and approval screens that never touch a photo do not pay for it.
 */
export function loadStorage(): Promise<Loaded> {
  loading ??= import('firebase/storage').then((sdk) => {
    const storage = sdk.getStorage(app)
    // Ports match firebase.json.
    if (import.meta.env.VITE_USE_EMULATORS === 'true') sdk.connectStorageEmulator(storage, '127.0.0.1', 9199)
    return { sdk, storage }
  })
  return loading
}

export async function downloadUrl(path: string): Promise<string> {
  const { sdk, storage } = await loadStorage()
  return sdk.getDownloadURL(sdk.ref(storage, path))
}

export async function uploadPhoto(path: string, blob: Blob): Promise<void> {
  const { sdk, storage } = await loadStorage()
  await sdk.uploadBytes(sdk.ref(storage, path), blob, { contentType: 'image/jpeg', cacheControl: 'private, max-age=3600' })
}

/** Resumable upload for evidence photos (progress, cancel). Rejects when it fails or when `signal` aborts. */
export async function uploadEvidencePhoto(path: string, blob: Blob, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<void> {
  const { sdk, storage } = await loadStorage()
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'))
    const task = sdk.uploadBytesResumable(sdk.ref(storage, path), blob, { contentType: 'image/jpeg', cacheControl: 'private, max-age=3600' })
    const cancel = () => task.cancel()
    signal.addEventListener('abort', cancel, { once: true })
    task.on(
      'state_changed',
      (snap) => onProgress(snap.totalBytes > 0 ? snap.bytesTransferred / snap.totalBytes : 0),
      (err) => {
        signal.removeEventListener('abort', cancel)
        reject(err)
      },
      () => {
        signal.removeEventListener('abort', cancel)
        resolve()
      },
    )
  })
}
