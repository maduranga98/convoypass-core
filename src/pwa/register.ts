import { toast } from 'sonner'
import { Workbox } from 'workbox-window'
import { strings } from '@/lib/strings'
import { isUpdateLocked } from './updateLock'
import { createUpdateController } from './updates'

/** Registers the single service worker (`src/sw.ts`, built to /sw.js). Production builds only. */
export function registerServiceWorker(): void {
  if (import.meta.env.DEV || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const wb = new Workbox('/sw.js')
  const controller = createUpdateController({
    isLocked: isUpdateLocked,
    applyUpdate: () => {
      wb.addEventListener('controlling', () => window.location.reload())
      wb.messageSkipWaiting()
    },
    promptReload: (apply) =>
      toast(strings.updates.ready, {
        id: 'sw-update',
        duration: Infinity,
        action: { label: strings.updates.reload, onClick: apply },
      }),
  })
  wb.addEventListener('waiting', () => controller.onUpdateReady())
  void wb.register()
  // An installed app can stay open for days: look for a new version whenever it comes back to the foreground.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void wb.update().catch(() => undefined)
  })
}
