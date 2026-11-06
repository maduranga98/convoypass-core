// Firestore side of the platform callables (Admin SDK). `setupInvites`, `operators` and `platformAuditLog` have no
// client access in the rules; `tenants` and `users` are read here only for names and `count()`s.
import { getAuth } from 'firebase-admin/auth'
import { FieldPath, FieldValue, getFirestore, Timestamp, type DocumentData } from 'firebase-admin/firestore'
import { lastSignInTimes } from './workspacesPort.js'
import { inviteStatus, type InviteTimes } from '../tenants/inviteCode.js'
import type { InviteRecord, PlatformPort, TenantRow } from './platform.js'
import type { PlatformAuditEntry } from './platformAudit.js'
import type { SignupAuthPort, SignupPort } from './signup.js'

const ms = (v: unknown): number | null => (v instanceof Timestamp ? v.toMillis() : null)

const timesOf = (d: DocumentData): InviteTimes => ({
  expiresAtMs: ms(d.expiresAt) ?? 0,
  usedAtMs: ms(d.usedAt),
  claimedAtMs: ms(d.claimedAt),
})

/** Overview reads every invite (a few dozen in practice); the cap keeps a runaway collection from becoming a huge read. */
const OVERVIEW_CAP = 5000

export const platformPort = (): PlatformPort => {
  const db = getFirestore()
  const auditRef = () => db.collection('platformAuditLog').doc()
  const stamp = (a: PlatformAuditEntry) => ({ ...a, createdAt: FieldValue.serverTimestamp() })

  return {
    getOperator: async (uid) => {
      const d = (await db.doc(`operators/${uid}`).get()).data()
      if (!d) return null
      return {
        name: typeof d.name === 'string' ? d.name : '',
        email: typeof d.email === 'string' ? d.email : '',
        status: d.status === 'active' ? 'active' : 'disabled',
        mustChangePassword: d.mustChangePassword === true,
      }
    },

    createInvite: async (hash, invite, audit) => {
      const batch = db.batch()
      batch.create(db.doc(`setupInvites/${hash}`), {
        createdAt: Timestamp.fromMillis(invite.createdAtMs),
        expiresAt: Timestamp.fromMillis(invite.expiresAtMs),
        ...(invite.companyHint ? { companyHint: invite.companyHint } : {}),
        ...(invite.emailLock ? { emailLock: invite.emailLock } : {}),
        claimedAt: null, claimId: null, usedAt: null, tenantId: null,
      })
      batch.create(auditRef(), stamp(audit))
      await batch.commit()
    },

    listInvites: async ({ beforeMs, limit }) => {
      let q = db.collection('setupInvites').orderBy('createdAt', 'desc')
      if (beforeMs !== null) q = q.where('createdAt', '<', Timestamp.fromMillis(beforeMs))
      const snap = await q.limit(limit).get()
      return snap.docs.map((doc): InviteRecord => {
        const d = doc.data()
        return {
          hash: doc.id,
          createdAtMs: ms(d.createdAt) ?? 0,
          ...timesOf(d),
          tenantId: typeof d.tenantId === 'string' ? d.tenantId : null,
          ...(typeof d.companyHint === 'string' ? { companyHint: d.companyHint } : {}),
          ...(typeof d.emailLock === 'string' ? { emailLock: d.emailLock } : {}),
        }
      })
    },

    findInviteHashes: async (prefix) => {
      const snap = await db.collection('setupInvites')
        .where(FieldPath.documentId(), '>=', prefix)
        .where(FieldPath.documentId(), '<', `${prefix}`)
        .limit(2)
        .get()
      return snap.docs.map((d) => d.id)
    },

    revokeInvite: (hash, nowMs, audit) =>
      db.runTransaction(async (tx) => {
        const ref = db.doc(`setupInvites/${hash}`)
        const d = (await tx.get(ref)).data()
        if (!d) return 'not-found'
        const status = inviteStatus(timesOf(d), nowMs)
        if (status === 'used') return 'used'
        if (status === 'claimed') return 'claimed'
        tx.delete(ref)
        tx.create(auditRef(), stamp(audit))
        return 'deleted'
      }),

    tenantNames: async (ids) => {
      const out = new Map<string, string>()
      if (ids.length === 0) return out
      const snaps = await db.getAll(...ids.map((id) => db.doc(`tenants/${id}`)))
      for (const s of snaps) {
        const name = s.data()?.name
        if (typeof name === 'string') out.set(s.id, name)
      }
      return out
    },

    listTenants: async ({ beforeMs, limit }) => {
      let q = db.collection('tenants').orderBy('createdAt', 'desc')
      if (beforeMs !== null) q = q.where('createdAt', '<', Timestamp.fromMillis(beforeMs))
      const snap = await q.limit(limit).get()
      return Promise.all(
        snap.docs.map(async (doc): Promise<TenantRow> => {
          const d = doc.data()
          const [users, vehicles, admins] = await Promise.all([
            db.collection('users').where('tenantId', '==', doc.id).count().get(),
            db.collection('vehicles').where('tenantId', '==', doc.id).count().get(),
            db.collection('users').where('tenantId', '==', doc.id).where('role', '==', 'admin').get(),
          ])
          // Oldest admin first: the "primary" one shown in the table.
          const adminDocs = admins.docs.sort((a, b) => (ms(a.data().createdAt) ?? 0) - (ms(b.data().createdAt) ?? 0))
          const admin = adminDocs[0]?.data()
          const signIns = await lastSignInTimes(getAuth(), adminDocs.map((a) => a.id))
          return {
            tenantId: doc.id,
            name: typeof d.name === 'string' ? d.name : '',
            createdAtMs: ms(d.createdAt) ?? 0,
            timezone: typeof d.timezone === 'string' ? d.timezone : 'Asia/Colombo',
            adminName: typeof admin?.name === 'string' ? admin.name : null,
            adminEmail: typeof admin?.email === 'string' ? admin.email : null,
            userCount: users.data().count,
            vehicleCount: vehicles.data().count,
            adminCount: adminDocs.length,
            activeAdminCount: adminDocs.filter((a) => a.data().status === 'active').length,
            adminSignedIn: [...signIns.values()].some((t) => t !== null),
          }
        }),
      )
    },

    inviteTimes: async () => {
      const snap = await db.collection('setupInvites').select('expiresAt', 'claimedAt', 'usedAt').limit(OVERVIEW_CAP).get()
      return snap.docs.map((d) => timesOf(d.data()))
    },

    setOperatorPassword: async (uid, password, audit) => {
      await getAuth().updateUser(uid, { password })
      const batch = db.batch()
      batch.update(db.doc(`operators/${uid}`), { mustChangePassword: false, passwordChangedAt: FieldValue.serverTimestamp() })
      batch.create(auditRef(), stamp(audit))
      await batch.commit()
    },

    tenantCount: async () => (await db.collection('tenants').count().get()).data().count,
  }
}

/** Firestore side of the open super admin signup: the operators profile and its audit entry, written together. */
export const signupPort = (): SignupPort => {
  const db = getFirestore()
  return {
    emailInUse: async (email) => {
      const [ops, users] = await Promise.all([
        db.collection('operators').where('email', '==', email).limit(1).get(),
        db.collection('users').where('email', '==', email).limit(1).get(),
      ])
      return !ops.empty || !users.empty
    },
    createOperator: async (uid, doc, audit) => {
      const batch = db.batch()
      batch.create(db.doc(`operators/${uid}`), { name: doc.name, email: doc.email, status: 'active', mustChangePassword: false, createdAt: FieldValue.serverTimestamp() })
      batch.create(db.collection('platformAuditLog').doc(), { ...audit, createdAt: FieldValue.serverTimestamp() })
      await batch.commit()
    },
  }
}

export const signupAuthPort = (): SignupAuthPort => {
  const auth = getAuth()
  return {
    createUser: async (p) => ({ uid: (await auth.createUser(p)).uid }),
    setCustomUserClaims: (uid, claims) => auth.setCustomUserClaims(uid, claims),
    deleteUser: (uid) => auth.deleteUser(uid),
  }
}
