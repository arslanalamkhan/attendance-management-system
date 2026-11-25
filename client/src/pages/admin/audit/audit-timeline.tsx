import * as React from 'react';
import { History, SearchX } from 'lucide-react';
import type { AuditEntry } from '@nacta/shared';
import { actionLabel, dayHeading, dayKeyOf, formatStamp } from '../../../lib/audit-ui';
import { relativeTime } from '../../../lib/time';
import { cn } from '../../../lib/utils';
import { ActionTile, AnonymousLabel, OutcomePill, SubjectCell, UserCell } from '../../../components/audit/audit-bits';
import { useRowNav } from '../../../components/audit/use-row-nav';
import { Button } from '../../../components/ui/button';
import { EmptyState } from '../../../components/ui/empty-state';
import { ErrorState } from '../../../components/ui/error-state';
import { Skeleton } from '../../../components/ui/skeleton';
import { Tooltip } from '../../../components/ui/tooltip';

interface TimelineProps {
  entries: AuditEntry[];
  total: number;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  hasNext: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  selectedId: number | null;
  onOpen: (e: AuditEntry) => void;
  filtered: boolean;
  onClearFilters: () => void;
}

function Row({ entry, selected, onOpen }: { entry: AuditEntry; selected: boolean; onOpen: (e: AuditEntry) => void }) {
  const time = formatStamp(entry.at).split(', ')[1];
  const who = entry.userName ?? entry.userEmail ?? AnonymousLabel;
  return (
    <li className="group relative">
      <button
        type="button"
        data-audit-row
        aria-label={`${actionLabel(entry.action)}: ${entry.summary}. ${who}, ${formatStamp(entry.at)}. Open details`}
        aria-current={selected ? 'true' : undefined}
        onClick={() => onOpen(entry)}
        className={cn(
          'absolute inset-0 z-0 transition-colors hover:bg-muted/60 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          selected && 'bg-primary-subtle/60 hover:bg-primary-subtle',
        )}
      />
      <div className="pointer-events-none relative z-[1] flex items-start gap-3 px-3 py-2.5 sm:px-4">
        <Tooltip content={`${relativeTime(entry.at)} · ${formatStamp(entry.at)}`} side="top">
          <time dateTime={entry.at} className="pointer-events-auto mt-1 hidden w-[4.25rem] shrink-0 cursor-default font-mono text-xs tabular-nums text-muted-foreground sm:block">
            {time}
          </time>
        </Tooltip>
        <ActionTile action={entry.action} category={entry.category} size="sm" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13px] font-medium">{actionLabel(entry.action)}</span>
            {entry.outcome !== 'success' && <OutcomePill outcome={entry.outcome} />}
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground sm:hidden">{time}</span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{entry.summary}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground md:hidden">
            <span className={cn(!entry.userName && !entry.userEmail && 'italic')}>{who}</span>
            {entry.ip && <span className="font-mono">{entry.ip}</span>}
          </div>
        </div>
        <div className="hidden w-56 shrink-0 space-y-1 text-[13px] lg:block">
          {entry.entityType && <SubjectCell entry={entry} className="pointer-events-auto" />}
        </div>
        <div className="hidden w-44 shrink-0 space-y-0.5 md:block">
          <UserCell entry={entry} />
          {entry.ip && <p className="pl-8 font-mono text-[11px] text-muted-foreground">{entry.ip}</p>}
        </div>
      </div>
    </li>
  );
}

function TimelineSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading audit entries">
      {[0, 1].map((g) => (
        <div key={g} className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <div className="divide-y rounded-lg border bg-card">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3">
                <Skeleton className="mt-1 hidden h-3.5 w-14 sm:block" />
                <Skeleton className="size-7 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-1/4" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Entries grouped by day with sticky day headers. Compact rows, keyboard navigable (Up/Down, j/k, Home/End). */
export function AuditTimeline({ entries, total, loading, error, onRetry, hasNext, loadingMore, onLoadMore, selectedId, onOpen, filtered, onClearFilters }: TimelineProps) {
  const onKeyDown = useRowNav();
  const groups = React.useMemo(() => {
    const out: { key: string; items: AuditEntry[] }[] = [];
    for (const e of entries) {
      const key = dayKeyOf(e.at);
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(e);
      else out.push({ key, items: [e] });
    }
    return out;
  }, [entries]);

  if (loading) return <TimelineSkeleton />;
  if (error && entries.length === 0) return <ErrorState error={error} title="Could not load the audit log" onRetry={onRetry} />;
  if (entries.length === 0) {
    return filtered ? (
      <EmptyState
        icon={<SearchX />}
        title="No entries match these filters"
        description="Try a wider date range, another user, or clear the filters."
        action={
          <Button variant="secondary" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        }
      />
    ) : (
      <EmptyState icon={<History />} title="No activity recorded in this period" description="Pick a longer date range to look further back." />
    );
  }

  return (
    <div onKeyDown={onKeyDown} className="space-y-5">
      {groups.map((g) => (
        <section key={g.key} aria-label={dayHeading(g.key)}>
          <h3 className="sticky top-0 z-10 -mx-1 mb-2 flex items-baseline gap-2 border-b bg-background/95 px-1 py-2 text-[13px] font-semibold backdrop-blur">
            {dayHeading(g.key)}
            <span className="font-figure text-xs font-normal text-muted-foreground">
              {g.items.length} {g.items.length === 1 ? 'entry' : 'entries'}
            </span>
          </h3>
          <ul className="divide-y overflow-hidden rounded-lg border bg-card shadow-xs">
            {g.items.map((e) => (
              <Row key={e.id} entry={e} selected={e.id === selectedId} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2">
        <p className="font-figure text-xs text-muted-foreground" aria-live="polite">
          Showing {entries.length.toLocaleString()} of {total.toLocaleString()} entries
        </p>
        {hasNext && (
          <Button variant="secondary" size="sm" loading={loadingMore} onClick={onLoadMore}>
            Load more
          </Button>
        )}
      </div>
    </div>
  );
}
