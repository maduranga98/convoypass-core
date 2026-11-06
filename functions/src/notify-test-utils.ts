// In-memory fakes for the notification ports, on top of the shared `World`. Not part of the build (see tsconfig.json).
import { dateKey } from './dates.js'
import type { DevicePort } from './devices.js'
import type { NotificationDoc, NotifyDeps, PushMessage, PushResult } from './notifications.js'
import type { SlaPort } from './sla.js'
import { NOW, type World } from './test-utils.js'
import type { PassData } from './types.js'

export interface FakeDevice {
  token: string
  enabled: boolean
  createdAt: number
  platform?: string
  userAgent?: string
  lastSeenAt?: number
}

export interface NotifyWorld {
  notifications: Map<string, NotificationDoc>
  devices: Map<string, Map<string, FakeDevice>>
  sent: PushMessage[]
  /** Decide the result per token; default success. Throw to simulate a whole-call failure. */
  sendResult: (token: string, message: PushMessage) => PushResult
  failSend: boolean
  failCreateFor: Set<string>
  nowMs: number
  deps: NotifyDeps
  sla: SlaPort
  devicePort: DevicePort
  addDevice(uid: string, deviceId: string, token: string, over?: Partial<FakeDevice>): void
  uidsWithNotification(prefix: string): string[]
}

export function makeNotifyWorld(w: World, nowMs = NOW * 1000): NotifyWorld {
  const nw: NotifyWorld = {
    notifications: new Map(),
    devices: new Map(),
    sent: [],
    sendResult: () => ({ success: true }),
    failSend: false,
    failCreateFor: new Set(),
    nowMs,
    deps: undefined as unknown as NotifyDeps,
    sla: undefined as unknown as SlaPort,
    devicePort: undefined as unknown as DevicePort,
    addDevice(uid, deviceId, token, over = {}) {
      const m = nw.devices.get(uid) ?? new Map<string, FakeDevice>()
      m.set(deviceId, { token, enabled: true, createdAt: nw.nowMs, ...over })
      nw.devices.set(uid, m)
    },
    uidsWithNotification: (prefix) =>
      [...nw.notifications].filter(([id]) => id.startsWith(prefix)).map(([, d]) => d.recipientUid).sort(),
  }
  nw.deps = {
    now: () => nw.nowMs,
    baseUrl: 'https://app.example.com',
    messaging: {
      sendEach: async (message) => {
        if (nw.failSend) throw new Error('fcm down')
        nw.sent.push(message)
        return message.tokens.map((t) => nw.sendResult(t, message))
      },
    },
    data: {
      getTenant: async (id) => w.tenants.get(id) ?? null,
      listActiveUids: async ({ tenantId, role, contractorId }) =>
        [...w.users]
          .filter(([, u]) => u.tenantId === tenantId && u.role === role && u.status === 'active' && (!contractorId || u.contractorId === contractorId))
          .map(([uid]) => uid),
      isActiveUser: async (tenantId, uid) => {
        const u = w.users.get(uid)
        return Boolean(u && u.tenantId === tenantId && u.status === 'active')
      },
      createNotification: async (id, doc) => {
        if (nw.failCreateFor.has(doc.recipientUid)) throw new Error('write failed')
        if (nw.notifications.has(id)) return false
        nw.notifications.set(id, structuredClone(doc))
        return true
      },
      listDevices: async (uid) =>
        [...(nw.devices.get(uid) ?? [])].filter(([, d]) => d.enabled).map(([deviceId, d]) => ({ deviceId, token: d.token })),
      deleteDevice: async (uid, deviceId) => void nw.devices.get(uid)?.delete(deviceId),
      countPending: async ({ tenantId, contractorId, status, dateKey: key }) =>
        [...w.passes.values()].filter(
          (p) => p.tenantId === tenantId && p.status === status && p.dateKey === key && (!contractorId || p.contractorId === contractorId),
        ).length,
    },
  }
  nw.sla = {
    listTenants: async () => [...w.tenants].map(([id, data]) => ({ id, data })),
    listSlaCandidates: async ({ tenantId, dateKey: key, status }) =>
      [...w.passes]
        .filter(([, p]) => p.tenantId === tenantId && p.dateKey === key && p.status === status)
        .map(([id, p]) => ({ id, pass: structuredClone(p) })),
    alertTx: async ({ passId, stage, attempt, status, docs, nowMs: at }) => {
      const p = w.passes.get(passId) as PassData | undefined
      if (!p || p.status !== status || p.attempt !== attempt || p.slaAlerts?.[stage]?.attempt === attempt) return false
      w.passes.set(passId, { ...p, slaAlerts: { ...p.slaAlerts, [stage]: { attempt, at } } })
      for (const { id, doc } of docs) {
        if (nw.notifications.has(id)) throw new Error('already exists')
        nw.notifications.set(id, structuredClone(doc))
      }
      return true
    },
  }
  nw.devicePort = {
    upsertDevice: async (uid, deviceId, input, max) => {
      const m = nw.devices.get(uid) ?? new Map<string, FakeDevice>()
      const existing = m.get(deviceId)
      m.set(deviceId, { ...(existing ?? { createdAt: input.nowMs }), token: input.token, enabled: true, platform: input.platform, userAgent: input.userAgent, lastSeenAt: input.nowMs })
      for (const [id, d] of [...m]) if (id !== deviceId && d.token === input.token) m.delete(id)
      const overflow = m.size - max
      if (overflow > 0) {
        for (const [id] of [...m].filter(([id]) => id !== deviceId).sort((a, b) => a[1].createdAt - b[1].createdAt).slice(0, overflow)) m.delete(id)
      }
      nw.devices.set(uid, m)
      for (const [other, dm] of nw.devices) if (other !== uid) for (const [id, d] of [...dm]) if (d.token === input.token) dm.delete(id)
    },
    deleteDevice: async (uid, deviceId) => void nw.devices.get(uid)?.delete(deviceId),
  }
  return nw
}

export const today = (w: World, ms: number): string => dateKey(w.tenants.get('T1')?.timezone ?? 'Asia/Colombo', new Date(ms))
