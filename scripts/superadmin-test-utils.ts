// In-memory Firebase for the super admin script tests (not a test file itself). Passwords are stored as given so a test can
// prove a repair left them alone and a reset changed them.
import type { PlatformAuditEntry } from '../functions/src/platform/platformAudit.ts'
import type { DoctorIo } from './superadminDoctorCli.ts'
import type { OperatorIo } from './operatorsCli.ts'
import type { AuthUserInfo, OperatorDoc } from './superadminChecks.ts'

export const RC = { projects: { default: 'demo', staging: 'conveypass-staging-1', prod: 'conveypass-prod-1' } }
export const EMAIL = 'olive@convoypass.test'
export const OPERATOR_CLAIMS = { role: 'platform', platformAdmin: true }

export interface Opts {
  failOperatorDoc?: boolean
  generated?: string
  stdin?: string
}

export function fakeFirebase(opts: Opts = {}) {
  const users = new Map<string, AuthUserInfo & { password: string }>()
  const operators = new Map<string, OperatorDoc & { createdAt?: true }>()
  const userDocs = new Map<string, { email: string }>()
  const audits: PlatformAuditEntry[] = []
  const lines: string[] = []
  const secrets: string[] = []
  const revoked: string[] = []
  const deleted: string[] = []
  let seq = 0
  let touched = 0

  const addUser = (email: string, over: Partial<AuthUserInfo & { password: string }> = {}) => {
    const uid = over.uid ?? `u${++seq}`
    users.set(uid, { uid, email, displayName: 'Olive', emailVerified: true, disabled: false, claims: { ...OPERATOR_CLAIMS }, password: 'pw-original', ...over })
    return uid
  }
  const addOperator = (uid: string, over: Partial<OperatorDoc> = {}) => operators.set(uid, { name: 'Olive', email: EMAIL, status: 'active', mustChangePassword: false, ...over })
  /** A healthy super admin. */
  const healthy = (over: Partial<AuthUserInfo & { password: string }> = {}) => {
    const uid = addUser(EMAIL, over)
    addOperator(uid)
    return uid
  }

  const store = {
    auth: {
      getUserByEmail: async (email: string) => {
        touched++
        return [...users.values()].find((u) => u.email === email) ?? null
      },
      getUser: async (uid: string) => users.get(uid) ?? null,
      updateUser: async (uid: string, p: { emailVerified?: true; password?: string; disabled?: boolean }) => {
        const u = users.get(uid)!
        if (p.emailVerified) u.emailVerified = true
        if (p.password) u.password = p.password
        if (p.disabled !== undefined) u.disabled = p.disabled
      },
      setCustomUserClaims: async (uid: string, claims: typeof OPERATOR_CLAIMS) => void (users.get(uid)!.claims = { ...claims }),
      revokeRefreshTokens: async (uid: string) => void revoked.push(uid),
      createUser: async (p: { email: string; password: string; displayName: string; emailVerified: true }) => {
        touched++
        return { uid: addUser(p.email, { displayName: p.displayName, emailVerified: p.emailVerified, password: p.password, claims: {} }) }
      },
      deleteUser: async (uid: string) => void (users.delete(uid), deleted.push(uid)),
      disableUser: async (uid: string) => void (users.get(uid)!.disabled = true),
    },
    db: {
      getOperator: async (uid: string) => operators.get(uid) ?? null,
      userDocExists: async (uid: string) => userDocs.has(uid),
      tenantUserExistsWithEmail: async (email: string) => [...userDocs.values()].some((d) => d.email === email),
      saveOperator: async (uid: string, doc: { name?: string; email: string; status?: 'active'; mustChangePassword?: boolean }, a: PlatformAuditEntry) => {
        if (opts.failOperatorDoc) throw new Error('firestore down')
        const cur = operators.get(uid)
        operators.set(uid, cur ? { ...cur, ...doc } : { name: doc.name ?? '', email: doc.email, status: doc.status ?? 'active', mustChangePassword: doc.mustChangePassword ?? false, createdAt: true })
        audits.push(a)
      },
      disableOperator: async (uid: string, a: PlatformAuditEntry) => {
        operators.set(uid, { ...operators.get(uid)!, status: 'disabled' })
        audits.push(a)
      },
    },
  }

  const io: OperatorIo & DoctorIo = {
    ...store,
    auth: store.auth,
    out: (l) => lines.push(l),
    secret: (l) => secrets.push(l),
    firebaserc: RC,
    randomPassword: () => opts.generated ?? 'Gen3rated-Pass-9876-XyZ',
    readPassword: async () => opts.stdin ?? '',
    appBaseUrl: 'https://app.convoypass.test',
    fetch: async () => ({ status: 401 }),
    region: 'asia-south1',
  }
  return {
    io, store, users, operators, userDocs, audits, revoked, deleted,
    addUser, addOperator, healthy,
    text: () => lines.join('\n'),
    secretText: () => secrets.join('\n'),
    touched: () => touched,
    /** Everything that persists (Auth profile minus password, operator docs, audit entries): a generated password must never be in it. */
    persisted: () => JSON.stringify({ users: [...users.values()].map((u) => ({ ...u, password: undefined })), operators: [...operators.entries()], audits }),
  }
}
