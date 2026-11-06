// Admin SDK helper: runs in its own process (`tsx e2e/support/admin.ts <command> <json>`), because Playwright's module
// loader cannot load firebase-admin. Emulators only.
import { initializeApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore, Timestamp, type QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { tenantDefaults } from '../../functions/src/tenants/tenantDefaults.ts'
import { DEV_PIN_PEPPER, pinKey } from '../../functions/src/pin.ts'
import { CONTRACTOR, DRIVER_PIN, PASSWORD, PLATE, PROJECT, SECURITY_PIN, STAFF, TENANT, VEHICLE } from './constants.ts'

process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099'
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= '127.0.0.1:9199'

if (!getApps().length) initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` })
const db = getFirestore()
const auth = getAuth()

const clearEmulators = async (): Promise<void> => {
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
}

const uids: Record<string, string> = {}

async function user(key: string, email: string, password: string, name: string, claims: Record<string, string>, doc: Record<string, unknown>): Promise<void> {
  // Verified: the unverified-email banner has its own tests (e2e/setup.spec.ts), and must not sit on every other screen.
  const u = await auth.createUser({ email, password, displayName: name, emailVerified: true })
  await finish(key, u.uid, name, claims, doc)
}

/** Module 12: a driver or security user has no email and no password; `pinIndex/{hmac}` points at it (dev pepper). */
async function pinUser(key: string, pin: string, name: string, claims: Record<string, string>, doc: Record<string, unknown>): Promise<void> {
  const u = await auth.createUser({ displayName: name })
  await db.doc(`pinIndex/${pinKey(pin, DEV_PIN_PEPPER)}`).set({ uid: u.uid, tenantId: TENANT, role: claims.role, createdAt: Timestamp.now() })
  await finish(key, u.uid, name, claims, { loginType: 'pin', pinVersion: 1, ...doc })
}

async function finish(key: string, uid: string, name: string, claims: Record<string, string>, doc: Record<string, unknown>): Promise<void> {
  const u = { uid }
  await auth.setCustomUserClaims(u.uid, claims)
  await db.doc(`users/${u.uid}`).set({
    tenantId: TENANT, contractorId: null, name, email: null, phone: null, status: 'active', mustChangePassword: false,
    createdAt: FieldValue.serverTimestamp(), createdBy: 'e2e', updatedAt: FieldValue.serverTimestamp(), ...doc,
  })
  uids[key] = u.uid
}

/** A clean tenant with one of every role, one contractor, one vehicle assigned to the driver. */
async function seed(): Promise<Record<string, string>> {
  await clearEmulators()
  // The tenant has exactly what provisionTenant gives every new workspace, so the whole e2e suite runs on a real default tenant.
  await db.doc(`tenants/${TENANT}`).set({ name: 'E2E Quarry', status: 'active', ...tenantDefaults('Asia/Colombo'), createdAt: FieldValue.serverTimestamp() })
  await db.doc(`contractors/${CONTRACTOR}`).set({ tenantId: TENANT, name: 'Acme Haulage', status: 'active', createdAt: Timestamp.now(), createdBy: 'e2e', updatedAt: Timestamp.now() })
  for (const [role, who] of Object.entries(STAFF)) {
    if (role === 'security') continue
    const contractorId = role === 'supervisor' ? CONTRACTOR : null
    await user(role, who.email, PASSWORD, who.name, { role, tenantId: TENANT, ...(contractorId ? { contractorId } : {}) }, { role, email: who.email, contractorId, loginType: 'password' })
  }
  await pinUser('security', SECURITY_PIN, STAFF.security.name, { role: 'security', tenantId: TENANT }, { role: 'security' })
  await pinUser('driver', DRIVER_PIN, 'Dan Driver', { role: 'driver', tenantId: TENANT, contractorId: CONTRACTOR }, { role: 'driver', contractorId: CONTRACTOR, phone: '94771234567' })
  await db.doc(`drivers/${uids.driver}`).set({ tenantId: TENANT, contractorId: CONTRACTOR, name: 'Dan Driver', phone: '94771234567', status: 'active', createdAt: Timestamp.now(), updatedAt: Timestamp.now() })
  await db.doc(`vehicles/${VEHICLE}`).set({
    tenantId: TENANT, contractorId: CONTRACTOR, plateNo: PLATE, plateKey: 'WPLJ4821', type: 'Tipper', assignedDriverIds: [uids.driver], status: 'active',
    createdAt: Timestamp.now(), createdBy: 'e2e', updatedAt: Timestamp.now(),
  })
  await db.doc(`vehiclePlates/${TENANT}_WPLJ4821`).set({ vehicleId: VEHICLE })
  // One audit entry, so the audit log page has a row to show and export.
  await db.collection('auditLog').add({
    tenantId: TENANT, action: 'user.create', actorUid: uids.admin, actorRole: 'admin', targetType: 'user', targetId: uids.driver, meta: { role: 'driver' }, createdAt: Timestamp.now(),
  })
  return uids
}

/** Today's `YYYYMMDD` in the tenant timezone. */
const todayKey = (): string => {
  const p = new Intl.DateTimeFormat('en-US-u-nu-latn', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${g('year')}${g('month')}${g('day')}`
}

