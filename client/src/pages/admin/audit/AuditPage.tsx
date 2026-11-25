import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Ban, Download, FileClock, LogIn, Pencil, UserX, Users } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { AUDIT_ACTIONS, AUDIT_CATEGORIES, AUDIT_OUTCOMES } from '@nacta/shared';
import type { AuditCategory, AuditEntityType, AuditEntry, AuditQuery, AuditAction, AuditOutcome } from '@nacta/shared';
import { useApiMutation } from '../../../lib/api';
import { getAuditEntry, getAuditSummary, listAudit, downloadAuditCsv } from '../../../lib/endpoints/audit';
import { listUsers } from '../../../lib/endpoints/users';
import { qk } from '../../../lib/query-keys';
import { OUTCOME_META, ENTITY_LABELS } from '../../../lib/audit-ui';
import { readStorage, writeStorage } from '../../../lib/storage';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { usePageMeta } from '../../../hooks/use-page-meta';
import { Gate } from '../../../components/auth/gate';
import { ActionCell, OutcomePill, Stamp, SubjectCell, UserCell } from '../../../components/audit/audit-bits';
import { AuditDetailSheet } from '../../../components/audit/audit-detail-sheet';
import { DataTable } from '../../../components/data-table/data-table';
import { DataTableFilterSelect, DataTableSearch } from '../../../components/data-table/toolbar';
import { useDataTableQuery, useDataTableState, type DataTablePagingState } from '../../../components/data-table/use-data-table-state';
import { Button } from '../../../components/ui/button';
import { EmptyState } from '../../../components/ui/empty-state';
import { PageHeader } from '../../../components/ui/page-header';
import { StatCard } from '../../../components/ui/stat-card';
import { ActionFilter, AuditRangePicker, CategoryChips, FilterChip, UserFilter, ViewToggle, type AuditView, type RangeChange } from './audit-filters';
import { DEFAULT_RANGE, rangeLabel, resolveRange } from './audit-range';
import { AuditTimeline } from './audit-timeline';

type FilterKey = 'q' | 'userId' | 'action' | 'category' | 'outcome' | 'range' | 'from' | 'to' | 'entityType' | 'entityId' | 'entityLabel';
const FILTER_KEYS = ['q', 'userId', 'action', 'category', 'outcome', 'range', 'from', 'to', 'entityType', 'entityId', 'entityLabel'] as const;

const VIEW_KEY = 'nacta-audit-view';
const TIMELINE_PAGE = 50;

const dash = <span className="text-muted-foreground">-</span>;

const columns: ColumnDef<AuditEntry>[] = [
  {
    id: 'at',
    accessorKey: 'at',
    header: 'Time',
    meta: { label: 'Time', className: 'w-[11.5rem]' },
    cell: ({ row }) => <Stamp iso={row.original.at} />,
  },
  {
    id: 'user',
    header: 'User',
    enableSorting: false,
    meta: { label: 'User', className: 'min-w-[11rem]' },
    cell: ({ row }) => <UserCell entry={row.original} />,
  },
  {
    id: 'action',
    header: 'Action',
    enableSorting: false,
    meta: { label: 'Action', className: 'min-w-[13rem]' },
    cell: ({ row }) => <ActionCell entry={row.original} />,
  },
  {
    id: 'subject',
    header: 'Subject',
    enableSorting: false,
    meta: { label: 'Subject', className: 'min-w-[12rem] max-w-[16rem]' },
    cell: ({ row }) => <SubjectCell entry={row.original} />,
  },
  {
    id: 'summary',
    header: 'Summary',
    enableSorting: false,
    meta: { label: 'Summary', className: 'min-w-[16rem] max-w-[26rem]', cellTitle: (row) => row.summary },
    cell: ({ row }) => <span className="line-clamp-2 text-muted-foreground">{row.original.summary}</span>,
  },
  {
    id: 'outcome',
    header: 'Outcome',
    enableSorting: false,
    meta: { label: 'Outcome' },
    cell: ({ row }) => <OutcomePill outcome={row.original.outcome} />,
  },
  {
    id: 'ip',
    header: 'IP',
    enableSorting: false,
    meta: { label: 'IP address' },
    cell: ({ row }) => (row.original.ip ? <span className="font-mono text-[12.5px] text-muted-foreground">{row.original.ip}</span> : dash),
  },
];

