import { lazy } from 'react'
import { loadStorage } from '@/lib/storage'

// Module 12: `/login` is the PIN screen (drivers and security); office staff sign in on `/login/staff`.
export const PinLoginPage = lazy(() => import('@/features/auth/PinLoginPage'))
export const StaffLoginPage = lazy(() => import('@/features/auth/StaffLoginPage'))
export const ForgotPasswordPage = lazy(() => import('@/features/auth/ForgotPasswordPage'))
export const AuthActionPage = lazy(() => import('@/features/auth/AuthActionPage'))
export const SetupPage = lazy(() => import('@/features/setup/SetupPage'))
export const PrivacyPage = lazy(() => import('@/features/auth/PrivacyPage'))
export const ChangePasswordPage = lazy(() => import('@/features/auth/ChangePasswordPage'))
export const DriverHome = lazy(() => import('@/features/passes/DriverHome'))
export const NotificationsPage = lazy(() => import('@/features/notifications/NotificationsPage'))
export const UserSettingsPage = lazy(() => import('@/features/notifications/UserSettingsPage'))
export const SettingsPage = lazy(() => import('@/features/admin/SettingsPage'))
export const AdminLayout = lazy(() => import('@/features/admin/AdminLayout'))
export const UsersPage = lazy(() => import('@/features/admin/UsersPage'))
export const ContractorsPage = lazy(() => import('@/features/admin/ContractorsPage'))
export const ContractorDetailPage = lazy(() => import('@/features/admin/ContractorDetailPage'))
export const VehiclesPage = lazy(() => import('@/features/vehicles/VehiclesPage'))
export const DriversPage = lazy(() => import('@/features/drivers/DriversPage'))
export const AuditPage = lazy(() => import('@/features/admin/audit/AuditPage'))
export const QrLabelsPage = lazy(() => import('@/features/qr/QrLabelsPage'))
export const SupervisorLayout = lazy(() => import('@/features/supervisor/SupervisorLayout'))
export const SupervisorDaily = lazy(() => import('@/features/supervisor/DailyPage'))
export const SupervisorAssignDrivers = lazy(() => import('@/features/supervisor/AssignDriversPage'))
export const SupervisorHome = lazy(() => import('@/features/supervisor/SupervisorHome'))
export const ApprovalsPage = lazy(() => import('@/features/supervisor/ApprovalsPage'))
export const ReviewPage = lazy(() => import('@/features/supervisor/ReviewPage'))
export const SafetyLayout = lazy(() => import('@/features/safety/SafetyLayout'))
export const PenaltiesPage = lazy(() => import('@/features/penalties/PenaltiesPage'))
export const IssuePenaltyPage = lazy(() => import('@/features/penalties/IssuePenaltyPage'))
export const RecordInspectionPage = lazy(() => import('@/features/inspections/RecordInspectionPage'))
export const DriverQualificationsPage = lazy(() => import('@/features/qualifications/QualificationsPage'))
export const GatePassesPage = lazy(() => import('@/features/gatePasses/GatePassesPage'))
export const QualificationPage = lazy(() => import('@/features/gatePasses/QualificationPage'))
export const ReinspectionPage = lazy(() => import('@/features/inspections/ReinspectionPage'))
export const PenaltyTypesPage = lazy(() => import('@/features/penalties/PenaltyTypesPage'))
export const VerificationQueuePage = lazy(() => import('@/features/penalties/VerificationQueuePage'))
export const OfficerLayout = lazy(() => import('@/features/officer/OfficerLayout'))
export const OfficerQueue = lazy(() => import('@/features/officer/OfficerQueue'))
export const PassesPage = lazy(() => import('@/features/admin/PassesPage'))
// The gate must keep working when the connection drops mid-shift, so once any gate screen loads, the others are
// fetched too: the guard can then open a vehicle (or the queue) offline.
const gateChunks = {
  layout: () => import('@/features/gate/SecurityLayout'),
  home: () => import('@/features/gate/GateHome'),
  queue: () => import('@/features/gate/QueuePage'),
  vehicle: () => import('@/features/passes/VehicleRoute'),
}
const withGate = <T,>(load: () => Promise<T>) => () => {
  for (const chunk of Object.values(gateChunks)) void chunk().catch(() => undefined)
  // Driver photos come from Storage: load its SDK now too, so the gate still shows photos after the connection drops.
  void loadStorage().catch(() => undefined)
  return load()
}
export const SecurityLayout = lazy(withGate(gateChunks.layout))
export const GateHome = lazy(withGate(gateChunks.home))
export const QueuePage = lazy(withGate(gateChunks.queue))
export const VehicleRoute = lazy(withGate(gateChunks.vehicle))
export const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'))
export const ReportsPage = lazy(() => import('@/features/reports/ReportsPage'))
// Module 9: the operator console. Separate chunks, loaded only on /platform (never reachable by workspace roles).
export const PlatformLoginPage = lazy(() => import('@/features/platform/PlatformLoginPage'))
export const PlatformSignupPage = lazy(() => import('@/features/platform/PlatformSignupPage'))
export const PlatformChangePasswordPage = lazy(() => import('@/features/platform/PlatformChangePasswordPage'))
export const PlatformLayout = lazy(() => import('@/features/platform/PlatformLayout'))
export const OperatorOverviewPage = lazy(() => import('@/features/platform/OverviewPage'))
export const OperatorInvitesPage = lazy(() => import('@/features/platform/InvitesPage'))
export const OperatorWorkspacesPage = lazy(() => import('@/features/platform/WorkspacesPage'))
export const OperatorWorkspaceDetailPage = lazy(() => import('@/features/platform/WorkspaceDetailPage'))
// Visit lifecycle: gate (check-in, check-out), yard (unloading check), the shared daily summary and the admin/supervisor views.
export const VisitCheckOutPage = lazy(() => import('@/features/visits/CheckOutPage'))
export const YardLayout = lazy(() => import('@/features/visits/YardLayout'))
export const UnloadingPage = lazy(() => import('@/features/visits/UnloadingPage'))
export const DailySummaryPage = lazy(() => import('@/features/visits/DailySummaryPage'))
export const VisitsPage = lazy(() => import('@/features/visits/VisitsPage'))
export const VisitDetailPage = lazy(() => import('@/features/visits/VisitDetailPage'))
