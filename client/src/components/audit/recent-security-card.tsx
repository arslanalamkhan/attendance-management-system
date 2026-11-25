import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import type { AuditEntry, AuditQuery } from '@nacta/shared';
import { listAudit } from '../../lib/endpoints/audit';
import { qk } from '../../lib/query-keys';
import { actionLabel } from '../../lib/audit-ui';
import { relativeTime } from '../../lib/time';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { EmptyState } from '../ui/empty-state';
import { ErrorState } from '../ui/error-state';
import { Skeleton } from '../ui/skeleton';
import { ActionTile, AnonymousLabel, OutcomePill } from './audit-bits';

const LIMIT = 5;
// The API filters on one category/outcome at a time, so "security OR denied OR failed" is three small queries merged here.
const QUERIES: AuditQuery[] = [
  { category: 'security', page: 1, pageSize: LIMIT },
  { outcome: 'denied', page: 1, pageSize: LIMIT },
  { outcome: 'failure', page: 1, pageSize: LIMIT },
];

/** Dashboard card: the five latest security-relevant entries. Render only for users with audit.view. */
export function RecentSecurityCard({ className }: { className?: string }) {
  const results = useQueries({
    queries: QUERIES.map((q) => ({
      queryKey: qk.audit.list(q),
      queryFn: ({ signal }: { signal: AbortSignal }) => listAudit(q, signal),
      refetchInterval: 60_000,
    })),
  });

  const pending = results.some((r) => r.isPending);
  const failed = results.find((r) => r.isError);
  const merged = new Map<number, AuditEntry>();
  for (const r of results) for (const e of r.data?.items ?? []) merged.set(e.id, e);
  const items = [...merged.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, LIMIT);

  return (
    <Card className={className}>
      <CardHeader>
        <div>
          <CardTitle>Recent security events</CardTitle>
          <CardDescription>Failed sign-ins, lockouts, denied requests and other security activity.</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/audit?category=security&range=30d">
            Audit log
            <ArrowUpRight aria-hidden="true" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="pt-2">
        {pending ? (
          <div className="space-y-4 pt-2" aria-busy="true" aria-label="Loading security events">
            {Array.from({ length: LIMIT }, (_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-7 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-1/4" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : failed && items.length === 0 ? (
          <ErrorState bare error={failed.error} title="Security events unavailable" onRetry={() => results.forEach((r) => void r.refetch())} className="py-8" />
        ) : items.length === 0 ? (
          <EmptyState bare icon={<ShieldCheck />} title="No security events" description="Nothing suspicious has been recorded." className="py-8" />
        ) : (
          <ul className="-mx-2 divide-y divide-border/60">
            {items.map((e) => (
              <li key={e.id}>
                <Link
                  to={`/admin/audit?entry=${e.id}&range=all`}
                  className="flex items-start gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ActionTile action={e.action} category={e.category} size="sm" className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[13px] font-medium">{actionLabel(e.action)}</span>
                      {e.outcome !== 'success' && <OutcomePill outcome={e.outcome} />}
                    </span>
                    <span className="mt-0.5 line-clamp-1 block text-[13px] text-muted-foreground">{e.summary}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      <span className={e.userName || e.userEmail ? undefined : 'italic'}>{e.userName ?? e.userEmail ?? AnonymousLabel}</span>
                      {e.ip && <span className="font-mono"> · {e.ip}</span>} · {relativeTime(e.at)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
