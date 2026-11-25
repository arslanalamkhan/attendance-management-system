import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Ban, Building2, Download, Eye, FileUp, LogOut, MoreHorizontal, Pencil, Play, Plus, Send, Trash2, UserPlus } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { EMPLOYEE_STATUSES, EMPLOYEE_STATUS_LABEL, EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABEL, DEVICE_SYNC_STATES } from '@nacta/shared';
import type { Employee, EmployeeListQuery } from '@nacta/shared';
import { useApiMutation } from '../../lib/api';
import { exportEmployees, listEmployees } from '../../lib/endpoints/employees';
import { qk } from '../../lib/query-keys';
import { useAuth } from '../../lib/auth';
import { Gate } from '../../components/auth/gate';
import { ORG_UNIT } from '../../lib/terms';
import { useSectionsOf, useWings } from '../../hooks/use-lookups';
import { usePageMeta } from '../../hooks/use-page-meta';
import { DataTable } from '../../components/data-table/data-table';
import { DataTableFilterSelect, DataTableSearch } from '../../components/data-table/toolbar';
import { useDataTableQuery, useDataTableState } from '../../components/data-table/use-data-table-state';
import { Button } from '../../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { EmptyState } from '../../components/ui/empty-state';
import { IconButton } from '../../components/ui/icon-button';
import { PageHeader } from '../../components/ui/page-header';
import { Badge } from '../../components/ui/badge';
import { BulkStatusDialog, MoveDialog, type BulkStatusTarget, type BulkTarget } from './BulkDialogs';
import { DeleteEmployeeDialog, type DeleteTarget } from './DeleteEmployeeDialog';
import { EmployeeFormSheet } from './EmployeeFormSheet';
import { EmployeeAvatar } from '../../components/ui/employee-avatar';
import { BiometricCounts, BpsBadge, CardCell, DeviceSyncIndicator, EmployeeStatusPill, dash } from './employee-bits';
import { PushDialog, type PushTarget } from './PushDialog';
import { StatusChangeDialog, type StatusChangeTarget } from './StatusChangeDialog';

type FilterKey = 'q' | 'wingId' | 'sectionId' | 'status' | 'employmentType' | 'biometrics' | 'deviceSync';
const FILTER_KEYS = ['q', 'wingId', 'sectionId', 'status', 'employmentType', 'biometrics', 'deviceSync'] as const;

const BIOMETRIC_OPTIONS = [
  { value: 'has_fingerprint', label: 'Has fingerprint' },
  { value: 'has_face', label: 'Has face' },
  { value: 'has_photo', label: 'Has photo' },
  { value: 'none', label: 'No biometrics' },
];
const SYNC_LABEL: Record<(typeof DEVICE_SYNC_STATES)[number], string> = { synced: 'Synced', pending: 'Pending', failed: 'Failed', not_on_device: 'Not on device' };

interface RowActions {
  open: (e: Employee) => void;
  edit: (e: Employee) => void;
  push: (e: Employee) => void;
  status: (e: Employee, to: Employee['status']) => void;
  remove: (e: Employee) => void;
}

