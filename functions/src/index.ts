import { initializeApp } from 'firebase-admin/app'
import { setGlobalOptions } from 'firebase-functions/v2'
import { onCall, onRequest } from 'firebase-functions/v2/https'
import { ENFORCE_APP_CHECK, REGION } from './config.js'
import * as approvals from './approvals.js'
import * as clientErrors from './clientErrors.js'
import * as core from './core.js'
import { handleCspReport } from './cspReport.js'
import * as devices from './devices.js'
import * as gate from './gate.js'
import * as requirements from './requirements.js'
import * as passes from './passes.js'
import * as inspections from './inspections.js'
import * as penalties from './penalties.js'
import * as eligibilityCheck from './checkEligibility.js'
import * as reportsApi from './reportsApi.js'
import { devicePort } from './notifyPorts.js'
import { clientIpOf, operatorCallable, callable, publicCallable, runOperatorCall } from './runtime.js'
import { APP_BASE_URL, IN_EMULATOR, SUPERADMIN_SIGNUP_ENABLED } from './config.js'
import { createPlatformApi } from './platform/platform.js'
import { platformPort, signupAuthPort, signupPort } from './platform/platformPort.js'
import * as superAdminSignup from './platform/signup.js'
import { createWorkspaceApi } from './platform/workspaces.js'
import { workspaceAuthPort, workspacePort } from './platform/workspacesPort.js'
import { generateTempPassword } from './auth/tempPassword.js'
import { supportedTimezones } from './setup.js'
import { enforceRateLimit, firestoreRateLimitPort } from './rateLimit.js'
import { newTenantId } from './tenants/tenantDefaults.js'
import * as setup from './setup.js'
import { newClaimId, setupPort } from './setupPort.js'
import { authPort } from './ports.js'
import { PIN_PEPPER, readPinPepper } from './pinSecret.js'
import * as pinLogin from './pinLogin.js'
import { pinLoginPort } from './pinLoginPort.js'
import { deliver } from './notifications.js'
import { notifyDeps } from './notificationTriggers.js'
import { PIN_LIMITS } from './config.js'
import * as vehicles from './vehicles.js'
import * as gatePasses from './gatePasses.js'
import { gatePassPort } from './gatePassPort.js'
import * as visits from './visits.js'
import { visitPort } from './visitsPort.js'

initializeApp()
// `enforceAppCheck` applies to callables only (ENFORCE_APP_CHECK=true in functions/.env.<alias>, never in the emulator).
setGlobalOptions({ region: REGION, maxInstances: 10, enforceAppCheck: ENFORCE_APP_CHECK })

// Sensitive callables are rate limited per user (`rateLimit: true`); latency-sensitive ones stay warm (`warm: true`).
// Drivers and security get a server-generated PIN (Module 12): the PIN functions bind the PIN_PEPPER secret.
export const createUser = callable('createUser', core.createUser, { rateLimit: true, secrets: [PIN_PEPPER] })
export const reissuePin = callable('reissuePin', core.reissuePin, { rateLimit: true, secrets: [PIN_PEPPER] })
export const revealPin = callable('revealPin', core.revealPin, { rateLimit: true, secrets: [PIN_PEPPER] })
// Module 12: PIN sign-in. Unauthenticated: throttled per hashed IP and device, one uniform failure, App Check through the
// global flag. Returns a custom token; the client calls signInWithCustomToken.
const pinLoginDeps = (): pinLogin.PinLoginDeps => ({
  port: pinLoginPort(),
  limits: PIN_LIMITS,
  pepper: readPinPepper,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: () => Math.random(),
  notify: async (tenantId, planned, actorUid) => {
    await deliver(notifyDeps(), tenantId, [planned], actorUid, { fn: 'loginWithPin', tenantId })
  },
})
export const loginWithPin = onCall({ secrets: [PIN_PEPPER] }, (request) =>
  pinLogin.loginWithPin(pinLoginDeps(), request.data, clientIpOf(request.rawRequest)),
)
export const updateUser = callable('updateUser', core.updateUser)
export const resetCredential = callable('resetCredential', core.resetCredential, { rateLimit: true })
// One callable for everyone's own password. A super admin (platform claims, no tenant) goes to the platform API (verified
// email, active operators profile, sign-in within 5 minutes, audit in platformAuditLog); everyone else takes the unchanged
// workspace path.
const changeTenantOwnPassword = callable('changeOwnPassword', core.changeOwnPassword)
export const changeOwnPassword = onCall((request) => {
  const token = request.auth?.token as Record<string, unknown> | undefined
  if (request.auth && token && (token.role === 'platform' || token.platformAdmin === true)) {
    return runOperatorCall('changeOwnPassword', { uid: request.auth.uid, token }, request.data, (a, d) => platformApi().changeOwnPassword(a, d))
  }
  return changeTenantOwnPassword.run(request)
})

