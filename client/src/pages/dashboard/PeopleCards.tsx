import { Link } from 'react-router-dom';
import { ArrowUpRight, CalendarCheck2, Clock3, Cpu, ServerOff } from 'lucide-react';
import type { Dashboard } from '@nacta/shared';
import { cn } from '../../lib/utils';
import { relativeTime } from '../../lib/time';
import { useNow } from '../../hooks/use-now';
import { useAuth } from '../../lib/auth';
import { LeavePill } from '../../components/rules/pills';
import { Button } from '../../components/ui/button';
import { StatusPill } from '../../components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { EmployeeAvatar } from '../../components/ui/employee-avatar';
import { EmptyState } from '../../components/ui/empty-state';
import { Skeleton } from '../../components/ui/skeleton';
import { dailyHref } from './dashboard-ui';

function ListSkeleton({ rows = 5, label }: { rows?: number; label: string }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-5 w-14" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
export function LateMostOften({ items, loading, className }: { items?: Dashboard['topLate']; loading?: boolean; className?: string }) {
  const max = Math.max(1, ...(items ?? []).map((i) => i.lateDays));
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <div>
          <CardTitle>Late most often</CardTitle>
          <CardDescription>Most late days in the last 30 days.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex-1 pt-3">
        {loading || !items ? (
          <ListSkeleton label="Loading late comers" />
        ) : items.length === 0 ? (
          <EmptyState bare icon={<Clock3 />} title="No late arrivals" description="Nobody has been late in the last 30 days." />
        ) : (
          <ol className="divide-y divide-border/60">
            {items.map((p, i) => (
              <li key={p.employeeId}>
                <Link
                  to={`/employees/${p.employeeId}?tab=attendance`}
                  className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="font-figure w-4 shrink-0 text-center text-xs font-medium text-muted-foreground" aria-hidden="true">
                    {i + 1}
                  </span>
                  <EmployeeAvatar employee={{ id: p.employeeId, name: p.name, hasPhoto: p.hasPhoto }} size="sm" />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[13px] font-medium">{p.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[p.wingName, p.empCode].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="w-24 shrink-0 text-right leading-tight">
                    <span className="font-figure block text-[13px] font-semibold">{p.lateDays} late {p.lateDays === 1 ? 'day' : 'days'}</span>
                    <span className="font-figure block text-xs text-muted-foreground">avg {p.avgLateMinutes}m</span>
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <span className="block h-full rounded-full bg-warning" style={{ width: `${(p.lateDays / max) * 100}%` }} />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
export function OnLeaveToday({ items, total, wingId, loading, className }: { items?: Dashboard['onLeaveToday']; total?: number; wingId: number | null; loading?: boolean; className?: string }) {
  const { can } = useAuth();
  const more = Math.max(0, (total ?? 0) - (items?.length ?? 0));
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <div>
          <CardTitle>On leave today</CardTitle>
          <CardDescription>{total !== undefined ? `${total.toLocaleString()} ${total === 1 ? 'person is' : 'people are'} away.` : 'Who is away, and why.'}</CardDescription>
        </div>
        {can('attendance.view') && (
          <Button asChild variant="ghost" size="sm">
            <Link to={dailyHref('leave', wingId)}>
              See all
              <ArrowUpRight aria-hidden="true" />
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex-1 pt-3">
        {loading || !items ? (
          <ListSkeleton label="Loading leave" />
        ) : items.length === 0 ? (
          <EmptyState bare icon={<CalendarCheck2 />} title="Everyone is available" description="Nobody is on leave today." />
        ) : (
          <>
            <ul className="divide-y divide-border/60">
              {items.map((p) => (
                <li key={p.employeeId}>
                  <Link
                    to={`/employees/${p.employeeId}?tab=attendance`}
                    className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <EmployeeAvatar employee={{ id: p.employeeId, name: p.name, hasPhoto: p.hasPhoto }} size="sm" />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-[13px] font-medium">{p.name}</span>
                      <span className="block font-mono text-xs text-muted-foreground">{p.empCode}</span>
                    </span>
                    <LeavePill code={p.code} name={p.typeName} color={p.color} />
                  </Link>
                </li>
              ))}
            </ul>
            {more > 0 && <p className="pt-2 text-center text-xs text-muted-foreground">and {more.toLocaleString()} more</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
function deviceTone(status: string): { tone: 'success' | 'danger' | 'neutral'; label: string } {
  if (status === 'online') return { tone: 'success', label: 'Online' };
  if (status === 'offline') return { tone: 'danger', label: 'Offline' };
  return { tone: 'neutral', label: 'Unknown' };
}

export function DevicesCard({ devices, loading, className }: { devices?: Dashboard['devices']; loading?: boolean; className?: string }) {
  const { can } = useAuth();
  const now = useNow();
  const online = devices?.filter((d) => d.status === 'online').length ?? 0;
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <div>
          <CardTitle>Devices</CardTitle>
          <CardDescription>{devices ? (devices.length === 0 ? 'No terminals registered.' : `${online} of ${devices.length} reporting.`) : 'Terminal health.'}</CardDescription>
        </div>
        {can('devices.view') && (
          <Button asChild variant="ghost" size="sm">
            <Link to="/devices">
              Manage
              <ArrowUpRight aria-hidden="true" />
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex-1 pt-3">
        {loading || !devices ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading devices">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-5 w-16" />
              </div>
            ))}
          </div>
        ) : devices.length === 0 ? (
          <EmptyState bare icon={<ServerOff />} title="No devices" description="Register a terminal to start receiving punches." />
        ) : (
          <ul className="divide-y divide-border/60">
            {devices.map((d) => {
              const s = deviceTone(d.status);
              const row = (
                <>
                  <span className="grid size-8 shrink-0 place-content-center rounded-md border bg-card text-muted-foreground [&_svg]:size-4" aria-hidden="true">
                    <Cpu />
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[13px] font-medium">{d.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">Last seen {relativeTime(d.lastSeenAt, now)}</span>
                  </span>
                  <StatusPill tone={s.tone} live={s.tone === 'success'}>
                    {s.label}
                  </StatusPill>
                </>
              );
              return (
                <li key={d.id}>
                  {can('devices.view') ? (
                    <Link to={`/devices/${d.id}`} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {row}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 py-2">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
