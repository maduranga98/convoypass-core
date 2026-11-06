import { newRequestId } from './requestId'

/** A random id for this browser (Module 12): it lets the server throttle per device and tell admins about new devices. */
const KEY = 'cp_device'
let memory: string | null = null

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Stored in localStorage (`cp_device`); when storage is blocked it lives in memory for this page load. */
export function deviceId(): string {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored && UUID.test(stored)) return stored
    const id = newRequestId()
    localStorage.setItem(KEY, id)
    return id
  } catch {
    memory ??= newRequestId()
    return memory
  }
}