/** What `submitPass` would leave behind: the real Firestore trigger then notifies the contractor's supervisors. */
async function writePass(status = 'submitted', vehicleId = VEHICLE, plateNo = PLATE, driverId = ''): Promise<string> {
  const id = `${vehicleId}_${todayKey()}`
  await db.doc(`passes/${id}`).set({
    tenantId: TENANT, contractorId: CONTRACTOR, vehicleId, plateNo, vehicleType: 'Tipper', dateKey: todayKey(), driverId: driverId, driverName: 'Dan Driver',
    status, attempt: 1, submittedAt: Timestamp.now(), updatedAt: Timestamp.now(),
    ...(status === 'supervisor_approved' || status === 'officer_approved' ? { supervisor: { uid: uids.supervisor ?? 's', name: 'Sue Supervisor', at: Timestamp.now() } } : {}),
    ...(status === 'officer_approved' ? { officer: { uid: uids.officer ?? 'o', name: 'Olga Officer', at: Timestamp.now() } } : {}),
    checklist: [{ id: 'tyres', label: 'Tyres are in good condition', answer: 'yes' }],
    evidence: { gps: { path: 'p/gps.jpg', size: 1, contentType: 'image/jpeg' }, dashcam: { path: 'p/dashcam.jpg', size: 1, contentType: 'image/jpeg' }, extra: [] },
    captureMeta: { method: 'live', clientCapturedAt: { gps: 'a', dashcam: 'b' } },
  })
  return id
}

const notificationsFor = async (uid: string): Promise<{ id: string; read: boolean }[]> =>
  (await db.collection('notifications').where('recipientUid', '==', uid).get()).docs.map((d: { id: string; data: () => unknown }) => ({ id: d.id, read: (d.data() as { readAt: unknown }).readAt !== null }))

/** Makes an invite (found by hash prefix) expired, the way waiting past its expiry date would. */
async function expireInvite(hashPrefix: string): Promise<string> {
  const docs = (await db.collection('setupInvites').get()).docs.filter((d: QueryDocumentSnapshot) => d.id.startsWith(hashPrefix))
  if (docs.length !== 1) throw new Error(`expected one invite for ${hashPrefix}, found ${docs.length}`)
  await docs[0]!.ref.update({ expiresAt: Timestamp.fromMillis(Date.now() - 60_000) })
  return docs[0]!.id
}

/** The stored tenant with this name (timestamps dropped, `id` added) for assertions about defaults. */
async function tenantByName(name: string): Promise<Record<string, unknown>> {
  const docs = (await db.collection('tenants').where('name', '==', name).get()).docs
  if (docs.length !== 1) throw new Error(`expected one tenant named ${name}, found ${docs.length}`)
  const data = docs[0]!.data()
  delete data.createdAt
  return { id: docs[0]!.id, ...data }
}

/** Breaks a super admin on purpose (doctor / repair tests): drop the claims, delete the operators profile, or unverify the email. */
async function breakOperator(email: string, what: string): Promise<string> {
  const u = await auth.getUserByEmail(email)
  if (what === 'claims') await auth.setCustomUserClaims(u.uid, {})
  else if (what === 'tenant-claim') await auth.setCustomUserClaims(u.uid, { role: 'platform', platformAdmin: true, tenantId: TENANT })
  else if (what === 'profile') await db.doc(`operators/${u.uid}`).delete()
  else if (what === 'email') await auth.updateUser(u.uid, { emailVerified: false })
  else throw new Error(`unknown break ${what}`)
  return what
}

const [command, raw] = process.argv.slice(2)
const args = JSON.parse(raw ?? '{}') as Record<string, string>
const run = async (): Promise<unknown> => {
  switch (command) {
    case 'seed':
      return seed()
    case 'writePass':
      return writePass(args.status, args.vehicleId, args.plateNo, args.driverId)
    case 'expireInvite':
      return expireInvite(args.hashPrefix ?? '')
    case 'tenantByName':
      return tenantByName(args.name ?? '')
    case 'breakOperator':
      return breakOperator(args.email ?? '', args.what ?? '')
    case 'notificationsFor':
      return notificationsFor(args.uid ?? '')
    default:
      throw new Error(`unknown command ${String(command)}`)
  }
}
run().then(
  (result) => {
    console.log(`RESULT ${JSON.stringify(result)}`)
    process.exit(0)
  },
  (e: unknown) => {
    console.error(e)
    process.exit(1)
  },
)
