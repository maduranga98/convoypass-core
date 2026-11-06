import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'
import type { DeviceInput, DevicePort } from './devices.js'
import type { MessagingPort, NotifyPort } from './notifications.js'
import { toPass } from './ports.js'
import type { SlaPort } from './sla.js'
import type { TenantData, UserData } from './types.js'

const ALREADY_EXISTS = 6

const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : 0)

export const notifyPort = (): NotifyPort => {
  const db = getFirestore()
  return {
    getTenant: async (tenantId) => {
      const snap = await db.doc(`tenants/${tenantId}`).get()
      return snap.exists ? (snap.data() as TenantData) : null
    },
    listActiveUids: async ({ tenantId, role, contractorId }) => {
      let q = db.collection('users').where('tenantId', '==', tenantId).where('role', '==', role).where('status', '==', 'active')
      if (contractorId) q = q.where('contractorId', '==', contractorId)
      return (await q.select().get()).docs.map((d) => d.id)
    },
    isActiveUser: async (tenantId, uid) => {
      const snap = await db.doc(`users/${uid}`).get()
      const u = snap.data() as UserData | undefined
      return Boolean(u && u.tenantId === tenantId && u.status === 'active')
    },
    createNotification: async (id, doc) => {
      try {
        await db.doc(`notifications/${id}`).create({
          ...doc,
          createdAt: Timestamp.fromMillis(doc.createdAt),
          expireAt: Timestamp.fromMillis(doc.expireAt),
          readAt: null,
        })
        return true
      } catch (e) {
        if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === ALREADY_EXISTS) return false
        throw e
      }
    },
    listDevices: async (uid) => {
      const snap = await db.collection(`users/${uid}/devices`).where('enabled', '==', true).get()
      return snap.docs.map((d) => ({ deviceId: d.id, token: String((d.data() as { token?: unknown }).token ?? '') })).filter((d) => d.token)
    },
    deleteDevice: async (uid, deviceId) => {
      await db.doc(`users/${uid}/devices/${deviceId}`).delete()
    },
    countPending: async ({ tenantId, contractorId, status, dateKey }) => {
      let q = db.collection('passes').where('tenantId', '==', tenantId).where('dateKey', '==', dateKey).where('status', '==', status)
      if (contractorId) q = q.where('contractorId', '==', contractorId)
      return (await q.count().get()).data().count
    },
  }
}

export const messagingPort = (): MessagingPort => ({
  sendEach: async (message) => {
    const res = await getMessaging().sendEachForMulticast({ tokens: message.tokens, data: message.data, webpush: message.webpush })
    return res.responses.map((r) => ({ success: r.success, ...(r.error ? { errorCode: r.error.code } : {}) }))
  },
})

export const slaPort = (): SlaPort => {
  const db = getFirestore()
  return {
    listTenants: async () => (await db.collection('tenants').get()).docs.map((d) => ({ id: d.id, data: d.data() as TenantData })),
    listSlaCandidates: async ({ tenantId, dateKey, status }) => {
      const snap = await db.collection('passes').where('tenantId', '==', tenantId).where('dateKey', '==', dateKey).where('status', '==', status).get()
      const clock = (p: ReturnType<typeof toPass>) => (status === 'submitted' ? p.submittedAt : p.supervisor?.at) ?? Number.MAX_SAFE_INTEGER
      return snap.docs
        .map((d) => ({ id: d.id, pass: toPass(d.data() as Record<string, unknown>) }))
        .sort((a, b) => clock(a.pass) - clock(b.pass))
    },
    alertTx: ({ passId, stage, attempt, status, docs, nowMs }) =>
      db.runTransaction(async (tx) => {
        const ref = db.doc(`passes/${passId}`)
        const snap = await tx.get(ref)
        const raw = snap.data() as { status?: string; attempt?: number; slaAlerts?: Record<string, { attempt?: number }> } | undefined
        if (!raw || raw.status !== status || raw.attempt !== attempt || raw.slaAlerts?.[stage]?.attempt === attempt) return false
        tx.update(ref, { [`slaAlerts.${stage}`]: { attempt, at: Timestamp.fromMillis(nowMs) } })
        for (const { id, doc } of docs) {
          tx.create(db.doc(`notifications/${id}`), {
            ...doc,
            createdAt: Timestamp.fromMillis(doc.createdAt),
            expireAt: Timestamp.fromMillis(doc.expireAt),
            readAt: null,
          })
        }
        return true
      }),
  }
}

export const devicePort = (): DevicePort => {
  const db = getFirestore()
  return {
    upsertDevice: async (uid, deviceId, input: DeviceInput, max) => {
      const col = db.collection(`users/${uid}/devices`)
      await db.runTransaction(async (tx) => {
        const all = await tx.get(col)
        const mine = all.docs.find((d) => d.id === deviceId)
        const ref = col.doc(deviceId)
        const fields = { token: input.token, platform: input.platform, userAgent: input.userAgent, lastSeenAt: Timestamp.fromMillis(input.nowMs), enabled: true }
        if (mine) tx.update(ref, fields)
        else tx.create(ref, { ...fields, createdAt: Timestamp.fromMillis(input.nowMs) })
        // Same token under another device id of this user would double every push.
        const others = all.docs.filter((d) => d.id !== deviceId)
        const same = others.filter((d) => (d.data() as { token?: unknown }).token === input.token)
        for (const d of same) tx.delete(d.ref)
        const kept = others.filter((d) => !same.includes(d))
        const overflow = kept.length + 1 - max
        if (overflow > 0) {
          const oldest = [...kept].sort((a, b) => ms((a.data() as { createdAt?: unknown }).createdAt) - ms((b.data() as { createdAt?: unknown }).createdAt))
          for (const d of oldest.slice(0, overflow)) tx.delete(d.ref)
        }
      })
      // A token belongs to one browser profile: if another account signed in there before, it must stop receiving
      // that account's alerts. Best effort; the client also unregisters when signing out.
      try {
        const clash = await db.collectionGroup('devices').where('token', '==', input.token).get()
        await Promise.all(clash.docs.filter((d) => d.ref.parent.parent?.id !== uid).map((d) => d.ref.delete()))
      } catch {
        /* the index may still be building; the next registration retries */
      }
    },
    deleteDevice: async (uid, deviceId) => {
      await db.doc(`users/${uid}/devices/${deviceId}`).delete()
    },
  }
}

