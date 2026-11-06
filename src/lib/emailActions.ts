import { FirebaseError } from 'firebase/app'
import { sendEmailVerification, sendPasswordResetEmail, type User } from 'firebase/auth'
import { appBase } from './appUrl'
import { auth } from './firebase'

/** Where the "continue" link in Firebase's emails leads. Unset when VITE_APP_BASE_URL is not configured. */
const continueUrl = (): { url: string } | undefined => (appBase ? { url: `${appBase.url}/login/staff` } : undefined)

const isContinueUriProblem = (e: unknown): boolean =>
  e instanceof FirebaseError && (e.code === 'auth/unauthorized-continue-uri' || e.code === 'auth/invalid-continue-uri' || e.code === 'auth/missing-continue-uri')

/**
 * A continue URL on a domain that is not in Firebase's authorized list would stop the email from being sent at all;
 * the email matters more than the link back, so that one case retries without it.
 */
async function withContinue<T>(send: (settings: { url: string } | undefined) => Promise<T>): Promise<T> {
  const settings = continueUrl()
  try {
    return await send(settings)
  } catch (e) {
    if (settings && isContinueUriProblem(e)) return send(undefined)
    throw e
  }
}

export const sendResetEmail = (email: string): Promise<void> =>
  withContinue((s) => (s ? sendPasswordResetEmail(auth, email, s) : sendPasswordResetEmail(auth, email)))

export const sendVerificationEmail = (user: User): Promise<void> =>
  withContinue((s) => (s ? sendEmailVerification(user, s) : sendEmailVerification(user)))
