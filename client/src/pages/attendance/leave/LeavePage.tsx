import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarOff, CalendarPlus, ChevronLeft, ChevronRight, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { LEAVE_PART_LABEL } from '@nacta/shared';
import type { Leave } from '@nacta/shared';
import { useApiMutation } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { addMonthsYmd, endOfMonthYmd, formatDate, formatMonth, isYmd, startOfMonthYmd, todayYmd } from '../../../lib/dates';
import { deleteLeave, listLeaves } from '../../../lib/endpoints/rules';
import { qk } from '../../../lib/query-keys';
import { rangeLabel } from '../../../lib/rules-ui';
import { ORG_UNIT } from '../../../lib/terms';
import { useDefaultTiming, useHolidays, useLeaveTypes } from '../../../hooks/use-rules';
import { useWings } from '../../../hooks/use-lookups';
import { usePageMeta } from '../../../hooks/use-page-meta';
import { Gate } from '../../../components/auth/gate';
import { DataTable } from '../../../components/data-table/data-table';
import { DataTableFilterSelect, DataTableSearch } from '../../../components/data-table/toolbar';
import { useDataTableQuery, useDataTableState } from '../../../components/data-table/use-data-table-state';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../../components/ui/alert-dialog';
import { Button } from '../../../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../../components/ui/dropdown-menu';
import { EmployeeAvatar } from '../../../components/ui/employee-avatar';
import { EmptyState } from '../../../components/ui/empty-state';
import { ErrorState } from '../../../components/ui/error-state';
import { IconButton } from '../../../components/ui/icon-button';
import { PageHeader } from '../../../components/ui/page-header';
import { Segmented } from '../../../components/ui/segmented';
import { Skeleton } from '../../../components/ui/skeleton';
import { LeaveDot, LeavePill } from '../../../components/rules/pills';
import { EditLeaveSheet } from './EditLeaveSheet';
import { LeaveMonthGrid } from './LeaveMonthGrid';
import { MarkLeaveSheet } from './MarkLeaveSheet';

type FilterKey = 'view' | 'month' | 'q' | 'wingId' | 'leaveTypeId';
const FILTER_KEYS = ['view', 'month', 'q', 'wingId', 'leaveTypeId'] as const;
const GRID_CAP = 500;

