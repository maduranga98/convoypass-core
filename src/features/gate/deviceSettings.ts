import { useCallback, useSyncExternalStore } from 'react'

// Per-device preferences of the gate phone (never roles or anything a rule depends on). Storage can be blocked
// (private mode), so every access is guarded and the in-memory value still works for this page.

const memory = new Map<string, string | null>()
const listeners = new Set<() => void>()

function read(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null
  try {
    const v = localStorage.getItem(key)
    memory.set(key, v)
    return v
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  memory.set(key, value)
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // keep the in-memory value
  }
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

function useSetting(key: string): [string | null, (v: string | null) => void] {
  const value = useSyncExternalStore(subscribe, () => read(key), () => null)
  const set = useCallback((v: string | null) => write(key, v), [key])
  return [value, set]
}

/** The gate this phone stands at, per tenant. */
export const useGateChoice = (tenantId: string) => useSetting(`convoypass.gate.${tenantId}`)

/** Result sounds; on unless switched off on this phone. */
export function useSoundOn(): [boolean, (on: boolean) => void] {
  const [v, set] = useSetting('convoypass.gate.sound')
  return [v !== 'off', (on: boolean) => set(on ? 'on' : 'off')]
}

/** Test helper. */
export const resetDeviceSettings = (): void => memory.clear()
