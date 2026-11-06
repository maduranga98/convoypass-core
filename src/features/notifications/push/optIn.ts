import type { PushEnv } from './env'

export const DISMISS_DAYS = 14

export type OptInView = 'hidden' | 'enable' | 'ios-install'

/**
 * What the opt-in card shows. Never asks by itself (the browser prompt only follows a tap on Enable), appears until
 * it is enabled or dismissed, and after a dismissal stays away for 14 days. Security guards receive no alerts, so
 * they are not asked.
 */
export function optInView(input: { env: PushEnv; role: string; enabledHere: boolean; dismissedAt: number | null; now: number }): OptInView {
  const { env, role, enabledHere, dismissedAt, now } = input
  if (role === 'security' || role === 'yard' || enabledHere) return 'hidden'
  if (dismissedAt !== null && now - dismissedAt < DISMISS_DAYS * 86_400_000) return 'hidden'
  if (env.ios === 'needs-install') return 'ios-install'
  if (!env.supported || env.permission === 'denied') return 'hidden'
  return 'enable'
}
