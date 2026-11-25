import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  CalendarX2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FilePenLine,
  MoreHorizontal,
  PartyPopper,
  PencilLine,
  UserCheck,
  UserRound,
} from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import type { AttendanceDay, DayStatus, Leave } from '@nacta/shared';
import { DAY_STATUSES, DAY_STATUS_LABEL } from '@nacta/shared';
import { useAuth } from '../../lib/auth';
import { addDaysYmd, isYmd, parseYmd, todayYmd } from '../../lib/dates';
import { getDaySummary, listDaily, listLeaves } from '../../lib/endpoints/rules';
import { qk } from '../../lib/query-keys';
import { formatMinutes, holidayOn } from '../../lib/rules-ui';
import { ORG_UNIT } from '../../lib/terms';
import { cn } from '../../lib/utils';
import { useHolidays } from '../../hooks/use-rules';
import { useSectionsOf, useWings } from '../../hooks/use-lookups';
import { usePageMeta } from '../../hooks/use-page-meta';
import { DataTable } from '../../components/data-table/data-table';
import { DataTableFilterSelect, DataTableSearch } from '../../components/data-table/toolbar';
import { useDataTableQuery, useDataTableState } from '../../components/data-table/use-data-table-state';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { DatePicker } from '../../components/ui/date-picker';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { EmployeeAvatar } from '../../components/ui/employee-avatar';
import { EmptyState } from '../../components/ui/empty-state';
import { IconButton } from '../../components/ui/icon-button';
import { PageHeader } from '../../components/ui/page-header';
import { StatCard } from '../../components/ui/stat-card';
import { Tooltip } from '../../components/ui/tooltip';
import { DayStatusPill } from '../../components/rules/pills';
import { TimingSetupBanner } from '../../components/rules/setup-banner';
import { ExportMenu } from '../../components/reports/export-buttons';
import { CorrectionDialog, type CorrectionTarget } from './CorrectionDialog';
import { MarkLeaveSheet, type MarkLeaveInitial } from './leave/MarkLeaveSheet';

type FilterKey = 'date' | 'q' | 'wingId' | 'sectionId' | 'status';
const FILTER_KEYS = ['date', 'q', 'wingId', 'sectionId', 'status'] as const;
const LIVE_MS = 60_000;

const longDate = (ymd: string) => parseYmd(ymd).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable || el.getAttribute?.('role') === 'combobox';
}

function Chip({ tone, children, title }: { tone: 'warning' | 'info'; children: React.ReactNode; title?: string }) {
  return (
    <Badge tone={tone} title={title} className="px-1.5 font-mono text-[11px] tabular-nums">
      {children}
    </Badge>
  );
}

