import { Link } from 'react-router-dom';
import { ArrowUpRight, Building2 } from 'lucide-react';
import type { Dashboard } from '@nacta/shared';
import { cn } from '../../lib/utils';
import { ORG_UNIT } from '../../lib/terms';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';
import { Skeleton } from '../../components/ui/skeleton';
import { dailyHref, sharePct, SERIES, type SeriesKey } from './dashboard-ui';

type Row = Dashboard['byWing'][number];

const valueOf = (w: Row, k: SeriesKey): number => (k === 'leave' ? w.onLeave : w[k]);

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5" aria-label="Legend">
      {SERIES.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn('size-2 rounded-full', s.dot)} aria-hidden="true" />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function WingRow({ w, selected }: { w: Row; selected: boolean }) {
  const total = Math.max(w.headcount, 1);
  const summary = SERIES.map((s) => `${valueOf(w, s.key)} ${s.label.toLowerCase()}`).join(', ');
  return (
    <li>
      <Link
        to={dailyHref(undefined, w.wingId)}
        aria-label={`${w.wingName}: ${w.headcount} employees, ${summary}. Open daily attendance for this ${ORG_UNIT.lower}.`}
        className={cn(
          '-mx-2 block rounded-md px-2 py-2 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          selected && 'bg-primary-subtle/60',
        )}
      >
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-[13px] font-medium">{w.wingName}</span>
          <span className="font-figure shrink-0 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{sharePct(w.present + w.late, w.headcount)}%</span> in {'·'} {w.headcount.toLocaleString()} staff
          </span>
        </div>
        <div className="flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-muted" role="img" aria-label={summary}>
          {SERIES.map((s) => {
            const v = valueOf(w, s.key);
            return v > 0 ? <span key={s.key} className={cn('h-full min-w-[3px] first:rounded-l-full last:rounded-r-full', s.bar)} style={{ width: `${(v / total) * 100}%` }} title={`${s.label}: ${v}`} /> : null;
          })}
        </div>
        <ul className="font-figure mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground" aria-hidden="true">
          {SERIES.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-1">
              <span className={cn('size-1.5 rounded-full', s.dot)} />
              <span className={cn(valueOf(w, s.key) > 0 && 'font-medium text-foreground')}>{valueOf(w, s.key).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </Link>
    </li>
  );
}

/** One stacked bar per wing: present / late / leave / absent / not in yet. */
export function WingBars({ rows, loading, selectedWing, className }: { rows?: Row[]; loading?: boolean; selectedWing: string | null; className?: string }) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <div>
          <CardTitle>Today by {ORG_UNIT.lower}</CardTitle>
          <CardDescription>Select a {ORG_UNIT.lower} to see its employees.</CardDescription>
        </div>
        <span className="hidden sm:block" aria-hidden="true">
          <ArrowUpRight className="size-4 text-muted-foreground" />
        </span>
      </CardHeader>
      <CardContent className="flex-1 space-y-4 pt-4">
        <Legend />
        {loading || !rows ? (
          <div className="space-y-5" aria-busy="true" aria-label="Loading wings">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-2.5 w-full rounded-full" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState bare icon={<Building2 />} title={`No ${ORG_UNIT.lowerPlural} yet`} description="Wings appear here once employees are assigned." />
        ) : (
          <ul className="space-y-1.5">
            {rows.map((w) => (
              <WingRow key={w.wingId ?? 'none'} w={w} selected={selectedWing !== null && String(w.wingId) === selectedWing} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
