import * as React from 'react';
import { ChevronLeft, ChevronRight, SearchX } from 'lucide-react';
import type { ReportColumn, ReportResult } from '@nacta/shared';
import { cn } from '../../lib/utils';
import { useFitHeight } from '../../hooks/use-fit-height';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Skeleton } from '../../components/ui/skeleton';
import { alignClassOf, isPersonColumn, ReportCell, ReportLegend, textOf } from './report-cells';

export const TABLE_MAX_HEIGHT = 'calc(100dvh - 20rem)';

interface HeadCell {
  key: string;
  label: string;
  colSpan: number;
  rowSpan: number;
  /** Index of the first column this cell covers. */
  start: number;
  col?: ReportColumn;
}

/** Two header rows when any column has a group (consecutive columns with one group share a spanning cell). */
export function buildHeader(columns: ReportColumn[]): { top: HeadCell[]; bottom: HeadCell[]; grouped: boolean } {
  const grouped = columns.some((c) => c.group);
  if (!grouped) return { top: columns.map((c, n) => ({ key: c.key, label: c.label, colSpan: 1, rowSpan: 1, start: n, col: c })), bottom: [], grouped };
  const top: HeadCell[] = [];
  const bottom: HeadCell[] = [];
  let i = 0;
  while (i < columns.length) {
    const c = columns[i]!;
    if (!c.group) {
      top.push({ key: c.key, label: c.label, colSpan: 1, rowSpan: 2, start: i, col: c });
      i++;
      continue;
    }
    let j = i;
    while (j < columns.length && columns[j]!.group === c.group) j++;
    top.push({ key: `g-${c.group}-${i}`, label: c.group, colSpan: j - i, rowSpan: 1, start: i });
    for (let k = i; k < j; k++) bottom.push({ key: columns[k]!.key, label: columns[k]!.label, colSpan: 1, rowSpan: 1, start: k, col: columns[k] });
    i = j;
  }
  return { top, bottom, grouped };
}

export function RowsSkeleton({ cols, rows = 8 }: { cols: number; rows?: number }) {
  return (
    <tbody aria-busy="true">
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="border-b last:border-0">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className="px-3 py-3">
              <Skeleton className={cn('h-4', c === 0 ? 'w-40' : 'w-16')} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

/** Rows / page-size / prev-next below a report. */
export function ReportPager({ page, pageSize, total, onPage, onPageSize, fetching }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; onPageSize: (n: number) => void; fetching?: boolean }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Report pages" className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted-foreground">
      <p aria-live="polite">
        {total === 0 ? 'No rows' : (
          <>
            Showing <span className="font-figure font-medium text-foreground">{from.toLocaleString()}-{to.toLocaleString()}</span> of <span className="font-figure font-medium text-foreground">{total.toLocaleString()}</span> {total === 1 ? 'row' : 'rows'}
            {fetching ? ' · updating...' : ''}
          </>
        )}
      </p>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2">
          Rows per page
          <Select value={String(pageSize)} onValueChange={(v) => onPageSize(Number(v))}>
            <SelectTrigger aria-label="Rows per page" className="h-8 w-[4.5rem] px-2 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[25, 50, 100, 200, 500].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <span className="font-figure">
          Page {page} of {pages}
        </span>
        <div className="flex gap-1">
          <Button variant="secondary" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button variant="secondary" size="icon-sm" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    </nav>
  );
}

export function FetchBar({ active }: { active: boolean }) {
  return (
    <div className={cn('pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden', !active && 'hidden')} aria-hidden="true">
      <div className="h-full w-1/3 bg-primary motion-safe:animate-table-progress" />
    </div>
  );
}

/** Any ReportResult as a table, by column kind. Sticky header, pinned totals row, keyboard-scrollable. */
export function ReportTable({ result, loading, fetching }: { result?: ReportResult; loading?: boolean; fetching?: boolean }) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const fitted = useFitHeight(wrapRef);
  const columns = result?.columns ?? [];
  const head = React.useMemo(() => buildHeader(columns), [columns]);
  const rows = result?.rows ?? [];
  const th = 'bg-muted px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';
  const firstTextCol = columns[0]?.key;

  return (
    <>
      <div ref={wrapRef} className="relative rounded-lg border bg-card shadow-xs">
        <FetchBar active={Boolean(fetching) && !loading} />
        <div
          role="region"
          data-print-region=""
          tabIndex={0}
          aria-label={`${result?.title ?? 'Report'} table. Use the arrow keys to scroll.`}
          className="overflow-auto rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ maxHeight: fitted ?? TABLE_MAX_HEIGHT }}
        >
          <table className="w-full min-w-max border-separate border-spacing-0 text-[13px]">
            <caption className="sr-only">{result ? `${result.title}. ${result.subtitle}` : 'Report'}</caption>
            <thead className="sticky top-0 z-10">
              {loading || !result ? (
                <tr>
                  {Array.from({ length: 6 }, (_, i) => (
                    <th key={i} className={cn(th, 'h-9 border-b text-left')}>
                      <Skeleton className="h-3 w-16" />
                    </th>
                  ))}
                </tr>
              ) : (
                <>
                  <tr>
                    {head.top.map((h) => (
                      <th
                        key={h.key}
                        scope={h.colSpan > 1 ? 'colgroup' : 'col'}
                        colSpan={h.colSpan}
                        rowSpan={h.rowSpan}
                        className={cn(th, 'h-9 whitespace-nowrap border-b', h.col ? alignClassOf(h.col) : 'border-x text-center')}
                      >
                        {h.label}
                      </th>
                    ))}
                  </tr>
                  {head.grouped && (
                    <tr>
                      {head.bottom.map((h) => (
                        <th key={h.key} scope="col" className={cn(th, 'h-8 whitespace-nowrap border-b', h.col ? alignClassOf(h.col) : '')}>
                          {h.label}
                        </th>
                      ))}
                    </tr>
                  )}
                </>
              )}
            </thead>
            {loading || !result ? (
              <RowsSkeleton cols={6} />
            ) : (
              <tbody>
                {rows.map((row, r) => (
                  <tr key={r} className="group transition-colors hover:bg-muted/50">
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          'border-b px-3 py-2.5 align-middle',
                          alignClassOf(col),
                          (isPersonColumn(col, row) || col.key === firstTextCol) && col.kind === 'text' && 'min-w-[12rem] max-w-[22rem] truncate',
                          col.kind === 'text' && 'max-w-[22rem] truncate',
                        )}
                        title={col.kind === 'text' && typeof row[col.key] === 'string' ? (row[col.key] as string) : undefined}
                      >
                        <ReportCell col={col} row={row} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            )}
            {result?.totals && rows.length > 0 && (
              <tfoot className="sticky bottom-0 z-10">
                <tr>
                  {columns.map((col, i) => {
                    const v = result.totals?.[col.key];
                    return (
                      <td key={col.key} className={cn('border-t-2 bg-muted px-3 py-2.5 font-semibold', alignClassOf(col))}>
                        {v !== undefined && v !== null && v !== '' ? textOf(col, v) : i === 0 ? 'Total' : ''}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
          {!loading && result && rows.length === 0 && (
            <EmptyState bare icon={<SearchX />} title="Nothing to report" description="No rows match these parameters. Try a wider period or fewer filters." />
          )}
        </div>
      </div>
      {result && <ReportLegend legend={result.legend} className="mt-3" />}
    </>
  );
}