/** Stat tile as a toggle button: clicking it filters the table to that status. */
function FilterTile({ active, onClick, label, children, hint }: { active: boolean; onClick: () => void; label: string; children: React.ReactElement; hint?: string }) {
  const btn = (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${label}: filter the table`}
      onClick={onClick}
      className={cn(
        'block h-full w-full rounded-lg text-left transition-shadow duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        active ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'hover:shadow-md',
      )}
    >
      {children}
    </button>
  );
  return hint ? <Tooltip content={hint}>{btn}</Tooltip> : btn;
}

export default function DailyAttendancePage() {
  usePageMeta({ title: 'Daily attendance' });
  const navigate = useNavigate();
  const { can } = useAuth();
  const state = useDataTableState<FilterKey>({ filterKeys: FILTER_KEYS, defaultPageSize: 50, defaultSort: { id: 'name', desc: false } });
  const today = todayYmd();
  const date = isYmd(state.filters.date) ? state.filters.date : today;
  const isToday = date === today;
  const wingId = state.filters.wingId ? Number(state.filters.wingId) : undefined;
  const status = (DAY_STATUSES as readonly string[]).includes(state.filters.status ?? '') ? (state.filters.status as DayStatus) : undefined;
  const refetchInterval = isToday ? LIVE_MS : undefined;

  const wings = useWings();
  const sections = useSectionsOf(wingId ?? null);
  const holidays = useHolidays();
  const holiday = holidayOn(date, holidays.data);

  const [leaveFor, setLeaveFor] = React.useState<MarkLeaveInitial | null>(null);
  const [correctFor, setCorrectFor] = React.useState<CorrectionTarget | null>(null);
  const lastLeave = React.useRef<MarkLeaveInitial | undefined>(undefined);
  if (leaveFor) lastLeave.current = leaveFor;

  const setDate = React.useCallback((d: string) => state.setFilter('date', d === todayYmd() ? null : d), [state]);
  const stateRef = React.useRef({ date, setDate });
  stateRef.current = { date, setDate };

  // Keyboard: left / right arrow moves a day (unless the user is typing or a dialog / menu is open).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (isTypingTarget(e.target) || document.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]')) return;
      e.preventDefault();
      stateRef.current.setDate(addDaysYmd(stateRef.current.date, e.key === 'ArrowLeft' ? -1 : 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toApi = (q: { page?: number; pageSize?: number; sort?: string; order?: 'asc' | 'desc'; q?: string; sectionId?: string }) => ({
    date,
    page: q.page,
    pageSize: q.pageSize,
    sort: q.sort,
    order: q.order,
    q: q.q,
    wingId,
    sectionId: q.sectionId ? Number(q.sectionId) : undefined,
    status,
  });
  const result = useDataTableQuery<AttendanceDay, FilterKey>({
    state,
    queryKey: (q) => qk.daily.list(toApi(q)),
    fetcher: (q, signal) => listDaily(toApi(q) as Parameters<typeof listDaily>[0], signal),
    refetchInterval,
  });

  const summary = useQuery({
    queryKey: qk.daily.summary({ date, wingId }),
    queryFn: ({ signal }) => getDaySummary({ from: date, to: date, wingId }, signal),
    placeholderData: keepPreviousData,
    refetchInterval,
  });
  const leaveToday = useQuery({
    queryKey: qk.leaves.list({ from: date, to: date, wingId, pageSize: 500, tip: true }),
    queryFn: ({ signal }) => listLeaves({ from: date, to: date, wingId, pageSize: 500, page: 1 }, signal),
    enabled: (summary.data?.counts.leave ?? 0) > 0,
    refetchInterval,
  });
  const leaveByType = React.useMemo(() => {
    const m = new Map<string, { code: string; name: string; n: number }>();
    for (const l of (leaveToday.data?.items ?? []) as Leave[]) {
      const cur = m.get(l.leaveTypeCode) ?? { code: l.leaveTypeCode, name: l.leaveTypeName, n: 0 };
      cur.n++;
      m.set(l.leaveTypeCode, cur);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [leaveToday.data]);

  const c = summary.data?.counts ?? {};
  const n = (s: DayStatus) => c[s] ?? 0;
  const tiles: { key: string; label: string; icon: React.ReactNode; value: number; statuses: DayStatus[]; footnote?: React.ReactNode; hint?: React.ReactNode }[] = [
    { key: 'present', label: 'Present', icon: <UserCheck />, value: n('present'), statuses: ['present'] },
    { key: 'late', label: 'Late', icon: <Clock3 />, value: n('late'), statuses: ['late'] },
    {
      key: 'leave',
      label: 'On leave',
      icon: <CalendarOff />,
      value: n('leave'),
      statuses: ['leave'],
      hint: leaveByType.length ? (
        <span className="block space-y-0.5">
          {leaveByType.map((t) => (
            <span key={t.code} className="flex justify-between gap-4">
              <span>
                {t.code} {'·'} {t.name}
              </span>
              <span className="tabular-nums">{t.n}</span>
            </span>
          ))}
        </span>
      ) : undefined,
    },
    { key: 'absent', label: 'Absent', icon: <CalendarX2 />, value: n('absent'), statuses: ['absent'] },
    { key: 'pending', label: 'Not in yet', icon: <CalendarClock />, value: n('pending'), statuses: ['pending'] },
    {
      key: 'partial',
      label: 'Half day / Missing punch',
      icon: <PencilLine />,
      value: n('half_day') + n('incomplete'),
      statuses: ['half_day', 'incomplete'],
      footnote: `${n('half_day')} half day ${'·'} ${n('incomplete')} missing`,
    },
    {
      key: 'off',
      label: 'Holiday / Weekend',
      icon: <CalendarDays />,
      value: n('holiday') + n('weekend'),
      statuses: ['holiday', 'weekend'],
      footnote: `${n('holiday')} holiday ${'·'} ${n('weekend')} weekend`,
    },
  ];
  const tileClick = (statuses: DayStatus[]) => {
    const i = status ? statuses.indexOf(status) : -1;
    if (i === -1) state.setFilter('status', statuses[0]);
    else if (i + 1 < statuses.length) state.setFilter('status', statuses[i + 1]);
    else state.setFilter('status', null);
  };

  const columns = React.useMemo<ColumnDef<AttendanceDay>[]>(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: 'Employee',
        meta: { label: 'Employee', className: 'min-w-[15rem]' },
        cell: ({ row }) => {
          const r = row.original;
          return (
            <Link
              to={`/employees/${r.employeeId}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex min-w-0 items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <EmployeeAvatar employee={{ id: r.employeeId, name: r.name, hasPhoto: r.hasPhoto }} size="sm" />
              <span className="min-w-0 leading-tight">
                <span className="block truncate font-medium hover:underline">{r.name}</span>
                <span className="block font-mono text-xs text-muted-foreground">{r.empCode}</span>
              </span>
            </Link>
          );
        },
      },
      {
        id: 'wingName',
        header: ORG_UNIT.singular,
        meta: { label: ORG_UNIT.singular, className: 'min-w-[11rem] max-w-[15rem]', cellTitle: (r) => [r.wingName, r.sectionName].filter(Boolean).join(' / ') || undefined },
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
      {
        id: 'status',
        header: 'Status',
        meta: { label: 'Status', className: 'min-w-[11rem]' },
        cell: ({ row }) => {
          const d = row.original;
          return (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <DayStatusPill day={d} />
              {d.leave && d.status === 'half_day' && <DayStatusPillLeaveHalf day={d} />}
              {d.corrected && (
                <Tooltip content="A correction was applied to this day">
                  <span tabIndex={0} aria-label="Corrected" className="grid size-5 place-content-center rounded-full bg-info-subtle text-info-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <FilePenLine className="size-3" aria-hidden="true" />
                  </span>
                </Tooltip>
              )}
            </span>
          );
        },
      },
      {
        id: 'firstIn',
        header: 'In',
        meta: { label: 'In' },
        cell: ({ row }) => <TimeCell value={row.original.firstIn} day={row.original} />,
      },
      { id: 'lastOut', header: 'Out', meta: { label: 'Out' }, cell: ({ row }) => <TimeCell value={row.original.lastOut} day={row.original} /> },
      {
        id: 'workedMinutes',
        header: 'Worked',
        meta: { label: 'Worked', align: 'right' },
        cell: ({ row }) => (
          <span className="font-mono text-[13px] tabular-nums text-muted-foreground">{row.original.workedMinutes > 0 ? formatMinutes(row.original.workedMinutes) : '-'}</span>
        ),
      },
      {
        id: 'flags',
        header: 'Timing',
        meta: { label: 'Late / early', className: 'min-w-[9rem]' },
        cell: ({ row }) => {
          const d = row.original;
          const t = d.timing ? `${d.timing.profileName}: ${d.timing.start}–${d.timing.end}` : undefined;
          if (d.lateMinutes <= 0 && !(d.earlyLeave && d.earlyMinutes > 0)) return <span className="text-muted-foreground">-</span>;
          return (
            <span className="inline-flex gap-1">
              {d.lateMinutes > 0 && <Chip tone="warning" title={t}>+{d.lateMinutes}m late</Chip>}
              {d.earlyLeave && d.earlyMinutes > 0 && <Chip tone="info" title={t}>{'−'}{d.earlyMinutes}m early</Chip>}
            </span>
          );
        },
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        enableHiding: false,
        meta: { label: 'Actions', className: 'w-12' },
        cell: ({ row }) => {
          const d = row.original;
          const canLeave = can('leave.manage');
          const canCorrect = can('attendance.correct');
          const canView = can('employees.view');
          if (!canLeave && !canCorrect && !canView) return null;
          return (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label={`Actions for ${d.name}`} icon={<MoreHorizontal />} size="icon-sm" tooltip={false} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canLeave && (
                    <DropdownMenuItem onSelect={() => setLeaveFor({ employees: [{ id: d.employeeId, name: d.name, empCode: d.empCode, hasPhoto: d.hasPhoto, wingName: d.wingName }], date })}>
                      <CalendarOff aria-hidden="true" /> Mark leave
                    </DropdownMenuItem>
                  )}
                  {canCorrect && (
                    <DropdownMenuItem onSelect={() => setCorrectFor({ employeeId: d.employeeId, name: d.name, date, timing: d.timing })}>
                      <FilePenLine aria-hidden="true" /> Correct...
                    </DropdownMenuItem>
                  )}
                  {(canLeave || canCorrect) && canView && <DropdownMenuSeparator />}
                  {canView && (
                    <DropdownMenuItem onSelect={() => navigate(`/employees/${d.employeeId}?tab=attendance`)}>
                      <UserRound aria-hidden="true" /> View employee
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [can, date, navigate],
  );

  const wingOptions = (wings.data ?? []).map((w) => ({ value: String(w.id), label: w.name }));
  const sectionOptions = sections.map((s) => ({ value: String(s.id), label: s.name }));
  const statusOptions = DAY_STATUSES.filter((s) => s !== 'inactive').map((s) => ({ value: s, label: DAY_STATUS_LABEL[s] }));

  return (
    <>
      <PageHeader
        title="Daily attendance"
        description="Every employee's computed status for the day, from punches, leave, holidays and corrections."
        actions={
          <ExportMenu
            type="daily"
            params={{ date, wingId, sectionId: state.filters.sectionId ? Number(state.filters.sectionId) : undefined, status }}
            note={state.filters.q ? 'The search box is not applied to downloads.' : undefined}
          />
        }
      />
      <TimingSetupBanner />

      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Choose the day">
        <IconButton label="Previous day" icon={<ChevronLeft />} size="icon-sm" variant="secondary" shortcut={'←'} onClick={() => setDate(addDaysYmd(date, -1))} />
        <DatePicker value={date} onChange={setDate} className="h-8 w-auto min-w-[10.5rem] text-[13px]" aria-label="Pick a date" />
        <IconButton label="Next day" icon={<ChevronRight />} size="icon-sm" variant="secondary" shortcut={'→'} onClick={() => setDate(addDaysYmd(date, 1))} />
        <Button size="sm" variant="secondary" disabled={isToday} onClick={() => setDate(today)}>
          Today
        </Button>
        <p className="ml-1 flex items-center gap-2 text-[13px] text-muted-foreground" aria-live="polite">
          <span className="font-medium text-foreground">{longDate(date)}</span>
          {isToday && (
            <span className="inline-flex items-center gap-1.5 text-xs">
              <span className="relative flex size-2" aria-hidden="true">
                <span className="absolute inset-0 rounded-full bg-success motion-safe:animate-status-ping" />
                <span className="relative size-2 rounded-full bg-success" />
              </span>
              Live {'·'} refreshes every minute
            </span>
          )}
        </p>
      </div>

      {holiday && (
        <div role="status" className="mb-4 flex items-center gap-3 rounded-lg border border-primary/25 bg-primary-subtle px-4 py-3 text-primary-text">
          <PartyPopper className="size-5 shrink-0" aria-hidden="true" />
          <p className="text-sm">
            <span className="font-semibold">{holiday.name}</span> is a holiday{holiday.from !== holiday.to ? ` (${holiday.from} to ${holiday.to})` : ''}: the office is closed, nobody is marked absent.
          </p>
        </div>
      )}

      <section aria-label="Summary for the day" className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {tiles.map((t) => (
          <FilterTile key={t.key} active={status !== undefined && t.statuses.includes(status)} onClick={() => tileClick(t.statuses)} label={t.label} hint={t.hint ? undefined : undefined}>
            {t.hint ? (
              <Tooltip content={t.hint} side="bottom">
                <div className="h-full">
                  <StatCard className="h-full p-4" loading={summary.isPending} label={t.label} icon={t.icon} value={t.value.toLocaleString()} footnote={t.footnote} />
                </div>
              </Tooltip>
            ) : (
              <StatCard className="h-full p-4" loading={summary.isPending} label={t.label} icon={t.icon} value={t.value.toLocaleString()} footnote={t.footnote} />
            )}
          </FilterTile>
        ))}
      </section>
      {summary.isError && !summary.data && <p className="mb-4 text-[13px] text-danger-text">The day summary could not be loaded; the table below may still work.</p>}

      <DataTable<AttendanceDay>
        id="daily-attendance"
        caption={`Attendance on ${longDate(date)}`}
        columns={columns}
        data={result.data?.items ?? []}
        total={result.data?.total ?? 0}
        state={{ ...state, hasFilters: Boolean(state.filters.q || state.filters.wingId || state.filters.sectionId || state.filters.status), resetFilters: () => state.setFilters({ q: null, wingId: null, sectionId: null, status: null }) }}
        getRowId={(r) => String(r.employeeId)}
        loading={result.isPending}
        fetching={result.isFetching}
        error={result.error}
        onRetry={() => void result.refetch()}
        noun={{ singular: 'employee', plural: 'employees' }}
        maxHeight="calc(100dvh - 26rem)"
        toolbar={
          <>
            <DataTableSearch value={state.filters.q} onChange={(v) => state.setFilter('q', v)} placeholder="Search name or code..." label="Search employees by name or code" />
            <DataTableFilterSelect label={ORG_UNIT.singular} value={state.filters.wingId} onChange={(v) => state.setFilters({ wingId: v, sectionId: null })} options={wingOptions} allLabel={`All ${ORG_UNIT.lowerPlural}`} />
            {state.filters.wingId && sectionOptions.length > 0 && (
              <DataTableFilterSelect label="Section" value={state.filters.sectionId} onChange={(v) => state.setFilter('sectionId', v)} options={sectionOptions} allLabel="All sections" />
            )}
            <DataTableFilterSelect label="Status" value={status} onChange={(v) => state.setFilter('status', v)} options={statusOptions} allLabel="All statuses" />
          </>
        }
        emptyState={<EmptyState bare icon={<CalendarCheck2 />} title="No employees to show" description="No one in your scope matches these filters on this day." />}
      />

      <MarkLeaveSheet open={leaveFor !== null} onOpenChange={(o) => !o && setLeaveFor(null)} initial={lastLeave.current} />
      <CorrectionDialog target={correctFor} onOpenChange={(o) => !o && setCorrectFor(null)} />
    </>
  );
}

function DayStatusPillLeaveHalf({ day }: { day: AttendanceDay }) {
  if (!day.leave) return null;
  return (
    <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${day.leave.color} 16%, transparent)`, color: `color-mix(in srgb, ${day.leave.color} 62%, rgb(var(--foreground)))` }}>
      {day.leave.code} {'½'}
    </span>
  );
}

function TimeCell({ value, day }: { value: string | null; day: AttendanceDay }) {
  if (!value) return <span className="whitespace-nowrap font-mono text-[13px] text-muted-foreground">--:--</span>;
  const span = <span className="whitespace-nowrap font-mono text-[13px] tabular-nums">{value}</span>;
  return day.timing ? <Tooltip content={`${day.timing.profileName}: ${day.timing.start}–${day.timing.end}`}>{span}</Tooltip> : span;
}
