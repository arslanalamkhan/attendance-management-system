import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarOff, UserCheck, UserRoundX, Users } from 'lucide-react';
import { getTodaySummary } from '../../lib/endpoints/reports';
import { qk } from '../../lib/query-keys';
import { useAuth } from '../../lib/auth';
import { NAV } from '../../lib/nav';
import { parseYmd } from '../../lib/dates';
import { usePageMeta } from '../../hooks/use-page-meta';
import { Card } from '../../components/ui/card';
import { ErrorState } from '../../components/ui/error-state';
import { PageHeader } from '../../components/ui/page-header';
import { StatCard } from '../../components/ui/stat-card';

const longFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const pctOf = (n: number, total: number) => (total > 0 ? `${Math.round((n / total) * 100)}% of employees` : undefined);

/**
 * The home page of roles without "View dashboard": today's four headline numbers for the wings of the user's roles,
 * and shortcuts to the pages their roles can open.
 */
export default function SimpleDashboard() {
  usePageMeta({ title: 'Today' });
  const { can, user } = useAuth();
  const q = useQuery({ queryKey: qk.dashboardToday(), queryFn: ({ signal }) => getTodaySummary(signal), refetchInterval: 60_000 });
  const d = q.data;
  const loading = q.isPending;
  const pages = NAV.flatMap((g) => g.items).filter((i) => !i.soon && i.to !== '/' && (!i.perm || i.perm.some((p) => can(p))));

  return (
    <>
      <PageHeader
        title={`Welcome${user ? `, ${user.name.split(' ')[0]}` : ''}`}
        description={d ? `Attendance today, ${longFmt.format(parseYmd(d.date))}. Updates every minute.` : 'Attendance today.'}
      />
      {q.isError ? (
        <ErrorState title="Today's numbers are unavailable" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : (
        <section aria-label="Today" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard loading={loading} label="Total employees" value={d?.total ?? 0} icon={<Users />} tone="primary" footnote={d && d.dayOff > 0 ? `${d.dayOff} on a holiday or day off today` : 'Active employees in your wings'} alwaysFootnote />
          <StatCard loading={loading} label="Present" value={d?.present ?? 0} icon={<UserCheck />} tone="success" footnote={d ? pctOf(d.present, d.total) : undefined} alwaysFootnote />
          <StatCard loading={loading} label="On leave" value={d?.onLeave ?? 0} icon={<CalendarOff />} tone="info" footnote={d ? pctOf(d.onLeave, d.total) : undefined} alwaysFootnote />
          <StatCard loading={loading} label="Absent / not yet recorded" value={d?.notRecorded ?? 0} icon={<UserRoundX />} tone="danger" footnote="No punch and no leave so far today" alwaysFootnote />
        </section>
      )}

      {pages.length > 0 && (
        <section aria-label="Your pages" className="mt-8">
          <h2 className="mb-3 text-sm font-semibold tracking-tight">Your pages</h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pages.map((p) => {
              const Icon = p.icon;
              return (
                <li key={p.to}>
                  <Card className="group transition-[box-shadow,border-color] duration-150 focus-within:ring-2 focus-within:ring-ring hover:border-border-strong hover:shadow-sm">
                    <Link to={p.to} className="flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium focus-visible:outline-none">
                      <span className="grid size-8 place-content-center rounded-md bg-primary-subtle text-primary-text [&_svg]:size-4" aria-hidden="true">
                        <Icon />
                      </span>
                      {p.label}
                      <ArrowRight className="ml-auto size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" aria-hidden="true" />
                    </Link>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
