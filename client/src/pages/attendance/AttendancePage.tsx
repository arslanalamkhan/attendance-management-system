import * as React from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CalendarSearch, CircleHelp, Fingerprint, Users } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import type { AttendanceQuery, AttendanceRecord } from '@nacta/shared';
import { listAttendance } from '../../lib/endpoints/attendance';
import { isYmd } from '../../lib/dates';
import { qk } from '../../lib/query-keys';
import { ORG_UNIT } from '../../lib/terms';
import { useDevices, useSectionsOf, useWings } from '../../hooks/use-lookups';
import { DataTable } from '../../components/data-table/data-table';
import { DataTableFilterSelect, DataTableSearch } from '../../components/data-table/toolbar';
import { useDataTableQuery, useDataTableState } from '../../components/data-table/use-data-table-state';
import { EmployeeAvatar } from '../../components/ui/employee-avatar';
import { EmptyState } from '../../components/ui/empty-state';
import { PageHeader } from '../../components/ui/page-header';
import { Skeleton } from '../../components/ui/skeleton';
import { ExportMenu } from '../../components/reports/export-buttons';
import { DateRangePicker, rangeIncludesToday } from './DateRangePicker';
import { MethodCell, PunchTime, PunchTypeBadge } from './punch-cells';
import { usePageMeta } from '../../hooks/use-page-meta';

type FilterKey = 'q' | 'from' | 'to' | 'wingId' | 'sectionId' | 'deviceId';
const FILTER_KEYS = ['q', 'from', 'to', 'wingId', 'sectionId', 'deviceId'] as const;

/** Live refresh while the range includes today. */
const LIVE_INTERVAL_MS = 15_000;
/** Largest page the API serves; used to count distinct people for the summary strip. */
const SUMMARY_SAMPLE = 500;

