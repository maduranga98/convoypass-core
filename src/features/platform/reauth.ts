// Operator mutations need a sign-in from the last 15 minutes. `reauthenticate` re-checks the password and refreshes the ID
// token (the new auth_time only reaches the callables with a refreshed token). See `useReauthRetry.tsx`.
import { FirebaseError } from 'firebase/app'
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { auth } from '@/lib/firebase'

/** The operator closed the dialog: the action is abandoned, nothing to report. */
export class ReauthCancelled extends Error {}

export class WrongPassword extends Error {}

export async function reauthenticate(password: string): Promise<void> {
  const user = auth.currentUser
  if (!user?.email) throw new Error('not signed in')
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password))
  } catch (e) {
    const code = e instanceof FirebaseError ? e.code : ''
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/missing-password') throw new WrongPassword()
    throw e
  }
  await user.getIdToken(true)
}
