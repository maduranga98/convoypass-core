// Firestore + Auth side of the super admin workspace functions (Admin SDK). Reads here are limited to the tenant summary,
// its admins' `users` docs and `count()`s; nothing of passes, vehicles, drivers or photos is read.
import { getAuth, type Auth } from 'firebase-admin/auth'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { provisionTenant } from '../tenants/tenantDefaults.js'
import type { AdminRecord, WorkspaceAuthPort, WorkspacePort } from './workspaces.js'

const ms = (v: unknown): number | null => (v instanceof Timestamp ? v.toMillis() : null)

/** `null` when the user has never signed in: Auth reports a last-sign-in time equal to (or before) creation for a fresh account. */
export async function lastSignInTimes(auth: Auth, uids: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>(uids.map((u) => [u, null]))
  if (uids.length === 0) return out
  const res = await auth.getUsers(uids.map((uid) => ({ uid })))
  for (const u of res.users) {
    const last = u.metadata.lastSignInTime ? Date.parse(u.metadata.lastSignInTime) : NaN
    const created = u.metadata.creationTime ? Date.parse(u.metadata.creationTime) : 0
    out.set(u.uid, Number.isFinite(last) && last > created ? last : null)
  }
  return out
}

export const workspaceAuthPort = (): WorkspaceAuthPort => {
  const auth = getAuth()
  return {
    getUserByEmail: (email) =>
      auth.getUserByEmail(email).then(
        (u) => ({ uid: u.uid }),
        (e: { code?: string }) => (e.code === 'auth/user-not-found' ? null : Promise.reject(e)),
      ),
    createUser: async (p) => ({ uid: (await auth.createUser(p)).uid }),
    setCustomUserClaims: (uid, claims) => auth.setCustomUserClaims(uid, claims),
    deleteUser: (uid) => auth.deleteUser(uid),
    updateUser: async (uid, p) => void (await auth.updateUser(uid, p)),
    revokeRefreshTokens: (uid) => auth.revokeRefreshTokens(uid),
    lastSignIn: (uids) => lastSignInTimes(auth, uids),
  }
}

export const workspacePort = (): WorkspacePort => {
  const db = getFirestore()
  const stamp = <T extends object>(a: T) => ({ ...a, createdAt: FieldValue.serverTimestamp() })
  const auditRef = () => db.collection('auditLog').doc()
  const platformRef = () => db.collection('platformAuditLog').doc()

  return {
    emailInUse: async (email) => {
      const [ops, users] = await Promise.all([
        db.collection('operators').where('email', '==', email).limit(1).get(),
        db.collection('users').where('email', '==', email).limit(1).get(),
      ])
      return !ops.empty || !users.empty
    },

    getWorkspace: async (tenantId) => {
      const snap = await db.doc(`tenants/${tenantId}`).get()
      const d = snap.data()
      if (!d) return null
      const [users, vehicles] = await Promise.all([
        db.collection('users').where('tenantId', '==', tenantId).count().get(),
        db.collection('vehicles').where('tenantId', '==', tenantId).count().get(),
      ])
      return {
        name: typeof d.name === 'string' ? d.name : '',
        createdAtMs: ms(d.createdAt) ?? 0,
        timezone: typeof d.timezone === 'string' ? d.timezone : 'Asia/Colombo',
        userCount: users.data().count,
        vehicleCount: vehicles.data().count,
      }
    },

    listAdmins: async (tenantId) => {
      const snap = await db.collection('users').where('tenantId', '==', tenantId).where('role', '==', 'admin').get()
      return snap.docs
        .map((doc): AdminRecord => {
          const d = doc.data()
          return {
            uid: doc.id,
            name: typeof d.name === 'string' ? d.name : '',
            email: typeof d.email === 'string' ? d.email : '',
            status: d.status === 'active' ? 'active' : 'disabled',
            mustChangePassword: d.mustChangePassword === true,
            createdAtMs: ms(d.createdAt) ?? 0,
          }
        })
        .sort((a, b) => a.createdAtMs - b.createdAtMs)
    },

    getUser: async (uid) => {
      const d = (await db.doc(`users/${uid}`).get()).data()
      if (!d) return null
      return { tenantId: String(d.tenantId ?? ''), role: String(d.role ?? ''), name: String(d.name ?? ''), status: String(d.status ?? '') }
    },

    createWorkspace: ({ input, platformAudit }) =>
      db.runTransaction(async (tx) => {
        // create() inside: an existing tenant or user makes it fail, so this can never join an existing workspace.
        provisionTenant(db, tx, { ...input, createdAt: FieldValue.serverTimestamp() })
        tx.create(platformRef(), stamp(platformAudit))
      }),

    addAdmin: async ({ tenantId, uid, name, email, tenantAudit, platformAudit }) => {
      const batch = db.batch()
      batch.create(db.doc(`users/${uid}`), {
        tenantId, role: 'admin', contractorId: null, name, email, phone: null, status: 'active', mustChangePassword: true,
        createdAt: FieldValue.serverTimestamp(), createdBy: 'platform', updatedAt: FieldValue.serverTimestamp(),
      })
      batch.create(auditRef(), stamp(tenantAudit))
      batch.create(platformRef(), stamp(platformAudit))
      await batch.commit()
    },

    resetAdmin: async ({ uid, tenantAudit, platformAudit }) => {
      const batch = db.batch()
      batch.update(db.doc(`users/${uid}`), { mustChangePassword: true, updatedAt: FieldValue.serverTimestamp() })
      batch.create(auditRef(), stamp(tenantAudit))
      batch.create(platformRef(), stamp(platformAudit))
      await batch.commit()
    },

    renameAdmin: async ({ uid, name, tenantAudit, platformAudit }) => {
      const batch = db.batch()
      batch.update(db.doc(`users/${uid}`), { name, updatedAt: FieldValue.serverTimestamp() })
      batch.create(auditRef(), stamp(tenantAudit))
      batch.create(platformRef(), stamp(platformAudit))
      await batch.commit()
    },

    setAdminStatus: ({ tenantId, uid, status, tenantAudit, platformAudit }) =>
      db.runTransaction(async (tx) => {
        if (status === 'disabled') {
          const admins = await tx.get(db.collection('users').where('tenantId', '==', tenantId).where('role', '==', 'admin'))
          const otherActive = admins.docs.filter((d) => d.id !== uid && d.data().status === 'active').length
          if (otherActive === 0) return 'last-admin' as const
        }
        tx.update(db.doc(`users/${uid}`), { status, updatedAt: FieldValue.serverTimestamp() })
        tx.create(auditRef(), stamp(tenantAudit))
        tx.create(platformRef(), stamp(platformAudit))
        return 'ok' as const
      }),

    restoreAdminStatus: async (uid, status) => void (await db.doc(`users/${uid}`).update({ status, updatedAt: FieldValue.serverTimestamp() })),
  }
}
