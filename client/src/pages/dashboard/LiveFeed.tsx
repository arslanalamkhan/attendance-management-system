import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CircleHelp, Fingerprint } from 'lucide-react';
import type { Dashboard } from '@nacta/shared';
import { VerifyTypeLabel } from '@nacta/shared';
import { cn } from '../../lib/utils';
import { useReducedMotion } from '../../hooks/use-reduced-motion';
import { useAuth } from '../../lib/auth';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { EmployeeAvatar } from '../../components/ui/employee-avatar';
import { EmptyState } from '../../components/ui/empty-state';
import { Skeleton } from '../../components/ui/skeleton';
import { Tooltip } from '../../components/ui/tooltip';
import { MethodIcon } from '../attendance/punch-cells';
import { clockOf } from './dashboard-ui';

type Punch = Dashboard['liveFeed'][number];

function PunchRow({ p, fresh }: { p: Punch; fresh: boolean }) {
  const known = p.employeeId !== null && p.name !== null;
  const method = p.verifyType !== null ? (VerifyTypeLabel[p.verifyType] ?? `Method ${p.verifyType}`) : 'Unknown method';
  const who = (
    <>
      {known ? (
        <EmployeeAvatar employee={{ id: p.employeeId, name: p.name ?? p.empCode, hasPhoto: p.hasPhoto }} size="sm" />
      ) : (
        <span className="grid size-8 shrink-0 place-content-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
          <CircleHelp className="size-4" />
        </span>
      )}
      <span className="min-w-0 leading-tight">
        <span className={cn('block truncate text-[13px] font-medium', !known && 'italic text-muted-foreground')}>{known ? p.name : `Unknown PIN ${p.empCode}`}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {known ? [p.wingName, p.empCode].filter(Boolean).join(' · ') : 'Not linked to an employee'}
        </span>
      </span>
    </>
  );
  return (
    <li className={cn('-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors [transition-duration:2200ms] ease-out', fresh ? 'bg-primary-subtle' : 'bg-transparent')}>
      {known ? (
        <Link to={`/employees/${p.employeeId}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {who}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{who}</div>
      )}
      <div className="shrink-0 text-right leading-tight">
        <p className="font-mono text-[13px] font-medium tabular-nums">{clockOf(p.time)}</p>
        <p className="mt-0.5 flex items-center justify-end gap-1 text-xs text-muted-foreground">
          <Tooltip content={method}>
            <span className="inline-flex" tabIndex={0} aria-label={method}>
              <MethodIcon verifyType={p.verifyType} className="size-3.5" />
            </span>
          </Tooltip>
          <span className="max-w-[8.5rem] truncate">{p.deviceName}</span>
        </p>
      </div>
    </li>
  );
}

/** Latest punches today. New arrivals on refresh flash briefly (unless the user prefers reduced motion). */
export function LiveFeed({ items, loading, className }: { items?: Punch[]; loading?: boolean; className?: string }) {
  const { can } = useAuth();
  const reduced = useReducedMotion();
  const seen = React.useRef<Set<number> | null>(null);
  const [fresh, setFresh] = React.useState<Set<number>>(() => new Set());
  const [announce, setAnnounce] = React.useState('');

  React.useEffect(() => {
    if (!items) return;
    const prev = seen.current;
    seen.current = new Set(items.map((i) => i.id));
    if (!prev) return;
    const added = items.filter((i) => !prev.has(i.id)).map((i) => i.id);
    if (added.length === 0) return;
    setAnnounce(`${added.length} new ${added.length === 1 ? 'punch' : 'punches'}`);
    if (reduced) return;
    setFresh(new Set(added));
    const t = window.setTimeout(() => setFresh(new Set()), 2400);
    return () => window.clearTimeout(t);
  }, [items, reduced]);

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            Live punches
            <span className="relative flex size-2" aria-hidden="true">
              <span className="absolute inset-0 rounded-full bg-success motion-safe:animate-status-ping" />
              <span className="relative size-2 rounded-full bg-success" />
            </span>
          </CardTitle>
          <CardDescription>Latest terminal activity today.</CardDescription>
        </div>
        {can('attendance.view') && (
          <Button asChild variant="ghost" size="sm">
            <Link to="/attendance">
              All punches
              <ArrowUpRight aria-hidden="true" />
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex-1 pt-3">
        <p className="sr-only" role="status" aria-live="polite">
          {announce}
        </p>
        {loading || !items ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading punches">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-8 w-16" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState bare icon={<Fingerprint />} title="No punches yet today" description="Punches appear here the moment a terminal reports them." />
        ) : (
          <ul className="-mx-2 max-h-[27rem] divide-y divide-border/60 overflow-y-auto overflow-x-hidden px-2">
            {items.map((p) => (
              <PunchRow key={p.id} p={p} fresh={fresh.has(p.id)} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
