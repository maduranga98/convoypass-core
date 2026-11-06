import { Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { RouteErrorPage, VehicleRouteBoundary } from '@/components/RouteErrorBoundary'
import { PageSpinner } from '@/components/ui/Spinner'
import { ForbiddenPage, NotFoundPage } from '@/features/auth/ErrorPages'
import { RequireAuth, RequireOperator, RequireRole, RoleHomeRedirect } from '@/features/auth/guards'
import { rolesFor } from '@/lib/permissions'
import { AuthedShell } from '@/features/auth/AuthedShell'
import {
  AdminLayout,
  ApprovalsPage,
  AuditPage,
  AuthActionPage,
  ChangePasswordPage,
  ContractorDetailPage,
  ContractorsPage,
  DashboardPage,
  DriverHome,
  ForgotPasswordPage,
  DriversPage,
  DriverQualificationsPage,
  GateHome,
  GatePassesPage,
  QualificationPage,
  PinLoginPage,
  StaffLoginPage,
  NotificationsPage,
  OfficerLayout,
  OfficerQueue,
  OperatorInvitesPage,
  OperatorOverviewPage,
  OperatorWorkspaceDetailPage,
  OperatorWorkspacesPage,
  PlatformChangePasswordPage,
  PlatformLayout,
  PlatformLoginPage,
  PlatformSignupPage,
  PassesPage,
  PenaltiesPage,
  PenaltyTypesPage,
  IssuePenaltyPage,
  RecordInspectionPage,
  ReinspectionPage,
  VerificationQueuePage,
  DailySummaryPage,
  UnloadingPage,
  VisitCheckOutPage,
  VisitDetailPage,
  VisitsPage,
  YardLayout,
  PrivacyPage,
  QrLabelsPage,
  QueuePage,
  ReportsPage,
  ReviewPage,
  SafetyLayout,
  SecurityLayout,
  SetupPage,
  SettingsPage,
  UserSettingsPage,
  SupervisorAssignDrivers,
  SupervisorDaily,
  SupervisorHome,
  SupervisorLayout,
  UsersPage,
  VehicleRoute,
  VehiclesPage,
} from './lazyPages'


const lazyEl = (node: ReactNode) => <Suspense fallback={<PageSpinner />}>{node}</Suspense>

export const router = createBrowserRouter([
  // Every route sits under one pathless parent so a crash anywhere shows the app's error page, not the router's.
  {
    errorElement: <RouteErrorPage />,
    children: [
      { path: '/login', element: lazyEl(<PinLoginPage />) },
      { path: '/login/staff', element: lazyEl(<StaffLoginPage />) },
      { path: '/privacy', element: lazyEl(<PrivacyPage />) },
      // Public, outside the auth guard: workspace setup (invite link), staff password reset and Firebase's email action page.
      { path: '/setup', element: lazyEl(<SetupPage />) },
      { path: '/forgot-password', element: lazyEl(<ForgotPasswordPage />) },
      { path: '/auth/action', element: lazyEl(<AuthActionPage />) },
      // `/` sends everyone home (workspace users by role, operators to /platform); it handles auth itself.
      { path: '/', element: <RoleHomeRedirect /> },
      // Module 11: the Super admin sign-in. Public, lazy, noindex; not linked from any workspace screen.
      { path: '/platform/login', element: lazyEl(<PlatformLoginPage />) },
      { path: '/platform/signup', element: lazyEl(<PlatformSignupPage />) },
      {
        // Platform operator console (Module 9): operators only, no tenant, no notifications or workspace navigation.
        element: <RequireOperator />,
        children: [
          { path: '/platform/change-password', element: lazyEl(<PlatformChangePasswordPage />) },
          {
            path: '/platform',
            element: lazyEl(<PlatformLayout />),
            children: [
              { index: true, element: lazyEl(<OperatorOverviewPage />) },
              { path: 'invites', element: lazyEl(<OperatorInvitesPage />) },
              { path: 'workspaces', element: lazyEl(<OperatorWorkspacesPage />) },
              { path: 'workspaces/:tenantId', element: lazyEl(<OperatorWorkspaceDetailPage />) },
              { path: 'tenants', element: <Navigate to="/platform/workspaces" replace /> },
            ],
          },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            // Everything below shares one live notification feed (the bell, /notifications and the tab title).
            element: <AuthedShell />,
            children: [
          { path: '/notifications', element: lazyEl(<NotificationsPage />) },
          { path: '/settings', element: lazyEl(<UserSettingsPage />) },
          { path: '/change-password', element: lazyEl(<ChangePasswordPage />) },
          { path: '/v/:vehicleId', element: <VehicleRouteBoundary>{lazyEl(<VehicleRoute />)}</VehicleRouteBoundary> },
          {
            element: <RequireRole roles={rolesFor('area.admin')} />,
            children: [
              {
                path: '/admin',
                element: lazyEl(<AdminLayout />),
                children: [
                  { index: true, element: <Navigate to="dashboard" replace /> },
                  { path: 'dashboard', element: lazyEl(<DashboardPage scope="admin" />) },
                  { path: 'users', element: lazyEl(<UsersPage />) },
                  { path: 'contractors', element: lazyEl(<ContractorsPage />) },
                  { path: 'contractors/:contractorId', element: lazyEl(<ContractorDetailPage />) },
                  { path: 'vehicles', element: lazyEl(<VehiclesPage scope="admin" />) },
                  { path: 'drivers', element: lazyEl(<DriversPage scope="admin" />) },
                  { path: 'passes', element: lazyEl(<PassesPage />) },
                  { path: 'qualifications', element: lazyEl(<DriverQualificationsPage />) },
                  { path: 'gate-passes', element: lazyEl(<GatePassesPage />) },
                  { path: 'gate-passes/month-end', element: lazyEl(<QualificationPage />) },
                  { path: 'penalties', element: lazyEl(<PenaltiesPage viewer="admin" issuePath="/admin/penalties/new" />) },
                  { path: 'penalties/new', element: lazyEl(<IssuePenaltyPage listPath="/admin/penalties" typesPath="/admin/penalty-types" />) },
                  { path: 'penalty-types', element: lazyEl(<PenaltyTypesPage />) },
                  { path: 'reports', element: lazyEl(<ReportsPage />) },
                  { path: 'visits', element: lazyEl(<VisitsPage scope="admin" />) },
                  { path: 'visits/:visitId', element: lazyEl(<VisitDetailPage scope="admin" />) },
                  { path: 'summary', element: lazyEl(<DailySummaryPage />) },
                  { path: 'audit', element: lazyEl(<AuditPage />) },
                  // Module 5's gate log is now a report.
                  { path: 'gate-log', element: <Navigate to="/admin/reports?type=gate_log" replace /> },
                  { path: 'qr', element: lazyEl(<QrLabelsPage scope="admin" />) },
                  { path: 'settings', element: lazyEl(<SettingsPage />) },
                ],
              },
            ],
          },
          {
            element: <RequireRole roles={rolesFor('area.supervisor')} />,
            children: [
              {
                path: '/supervisor',
                element: lazyEl(<SupervisorLayout />),
                children: [
                  { index: true, element: lazyEl(<SupervisorHome />) },
                  // The list stays beside the open pass on desktop; on a phone the review takes the whole screen.
                  {
                    path: 'approvals',
                    element: lazyEl(<ApprovalsPage />),
                    children: [{ path: ':passId', element: lazyEl(<ReviewPage />) }],
                  },
                  { path: 'daily', element: lazyEl(<SupervisorDaily />) },
                  { path: 'assign-drivers', element: lazyEl(<SupervisorAssignDrivers />) },
                  { path: 'penalties', element: lazyEl(<VerificationQueuePage />) },
                  { path: 'visits', element: lazyEl(<VisitsPage scope="supervisor" />) },
                  { path: 'visits/:visitId', element: lazyEl(<VisitDetailPage scope="supervisor" />) },
                  { path: 'summary', element: lazyEl(<DailySummaryPage />) },
                  { path: 'vehicles', element: lazyEl(<VehiclesPage scope="supervisor" />) },
                  { path: 'drivers', element: lazyEl(<DriversPage scope="supervisor" />) },
                  { path: 'qr', element: lazyEl(<QrLabelsPage scope="supervisor" />) },
                ],
              },
            ],
          },
          {
            element: <RequireRole roles={rolesFor('area.officer')} />,
            children: [
              {
                path: '/officer',
                element: lazyEl(<OfficerLayout />),
                children: [
                  { index: true, element: lazyEl(<OfficerQueue />) },
                  { path: 'qualifications', element: lazyEl(<DriverQualificationsPage />) },
                  { path: 'overview', element: lazyEl(<DashboardPage scope="officer" />) },
                  { path: 'reports', element: lazyEl(<ReportsPage />) },
                  { path: 'summary', element: lazyEl(<DailySummaryPage />) },
                ],
              },
            ],
          },
          {
            element: <RequireRole roles={rolesFor('area.safety')} />,
            children: [
              {
                path: '/safety',
                element: lazyEl(<SafetyLayout />),
                children: [
                  { index: true, element: lazyEl(<PenaltiesPage viewer="safety" issuePath="/safety/penalties/new" />) },
                  { path: 'penalties/new', element: lazyEl(<IssuePenaltyPage listPath="/safety" typesPath={null} />) },
                  { path: 'inspections/new', element: lazyEl(<RecordInspectionPage />) },
                  { path: 'reinspection', element: lazyEl(<ReinspectionPage />) },
                  { path: 'summary', element: lazyEl(<DailySummaryPage />) },
                ],
              },
            ],
          },
          {
            element: <RequireRole roles={rolesFor('area.driver')} />,
            children: [{ path: '/driver', element: lazyEl(<DriverHome />) }],
          },
          {
            element: <RequireRole roles={rolesFor('area.security')} />,
            children: [
              {
                path: '/security',
                element: lazyEl(<SecurityLayout />),
                children: [
                  { index: true, element: lazyEl(<GateHome />) },
                  { path: 'queue', element: lazyEl(<QueuePage />) },
                  { path: 'visit/check-in', element: <Navigate to="/security" replace /> },
                  { path: 'visit/check-out', element: lazyEl(<VisitCheckOutPage />) },
                  { path: 'summary', element: lazyEl(<DailySummaryPage backTo="/security" />) },
                ],
              },
            ],
          },
          {
            element: <RequireRole roles={rolesFor('area.yard')} />,
            children: [
              {
                path: '/yard',
                element: lazyEl(<YardLayout />),
                children: [
                  { index: true, element: lazyEl(<UnloadingPage />) },
                  { path: 'summary', element: lazyEl(<DailySummaryPage backTo="/yard" />) },
                ],
              },
            ],
          },
            ],
          },
        ],
      },
      { path: '/403', element: <ForbiddenPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
