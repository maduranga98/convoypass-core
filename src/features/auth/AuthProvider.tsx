import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth'
import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { auth, db } from '@/lib/firebase'
import { releaseDeviceOnSignOut } from '@/features/notifications/push/registration'
import { queryClient } from '@/lib/queryClient'
import { strings } from '@/lib/strings'
import type { Contractor, UserDoc } from '@/types'
import { getOperatorProfile } from '@/lib/api'
import { apiErrorReason } from '@/lib/errors'
import { clearSensitiveState } from '@/features/platform/sensitive'
import { isPinRole, sessionExpired } from '@/lib/session'
import { onSessionExpired } from '@/lib/sessionEvents'
import { isOperatorToken, parseClaims } from './claims'
import { AuthContext, type AuthContextValue, type OperatorSession, type Session } from './useAuth'

interface State {
  status: AuthContextValue['status']
  session: Session | null
  operator: OperatorSession | null
  notice: string | null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading', session: null, operator: null, notice: null })
  const generation = useRef(0)

  const endSession = useCallback(async (notice: string) => {
    setState((s) => ({ ...s, notice }))
    await fbSignOut(auth)
  }, [])

  useEffect(() => {
    let unsubProfile: (() => void) | null = null
    let unsubContractor: (() => void) | null = null

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      const gen = ++generation.current
      unsubProfile?.()
      unsubProfile = null
      unsubContractor?.()
      unsubContractor = null

      if (!user) {
        queryClient.clear() // never leak one account's cached data into the next session
        clearSensitiveState() // one-time credential cards, invite codes: gone with the session
        setState((s) => ({ status: 'signedOut', session: null, operator: null, notice: s.notice }))
        return
      }

      setState((s) => ({ ...s, status: 'loading' }))
      void (async () => {
        const tokenResult = await user.getIdTokenResult()
        if (gen !== generation.current) return

        // Platform operator (Module 9): no tenant, no `users` doc. The profile is a callable (clients cannot read
        // `operators`); a missing, disabled or unverified operator is refused by the server and signs out here.
        if (isOperatorToken(tokenResult.claims)) {
          try {
            const profile = await getOperatorProfile({})
            if (gen !== generation.current) return
            setState({ status: 'signedIn', notice: null, session: null, operator: { uid: user.uid, ...profile } })
          } catch (e) {
            if (gen !== generation.current) return
            const denied = apiErrorReason(e) === 'forbidden' || (e as { code?: string }).code === 'functions/permission-denied'
            await endSession(denied ? strings.authErrors.accountDisabled : strings.authErrors.sessionEnded)
          }
          return
        }

        let claims = parseClaims(tokenResult.claims)
        if (!claims) {
          await endSession(strings.authErrors.accountMissing)
          return
        }
        // Module 12: drivers (90 days) and security (16 hours) sign in again with their PIN after the session limit.
        const authTime = Math.floor(Date.parse(tokenResult.authTime) / 1000) || 0
        if (sessionExpired(claims.role, authTime, Math.floor(Date.now() / 1000))) {
          await endSession(strings.authErrors.pinAgain)
          return
        }

        // Contractor users are locked out while their contractor is suspended: checked before the app renders,
        // then watched so a suspension while signed in ends the session too.
        if (claims.contractorId) {
          const contractorRef = doc(db, 'contractors', claims.contractorId)
          const first = await getDoc(contractorRef)
          if (gen !== generation.current) return
          const contractor = first.data() as Contractor | undefined
          if (!contractor) {
            await endSession(strings.authErrors.accountMissing)
            return
          }
          if (contractor.status === 'suspended') {
            await endSession(strings.authErrors.contractorSuspended)
            return
          }
          unsubContractor = onSnapshot(contractorRef, (snap) => {
            if (gen === generation.current && (snap.data() as Contractor | undefined)?.status === 'suspended') {
              void endSession(strings.authErrors.contractorSuspended)
            }
          })
        }

        unsubProfile = onSnapshot(
          doc(db, 'users', user.uid),
          (snap) => {
            if (gen !== generation.current) return
            const data = snap.data() as UserDoc | undefined
            if (!data) {
              void endSession(strings.authErrors.accountMissing)
              return
            }
            if (data.status === 'disabled') {
              void endSession(strings.authErrors.accountDisabled)
              return
            }
            // A reissued PIN ends every older session at once (the server refuses them too).
            if (claims && isPinRole(claims.role) && typeof data.sessionsRevokedAt === 'number' && authTime < data.sessionsRevokedAt) {
              void endSession(strings.authErrors.pinAgain)
              return
            }
            if (claims && (data.role !== claims.role || data.tenantId !== claims.tenantId)) {
              // Stale token: pick up the new claims.
              void user.getIdTokenResult(true).then((r) => {
                const fresh = parseClaims(r.claims)
                if (fresh) claims = fresh
                else void endSession(strings.authErrors.accountMissing)
              })
              return
            }
            if (!claims) return
            setState({
              status: 'signedIn',
              notice: null,
              operator: null,
              session: { uid: user.uid, claims, profile: { ...data, id: snap.id }, authTime },
            })
          },
          () => {
            if (gen === generation.current) void endSession(strings.authErrors.sessionEnded)
          },
        )
      })().catch(() => void endSession(strings.authErrors.sessionEnded))
    })

    return () => {
      unsubAuth()
      unsubProfile?.()
      unsubContractor?.()
    }
  }, [endSession])

  // A callable said `session-expired`: end the session; RequireAuth sends the person to the PIN screen with the return URL.
  useEffect(() => {
    return onSessionExpired(() => void endSession(strings.authErrors.pinAgain))
  }, [endSession])

  // A PIN session also expires while the app stays open (a guard's 16-hour shift limit): checked every minute.
  const pinSession = state.session && isPinRole(state.session.claims.role) ? state.session : null
  useEffect(() => {
    if (!pinSession) return
    const check = () => {
      if (sessionExpired(pinSession.claims.role, pinSession.authTime, Math.floor(Date.now() / 1000))) void endSession(strings.authErrors.pinAgain)
    }
    check()
    const timer = window.setInterval(check, 60_000)
    return () => window.clearInterval(timer)
  }, [pinSession, endSession])

  const refreshClaims = useCallback(async () => {
    const user = auth.currentUser
    if (!user) return
    const claims = parseClaims((await user.getIdTokenResult(true)).claims)
    if (!claims) return endSession(strings.authErrors.accountMissing)
    setState((s) => (s.session ? { ...s, session: { ...s.session, claims } } : s))
  }, [endSession])

  const refreshOperator = useCallback(async () => {
    const user = auth.currentUser
    if (!user) return
    try {
      const profile = await getOperatorProfile({})
      setState((s) => (s.operator ? { ...s, operator: { uid: user.uid, ...profile } } : s))
    } catch {
      await endSession(strings.authErrors.sessionEnded)
    }
  }, [endSession])

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      clearNotice: () => setState((s) => ({ ...s, notice: null })),
      signOut: async () => {
        // This device must stop receiving this account's alerts (best effort, never blocks sign-out).
        const uid = auth.currentUser?.uid
        if (uid && !state.operator) await releaseDeviceOnSignOut(uid) // super admins register no device
        await fbSignOut(auth)
      },
      refreshClaims,
      refreshOperator,
    }),
    [state, refreshClaims, refreshOperator],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