function RowMenu({ employee, actions }: { employee: Employee; actions: RowActions }) {
  const { can, user } = useAuth();
  const canManage = can('employees.manage');
  const canStatus = canManage && can('employees.push');
  // Deleting erases the employee's leave, corrections and calculated attendance: Super Admin only.
  const canDelete = user?.isSuperAdmin === true;
  return (
    // The menu is portaled, but React events still bubble to the row: stop them here.
    <div className="flex justify-end" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={`Actions for ${employee.name}`} icon={<MoreHorizontal />} size="icon-sm" tooltip={false} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => actions.open(employee)}>
            <Eye /> View profile
          </DropdownMenuItem>
          {canManage && (
            <DropdownMenuItem onSelect={() => actions.edit(employee)}>
              <Pencil /> Edit
            </DropdownMenuItem>
          )}
          {can('employees.push') && employee.status === 'active' && (
            <DropdownMenuItem onSelect={() => actions.push(employee)}>
              <Send /> Push to devices
            </DropdownMenuItem>
          )}
          {canStatus && (
            <>
              <DropdownMenuSeparator />
              {employee.status === 'active' ? (
                <>
                  <DropdownMenuItem onSelect={() => actions.status(employee, 'disabled')}>
                    <Ban /> Disable
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => actions.status(employee, 'left')}>
                    <LogOut /> Mark as left
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem onSelect={() => actions.status(employee, 'active')}>
                  <Play /> Enable
                </DropdownMenuItem>
              )}
            </>
          )}
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => actions.remove(employee)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function buildColumns(actions: RowActions): ColumnDef<Employee>[] {
  return [
    {
      id: 'name',
      accessorKey: 'name',
      header: 'Employee',
      meta: { label: 'Employee', className: 'min-w-[17rem]' },
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-3">
          <EmployeeAvatar employee={row.original} size="md" />
          <div className="min-w-0">
            <Link
              to={`/employees/${row.original.id}`}
              onClick={(e) => e.stopPropagation()}
              className="block truncate rounded-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {row.original.name}
            </Link>
            <p className="font-mono text-xs tabular-nums text-muted-foreground">{row.original.empCode}</p>
          </div>
        </div>
      ),
    },
    {
      id: 'wing',
      accessorKey: 'wingName',
      header: `${ORG_UNIT.singular} / section`,
      meta: { label: ORG_UNIT.singular, cellTitle: (r) => [r.wingName, r.sectionName].filter(Boolean).join(' / ') || undefined, className: 'max-w-[15rem]' },
      cell: ({ row }) =>
        row.original.wingName ? (
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[13px]">{row.original.wingName}</p>
            {row.original.sectionName && <p className="truncate text-xs text-muted-foreground">{row.original.sectionName}</p>}
          </div>
        ) : (
          dash
        ),
    },
    {
      id: 'bps',
      accessorKey: 'bps',
      header: 'Designation',
      meta: { label: 'Designation', className: 'max-w-[15rem]' },
      cell: ({ row }) =>
        row.original.designation || row.original.bps !== null ? (
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px]" title={row.original.designation ?? undefined}>
              {row.original.designation ?? dash}
            </span>
            <BpsBadge bps={row.original.bps} className="shrink-0" />
          </div>
        ) : (
          dash
        ),
    },
    {
      id: 'employmentType',
      header: 'Type',
      meta: { label: 'Employment type' },
      cell: ({ row }) => (row.original.employmentType ? <span className="text-[13px]">{EMPLOYMENT_TYPE_LABEL[row.original.employmentType]}</span> : dash),
    },
    {
      id: 'status',
      header: 'Status',
      meta: { label: 'Status' },
      cell: ({ row }) => <EmployeeStatusPill status={row.original.status} />,
    },
    {
      id: 'deviceSync',
      header: 'Devices',
      meta: { label: 'Device sync' },
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2">
          <DeviceSyncIndicator state={row.original.deviceSync} />
          <span className="text-xs tabular-nums text-muted-foreground">{row.original.deviceCount}</span>
        </span>
      ),
    },
    {
      id: 'biometrics',
      header: 'Biometrics',
      meta: { label: 'Biometrics' },
      cell: ({ row }) => <BiometricCounts templates={row.original.templates} hasPhoto={row.original.hasPhoto} />,
    },
    {
      id: 'card',
      header: 'Card',
      meta: { label: 'Card' },
      cell: ({ row }) => <CardCell cardNo={row.original.cardNo} />,
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableHiding: false,
      meta: { label: 'Actions', className: 'w-12 pl-0 text-right' },
      cell: ({ row }) => <RowMenu employee={row.original} actions={actions} />,
    },
  ];
}

