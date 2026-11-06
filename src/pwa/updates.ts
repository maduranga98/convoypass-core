export interface UpdateEnv {
  isLocked: () => boolean
  /** Activate the waiting version and reload. */
  applyUpdate: () => void
  /** Show "Update ready, reload when convenient"; `apply` runs when the user taps Reload. */
  promptReload: (apply: () => void) => void
}

/**
 * `autoUpdate` policy with a safety valve: a new version activates and reloads by itself, unless a camera capture
 * or a form is open, in which case the person is asked and nothing reloads until they say so.
 */
export function createUpdateController(env: UpdateEnv) {
  let prompted = false
  return {
    onUpdateReady(): void {
      if (!env.isLocked()) {
        env.applyUpdate()
        return
      }
      if (prompted) return
      prompted = true
      env.promptReload(() => env.applyUpdate())
    },
  }
}
