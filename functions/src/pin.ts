// PIN sign-in for drivers and security (Module 12). Pure (node:crypto only, no firebase imports): the operator scripts
// import it too. A PIN is NEVER logged and never stored in the clear: `pinIndex/{pinKey(pin, pepper)}` is an HMAC-SHA256 under the
// PIN_PEPPER secret, and a sealed (encrypted) copy in `pinVault/{uid}` is opened only by `revealPin` (end of this file).
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt } from 'node:crypto'

export const PIN_LENGTH = 8

/**
 * The emulator's pepper when `functions/.secret.local` sets none. Only ever used when FUNCTIONS_EMULATOR=true (and by the
 * emulator-only seeds and e2e setup); a deployed function without a real pepper refuses to issue or check PINs.
 */
export const DEV_PIN_PEPPER = 'dev-only-pin-pepper-never-use-outside-the-emulator-0000'
/** 32+ random bytes, e.g. `openssl rand -base64 48`. */
export const MIN_PEPPER_LENGTH = 32

export class PepperMissingError extends Error {
  constructor() {
    super('PIN_PEPPER is missing or shorter than 32 characters')
  }
}

export function assertPepper(pepper: string | undefined): string {
  if (!pepper || pepper.length < MIN_PEPPER_LENGTH) throw new PepperMissingError()
  return pepper
}

/** `1234 5678` / `1234-5678` / ` 12345678 ` -> `12345678`; anything that is not exactly 8 digits then -> null. */
export function normalisePin(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 32) return null
  const digits = input.replace(/[\s-]/g, '')
  return /^\d{8}$/.test(digits) ? digits : null
}

/** Common or memorable 8-digit values, refused at generation. */
export const PIN_DENY_LIST: ReadonlySet<string> = new Set([
  '12345678', '87654321', '11223344', '12341234', '12121212', '11112222', '12344321', '13579135', '24682468', '19191919',
  '01234567', '98765432', '20202020', '19901990', '20002000', '20242024', '20252025', '20262026', '14725836', '15975346',
  '12369874', '78963214', '00001111', '99998888', '10203040', '11221122', '69696969', '42424242', '13131313', '77777778',
])

/** True for PINs that are too easy to guess: one digit, runs of 4+, `abababab`, `abcdabcd`, dates and the deny list. */
export function isTrivialPin(pin: string): boolean {
  if (!/^\d{8}$/.test(pin)) return true
  if (/^(\d)\1{7}$/.test(pin)) return true
  if (/^(\d\d)\1{3}$/.test(pin)) return true
  if (/^(\d{4})\1$/.test(pin)) return true
  if (PIN_DENY_LIST.has(pin)) return true
  const d = [...pin].map(Number)
  // Ascending or descending runs of 4 or more consecutive digits anywhere (1234, 6789, 9876, 3210 ...).
  let up = 1
  let down = 1
  for (let i = 1; i < d.length; i++) {
    const step = (d[i] as number) - (d[i - 1] as number)
    up = step === 1 ? up + 1 : 1
    down = step === -1 ? down + 1 : 1
    if (up >= 4 || down >= 4) return true
  }
  // Four or more of the same digit in a row (00001234, 12999995 ...).
  if (/(\d)\1{3}/.test(pin)) return true
  return false
}

/** A random 8-digit PIN that is never trivial. `rand(max)` is an unbiased integer in [0, max): crypto.randomInt. */
export function generatePin(rand: (max: number) => number = (max) => randomInt(max)): string {
  for (;;) {
    const pin = String(rand(100_000_000)).padStart(PIN_LENGTH, '0')
    if (!isTrivialPin(pin)) return pin
  }
}

/** `1234 5678` for display. */
export const formatPin = (pin: string): string => `${pin.slice(0, 4)} ${pin.slice(4)}`

/** `pinIndex` document id: HMAC-SHA256(pin) under the pepper, hex. */
export const pinKey = (pin: string, pepper: string): string => createHmac('sha256', assertPepper(pepper)).update(`pin:${pin}`, 'utf8').digest('hex')

/**
 * Throttle and device keys: HMAC of an IP address or a device id under the same pepper, with a domain prefix so the
 * kinds never collide. Only these hashes are stored (`pinAttempts/{kind}-{hash}`, `knownDevices` keys).
 */
export const identifierKey = (kind: 'ip' | 'dev', value: string, pepper: string): string =>
  createHmac('sha256', assertPepper(pepper)).update(`${kind}:${value}`, 'utf8').digest('hex').slice(0, 32)

// ---- Viewable PIN (admin/supervisor "Show PIN") -------------------------------------------------------------------
// A copy of each issued PIN is kept ONLY sealed (AES-256-GCM) in `pinVault/{uid}`: no client can read that collection, the
// key is derived from PIN_PEPPER (a different HKDF label from the HMACs above), and the uid and PIN version are bound as
// authenticated data so a sealed value cannot be moved to another account or survive a reissue. Opened only by `revealPin`.

const vaultKey = (pepper: string): Buffer => Buffer.from(hkdfSync('sha256', assertPepper(pepper), 'convoypass', 'pin-vault-v1', 32))
const vaultAad = (uid: string, version: number): Buffer => Buffer.from(`pinVault:${uid}:${version}`, 'utf8')

/** base64(iv | tag | ciphertext). */
export function sealPin(pin: string, uid: string, version: number, pepper: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', vaultKey(pepper), iv)
  cipher.setAAD(vaultAad(uid, version))
  const ct = Buffer.concat([cipher.update(pin, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')
}

/** The PIN, or null when the value was sealed for another account/version, under another pepper, or was altered. */
export function openPin(sealed: string, uid: string, version: number, pepper: string): string | null {
  try {
    const raw = Buffer.from(sealed, 'base64')
    if (raw.length < 12 + 16 + 1) return null
    const decipher = createDecipheriv('aes-256-gcm', vaultKey(pepper), raw.subarray(0, 12))
    decipher.setAAD(vaultAad(uid, version))
    decipher.setAuthTag(raw.subarray(12, 28))
    const pin = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
    return normalisePin(pin)
  } catch {
    return null
  }
}