export const createVehicle = callable('createVehicle', vehicles.createVehicle)
export const updateVehicle = callable('updateVehicle', vehicles.updateVehicle)
export const setVehicleStatus = callable('setVehicleStatus', vehicles.setVehicleStatus)
export const setVehicleDrivers = callable('setVehicleDrivers', vehicles.setVehicleDrivers)
// 200 rows, one transaction each.
export const recordQualification = callable('recordQualification', requirements.recordQualification)
export const setMyPermits = callable('setMyPermits', requirements.setMyPermits)
export const importVehicles = callable('importVehicles', vehicles.importVehicles, { timeoutSeconds: 180, rateLimit: true })
export const setContractorStatus = callable('setContractorStatus', vehicles.setContractorStatus, { timeoutSeconds: 120 })

export const resolveVehicle = callable('resolveVehicle', passes.resolveVehicle, { warm: true })
export const submitPass = callable('submitPass', passes.submitPass, { warm: true })
export const updateTenantSettings = callable('updateTenantSettings', passes.updateTenantSettings)

export const decidePass = callable('decidePass', approvals.decidePass)
// 50 items, one transaction each.
export const bulkApprove = callable('bulkApprove', approvals.bulkApprove, { timeoutSeconds: 120, rateLimit: true })
export const revokePass = callable('revokePass', approvals.revokePass)

// Module 5: the gate. Security reads directly from Firestore; these are its only writes.
export const checkIn = callable('checkIn', gate.checkIn, { warm: true })
export const denyEntry = callable('denyEntry', gate.denyEntry)

// Penalties and suspensions: issue (admin, Safety Officer), revoke (admin), verify (supervisor), types (admin). Clients
// only read these collections; `checkEligibility` is the live check the gate and trip assignment share.
export const createPenaltyType = callable('createPenaltyType', penalties.createPenaltyType)
export const updatePenaltyType = callable('updatePenaltyType', penalties.updatePenaltyType)
export const deletePenaltyType = callable('deletePenaltyType', penalties.deletePenaltyType)
export const issuePenalty = callable('issuePenalty', penalties.issuePenalty, { rateLimit: true })
export const revokePenalty = callable('revokePenalty', penalties.revokePenalty)
export const verifyPenalty = callable('verifyPenalty', penalties.verifyPenalty)
export const checkEligibility = callable('checkEligibility', eligibilityCheck.checkEligibility, { warm: true })

// Inspections: the Safety Officer records an inspection (or withdraws a clearance); clearance is cancelled by the triggers
// below when a penalty is issued or a document expires. Clients only read these collections.
export const recordInspection = callable('recordInspection', inspections.recordInspection, { rateLimit: true })
export const withdrawClearance = callable('withdrawClearance', inspections.withdrawClearance)
export { invalidateInspectionOnPenalty, invalidateInspectionOnVehicleExpiry, invalidateInspectionOnDriverExpiry } from './inspectionTriggers.js'

// Visit lifecycle (check-in, unloading check, check-out). Clients only read `visits`. Check-in resolves the driver by PIN,
// so it binds PIN_PEPPER and keeps the gate's cold-start setting; failed PINs are throttled per guard.
export const checkInVisit = callable('checkInVisit', (d, c, data) => visits.checkInVisit(d, visitPort(), c, data), { warm: true, rateLimit: true })
export const checkOutVisit = callable('checkOutVisit', (d, c, data) => visits.checkOutVisit(d, visitPort(), c, data), { warm: true })
export const logUnloadingCheck = callable('logUnloadingCheck', (d, c, data) => visits.logUnloadingCheck(d, visitPort(), c, data))
export const getDailySummary = callable('getDailySummary', (d, c) => visits.getDailySummary(d, visitPort(), c))

// Monthly gate pass (the last gate of the eligibility chain). Clients only read `gatePasses` and `monthEndQualification`. System blocks
// come from the inspection triggers above; expiry and the optional auto-issue from the schedules in gatePassSchedules.ts.
export const issueGatePasses = callable('issueGatePasses', (d, c, data) => gatePasses.issueGatePasses(d, gatePassPort(), c, data), { rateLimit: true, timeoutSeconds: 120 })
export const blockGatePass = callable('blockGatePass', (d, c, data) => gatePasses.blockGatePass(d, gatePassPort(), c, data))
export const reactivateGatePass = callable('reactivateGatePass', (d, c, data) => gatePasses.reactivateGatePass(d, gatePassPort(), c, data))
export const refreshQualificationList = callable('refreshQualificationList', (d, c, data) => gatePasses.refreshQualificationList(d, gatePassPort(), c, data), { rateLimit: true, timeoutSeconds: 300, memory: '512MiB' })
export { rolloverGatePassesScheduled as rolloverGatePasses, computeQualificationScheduled as computeQualificationLists } from './gatePassSchedules.js'

// Module 6: dashboard trend and reports (admin and officer, read only).
export const getDashboardTrend = callable('getDashboardTrend', reportsApi.getDashboardTrend, { timeoutSeconds: 60 })
export const runReport = callable('runReport', (d, c, data) => reportsApi.runReport(d, c, data), { timeoutSeconds: 300, memory: '1GiB' })

