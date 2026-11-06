// Admin SDK wiring for the super admin scripts (create, disable, doctor, dev). The environment is already resolved,
// confirmed and credential-checked by lib/env.ts when this runs.
import type { UserRecord } from 'firebase-admin/auth'
import { FieldValue, type Transaction } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { connect, loadDotEnv, readJson, type Firebaserc, type Target } from './lib/env.ts'
import { readPasswordFromStdin, generatePassword } from './lib/secrets.ts'
import { GENERATED_PASSWORD_LENGTH, type OperatorIo } from './operatorsCli.ts'
import { parseDotEnv, type AuthUserInfo } from './superadminChecks.ts'

const toInfo = (u: UserRecord): AuthUserInfo => ({
  uid: u.uid, email: (u.email ?? '').toLowerCase(), displayName: u.displayName ?? null, emailVerified: u.emailVerified, disabled: u.disabled, claims: { ...(u.customClaims ?? {}) },
})
const missing = (e: unknown): null => {
  if ((e as { code?: string }).code === 'auth/user-not-found') return null
  throw e
}

/** `functions/.env.<alias>` (staging | prod), else `functions/.env`: FUNCTIONS_REGION and APP_BASE_URL live there (no secrets). */
export function functionsEnvFor(target: Target): Record<string, string> {
  const alias = target.env === 'emulator' ? undefined : target.env
  for (const f of [alias ? `functions/.env.${alias}` : '', 'functions/.env']) {
    if (!f) continue
    try {
      return parseDotEnv(readFileSync(f, 'utf8'))
    } catch {
      /* try the next one */
    }
  }
  return {}
}

export function operatorIo(target: Target): OperatorIo {
  loadDotEnv()
  const { auth, db } = connect(target)
  const stamp = (a: unknown) => ({ ...(a as object), createdAt: FieldValue.serverTimestamp() })
  return {
    auth: {
      getUserByEmail: (email) => auth.getUserByEmail(email).then(toInfo, missing),
      getUser: (uid) => auth.getUser(uid).then(toInfo, missing),
      createUser: async (p) => ({ uid: (await auth.createUser(p)).uid }),
      updateUser: async (uid, p) => void (await auth.updateUser(uid, p)),
      setCustomUserClaims: (uid, claims) => auth.setCustomUserClaims(uid, claims),
      deleteUser: (uid) => auth.deleteUser(uid),
      disableUser: async (uid) => void (await auth.updateUser(uid, { disabled: true })),
      revokeRefreshTokens: (uid) => auth.revokeRefreshTokens(uid),
    },
    db: {
      tenantUserExistsWithEmail: async (email) => !(await db.collection('users').where('email', '==', email).limit(1).get()).empty,
      userDocExists: async (uid) => (await db.doc(`users/${uid}`).get()).exists,
      getOperator: async (uid) => {
        const x = (await db.doc(`operators/${uid}`).get()).data()
        return x
          ? { name: String(x.name ?? ''), email: String(x.email ?? ''), status: x.status === 'active' ? 'active' : 'disabled', mustChangePassword: x.mustChangePassword === true }
          : null
      },
      saveOperator: (uid, doc, a) =>
        db.runTransaction(async (tx: Transaction) => {
          const ref = db.doc(`operators/${uid}`)
          const exists = (await tx.get(ref)).exists
          if (exists) tx.update(ref, { ...doc, updatedAt: FieldValue.serverTimestamp() })
          else tx.create(ref, { name: doc.name ?? '', email: doc.email, status: doc.status ?? 'active', mustChangePassword: doc.mustChangePassword ?? false, createdAt: FieldValue.serverTimestamp() })
          tx.create(db.collection('platformAuditLog').doc(), stamp(a))
        }),
      disableOperator: async (uid, a) => {
        const batch = db.batch()
        batch.update(db.doc(`operators/${uid}`), { status: 'disabled', updatedAt: FieldValue.serverTimestamp() })
        batch.create(db.collection('platformAuditLog').doc(), stamp(a))
        await batch.commit()
      },
    },
    out: (l) => console.log(l),
    secret: (l) => console.log(l),
    firebaserc: readJson<Firebaserc>('.firebaserc'),
    randomPassword: () => generatePassword(GENERATED_PASSWORD_LENGTH),
    readPassword: () => readPasswordFromStdin(),
    appBaseUrl: process.env.APP_BASE_URL || functionsEnvFor(target).APP_BASE_URL,
  }
}
