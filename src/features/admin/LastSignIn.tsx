import { strings } from '@/lib/strings'
import type { UserDoc } from '@/types'

const t = strings.admin.users

/** PIN users: when they last signed in and on how many phones (Module 12, written by `loginWithPin`). */
export function LastSignIn({ user }: { user: Pick<UserDoc, 'lastLoginAt' | 'knownDevices'> }) {
  const devices = Object.keys(user.knownDevices ?? {}).length
  if (!user.lastLoginAt) return <span className="text-slate-600">{t.never}</span>
  return (
    <span>
      {user.lastLoginAt.toDate().toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
      <span className="block text-xs text-slate-600">{t.devices(devices)}</span>
    </span>
  )
}
