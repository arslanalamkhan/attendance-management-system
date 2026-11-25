import * as React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Ban, Cpu, Fingerprint, LogOut, Pencil, Play, Send, Trash2, UserX } from 'lucide-react';
import type { ColumnDef, SortingState, Updater } from '@tanstack/react-table';
import type { AttendanceRecord, EmployeeDetail } from '@nacta/shared';
import { EMPLOYMENT_TYPE_LABEL, GENDER_LABEL, Privilege } from '@nacta/shared';
import { isApiError } from '../../lib/api';
import { endOfMonthYmd, formatDate, startOfMonthYmd, todayYmd, formatMonth } from '../../lib/dates';
import { listAttendance } from '../../lib/endpoints/attendance';
import { listEmployeeDays } from '../../lib/endpoints/rules';
import { getEmployee } from '../../lib/endpoints/employees';
import { qk } from '../../lib/query-keys';
import { usePageMeta } from '../../hooks/use-page-meta';
import { ActivityFeed } from '../../components/audit/activity-feed';
import { useAuth } from '../../lib/auth';
import { Gate } from '../../components/auth/gate';
import { absoluteTime, relativeTime } from '../../lib/time';
import { ORG_UNIT } from '../../lib/terms';
import { DataTable } from '../../components/data-table/data-table';
import type { DataTablePagingState } from '../../components/data-table/use-data-table-state';
import { Badge, StatusPill } from '../../components/ui/badge';
import { Breadcrumbs } from '../../components/ui/breadcrumbs';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { Skeleton } from '../../components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { MethodCell, PunchTime, PunchTypeBadge } from '../attendance/punch-cells';
import { DeleteEmployeeDialog } from './DeleteEmployeeDialog';
import { EmployeeFormSheet } from './EmployeeFormSheet';
import { EmployeeAvatar } from '../../components/ui/employee-avatar';
import { BiometricsTab } from './biometrics/BiometricsTab';
import { BpsBadge, DeviceSyncIndicator, EmployeeStatusPill, PrivilegeBadge } from './employee-bits';
import { ExportMenu } from '../../components/reports/export-buttons';
import { PunchCalendar } from './PunchCalendar';
import { AttendanceCalendar } from './AttendanceCalendar';
import { DayPanel } from './DayPanel';
import { CorrectionDialog, type CorrectionTarget } from '../attendance/CorrectionDialog';
import { MarkLeaveSheet, type MarkLeaveInitial } from '../attendance/leave/MarkLeaveSheet';
import { PushDialog, type PushTarget } from './PushDialog';
import { StatusChangeDialog, type StatusChangeTarget } from './StatusChangeDialog';

const dash = <span className="text-muted-foreground">-</span>;

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function Detail({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={mono ? 'truncate font-mono text-[13px] tabular-nums' : 'truncate text-sm'}>{children}</dd>
    </div>
  );
}

function DetailCard({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5">{children}</dl>
      </CardContent>
    </Card>
  );
}

