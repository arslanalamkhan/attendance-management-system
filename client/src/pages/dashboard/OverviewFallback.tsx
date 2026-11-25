import { Link } from 'react-router-dom';
import type { Permission } from '@nacta/shared';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, Cpu, Fingerprint, UserCheck, UserPlus, Users } from 'lucide-react';
import { qk } from '../../lib/query-keys';
import { useAuth } from '../../lib/auth';
import { getOverview } from '../../lib/endpoints';
import { parseYmd } from '../../lib/dates';
import { AreaTrendChart, type TrendPoint } from '../../components/charts/area-trend-chart';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { ErrorState } from '../../components/ui/error-state';
import { Skeleton } from '../../components/ui/skeleton';
import { StatCard } from '../../components/ui/stat-card';

const shortFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const longFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

/** The basic overview cards: shown while the server cannot yet serve the executive dashboard. */
export function OverviewFallback({ enabled }: { enabled: boolean }) {
  const { can } = useAuth();
  const overview = useQuery({
    queryKey: qk.overview(),
    queryFn: ({ signal }) => getOverview(signal),
    refetchInterval: 30_000,
    enabled,
  });
  const { data, isPending, isError, error, isFetching, refetch } = overview;

  if (isError) return <ErrorState title="Overview unavailable" error={error} onRetry={() => void refetch()} retrying={isFetching} />;

  const series = data?.dailyPresence ?? [];
  const today = data?.today;
  const active = data?.employees.active ?? 0;
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const todayIsLast = Boolean(today && last && last.date === today.date);
  const delta = todayIsLast && last && prev ? last.present - prev.present : null;
  const pct = today && active > 0 ? Math.round((today.present / active) * 100) : null;
  const chartData: TrendPoint[] = series.map((d) => ({
    label: shortFmt.format(parseYmd(d.date)),
    fullLabel: longFmt.format(parseYmd(d.date)),
    value: d.present,
  }));

  return (
    <>
      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          loading={isPending}
          label="Devices online"
          icon={<Cpu />}
          value={data?.devices.online ?? 0}
          unit={data ? `of ${data.devices.total}` : undefined}
          footnote={data ? (data.devices.total === 0 ? 'No devices registered yet' : data.devices.online === data.devices.total ? 'All devices reporting' : `${data.devices.total - data.devices.online} not reporting`) : undefined}
        />
        <StatCard loading={isPending} label="Employees" icon={<Users />} value={data?.employees.total.toLocaleString() ?? 0} footnote={data ? `${data.employees.active.toLocaleString()} active` : undefined} />
        <StatCard
          loading={isPending}
          label="Present today"
          icon={<UserCheck />}
          value={today?.present.toLocaleString() ?? 0}
          unit={data ? `of ${active.toLocaleString()}` : undefined}
          delta={delta !== null ? { value: delta, label: 'vs yesterday' } : undefined}
          footnote={pct !== null ? `${pct}% of active staff` : undefined}
          sparkline={series.map((d) => d.present)}
        />
        <StatCard loading={isPending} label="Punches today" icon={<Fingerprint />} value={today?.punches.toLocaleString() ?? 0} footnote="Raw device punches received" />
      </section>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Presence, last 14 days</CardTitle>
              <CardDescription>Employees with at least one punch each day.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {isPending ? <Skeleton className="h-[260px] w-full" /> : <AreaTrendChart data={chartData} seriesLabel="Present" ariaLabel="Employees present per day over the last 14 days" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Quick actions</CardTitle>
              <CardDescription>Common jobs, one click away.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-1 pt-3">
            {[
              { to: '/employees?new=1', perm: 'employees.manage', icon: <UserPlus />, label: 'Add an employee', hint: 'Create a record and push to devices' },
              { to: '/attendance', perm: 'attendance.view', icon: <CalendarCheck />, label: 'Browse attendance records', hint: 'Search and filter raw punches' },
              { to: '/devices', perm: 'devices.view', icon: <Cpu />, label: 'Manage devices', hint: 'Status, users and commands' },
            ]
              .filter((a) => can(a.perm as Permission))
              .map((a) => (
                <Link
                  key={a.to}
                  to={a.to}
                  className="group flex items-center gap-3 rounded-md p-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="grid size-9 shrink-0 place-content-center rounded-md border bg-card text-muted-foreground shadow-xs transition-colors group-hover:text-primary-text [&_svg]:size-4" aria-hidden="true">
                    {a.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{a.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{a.hint}</span>
                  </span>
                </Link>
              ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