export default function EmployeesPage() {
  usePageMeta({ title: 'Employees' });
  const navigate = useNavigate();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const state = useDataTableState<FilterKey>({ filterKeys: FILTER_KEYS, defaultPageSize: 50, defaultSort: { id: 'empCode', desc: false } });
  const wings = useWings();
  const wingId = state.filters.wingId ? Number(state.filters.wingId) : null;
  const sections = useSectionsOf(wingId);

  const toApi = (q: Record<string, unknown>): EmployeeListQuery => {
    const { wingId: w, sectionId: s, status, employmentType, biometrics, deviceSync, ...rest } = q as Record<string, string | undefined>;
    return {
      ...(rest as EmployeeListQuery),
      wingId: w ? Number(w) : undefined,
      sectionId: s ? Number(s) : undefined,
      status: (EMPLOYEE_STATUSES as readonly string[]).includes(status ?? '') ? (status as EmployeeListQuery['status']) : undefined,
      employmentType: (EMPLOYMENT_TYPES as readonly string[]).includes(employmentType ?? '') ? (employmentType as EmployeeListQuery['employmentType']) : undefined,
      biometrics: BIOMETRIC_OPTIONS.some((o) => o.value === biometrics) ? (biometrics as EmployeeListQuery['biometrics']) : undefined,
      deviceSync: (DEVICE_SYNC_STATES as readonly string[]).includes(deviceSync ?? '') ? (deviceSync as EmployeeListQuery['deviceSync']) : undefined,
    };
  };

  const result = useDataTableQuery<Employee, FilterKey>({
    state,
    queryKey: (q) => qk.employees.list(toApi(q)),
    fetcher: (q, signal) => listEmployees(toApi(q), signal),
  });

  const [formState, setFormState] = React.useState<{ employee: Employee | null } | null>(null);
  const lastForm = React.useRef<{ employee: Employee | null } | null>(null);
  if (formState) lastForm.current = formState;
  const [pushTarget, setPushTarget] = React.useState<PushTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<DeleteTarget | null>(null);
  const [statusTarget, setStatusTarget] = React.useState<StatusChangeTarget | null>(null);
  const [moveTarget, setMoveTarget] = React.useState<BulkTarget | null>(null);
  const [bulkStatus, setBulkStatus] = React.useState<BulkStatusTarget | null>(null);

  const canManage = can('employees.manage');
  const canStatus = canManage && can('employees.push');
  const canExport = can('employees.import');

  const exporter = useApiMutation<string, void>({
    mutationFn: () => {
      const { page: _p, pageSize: _ps, sort: _s, order: _o, ...filters } = toApi(state.query as unknown as Record<string, unknown>);
      return exportEmployees(filters);
    },
    successMessage: (name) => `Downloaded ${name}`,
    errorMessage: 'Export failed',
  });

  // `?new=1` opens the add sheet; `?export=1` starts the Excel export (command palette, deep links).
  const wantsNew = params.get('new') === '1';
  const wantsExport = params.get('export') === '1';
  React.useEffect(() => {
    if (!wantsNew && !wantsExport) return;
    if (wantsNew && canManage) setFormState({ employee: null });
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('new');
        next.delete('export');
        return next;
      },
      { replace: true },
    );
    if (wantsExport && canExport) exporter.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsNew, wantsExport]);

  const actions = React.useMemo<RowActions>(
    () => ({
      open: (e) => navigate(`/employees/${e.id}`),
      edit: (e) => setFormState({ employee: e }),
      push: (e) => setPushTarget({ employeeIds: [e.id], count: 1, name: e.name }),
      status: (e, to) => setStatusTarget({ id: e.id, name: e.name, status: e.status, to }),
      remove: (e) => setDeleteTarget({ id: e.id, name: e.name, empCode: e.empCode, deviceCount: e.deviceCount, status: e.status }),
    }),
    [navigate],
  );
  const columns = React.useMemo(() => buildColumns(actions), [actions]);

  const total = result.data?.total;
  const wingOptions = (wings.data ?? []).map((w) => ({ value: String(w.id), label: w.name }));
  const sectionOptions = sections.map((s) => ({ value: String(s.id), label: s.name }));
  const selectable = can('employees.push') || canManage;

  return (
    <>
      <PageHeader
        title="Employees"
        description={
          total === undefined
            ? 'The people registered for attendance. Their codes are the PINs on the terminals.'
            : `${total.toLocaleString()} ${total === 1 ? 'person' : 'people'}${state.hasFilters ? ' match the filters' : ' registered'}. Codes are the PINs on the terminals.`
        }
        actions={
          <>
            <Gate perm="employees.import" action="export employees to Excel">
              <Button variant="secondary" onClick={() => exporter.mutate()} loading={exporter.isPending} title={state.hasFilters ? 'Exports the people matching the current filters' : 'Exports everyone'}>
                {!exporter.isPending && <Download aria-hidden="true" />}
                Export to Excel
              </Button>
            </Gate>
            <Gate perm={['employees.import', 'employees.manage']} action="import employees from Excel">
              <Button variant="secondary" asChild>
                <Link to="/employees/import">
                  <FileUp aria-hidden="true" />
                  Import from Excel
                </Link>
              </Button>
            </Gate>
            <Gate perm="employees.manage" action="add employees">
              <Button onClick={() => setFormState({ employee: null })}>
                <Plus aria-hidden="true" />
                Add employee
              </Button>
            </Gate>
          </>
        }
      />

      <DataTable<Employee>
        id="employees"
        caption="Employees"
        columns={columns}
        data={result.data?.items ?? []}
        total={result.data?.total ?? 0}
        state={state}
        getRowId={(e) => String(e.id)}
        loading={result.isPending}
        fetching={result.isFetching}
        error={result.error}
        onRetry={() => void result.refetch()}
        onRowClick={(e) => navigate(`/employees/${e.id}`)}
        selectable={selectable}
        noun={{ singular: 'employee', plural: 'employees' }}
        toolbar={
          <>
            <DataTableSearch value={state.filters.q} onChange={(v) => state.setFilter('q', v)} placeholder="Search name, code, CNIC or card..." label="Search employees" />
            <DataTableFilterSelect
              label={ORG_UNIT.singular}
              value={state.filters.wingId}
              onChange={(v) => state.setFilters({ wingId: v, sectionId: null })}
              options={wingOptions}
              allLabel={`All ${ORG_UNIT.lowerPlural}`}
            />
            {wingId !== null && sectionOptions.length > 0 && (
              <DataTableFilterSelect label="Section" value={state.filters.sectionId} onChange={(v) => state.setFilter('sectionId', v)} options={sectionOptions} allLabel="All sections" />
            )}
            <DataTableFilterSelect
              label="Status"
              value={state.filters.status}
              onChange={(v) => state.setFilter('status', v)}
              options={EMPLOYEE_STATUSES.map((s) => ({ value: s, label: EMPLOYEE_STATUS_LABEL[s] }))}
              allLabel="Any status"
            />
            <DataTableFilterSelect
              label="Type"
              value={state.filters.employmentType}
              onChange={(v) => state.setFilter('employmentType', v)}
              options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: EMPLOYMENT_TYPE_LABEL[t] }))}
              allLabel="Any type"
            />
            <DataTableFilterSelect label="Biometrics" value={state.filters.biometrics} onChange={(v) => state.setFilter('biometrics', v)} options={BIOMETRIC_OPTIONS} allLabel="Any" />
            <DataTableFilterSelect
              label="Devices"
              value={state.filters.deviceSync}
              onChange={(v) => state.setFilter('deviceSync', v)}
              options={DEVICE_SYNC_STATES.map((s) => ({ value: s, label: SYNC_LABEL[s] }))}
              allLabel="Any"
            />
          </>
        }
        toolbarActions={
          <Gate perm="employees.push" action="send employees to devices" hide>
            <Button variant="ghost" size="sm" disabled={!total} onClick={() => setPushTarget({ employeeIds: 'all', count: total ?? 0 })}>
              <Send aria-hidden="true" />
              Push all active
            </Button>
          </Gate>
        }
        bulkActions={({ rows, ids, clear }) => (
          <>
            {can('employees.push') && (
              <Button size="sm" onClick={() => setPushTarget({ employeeIds: ids.map(Number), count: ids.length, onDone: clear })}>
                <Send aria-hidden="true" />
                Push to devices
              </Button>
            )}
            {canManage && (
              <Button size="sm" variant="secondary" onClick={() => setMoveTarget({ rows, onDone: clear })}>
                <Building2 aria-hidden="true" />
                Move to {ORG_UNIT.lower}
              </Button>
            )}
            {canStatus && (
              <>
                <Button size="sm" variant="secondary" onClick={() => setBulkStatus({ rows, to: 'disabled', onDone: clear })}>
                  <Ban aria-hidden="true" />
                  Disable
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setBulkStatus({ rows, to: 'active', onDone: clear })}>
                  <Play aria-hidden="true" />
                  Enable
                </Button>
              </>
            )}
          </>
        )}
        emptyState={
          state.hasFilters ? (
            <EmptyState
              bare
              icon={<UserPlus />}
              title="No employees match"
              description="Try removing a filter, or search for something else."
              action={
                <Button size="sm" variant="secondary" onClick={state.resetFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              bare
              icon={<UserPlus />}
              title="No employees yet"
              description="Add the first person, import a spreadsheet, or import the users already enrolled on a device from the Devices page."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Gate perm="employees.manage" action="add employees">
                    <Button size="sm" onClick={() => setFormState({ employee: null })}>
                      <Plus aria-hidden="true" />
                      Add employee
                    </Button>
                  </Gate>
                  <Gate perm={['employees.import', 'employees.manage']} action="import employees from Excel" hide>
                    <Button size="sm" variant="secondary" asChild>
                      <Link to="/employees/import">
                        <FileUp aria-hidden="true" />
                        Import from Excel
                      </Link>
                    </Button>
                  </Gate>
                </div>
              }
            />
          )
        }
      />

      {state.hasFilters && total !== undefined && (
        <p className="mt-2 text-xs text-muted-foreground">
          <Badge tone="outline" className="mr-1.5">
            Filtered
          </Badge>
          Export to Excel downloads only these {total.toLocaleString()} {total === 1 ? 'person' : 'people'}.
        </p>
      )}

      <EmployeeFormSheet
        key={(formState ?? lastForm.current)?.employee?.id ?? 'new'}
        open={formState !== null}
        onOpenChange={(o) => !o && setFormState(null)}
        employee={(formState ?? lastForm.current)?.employee ?? null}
        defaults={{ wingId, sectionId: state.filters.sectionId ? Number(state.filters.sectionId) : null }}
      />
      <PushDialog target={pushTarget} onOpenChange={(o) => !o && setPushTarget(null)} />
      <DeleteEmployeeDialog
        employee={deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        onMarkLeft={(t) => setStatusTarget({ id: t.id, name: t.name, status: t.status ?? 'active', to: 'left' })}
      />
      <StatusChangeDialog target={statusTarget} onOpenChange={(o) => !o && setStatusTarget(null)} />
      <MoveDialog target={moveTarget} onOpenChange={(o) => !o && setMoveTarget(null)} />
      <BulkStatusDialog target={bulkStatus} onOpenChange={(o) => !o && setBulkStatus(null)} />
    </>
  );
}