function OverviewTab({ e }: { e: EmployeeDetail }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <DetailCard title="Identity">
        <Detail label="Full name">{e.name}</Detail>
        <Detail label="Father's name">{e.fatherName ?? dash}</Detail>
        <Detail label="CNIC" mono>
          {e.cnic ?? dash}
        </Detail>
        <Detail label="Gender">{e.gender ? GENDER_LABEL[e.gender] : dash}</Detail>
      </DetailCard>
      <DetailCard title="Organisation">
        <Detail label={ORG_UNIT.singular}>{e.wingName ?? dash}</Detail>
        <Detail label="Section">{e.sectionName ?? dash}</Detail>
        <Detail label="Designation">{e.designation ?? dash}</Detail>
        <Detail label="BPS grade">{e.bps !== null ? `BPS ${e.bps}` : dash}</Detail>
        <Detail label="Employment type">{e.employmentType ? EMPLOYMENT_TYPE_LABEL[e.employmentType] : dash}</Detail>
        <Detail label="Join date">{e.joinDate ? formatDate(e.joinDate) : dash}</Detail>
        {e.status === 'left' && <Detail label="Left on">{e.leftDate ? formatDate(e.leftDate) : dash}</Detail>}
      </DetailCard>
      <DetailCard title="Status" description="Disabled and left employees are removed from the devices.">
        <Detail label="Status">
          <EmployeeStatusPill status={e.status} />
        </Detail>
        <Detail label="Since">{e.statusChangedAt ? absoluteTime(e.statusChangedAt) : dash}</Detail>
        <div className="col-span-2 min-w-0 space-y-1">
          <dt className="text-xs font-medium text-muted-foreground">Reason</dt>
          <dd className="text-sm">{e.statusReason ?? dash}</dd>
        </div>
      </DetailCard>
      <DetailCard title="Device access" description="How this person identifies at the terminals.">
        <Detail label="Employee code (PIN)" mono>
          {e.empCode}
        </Detail>
        <Detail label="Card number" mono>
          {e.cardNo ?? dash}
        </Detail>
        <Detail label="Device role">{e.privilege === Privilege.ADMIN ? <PrivilegeBadge privilege={e.privilege} /> : 'User'}</Detail>
        <Detail label="Device password">{e.devicePassword ? 'Set' : 'Not set'}</Detail>
      </DetailCard>
      <DetailCard title="Contact">
        <Detail label="Phone">{e.phone ?? dash}</Detail>
        <Detail label="Email">{e.email ? <a className="text-primary-text underline-offset-4 hover:underline" href={`mailto:${e.email}`}>{e.email}</a> : dash}</Detail>
        <Detail label="Emergency contact">{e.emergencyContactName ?? dash}</Detail>
        <Detail label="Emergency phone">{e.emergencyContactPhone ?? dash}</Detail>
        <div className="col-span-2 min-w-0 space-y-1">
          <dt className="text-xs font-medium text-muted-foreground">Address</dt>
          <dd className="whitespace-pre-wrap text-sm">{e.address ?? dash}</dd>
        </div>
      </DetailCard>
      <DetailCard title="Record">
        <Detail label="Created">{absoluteTime(e.createdAt)}</Detail>
        <Detail label="Last updated">{absoluteTime(e.updatedAt)}</Detail>
      </DetailCard>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          {e.notes ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{e.notes}</p> : <p className="text-sm text-muted-foreground">No notes.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

const punchColumns: ColumnDef<AttendanceRecord>[] = [
  { id: 'punchTime', accessorKey: 'punchTime', header: 'Time', meta: { label: 'Time' }, cell: ({ row }) => <PunchTime punchTime={row.original.punchTime} /> },
  { id: 'status', header: 'Type', meta: { label: 'Type' }, cell: ({ row }) => <PunchTypeBadge status={row.original.status} /> },
  { id: 'verifyType', header: 'Method', meta: { label: 'Method' }, cell: ({ row }) => <MethodCell verifyType={row.original.verifyType} /> },
  { id: 'deviceName', header: 'Device', meta: { label: 'Device' }, cell: ({ row }) => <span className="text-[13px]">{row.original.deviceName}</span> },
];

function AttendanceTab({ employee }: { employee: EmployeeDetail }) {
  const [month, setMonth] = React.useState(() => startOfMonthYmd(todayYmd()));
  const [day, setDay] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);
  const [desc, setDesc] = React.useState(true);

  const monthRange = { from: startOfMonthYmd(month), to: endOfMonthYmd(month) };

  // Computed status per day (colour per status, leave by type colour).
  const days = useQuery({
    queryKey: qk.daily.days(employee.id, monthRange.from, monthRange.to),
    queryFn: ({ signal }) => listEmployeeDays({ employeeId: employee.id, ...monthRange }, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const dayMap = React.useMemo(() => new Map((days.data ?? []).map((d) => [d.date, d])), [days.data]);
  const [panelDay, setPanelDay] = React.useState<string | null>(null);
  const [leaveFor, setLeaveFor] = React.useState<MarkLeaveInitial | null>(null);
  const lastLeave = React.useRef<MarkLeaveInitial | undefined>(undefined);
  if (leaveFor) lastLeave.current = leaveFor;
  const [correctFor, setCorrectFor] = React.useState<CorrectionTarget | null>(null);

  // Fallback while the server has no /attendance/days yet: the raw punch-count heat-map.
  const heat = useQuery({
    queryKey: qk.attendance.list({ employeeId: employee.id, ...monthRange, page: 1, pageSize: 500 }),
    queryFn: ({ signal }) => listAttendance({ employeeId: employee.id, ...monthRange, page: 1, pageSize: 500 }, signal),
    placeholderData: keepPreviousData,
    enabled: days.isError,
  });
  const counts = React.useMemo(() => {
    if (!heat.data) return undefined;
    const out: Record<string, number> = {};
    for (const r of heat.data.items) {
      const d = r.punchTime.slice(0, 10);
      out[d] = (out[d] ?? 0) + 1;
    }
    return out;
  }, [heat.data]);

  const listRange = day ? { from: day, to: day } : monthRange;
  const listQuery = { employeeId: employee.id, ...listRange, page, pageSize, sort: 'punchTime', order: desc ? ('desc' as const) : ('asc' as const) };
  const list = useQuery({
    queryKey: qk.attendance.list(listQuery),
    queryFn: ({ signal }) => listAttendance(listQuery, signal),
    placeholderData: keepPreviousData,
  });

  const state: DataTablePagingState = {
    page,
    pageSize,
    sorting: [{ id: 'punchTime', desc }] satisfies SortingState,
    setPage,
    setPageSize: (n) => {
      setPageSize(n);
      setPage(1);
    },
    setSorting: (u: Updater<SortingState>) => {
      const next = typeof u === 'function' ? u([{ id: 'punchTime', desc }]) : u;
      setDesc(next[0]?.desc ?? true);
      setPage(1);
    },
    hasFilters: day !== null,
    resetFilters: () => setDay(null),
  };

  const changeMonth = (m: string) => {
    setMonth(m);
    setDay(null);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">Day by day for {formatMonth(month)}: status, in/out and worked hours.</p>
        <ExportMenu type="time_card" label="Export time card" size="sm" params={{ employeeId: employee.id, from: monthRange.from, to: monthRange.to }} />
      </div>
      <Card>
        <CardContent className="p-5">
          {days.isError ? (
            <>
              <ErrorState error={days.error} title="Computed statuses unavailable" onRetry={() => void days.refetch()} retrying={days.isFetching} bare className="py-6" />
              <PunchCalendar
                month={month}
                onMonthChange={changeMonth}
                counts={counts}
                loading={heat.isPending}
                selected={day}
                onSelect={(d) => {
                  setDay(d);
                  setPage(1);
                }}
              />
            </>
          ) : (
            <AttendanceCalendar
              month={month}
              onMonthChange={changeMonth}
              days={days.data}
              loading={days.isPending}
              selected={day}
              onSelect={(d) => {
                setDay(d);
                setPanelDay(d);
                setPage(1);
              }}
            />
          )}
        </CardContent>
      </Card>

      <DayPanel
        employee={{ id: employee.id, name: employee.name }}
        date={panelDay}
        day={panelDay ? dayMap.get(panelDay) : undefined}
        onClose={() => setPanelDay(null)}
        onMarkLeave={(d) => {
          setPanelDay(null);
          setLeaveFor({ employees: [{ id: employee.id, name: employee.name, empCode: employee.empCode, hasPhoto: employee.hasPhoto, wingName: employee.wingName }], date: d });
        }}
        onCorrect={(d) => {
          setPanelDay(null);
          setCorrectFor({ employeeId: employee.id, name: employee.name, date: d, timing: dayMap.get(d)?.timing ?? null });
        }}
      />
      <MarkLeaveSheet open={leaveFor !== null} onOpenChange={(o) => !o && setLeaveFor(null)} initial={lastLeave.current} />
      <CorrectionDialog target={correctFor} onOpenChange={(o) => !o && setCorrectFor(null)} />

      <section aria-label="Punch list" className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight">{day ? `Punches on ${formatDate(day)}` : `Punches in ${formatMonth(month)}`}</h3>
        <DataTable<AttendanceRecord>
          id="employee-punches"
          caption={`Punches for ${employee.name}`}
          columns={punchColumns}
          data={list.data?.items ?? []}
          total={list.data?.total ?? 0}
          state={state}
          getRowId={(r) => String(r.id)}
          loading={list.isPending}
          fetching={list.isFetching}
          error={list.error}
          onRetry={() => void list.refetch()}
          noun={{ singular: 'punch', plural: 'punches' }}
          pageSizeOptions={[10, 25, 50]}
          maxHeight="none"
          emptyState={
            <EmptyState
              bare
              icon={<Fingerprint />}
              title={day ? 'No punches on this day' : 'No punches this month'}
              description="Punches appear here as soon as a terminal reports them."
            />
          }
        />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Devices & biometrics
// ---------------------------------------------------------------------------

function DevicesTab({ e, onPush }: { e: EmployeeDetail; onPush: () => void }) {
  if (e.devices.length === 0) {
    return (
      <EmptyState
        icon={<Cpu />}
        title="No devices registered yet"
        description="Register a terminal on the Devices page, then push this employee to it."
        action={
          <Gate perm="employees.push" action="send employees to devices">
            <Button size="sm" onClick={onPush}>
              <Send aria-hidden="true" />
              Push to devices
            </Button>
          </Gate>
        }
      />
    );
  }
  return (
    <Card>
      <CardHeader className="pb-3">
        <div>
          <CardTitle>Devices</CardTitle>
          <CardDescription>
            {e.status === 'active' ? 'Where this person is registered, and the latest command sent to each device.' : 'This person is not meant to be on any device while they are ' + (e.status === 'disabled' ? 'disabled.' : 'marked as left.')}
          </CardDescription>
        </div>
        <Gate perm="employees.push" action="send employees to devices" hide>
          {e.status === 'active' ? (
            <Button size="sm" variant="secondary" onClick={onPush}>
              <Send aria-hidden="true" />
              Push to devices
            </Button>
          ) : (
            <span />
          )}
        </Gate>
      </CardHeader>
      <ul className="mt-3 divide-y border-t">
        {e.devices.map((d) => {
          const cmd = d.lastCommand;
          return (
            <li key={d.deviceId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
              <span className="grid size-9 shrink-0 place-content-center rounded-md bg-muted text-muted-foreground" aria-hidden="true">
                <Cpu className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{d.deviceName}</p>
                <p className="text-xs text-muted-foreground" title={absoluteTime(d.lastSeenAt)}>
                  Device last seen {relativeTime(d.lastSeenAt)}
                </p>
              </div>
              {cmd ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground" title={absoluteTime(cmd.at)}>
                  <span className="font-mono">{cmd.command}</span>
                  <StatusPill tone={cmd.status === 'success' ? 'success' : cmd.status === 'failed' ? 'danger' : 'info'} live={cmd.status === 'pending' || cmd.status === 'sent'}>
                    {cmd.status === 'success' ? 'Confirmed' : cmd.status === 'failed' ? 'Failed' : cmd.status === 'sent' ? 'Sent' : 'Queued'}
                  </StatusPill>
                  <span>{relativeTime(cmd.at)}</span>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">No commands yet</span>
              )}
              {d.onDevice ? <StatusPill tone="success">On device</StatusPill> : <StatusPill tone="neutral">Not on device</StatusPill>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function ProfileSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading employee" className="space-y-6">
      <Skeleton className="h-4 w-48" />
      <div className="flex items-center gap-5">
        <Skeleton className="size-20 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <Skeleton className="h-10 w-96" />
      <Skeleton className="h-64" />
    </div>
  );
}

const TABS = ['overview', 'attendance', 'devices', 'biometrics', 'activity'] as const;
type TabKey = (typeof TABS)[number];

export default function EmployeeProfilePage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const { can, user } = useAuth();
  const canAudit = can('audit.view');
  // Deleting an employee erases their leave, corrections and calculated attendance: Super Admin only.
  const canDelete = user?.isSuperAdmin === true;
  const tab: TabKey = (TABS as readonly string[]).includes(tabParam ?? '') && (tabParam !== 'activity' || canAudit) ? (tabParam as TabKey) : 'overview';

  const query = useQuery({
    queryKey: qk.employees.detail(id),
    queryFn: ({ signal }) => getEmployee(id, signal),
    enabled: Number.isInteger(id) && id > 0,
    // While a device command is still in flight, keep the profile fresh.
    refetchInterval: (q) => (q.state.data?.devices.some((d) => d.lastCommand && (d.lastCommand.status === 'pending' || d.lastCommand.status === 'sent')) ? 3000 : false),
    retry: (count, err) => !(isApiError(err) && err.status === 404) && count < 2,
  });

  const [editing, setEditing] = React.useState(false);
  const [pushTarget, setPushTarget] = React.useState<PushTarget | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [statusTarget, setStatusTarget] = React.useState<StatusChangeTarget | null>(null);

  const e = query.data;
  usePageMeta({ title: 'Employee profile', entityType: 'employee', entityId: Number.isInteger(id) && id > 0 ? id : undefined, entityLabel: e ? `${e.empCode} · ${e.name}` : undefined });
  const crumbs = [{ label: 'Employees', to: '/employees' }, { label: e?.name ?? 'Employee' }];

  if (!Number.isInteger(id) || id <= 0 || (query.isError && !e && isApiError(query.error) && query.error.status === 404)) {
    return (
      <>
        <Breadcrumbs items={crumbs} className="mb-4" />
        <EmptyState
          icon={<UserX />}
          title="Employee not found"
          description="This employee may have been deleted, or the link is wrong."
          action={
            <Button asChild size="sm" variant="secondary">
              <Link to="/employees">Back to employees</Link>
            </Button>
          }
        />
      </>
    );
  }
  if (query.isPending) return <ProfileSkeleton />;
  if (query.isError && !e) {
    return (
      <>
        <Breadcrumbs items={crumbs} className="mb-4" />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      </>
    );
  }
  if (!e) return null;

  return (
    <>
      <Breadcrumbs items={crumbs} className="mb-5" />
      <header className="mb-6 flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center gap-5">
          <EmployeeAvatar employee={e} size="2xl" ring />
          <div className="min-w-0 space-y-2">
            <div>
              <h1 className="text-balance text-xl font-semibold tracking-tight sm:text-2xl">{e.name}</h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span className="font-mono tabular-nums">{e.empCode}</span>
                <span aria-hidden="true">·</span>
                <span>{e.wingName ? (e.sectionName ? `${e.wingName} / ${e.sectionName}` : e.wingName) : `No ${ORG_UNIT.lower}`}</span>
                {(e.designation || e.bps !== null) && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1.5">
                      {e.designation}
                      <BpsBadge bps={e.bps} />
                    </span>
                  </>
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <EmployeeStatusPill status={e.status} />
              {e.status !== 'active' && (e.statusReason || e.statusChangedAt) && (
                <span className="text-xs text-muted-foreground">
                  {e.statusReason ? `${e.statusReason} · ` : ''}
                  {e.status === 'left' && e.leftDate ? `left ${formatDate(e.leftDate)}` : e.statusChangedAt ? relativeTime(e.statusChangedAt) : ''}
                </span>
              )}
              <DeviceSyncIndicator state={e.deviceSync} withLabel />
              {e.privilege === Privilege.ADMIN && <PrivilegeBadge privilege={e.privilege} />}
              <Badge tone="outline">
                <Cpu aria-hidden="true" />
                {e.deviceCount} {e.deviceCount === 1 ? 'device' : 'devices'}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Gate perm="employees.manage" action="edit employees">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" />
              Edit
            </Button>
          </Gate>
          {e.status === 'active' && (
            <Gate perm="employees.push" action="send employees to devices">
              <Button variant="secondary" onClick={() => setPushTarget({ employeeIds: [e.id], count: 1, name: e.name })}>
                <Send aria-hidden="true" />
                Push to devices
              </Button>
            </Gate>
          )}
          {e.status === 'active' ? (
            <>
              <Gate perm={['employees.manage', 'employees.push']} action="disable employees">
                <Button variant="secondary" onClick={() => setStatusTarget({ id: e.id, name: e.name, status: e.status, to: 'disabled' })}>
                  <Ban aria-hidden="true" />
                  Disable
                </Button>
              </Gate>
              <Gate perm={['employees.manage', 'employees.push']} action="mark employees as left">
                <Button variant="secondary" onClick={() => setStatusTarget({ id: e.id, name: e.name, status: e.status, to: 'left' })}>
                  <LogOut aria-hidden="true" />
                  Mark as left
                </Button>
              </Gate>
            </>
          ) : (
            <Gate perm={['employees.manage', 'employees.push']} action="enable employees">
              <Button onClick={() => setStatusTarget({ id: e.id, name: e.name, status: e.status, to: 'active' })}>
                <Play aria-hidden="true" />
                Enable
              </Button>
            </Gate>
          )}
          {canDelete && (
            <Button variant="destructive-ghost" onClick={() => setDeleting(true)}>
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
          )}
        </div>
      </header>

      <Tabs
        value={tab}
        onValueChange={(v) =>
          setParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              if (v === 'overview') next.delete('tab');
              else next.set('tab', v);
              return next;
            },
            { replace: true },
          )
        }
      >
        <TabsList className="w-full">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="devices">Devices</TabsTrigger>
          <TabsTrigger value="biometrics">Biometrics</TabsTrigger>
          {canAudit && <TabsTrigger value="activity">Activity</TabsTrigger>}
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab e={e} />
        </TabsContent>
        <TabsContent value="attendance">
          <AttendanceTab employee={e} />
        </TabsContent>
        <TabsContent value="devices">
          <DevicesTab e={e} onPush={() => setPushTarget({ employeeIds: [e.id], count: 1, name: e.name })} />
        </TabsContent>
        <TabsContent value="biometrics">
          <BiometricsTab employee={e} onPush={() => setPushTarget({ employeeIds: [e.id], count: 1, name: e.name })} />
        </TabsContent>
        {canAudit && (
          <TabsContent value="activity">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Activity</CardTitle>
                  <CardDescription>{`Everything recorded about ${e.name}: edits, pushes to devices, exports and views.`}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <ActivityFeed filter={{ entityType: 'employee', entityId: String(e.id) }} hide="subject" emptyDescription="Changes to this employee and pushes to devices will appear here." />
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <EmployeeFormSheet open={editing} onOpenChange={setEditing} employee={e} />
      <PushDialog target={pushTarget} onOpenChange={(o) => !o && setPushTarget(null)} />
      <StatusChangeDialog target={statusTarget} onOpenChange={(o) => !o && setStatusTarget(null)} />
      <DeleteEmployeeDialog
        employee={deleting ? { id: e.id, name: e.name, empCode: e.empCode, deviceCount: e.deviceCount, status: e.status } : null}
        onOpenChange={(o) => !o && setDeleting(false)}
        onDeleted={() => navigate('/employees', { replace: true })}
        onMarkLeft={() => setStatusTarget({ id: e.id, name: e.name, status: e.status, to: 'left' })}
      />
    </>
  );
}