const asEnum = <T extends string>(list: readonly T[], v: string | undefined): T | undefined => (v && (list as readonly string[]).includes(v) ? (v as T) : undefined);

export default function AuditPage() {
  usePageMeta({ title: 'Audit log' });
  const [params, setParams] = useSearchParams();
  const state = useDataTableState<FilterKey>({ filterKeys: FILTER_KEYS, defaultPageSize: 50, defaultSort: { id: 'at', desc: true } });
  const { filters } = state;

  // ---- view (table / timeline): URL > remembered choice > narrow screens default to the timeline
  const narrow = useMediaQuery('(max-width: 767px)');
  const viewParam = asEnum(['table', 'timeline'] as const, params.get('view') ?? undefined);
  const stored = asEnum(['table', 'timeline'] as const, readStorage(VIEW_KEY) ?? undefined);
  const view: AuditView = viewParam ?? stored ?? (narrow ? 'timeline' : 'table');
  const setView = (v: AuditView) => {
    writeStorage(VIEW_KEY, v);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('view', v);
        return next;
      },
      { replace: true },
    );
  };

  // ---- filters -> API query
  const range = resolveRange(filters.range, filters.from, filters.to);
  const auditQuery = React.useMemo<AuditQuery>(() => {
    const userId = Number(filters.userId);
    return {
      q: filters.q,
      userId: Number.isInteger(userId) && userId > 0 ? userId : undefined,
      action: asEnum(Object.keys(AUDIT_ACTIONS) as AuditAction[], filters.action),
      category: asEnum(AUDIT_CATEGORIES, filters.category),
      outcome: asEnum(AUDIT_OUTCOMES, filters.outcome),
      entityType: asEnum(Object.keys(ENTITY_LABELS) as AuditEntityType[], filters.entityType),
      entityId: filters.entityId,
      from: range.from,
      to: range.to,
    };
  }, [filters.q, filters.userId, filters.action, filters.category, filters.outcome, filters.entityType, filters.entityId, range.from, range.to]);

  const rangeChanged = range.key !== DEFAULT_RANGE;
  const activeFilterCount = Object.keys(filters).filter((k) => k !== 'entityLabel' && k !== 'from' && k !== 'to' && k !== 'range').length + (rangeChanged ? 1 : 0);
  const hasFilters = activeFilterCount > 0;
  const resetAll = React.useCallback(() => state.setFilters(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])) as Record<FilterKey, null>), [state]);
  const pagingState: DataTablePagingState = { ...state, hasFilters, resetFilters: resetAll };

  // ---- data
  const table = useDataTableQuery<AuditEntry, FilterKey>({
    state,
    queryKey: (q) => qk.audit.list({ ...auditQuery, page: q.page, pageSize: q.pageSize, order: q.order }),
    fetcher: (q, signal) => listAudit({ ...auditQuery, page: q.page, pageSize: q.pageSize, sort: 'at', order: q.order }, signal),
    enabled: view === 'table',
  });
  const timeline = useInfiniteQuery({
    queryKey: qk.audit.feed({ ...auditQuery, pageSize: TIMELINE_PAGE, order: state.sorting[0]?.desc === false ? 'asc' : 'desc' }),
    queryFn: ({ pageParam, signal }) => listAudit({ ...auditQuery, page: pageParam, pageSize: TIMELINE_PAGE, sort: 'at', order: state.sorting[0]?.desc === false ? 'asc' : 'desc' }, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    enabled: view === 'timeline',
  });
  const summary = useQuery({
    queryKey: qk.audit.summary({ from: range.from, to: range.to }),
    queryFn: ({ signal }) => getAuditSummary({ from: range.from, to: range.to }, signal),
  });
  const users = useQuery({
    queryKey: qk.users.list({ page: 1, pageSize: 200, sort: 'name' }),
    queryFn: ({ signal }) => listUsers({ page: 1, pageSize: 200, sort: 'name' }, signal),
    staleTime: 60_000,
    retry: false,
  });

  const tableItems = table.data?.items ?? [];
  const timelineItems = React.useMemo(() => timeline.data?.pages.flatMap((p) => p.items) ?? [], [timeline.data]);
  const loaded = view === 'table' ? tableItems : timelineItems;
  const total = view === 'table' ? (table.data?.total ?? 0) : (timeline.data?.pages[0]?.total ?? 0);

  // Users filter options: /users needs users.manage; auditors without it fall back to people seen in the loaded entries.
  const userOptions = React.useMemo(() => {
    if (users.data) return users.data.items.map((u) => ({ value: String(u.id), label: u.name, hint: u.email.split('@')[0] }));
    const seen = new Map<string, string>();
    for (const e of [...tableItems, ...timelineItems]) if (e.userId !== null && (e.userName ?? e.userEmail)) seen.set(String(e.userId), (e.userName ?? e.userEmail)!);
    return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [users.data, tableItems, timelineItems]);

  // ---- detail sheet (?entry=ID so a row can be linked to)
  const entryId = Number(params.get('entry')) || null;
  const inList = entryId ? (loaded.find((e) => e.id === entryId) ?? null) : null;
  const fetched = useQuery({
    queryKey: qk.audit.entry(entryId ?? 0),
    queryFn: ({ signal }) => getAuditEntry(entryId!, signal),
    enabled: Boolean(entryId) && !inList,
    retry: false,
  });
  const lastEntry = React.useRef<AuditEntry | null>(null);
  const entryMissing = fetched.isError;
  const current = inList ?? fetched.data ?? null;
  if (current) lastEntry.current = current;
  const openEntry = (e: AuditEntry | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (e) next.set('entry', String(e.id));
        else next.delete('entry');
        return next;
      },
      { replace: e === null },
    );

  // A linked entry that no longer exists: drop the param instead of leaving the sheet loading.
  React.useEffect(() => {
    if (entryMissing && entryId) openEntry(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryMissing, entryId]);

  // ---- export
  const exporter = useApiMutation<string, void>({
    mutationFn: () => downloadAuditCsv(auditQuery),
    successMessage: (name) => `Downloaded ${name}`,
    errorMessage: 'Could not export the audit log',
    invalidate: [qk.audit.all],
  });

  const onRange = (r: RangeChange) => state.setFilters({ range: r.range === DEFAULT_RANGE ? null : r.range, from: r.range === 'custom' ? r.from : null, to: r.range === 'custom' ? r.to : null });

  const s = summary.data;
  const sv = (n: number | undefined, danger = false) => (
    <span className={danger && n ? 'text-danger-text' : undefined}>{n === undefined ? '-' : n.toLocaleString()}</span>
  );
  const subjectChip = filters.entityType && filters.entityId ? `${ENTITY_LABELS[filters.entityType as AuditEntityType] ?? filters.entityType} · ${filters.entityLabel ?? filters.entityId}` : null;

  const resultCount =
    total === 0 && (table.isPending || timeline.isPending)
      ? 'Loading...'
      : `${total.toLocaleString()} ${total === 1 ? 'entry' : 'entries'}${hasFilters ? ' match' : ''} · ${rangeLabel(range).toLowerCase()}`;

  const toolbar = (
    <>
      <DataTableSearch value={filters.q} onChange={(v) => state.setFilter('q', v)} placeholder="Search summaries, people, subjects..." label="Search the audit log" />
      <AuditRangePicker value={range} onChange={onRange} />
      <UserFilter value={filters.userId} options={userOptions} loading={users.isPending} onChange={(v) => state.setFilter('userId', v)} />
      <ActionFilter value={filters.action} category={asEnum(AUDIT_CATEGORIES, filters.category)} onChange={(v) => state.setFilter('action', v)} />
      <DataTableFilterSelect
        label="Outcome"
        value={asEnum(AUDIT_OUTCOMES, filters.outcome)}
        onChange={(v) => state.setFilter('outcome', v)}
        options={AUDIT_OUTCOMES.map((o: AuditOutcome) => ({ value: o, label: OUTCOME_META[o].label }))}
        allLabel="Any outcome"
      />
    </>
  );

  const chips = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <CategoryChips
        value={asEnum(AUDIT_CATEGORIES, filters.category) as AuditCategory | undefined}
        onChange={(c) => state.setFilters({ category: c ?? null, action: c && filters.action && AUDIT_ACTIONS[filters.action as AuditAction]?.category !== c ? null : filters.action })}
      />
      {subjectChip && <FilterChip label="Subject" value={subjectChip} onClear={() => state.setFilters({ entityType: null, entityId: null, entityLabel: null })} />}
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={resetAll} className="h-7 text-xs">
          Clear filters
        </Button>
      )}
    </div>
  );

  return (
    <>
      <PageHeader
        title="Audit log"
        description="A tamper-evident record of who signed in, changed, viewed or exported what, and when. Entries cannot be edited or deleted."
        actions={
          <Gate perm="audit.view" action="export the audit log">
            <Button variant="secondary" loading={exporter.isPending} onClick={() => exporter.mutate()}>
              {!exporter.isPending && <Download aria-hidden="true" />}
              Export CSV
            </Button>
          </Gate>
        }
      />

      <section aria-label={`Summary, ${rangeLabel(range)}`} className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard className="p-4" loading={summary.isPending} label="Total events" icon={<FileClock />} value={sv(s?.total)} footnote={summary.isError ? 'Unavailable' : rangeLabel(range)} />
        <StatCard className="p-4" loading={summary.isPending} label="Sign-ins" icon={<LogIn />} value={sv(s?.signIns)} footnote="Successful" />
        <StatCard className="p-4" loading={summary.isPending} label="Failed sign-ins" icon={<UserX />} value={sv(s?.failedSignIns, true)} footnote="Wrong password or unknown account" />
        <StatCard className="p-4" loading={summary.isPending} label="Changes" icon={<Pencil />} value={sv(s?.changes)} footnote="Created, edited or deleted" />
        <StatCard className="p-4" loading={summary.isPending} label="Exports" icon={<Download />} value={sv(s?.exports)} footnote="Files taken out" />
        <StatCard className="p-4" loading={summary.isPending} label="Access denied" icon={<Ban />} value={sv(s?.denied, true)} footnote="Blocked requests" />
        <StatCard className="p-4" loading={summary.isPending} label="Active users" icon={<Users />} value={sv(s?.activeUsers)} footnote="Distinct people" />
      </section>

      <div className="mb-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">{toolbar}</div>
        {chips}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="font-figure text-[13px] text-muted-foreground" aria-live="polite">
          {resultCount}
        </p>
        <ViewToggle value={view} onChange={setView} />
      </div>

      {view === 'table' ? (
        <DataTable<AuditEntry>
          id="audit"
          caption="Audit log entries"
          columns={columns}
          data={tableItems}
          total={table.data?.total ?? 0}
          state={pagingState}
          getRowId={(e) => String(e.id)}
          loading={table.isPending}
          fetching={table.isFetching}
          error={table.error}
          onRetry={() => void table.refetch()}
          onRowClick={openEntry}
          rowClassName={(e) => (e.id === entryId ? 'bg-primary-subtle/50' : undefined)}
          noun={{ singular: 'entry', plural: 'entries' }}
          maxHeight="max(28rem, calc(100dvh - 11rem))"
          pageSizeOptions={[25, 50, 100]}
          emptyState={<EmptyState bare icon={<FileClock />} title="No activity recorded in this period" description="Pick a longer date range to look further back." />}
        />
      ) : (
        <AuditTimeline
          entries={timelineItems}
          total={total}
          loading={timeline.isPending}
          error={timeline.error}
          onRetry={() => void timeline.refetch()}
          hasNext={Boolean(timeline.hasNextPage)}
          loadingMore={timeline.isFetchingNextPage}
          onLoadMore={() => void timeline.fetchNextPage()}
          selectedId={entryId}
          onOpen={openEntry}
          filtered={hasFilters}
          onClearFilters={resetAll}
        />
      )}

      <AuditDetailSheet entry={current ?? (entryId ? lastEntry.current : null)} open={entryId !== null} onOpenChange={(o) => !o && openEntry(null)} />
    </>
  );
}
