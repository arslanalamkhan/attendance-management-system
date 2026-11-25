import { lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { REPORT_PERMISSIONS, type Permission } from '@nacta/shared';
import { AuthLoadError, AuthLoader } from './components/auth/auth-loader';
import { IdleTimeout } from './components/auth/idle-timeout';
import { RequirePermission } from './components/auth/require-permission';
import { AppShell } from './components/layout/app-shell';
import { Skeleton } from './components/ui/skeleton';
import { Toaster } from './components/ui/toaster';
import { TooltipProvider } from './components/ui/tooltip';
import { AuthProvider, useAuth } from './lib/auth';
import { NAV } from './lib/nav';
import ComingSoonPage from './pages/ComingSoonPage';
import NotFoundPage from './pages/NotFoundPage';
import ForcedPasswordChangePage from './pages/auth/ForcedPasswordChangePage';
import LoginPage, { safeNext } from './pages/auth/LoginPage';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const SimpleDashboard = lazy(() => import('./pages/dashboard/SimpleDashboard'));
const DesignPage = lazy(() => import('./pages/DesignPage'));
const EmployeesPage = lazy(() => import('./pages/employees/EmployeesPage'));
const EmployeeProfilePage = lazy(() => import('./pages/employees/EmployeeProfilePage'));
const WingsPage = lazy(() => import('./pages/wings/WingsPage'));
const EmployeeImportPage = lazy(() => import('./pages/employees/EmployeeImportPage'));
const AttendancePage = lazy(() => import('./pages/attendance/AttendancePage'));
const DailyAttendancePage = lazy(() => import('./pages/attendance/DailyAttendancePage'));
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage'));
const ReportPage = lazy(() => import('./pages/reports/ReportPage'));
const LeavePage = lazy(() => import('./pages/attendance/leave/LeavePage'));
const LeaveTypesPage = lazy(() => import('./pages/settings/LeaveTypesPage'));
const HolidaysPage = lazy(() => import('./pages/settings/HolidaysPage'));
const TimingsPage = lazy(() => import('./pages/settings/timings/TimingsPage'));
const DevicesPage = lazy(() => import('./pages/devices/DevicesPage'));
const DeviceDetailPage = lazy(() => import('./pages/devices/DeviceDetailPage'));
const DeviceLogPage = lazy(() => import('./pages/devices/DeviceLogPage'));
const AccountPage = lazy(() => import('./pages/account/AccountPage'));
const UsersPage = lazy(() => import('./pages/admin/users/UsersPage'));
const RolesPage = lazy(() => import('./pages/admin/roles/RolesPage'));
const AuditPage = lazy(() => import('./pages/admin/audit/AuditPage'));
const RoleEditorPage = lazy(() => import('./pages/admin/roles/RoleEditorPage'));

function PageFallback() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading page">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-36" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

const soonItems = NAV.flatMap((g) => g.items.filter((i) => i.soon));

/** Permission-guarded, lazily loaded page. */
function page(any: Permission[] | null, node: ReactNode) {
  const inner = <Suspense fallback={<PageFallback />}>{node}</Suspense>;
  return any ? <RequirePermission any={any}>{inner}</RequirePermission> : inner;
}

/** "/" shows the full dashboard, or the simple one (today's four numbers) to roles without dashboard.view. */
function HomeRoute() {
  const { can } = useAuth();
  if (can('dashboard.view')) return page(['dashboard.view'], <DashboardPage />);
  return page(null, <SimpleDashboard />);
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomeRoute />} />
        <Route path="design" element={page(null, <DesignPage />)} />
        <Route path="account" element={page(null, <AccountPage />)} />

        <Route path="employees" element={page(['employees.view'], <EmployeesPage />)} />
        <Route path="employees/import" element={page(['employees.import'], <EmployeeImportPage />)} />
        <Route path="employees/:id" element={page(['employees.view'], <EmployeeProfilePage />)} />
        <Route path="wings" element={page(['employees.view'], <WingsPage />)} />
        <Route path="attendance" element={page(['attendance.view'], <AttendancePage />)} />
        <Route path="attendance/daily" element={page(['attendance.view'], <DailyAttendancePage />)} />
        <Route path="attendance/leave" element={page(['leave.manage', 'attendance.view'], <LeavePage />)} />

        <Route path="reports" element={page(REPORT_PERMISSIONS, <ReportsPage />)} />
        <Route path="reports/:type" element={page(REPORT_PERMISSIONS, <ReportPage />)} />

        <Route path="settings/leave-types" element={page(['leave.configure'], <LeaveTypesPage />)} />
        <Route path="settings/holidays" element={page(['holidays.manage', 'attendance.view'], <HolidaysPage />)} />
        <Route path="settings/timings" element={page(['timings.manage'], <TimingsPage />)} />

        <Route path="devices" element={page(['devices.view'], <DevicesPage />)} />
        <Route path="devices/:id" element={page(['devices.view'], <DeviceDetailPage />)} />
        <Route path="diagnostics" element={page(['diagnostics.view'], <DeviceLogPage />)} />

        <Route path="admin/users" element={page(['users.manage'], <UsersPage />)} />
        <Route path="admin/roles" element={page(['roles.manage'], <RolesPage />)} />
        <Route path="admin/roles/new" element={page(['roles.manage'], <RoleEditorPage />)} />
        <Route path="admin/roles/:id" element={page(['roles.manage'], <RoleEditorPage />)} />
        <Route path="admin/audit" element={page(['audit.view'], <AuditPage />)} />
        <Route path="audit" element={<Navigate to="/admin/audit" replace />} />
        <Route path="users" element={<Navigate to="/admin/users" replace />} />

        {soonItems.map((i) => (
          <Route key={i.to} path={i.to.slice(1)} element={page(i.perm ?? null, <ComingSoonPage title={i.label} phase={i.phase} />)} />
        ))}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

/** Decides what the whole window shows: loader, login, forced password change or the app. */
function Gatekeeper() {
  const { status, user, notice, error, retry } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();

  if (status === 'loading') return <AuthLoader />;
  if (status === 'error') return <AuthLoadError error={error} onRetry={retry} />;

  if (status === 'anonymous') {
    if (location.pathname === '/login') return <LoginPage />;
    const here = `${location.pathname}${location.search}`;
    // A deliberate sign-out should land on a clean login page; an expired session remembers where you were.
    const to = notice === 'signed-out' ? '/login' : `/login?next=${encodeURIComponent(here)}`;
    return <Navigate to={to} replace />;
  }

  if (user?.mustChangePassword) return <ForcedPasswordChangePage />;
  if (location.pathname === '/login') return <Navigate to={safeNext(params.get('next'))} replace />;
  return (
    <>
      <IdleTimeout />
      <AppRoutes />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <TooltipProvider>
        <Gatekeeper />
        <Toaster />
      </TooltipProvider>
    </AuthProvider>
  );
}
