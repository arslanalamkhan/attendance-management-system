import * as React from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowUpRight, History } from 'lucide-react';
import type { AuditEntry, AuditQuery } from '@nacta/shared';
import { listAudit } from '../../lib/endpoints/audit';
import { qk } from '../../lib/query-keys';
import { actionLabel } from '../../lib/audit-ui';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/empty-state';
import { ErrorState } from '../ui/error-state';
import { Skeleton } from '../ui/skeleton';
import { AnonymousLabel, ActionTile, OutcomePill, Stamp } from './audit-bits';
import { AuditDetailSheet } from './audit-detail-sheet';
import { useRowNav } from './use-row-nav';

export type ActivityFilter = Omit<AuditQuery, 'page' | 'pageSize' | 'sort' | 'order'>;

export interface ActivityFeedProps {
  /** Which entries to show, e.g. `{ entityType: 'employee', entityId: '273' }` or `{ userId: 4 }`. */
  filter: ActivityFilter;
  /** Entries per "Load more" (default 15). */
  pageSize?: number;
  /** Hide the user (when every entry is by the same person) or the subject (when every entry is about the same thing). */
  hide?: 'user' | 'subject';
  emptyTitle?: string;
  emptyDescription?: string;
  /** Show the "Open in audit log" link (default true). */
  showAuditLink?: boolean;
  className?: string;
}

function auditLinkFor(filter: ActivityFilter): string {
  const sp = new URLSearchParams({ range: 'all' });
  if (filter.userId) sp.set('userId', String(filter.userId));
  if (filter.entityType) sp.set('entityType', filter.entityType);
  if (filter.entityId) sp.set('entityId', filter.entityId);
  return `/admin/audit?${sp}`;
}

function FeedSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading activity">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-7 shrink-0 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

function FeedRow({ entry, hide, onOpen }: { entry: AuditEntry; hide?: 'user' | 'subject'; onOpen: (e: AuditEntry) => void }) {
  const who = entry.userName ?? entry.userEmail ?? AnonymousLabel;
  const parts: React.ReactNode[] = [];
  if (hide !== 'user') parts.push(<span key="u" className={cn(!entry.userName && !entry.userEmail && 'italic')}>{who}</span>);
  if (hide !== 'subject' && entry.entityLabel) parts.push(<span key="s" className="truncate">on {entry.entityLabel}</span>);
  return (
    <li>
      <button
        type="button"
        data-audit-row
        onClick={() => onOpen(entry)}
        className="group flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ActionTile action={entry.action} category={entry.category} size="sm" className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[13px] font-medium">{actionLabel(entry.action)}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              <Stamp iso={entry.at} className="text-[11.5px]" />
            </span>
          </span>
          <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted-foreground">{entry.summary}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {parts.map((p, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span aria-hidden="true">·</span>}
                {p}
              </React.Fragment>
            ))}
            {entry.outcome !== 'success' && <OutcomePill outcome={entry.outcome} className="ml-1" />}
          </span>
        </span>
      </button>
    </li>
  );
}

/** Compact, infinitely loadable timeline of audit entries for one object or one person. Needs audit.view. */
export function ActivityFeed({
  filter,
  pageSize = 15,
  hide,
  emptyTitle = 'No recorded activity',
  emptyDescription = 'Nothing has been logged for this yet.',
  showAuditLink = true,
  className,
}: ActivityFeedProps) {
  const [selected, setSelected] = React.useState<AuditEntry | null>(null);
  const [open, setOpen] = React.useState(false);
  const onKeyDown = useRowNav();
  const query = useInfiniteQuery({
    queryKey: qk.audit.feed({ ...filter, pageSize }),
    queryFn: ({ pageParam, signal }) => listAudit({ ...filter, page: pageParam, pageSize }, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;

  return (
    <div className={className}>
      {query.isPending ? (
        <FeedSkeleton />
      ) : query.isError ? (
        <ErrorState bare error={query.error} title="Could not load activity" onRetry={() => void query.refetch()} retrying={query.isFetching} className="py-8" />
      ) : items.length === 0 ? (
        <EmptyState bare icon={<History />} title={emptyTitle} description={emptyDescription} className="py-8" />
      ) : (
        <>
          <ul className="-mx-2 space-y-0.5" onKeyDown={onKeyDown} aria-label="Activity">
            {items.map((e) => (
              <FeedRow
                key={e.id}
                entry={e}
                hide={hide}
                onOpen={(entry) => {
                  setSelected(entry);
                  setOpen(true);
                }}
              />
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <p className="font-figure text-xs text-muted-foreground" aria-live="polite">
              Showing {items.length.toLocaleString()} of {total.toLocaleString()}
            </p>
            <div className="flex items-center gap-2">
              {showAuditLink && (
                <Button asChild variant="ghost" size="sm">
                  <Link to={auditLinkFor(filter)}>
                    Open in audit log
                    <ArrowUpRight aria-hidden="true" />
                  </Link>
                </Button>
              )}
              {query.hasNextPage && (
                <Button type="button" variant="secondary" size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                  Load more
                </Button>
              )}
            </div>
          </div>
        </>
      )}
      <AuditDetailSheet entry={selected} open={open} onOpenChange={setOpen} />
    </div>
  );
}
