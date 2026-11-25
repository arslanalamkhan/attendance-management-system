import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Info, RefreshCw, UserPlus } from 'lucide-react';
import { qk } from '../lib/query-keys';
import { useAuth } from '../lib/auth';
import { isApiError } from '../lib/api';
import { getDashboard } from '../lib/endpoints/reports';
import { parseYmd } from '../lib/dates';
import { ORG_UNIT } from '../lib/terms';
import { relativeTime } from '../lib/time';
import { useNow } from '../hooks/use-now';
import { usePageMeta } from '../hooks/use-page-meta';
import { RecentSecurityCard } from '../components/audit/recent-security-card';
import { DataTableFilterSelect } from '../components/data-table/toolbar';
import { TimingSetupBanner } from '../components/rules/setup-banner';
import { Button } from '../components/ui/button';
import { PageHeader } from '../components/ui/page-header';
import { KpiRow } from './dashboard/KpiRow';
import { LiveFeed } from './dashboard/LiveFeed';
import { OverviewFallback } from './dashboard/OverviewFallback';
import { DevicesCard, LateMostOften, OnLeaveToday } from './dashboard/PeopleCards';
import { TrendCard } from './dashboard/TrendCard';
import { WingBars } from './dashboard/WingBars';
import { todayCounts } from './dashboard/dashboard-ui';

const REFRESH_MS = 60_000;
const dateFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** "Updated 12s ago": the only part of the page that ticks every second. */
function UpdatedAgo({ at }: { at: number }) {
  const now = useNow();
  if (!at) return null;
  return <span>Updated {relativeTime(new Date(at).toISOString(), now)}</span>;
}

export default function DashboardPage() {
  usePageMeta({ title: 'Dashboard' });
  const { can, user } = useAuth();
  const [params, setParams] = useSearchParams();

  const dash = useQuery({
    queryKey: qk.dashboard(),
    queryFn: ({ signal }) => getDashboard(signal),
    refetchInterval: REFRESH_MS,
    // A server without /dashboard (404) or a contract mismatch should fall back quickly, not retry for seconds.
    retry: (count, e) => !(isApiError(e) && (e.status === 404 || e.status === 403 || e.code === 'CONTRACT_MISMATCH')) && count < 1,
  });
  const d = dash.data;
  const fallback = dash.isError && !d;

  const wingParam = params.get('wing');
  const wingKey = d && wingParam && d.byWing.some((w) => String(w.wingId) === wingParam) ? wingParam : null;
  const wingRow = wingKey && d ? d.byWing.find((w) => String(w.wingId) === wingKey) : undefined;
  const wingId = wingRow?.wingId ?? null;
  const multiWing = (d?.byWing.length ?? 0) > 1;

  const counts = React.useMemo(() => (d ? todayCounts(d, wingKey) : undefined), [d, wingKey]);
  const feed = React.useMemo(() => (d ? (wingRow ? d.liveFeed.filter((p) => p.wingName === wingRow.wingName) : d.liveFeed) : undefined), [d, wingRow]);
  const topLate = React.useMemo(() => (d ? (wingRow ? d.topLate.filter((p) => p.wingName === wingRow.wingName) : d.topLate) : undefined), [d, wingRow]);

  const setWing = (v: string | undefined) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v) next.set('wing', v);
        else next.delete('wing');
        return next;
      },
      { replace: true },
    );

  const refreshing = dash.isFetching && !dash.isPending;
  const name = user?.name ?? '';

  const actions = (
    <>
      {multiWing && d && (
        <DataTableFilterSelect
          label={ORG_UNIT.singular}
          value={wingKey ?? undefined}
          onChange={setWing}
          options={d.byWing.filter((w) => w.wingId !== null).map((w) => ({ value: String(w.wingId), label: w.wingName }))}
          allLabel={`All ${ORG_UNIT.lowerPlural}`}
        />
      )}
      <Button variant="secondary" size="sm" onClick={() => void dash.refetch()} loading={refreshing} aria-label="Refresh the dashboard">
        {!refreshing && <RefreshCw aria-hidden="true" />}
        Refresh
      </Button>
      {can('employees.manage') && (
        <Button asChild size="sm">
          <Link to="/employees?new=1">
            <UserPlus aria-hidden="true" />
            Add employee
          </Link>
        </Button>
      )}
    </>
  );

  const description = (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>{d ? dateFmt.format(parseYmd(d.date)) : dateFmt.format(new Date())}</span>
      {!fallback && (
        <span className="inline-flex items-center gap-2 text-xs">
          <span className="relative flex size-2" aria-hidden="true">
            <span className="absolute inset-0 rounded-full bg-success motion-safe:animate-status-ping" />
            <span className="relative size-2 rounded-full bg-success" />
          </span>
          Live {'·'} refreshes every minute {'·'} <UpdatedAgo at={dash.dataUpdatedAt} />
        </span>
      )}
    </span>
  );

  return (
    <>
      <PageHeader title={`${greeting(new Date().getHours())}${name ? `, ${name}` : ''}`} description={description} actions={actions} />
      <TimingSetupBanner />

      {fallback ? (
        <>
          <div role="status" className="mb-5 flex flex-col gap-2 rounded-lg border bg-muted/40 px-4 py-3 sm:flex-row sm:items-center">
            <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="flex-1 text-[13px] text-muted-foreground">
              {dash.isPending
                ? 'Loading the dashboard...'
                : isApiError(dash.error) && dash.error.status === 404
                  ? "The executive dashboard isn't available from the server yet, so the basic overview is shown."
                  : `The executive dashboard could not be loaded (${dash.error instanceof Error ? dash.error.message : 'unknown error'}). Showing the basic overview instead.`}
            </p>
            <Button variant="ghost" size="sm" onClick={() => void dash.refetch()} loading={dash.isFetching}>
              Try again
            </Button>
          </div>
          <OverviewFallback enabled />
        </>
      ) : (
        <div className="space-y-4">
          <KpiRow counts={counts} trend={d?.trend} wingId={wingId} loading={dash.isPending} />
          {wingRow && (
            <p className="text-xs text-muted-foreground" role="status">
              Showing {wingRow.wingName}: figures, punches and late list are filtered; the trend, leave and devices cover all {ORG_UNIT.lowerPlural}.
            </p>
          )}

          <div className="grid gap-4 xl:grid-cols-12">
            <WingBars className="xl:col-span-5" rows={d?.byWing} loading={dash.isPending} selectedWing={wingKey} />
            <TrendCard className="xl:col-span-7" trend={d?.trend} loading={dash.isPending} />

            <LiveFeed className="xl:col-span-4" items={feed} loading={dash.isPending} />
            <LateMostOften className="xl:col-span-4" items={topLate} loading={dash.isPending} />
            <OnLeaveToday className="xl:col-span-4" items={d?.onLeaveToday} total={counts?.leave} wingId={wingId} loading={dash.isPending} />

            <DevicesCard className={can('audit.view') ? 'xl:col-span-5' : 'xl:col-span-12'} devices={d?.devices} loading={dash.isPending} />
            {can('audit.view') && <RecentSecurityCard className="xl:col-span-7" />}
          </div>
        </div>
      )}
    </>
  );
}