const columns: ColumnDef<AttendanceRecord>[] = [
  {
    id: 'punchTime',
    accessorKey: 'punchTime',
    header: 'Time',
    meta: { label: 'Time', className: 'w-[15rem]' },
    cell: ({ row }) => <PunchTime punchTime={row.original.punchTime} />,
  },
  {
    id: 'employeeName',
    accessorKey: 'employeeName',
    header: 'Employee',
    meta: { label: 'Employee', className: 'min-w-[14rem]' },
    cell: ({ row }) => {
      const r = row.original;
      if (r.employeeId === null) {
        return (
          <div className="flex items-center gap-3 text-muted-foreground">
            <span className="grid size-8 shrink-0 place-content-center rounded-full bg-muted" aria-hidden="true">
              <CircleHelp className="size-4" />
            </span>
            <span className="italic">Unknown PIN</span>
          </div>
        );
      }
      const name = r.employeeName ?? `Employee ${r.employeeId}`;
      return (
        <Link
          to={`/employees/${r.employeeId}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex min-w-0 items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <EmployeeAvatar employee={{ id: r.employeeId, name }} size="sm" />
          <span className="truncate font-medium hover:underline">{name}</span>
        </Link>
      );
    },
  },
  {
    id: 'pin',
    accessorKey: 'pin',
    header: 'PIN',
    meta: { label: 'PIN' },
    cell: ({ row }) => <span className="font-mono text-[13px] tabular-nums">{row.original.pin}</span>,
  },
  {
    id: 'wingName',
    accessorKey: 'wingName',
    header: ORG_UNIT.singular,
    meta: { label: ORG_UNIT.singular, className: 'min-w-[12rem] max-w-[16rem]', cellTitle: (r) => [r.wingName, r.sectionName].filter(Boolean).join(' / ') || undefined },
    cell: ({ row }) =>
      row.original.wingName ? (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[13px]">{row.original.wingName}</p>
          {row.original.sectionName && <p className="truncate text-xs text-muted-foreground">{row.original.sectionName}</p>}
        </div>
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
  },
  { id: 'status', header: 'Punch type', meta: { label: 'Punch type' }, cell: ({ row }) => <PunchTypeBadge status={row.original.status} /> },
  { id: 'verifyType', header: 'Method', meta: { label: 'Method' }, cell: ({ row }) => <MethodCell verifyType={row.original.verifyType} /> },
  {
    id: 'deviceName',
    accessorKey: 'deviceName',
    header: 'Device',
    meta: { label: 'Device', className: 'max-w-[14rem] truncate', cellTitle: (r) => r.deviceName },
    cell: ({ row }) => <span className="text-[13px]">{row.original.deviceName}</span>,
  },
];

function SummaryItem({ icon, label, value, loading, hint }: { icon: React.ReactNode; label: string; value: string; loading: boolean; hint?: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5" title={hint}>
      <span className="grid size-8 shrink-0 place-content-center rounded-md bg-primary-subtle text-primary-text [&_svg]:size-4" aria-hidden="true">
        {icon}
      </span>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        {loading ? <Skeleton className="mt-1 h-5 w-14" /> : <p className="font-figure text-lg font-semibold leading-tight tracking-tight">{value}</p>}
      </div>
    </div>
  );
}

const toApiQuery = (q: Record<string, unknown> & { q?: string; from?: string; to?: string; wingId?: string; sectionId?: string; deviceId?: string }): AttendanceQuery => ({
  ...(q as AttendanceQuery),
  q: q.q,
  from: isYmd(q.from) ? q.from : undefined,
  to: isYmd(q.to) ? q.to : undefined,
  wingId: q.wingId ? Number(q.wingId) : undefined,
  sectionId: q.sectionId ? Number(q.sectionId) : undefined,
  deviceId: q.deviceId ? Number(q.deviceId) : undefined,
});

export default function AttendancePage() {
  usePageMeta({ title: 'Punch records' });
  const state = useDataTableState<FilterKey>({ filterKeys: FILTER_KEYS, defaultPageSize: 50, defaultSort: { id: 'punchTime', desc: true } });
  const wings = useWings();
  const sections = useSectionsOf(state.filters.wingId ? Number(state.filters.wingId) : null);
  const devices = useDevices();

  const range = { from: isYmd(state.filters.from) ? state.filters.from : undefined, to: isYmd(state.filters.to) ? state.filters.to : undefined };
  const live = rangeIncludesToday(range);

  const result = useDataTableQuery<AttendanceRecord, FilterKey>({
    state,
    queryKey: (q) => qk.attendance.list(toApiQuery(q)),
    fetcher: (q, signal) => listAttendance(toApiQuery(q), signal),
    refetchInterval: live ? LIVE_INTERVAL_MS : undefined,
  });

  // Distinct people for the filtered range: counted from the largest page the API allows.
  const filters = state.filters;
  const sampleQuery = toApiQuery({ ...filters, page: 1, pageSize: SUMMARY_SAMPLE });
  const sample = useQuery({
    queryKey: qk.attendance.list(sampleQuery),
    queryFn: ({ signal }) => listAttendance(sampleQuery, signal),
    placeholderData: keepPreviousData,
    refetchInterval: live ? LIVE_INTERVAL_MS : undefined,
  });
  const people = React.useMemo(() => {
    if (!sample.data) return null;
    return new Set(sample.data.items.map((r) => (r.employeeId !== null ? `e${r.employeeId}` : `p${r.pin}`))).size;
  }, [sample.data]);
  const sampled = sample.data ? sample.data.total > sample.data.items.length : false;

  const total = result.data?.total;
  const wingOptions = (wings.data ?? []).map((d) => ({ value: String(d.id), label: d.name }));
  const sectionOptions = sections.map((s) => ({ value: String(s.id), label: s.name }));
  const deviceOptions = (devices.data ?? []).map((d) => ({ value: String(d.id), label: d.name }));

  return (
    <>
      <PageHeader
        title="Punch records"
        description="Every punch reported by the terminals, newest first. Times are the terminal's local clock."
        actions={
          <ExportMenu
            type="punch_log"
            params={{ from: range.from, to: range.to, wingId: state.filters.wingId ? Number(state.filters.wingId) : undefined, deviceId: state.filters.deviceId ? Number(state.filters.deviceId) : undefined }}
            note={state.filters.q || state.filters.sectionId ? 'Search and section filters are not applied to downloads.' : undefined}
          />
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-lg border bg-card shadow-xs">
        <div className="flex flex-wrap items-center divide-x" role="group" aria-label="Summary for the filtered range">
          <SummaryItem icon={<Fingerprint />} label="Punches" value={(total ?? 0).toLocaleString()} loading={total === undefined} />
          <SummaryItem
            icon={<Users />}
            label="Distinct people"
            value={people === null ? '-' : `${sampled ? '≥ ' : ''}${people.toLocaleString()}`}
            loading={people === null}
            hint={sampled ? `Counted from the latest ${SUMMARY_SAMPLE} punches in this range` : undefined}
          />
        </div>
        <p className="flex items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground">
          {live ? (
            <>
              <span className="relative flex size-2" aria-hidden="true">
                <span className="absolute inset-0 rounded-full bg-success motion-safe:animate-status-ping" />
                <span className="relative size-2 rounded-full bg-success" />
              </span>
              Live: refreshes every {LIVE_INTERVAL_MS / 1000} seconds
            </>
          ) : (
            'Fixed range: no auto-refresh'
          )}
        </p>
      </div>

      <DataTable<AttendanceRecord>
        id="attendance"
        caption="Attendance records"
        columns={columns}
        data={result.data?.items ?? []}
        total={result.data?.total ?? 0}
        state={state}
        getRowId={(r) => String(r.id)}
        loading={result.isPending}
        fetching={result.isFetching}
        error={result.error}
        onRetry={() => void result.refetch()}
        noun={{ singular: 'punch', plural: 'punches' }}
        maxHeight="calc(100dvh - 24rem)"
        toolbar={
          <>
            <DataTableSearch value={state.filters.q} onChange={(v) => state.setFilter('q', v)} placeholder="Search name or PIN..." label="Search punches by name or PIN" />
            <DateRangePicker value={range} onChange={(r) => state.setFilters({ from: r.from ?? null, to: r.to ?? null })} />
            <DataTableFilterSelect
              label={ORG_UNIT.singular}
              value={state.filters.wingId}
              onChange={(v) => state.setFilters({ wingId: v, sectionId: null })}
              options={wingOptions}
              allLabel={`All ${ORG_UNIT.lowerPlural}`}
            />
            {state.filters.wingId && sectionOptions.length > 0 && (
              <DataTableFilterSelect label="Section" value={state.filters.sectionId} onChange={(v) => state.setFilter('sectionId', v)} options={sectionOptions} allLabel="All sections" />
            )}
            <DataTableFilterSelect label="Device" value={state.filters.deviceId} onChange={(v) => state.setFilter('deviceId', v)} options={deviceOptions} allLabel="All devices" />
          </>
        }
        emptyState={
          <EmptyState
            bare
            icon={<CalendarSearch />}
            title="No punches recorded yet"
            description="Punches show up here as soon as a terminal reports them."
          />
        }
      />
    </>
  );
}