export default function LeavePage() {
  usePageMeta({ title: 'Leave', entityType: 'leave' });
  const { can } = useAuth();
  const canManage = can('leave.manage');
  const [params, setParams] = useSearchParams();
  const state = useDataTableState<FilterKey>({ filterKeys: FILTER_KEYS, defaultPageSize: 25, defaultSort: { id: 'from', desc: true } });
  const view = state.filters.view === 'list' ? 'list' : 'grid';
  const month = startOfMonthYmd(isYmd(state.filters.month ? `${state.filters.month}-01` : undefined) ? `${state.filters.month}-01` : todayYmd());
  const thisMonth = startOfMonthYmd(todayYmd());
  const from = month;
  const to = endOfMonthYmd(month);
  const wingId = state.filters.wingId ? Number(state.filters.wingId) : undefined;
  const leaveTypeId = state.filters.leaveTypeId ? Number(state.filters.leaveTypeId) : undefined;

  const wings = useWings();
  const types = useLeaveTypes();
  const holidays = useHolidays();
  const timing = useDefaultTiming();

  const [markOpen, setMarkOpen] = React.useState(params.get('mark') === '1');
  React.useEffect(() => {
    if (params.get('mark') === '1' && canManage) {
      setMarkOpen(true);
      setParams((p) => {
        const n = new URLSearchParams(p);
        n.delete('mark');
        return n;
      }, { replace: true });
    }
  }, [params, setParams, canManage]);
  const [editing, setEditing] = React.useState<Leave | null>(null);
  const [cancelling, setCancelling] = React.useState<Leave | null>(null);
  const lastCancel = React.useRef<Leave | null>(null);
  if (cancelling) lastCancel.current = cancelling;

  const setMonth = (m: string) => state.setFilter('month', m === thisMonth ? null : m.slice(0, 7));

  // Grid: every leave overlapping the month (capped); list: server-paginated.
  const gridQuery = { from, to, wingId, leaveTypeId, q: state.filters.q, page: 1, pageSize: GRID_CAP, sort: 'employee', order: 'asc' as const };
  const grid = useQuery({ queryKey: qk.leaves.list({ ...gridQuery, grid: true }), queryFn: ({ signal }) => listLeaves(gridQuery, signal), enabled: view === 'grid' });

  const result = useDataTableQuery<Leave, FilterKey>({
    state,
    enabled: view === 'list',
    queryKey: (q) => qk.leaves.list({ ...q, from, to }),
    fetcher: (q, signal) =>
      listLeaves({ page: q.page, pageSize: q.pageSize, sort: q.sort, order: q.order, q: q.q, wingId, leaveTypeId, from, to }, signal),
  });

  const remove = useApiMutation<void, Leave>({
    mutationFn: (l) => deleteLeave(l.id),
    invalidate: [qk.leaves.all, qk.daily.all],
    successMessage: 'Leave cancelled',
    onSuccess: () => setCancelling(null),
  });

  const columns = React.useMemo<ColumnDef<Leave>[]>(
    () => [
      {
        id: 'employee',
        accessorKey: 'employeeName',
        header: 'Employee',
        meta: { label: 'Employee', className: 'min-w-[15rem]' },
        cell: ({ row }) => (
          <Link to={`/employees/${row.original.employeeId}?tab=attendance`} className="inline-flex min-w-0 items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <EmployeeAvatar employee={{ id: row.original.employeeId, name: row.original.employeeName }} size="sm" />
            <span className="min-w-0 leading-tight">
              <span className="block truncate font-medium hover:underline">{row.original.employeeName}</span>
              <span className="block font-mono text-xs text-muted-foreground">{row.original.empCode}</span>
            </span>
          </Link>
        ),
      },
      { id: 'wingName', header: ORG_UNIT.singular, meta: { label: ORG_UNIT.singular, className: 'max-w-[14rem]' }, cell: ({ row }) => <span className="block truncate text-[13px]">{row.original.wingName ?? '-'}</span> },
      { id: 'type', accessorKey: 'leaveTypeName', header: 'Type', meta: { label: 'Type' }, cell: ({ row }) => <LeavePill code={row.original.leaveTypeCode} name={row.original.leaveTypeName} color={row.original.leaveTypeColor} part={row.original.part} /> },
      {
        id: 'from',
        accessorKey: 'from',
        header: 'Dates',
        meta: { label: 'Dates' },
        cell: ({ row }) => <span className="text-[13px] tabular-nums">{row.original.from === row.original.to ? formatDate(row.original.from) : `${formatDate(row.original.from)} – ${formatDate(row.original.to)}`}</span>,
      },
      {
        id: 'workingDays',
        header: 'Days',
        meta: { label: 'Working days', align: 'right' },
        cell: ({ row }) => (
          <span className="font-mono text-[13px] tabular-nums" title={row.original.part !== 'full' ? LEAVE_PART_LABEL[row.original.part] : undefined}>
            {row.original.workingDays}
          </span>
        ),
      },
      { id: 'reason', header: 'Reason', meta: { label: 'Reason', className: 'max-w-[18rem]', cellTitle: (r) => r.reason ?? undefined }, cell: ({ row }) => <span className="block truncate text-[13px] text-muted-foreground">{row.original.reason ?? '-'}</span> },
      { id: 'createdBy', header: 'Marked by', meta: { label: 'Marked by' }, cell: ({ row }) => <span className="text-[13px] text-muted-foreground">{row.original.createdBy ?? '-'}</span> },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        enableHiding: false,
        meta: { label: 'Actions', className: 'w-12' },
        cell: ({ row }) =>
          canManage ? (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label={`Actions for ${row.original.employeeName}'s leave`} icon={<MoreHorizontal />} size="icon-sm" tooltip={false} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setEditing(row.original)}>
                    <Pencil aria-hidden="true" /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setCancelling(row.original)} className="text-danger-text focus:text-danger-text">
                    <Trash2 aria-hidden="true" /> Cancel leave
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null,
      },
    ],
    [canManage],
  );

  const typeOptions = (types.data ?? []).map((t) => ({ value: String(t.id), label: `${t.code} · ${t.name}` }));
  const wingOptions = (wings.data ?? []).map((w) => ({ value: String(w.id), label: w.name }));
  const hasFilters = Boolean(state.filters.q || state.filters.wingId || state.filters.leaveTypeId);
  const reset = () => state.setFilters({ q: null, wingId: null, leaveTypeId: null });

  return (
    <>
      <PageHeader
        title="Leave"
        description="Who is away and when. Marked leave shows up in daily attendance straight away; there is no approval step."
        actions={
          <Gate perm="leave.manage" action="mark leave">
            <Button onClick={() => setMarkOpen(true)}>
              <CalendarPlus aria-hidden="true" />
              Mark leave
            </Button>
          </Gate>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          aria-label="View"
          size="sm"
          value={view}
          onChange={(v) => state.setFilter('view', v === 'grid' ? null : v)}
          options={[
            { value: 'grid', label: 'Month timeline' },
            { value: 'list', label: 'List' },
          ]}
        />
        <div className="flex items-center gap-1" role="group" aria-label="Month">
          <IconButton label="Previous month" icon={<ChevronLeft />} size="icon-sm" variant="secondary" onClick={() => setMonth(addMonthsYmd(month, -1))} />
          <span className="min-w-[8.5rem] text-center text-sm font-semibold tabular-nums" aria-live="polite">
            {formatMonth(month)}
          </span>
          <IconButton label="Next month" icon={<ChevronRight />} size="icon-sm" variant="secondary" onClick={() => setMonth(addMonthsYmd(month, 1))} />
          <Button size="sm" variant="secondary" disabled={month === thisMonth} onClick={() => setMonth(thisMonth)}>
            This month
          </Button>
        </div>
        <DataTableSearch value={state.filters.q} onChange={(v) => state.setFilter('q', v)} placeholder="Search employee..." label="Search leave by employee name or code" />
        <DataTableFilterSelect label={ORG_UNIT.singular} value={state.filters.wingId} onChange={(v) => state.setFilter('wingId', v)} options={wingOptions} allLabel={`All ${ORG_UNIT.lowerPlural}`} />
        <DataTableFilterSelect label="Type" value={state.filters.leaveTypeId} onChange={(v) => state.setFilter('leaveTypeId', v)} options={typeOptions} allLabel="All types" />
        {hasFilters && (
          <Button size="sm" variant="ghost" onClick={reset}>
            Clear filters
          </Button>
        )}
      </div>

      {view === 'grid' ? (
        <>
          {grid.isPending ? (
            <Skeleton className="h-80" />
          ) : grid.isError ? (
            <ErrorState error={grid.error} onRetry={() => void grid.refetch()} retrying={grid.isFetching} />
          ) : grid.data.items.length === 0 ? (
            <EmptyState
              icon={<CalendarOff />}
              title={hasFilters ? 'No leave matches these filters' : `No one is on leave in ${formatMonth(month)}`}
              description={hasFilters ? 'Try another month or clear the filters.' : 'Leave you mark appears here as a coloured bar for each person.'}
              action={
                hasFilters ? (
                  <Button variant="secondary" onClick={reset}>
                    Clear filters
                  </Button>
                ) : canManage ? (
                  <Button onClick={() => setMarkOpen(true)}>
                    <CalendarPlus aria-hidden="true" /> Mark leave
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className={grid.isFetching ? 'opacity-70 transition-opacity' : undefined}>
              <LeaveMonthGrid month={month} leaves={grid.data.items} holidays={holidays.data} timing={timing} canManage={canManage} onEdit={setEditing} onCancel={setCancelling} />
              {grid.data.total > grid.data.items.length && (
                <p className="mt-2 text-xs text-warning-text">Showing the first {grid.data.items.length} of {grid.data.total.toLocaleString()} leaves. Narrow by {ORG_UNIT.lower} or type to see the rest, or use the List view.</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground" aria-label="Legend">
                {(types.data ?? []).filter((t) => t.isActive).map((t) => (
                  <span key={t.id} className="inline-flex items-center gap-1.5">
                    <LeaveDot color={t.color} /> <span className="font-semibold text-foreground">{t.code}</span> {t.name}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-3 rounded-sm bg-muted ring-1 ring-border" /> Weekend / holiday
                </span>
              </div>
            </div>
          )}
        </>
      ) : (
        <DataTable<Leave>
          id="leave-list"
          caption={`Leave in ${formatMonth(month)}`}
          columns={columns}
          data={result.data?.items ?? []}
          total={result.data?.total ?? 0}
          state={{ ...state, hasFilters, resetFilters: reset }}
          getRowId={(r) => String(r.id)}
          loading={result.isPending}
          fetching={result.isFetching}
          error={result.error}
          onRetry={() => void result.refetch()}
          noun={{ singular: 'leave', plural: 'leaves' }}
          maxHeight="calc(100dvh - 22rem)"
          emptyState={<EmptyState bare icon={<CalendarOff />} title={`No leave in ${formatMonth(month)}`} description="Leave you mark appears here." />}
        />
      )}

      <MarkLeaveSheet open={markOpen} onOpenChange={setMarkOpen} />
      <EditLeaveSheet leave={editing} onOpenChange={(o) => !o && setEditing(null)} />

      <AlertDialog open={cancelling !== null} onOpenChange={(o) => !o && !remove.isPending && setCancelling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this leave?</AlertDialogTitle>
            <AlertDialogDescription>
              {lastCancel.current
                ? `${lastCancel.current.leaveTypeName} for ${lastCancel.current.employeeName}, ${rangeLabel(lastCancel.current.from, lastCancel.current.to)}, will be removed and those days go back to being calculated from punches. This is recorded in the audit log.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Keep leave</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                if (cancelling) remove.mutate(cancelling);
              }}
            >
              {remove.isPending ? 'Cancelling...' : 'Cancel leave'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