// Module 7: notifications. Triggers (passes, gateEvents) and the SLA schedule live in notificationTriggers.ts.
export { flagDwellVisitsScheduled as flagDwellVisits, onGateEventCreated, onPassWritten, purgeOldEvidenceDaily as purgeOldEvidence, expirePenaltiesHourly as expirePenalties, recomputeEligibilityDaily as recomputeEligibility, slaReminders } from './notificationTriggers.js'
export const registerDevice = callable(
  'registerDevice',
  (d, caller, data, meta) => devices.registerDevice(d, devicePort(), caller, data, meta),
  { rateLimit: true },
)
export const unregisterDevice = callable('unregisterDevice', (d, caller, data) => devices.unregisterDevice(d, devicePort(), caller, data))

// Module 8: invite-only workspace setup. No sign-in: per-IP rate limits, uniform errors, codes never logged.
const setupDeps = (): setup.SetupDeps => ({
  auth: authPort(),
  port: setupPort(),
  now: () => Date.now(),
  newTenantId,
  newClaimId,
  timezones: setup.supportedTimezones,
})
export const validateSetupInvite = publicCallable('validateSetupInvite', (data) => setup.validateSetupInvite(setupDeps(), data))
export const completeSetup = publicCallable('completeSetup', (data) => setup.completeSetup(setupDeps(), data))

// Module 9: operator console. Operators have claims { role: 'platform', platformAdmin: true } and no tenant;
// every call goes through requireOperator (verified email, active operators/{uid}, fresh sign-in for mutations).
const platformApi = () =>
  createPlatformApi({
    port: platformPort(),
    now: () => Date.now(),
    rateLimit: (uid, fn) => enforceRateLimit(firestoreRateLimitPort(), uid, fn),
    appBaseUrl: APP_BASE_URL,
    inEmulator: IN_EMULATOR,
  })
export const getOperatorProfile = operatorCallable('getOperatorProfile', (a) => platformApi().getOperatorProfile(a))
export const getOperatorOverview = operatorCallable('getOperatorOverview', (a) => platformApi().getOperatorOverview(a))
export const createSetupInvite = operatorCallable('createSetupInvite', (a, d) => platformApi().createSetupInvite(a, d))
export const listSetupInvites = operatorCallable('listSetupInvites', (a, d) => platformApi().listSetupInvites(a, d))
export const revokeSetupInvite = operatorCallable('revokeSetupInvite', (a, d) => platformApi().revokeSetupInvite(a, d))
// Module 11: open super admin signup. Public (per-IP rate limits); off unless the emulator or ALLOW_SUPERADMIN_SIGNUP=true.
const signupDeps = (): superAdminSignup.SignupDeps => ({ enabled: () => SUPERADMIN_SIGNUP_ENABLED, auth: signupAuthPort(), port: signupPort() })
export const getSuperAdminSignupStatus = publicCallable('getSuperAdminSignupStatus', async () => superAdminSignup.signupStatus(signupDeps()))
export const signUpSuperAdmin = publicCallable('signUpSuperAdmin', (data) => superAdminSignup.signUpSuperAdmin(signupDeps(), data))
// Module 10: the super admin creates workspaces and manages their admins (temporary password returned once).
const workspaceApi = () =>
  createWorkspaceApi({
    port: platformPort(),
    now: () => Date.now(),
    rateLimit: (uid, fn) => enforceRateLimit(firestoreRateLimitPort(), uid, fn),
    appBaseUrl: APP_BASE_URL,
    inEmulator: IN_EMULATOR,
    auth: workspaceAuthPort(),
    workspaces: workspacePort(),
    newTenantId,
    newTempPassword: () => generateTempPassword(),
    timezones: supportedTimezones,
  })
export const createWorkspace = operatorCallable('createWorkspace', (a, d) => workspaceApi().createWorkspace(a, d))
export const addTenantAdmin = operatorCallable('addTenantAdmin', (a, d) => workspaceApi().addTenantAdmin(a, d))
export const resetTenantAdminCredential = operatorCallable('resetTenantAdminCredential', (a, d) => workspaceApi().resetTenantAdminCredential(a, d))
export const setTenantAdminStatus = operatorCallable('setTenantAdminStatus', (a, d) => workspaceApi().setTenantAdminStatus(a, d))
export const updateTenantAdmin = operatorCallable('updateTenantAdmin', (a, d) => workspaceApi().updateTenantAdmin(a, d))
export const getWorkspace = operatorCallable('getWorkspace', (a, d) => workspaceApi().getWorkspace(a, d))
export const listTenants = operatorCallable('listTenants', (a, d) => platformApi().listTenants(a, d))

// Browsers report crashes here: signed-in users only, rate limited per user, scrubbed and truncated, logs only.
export const reportClientError = callable('reportClientError', clientErrors.reportClientError, { rateLimit: true })

// Content-Security-Policy-Report-Only violations (hosting rewrites /csp-report here). Logs only: host, path, directive.
export const cspReport = onRequest({ cors: false, maxInstances: 2, memory: '128MiB' }, (req, res) => handleCspReport(req, res))
