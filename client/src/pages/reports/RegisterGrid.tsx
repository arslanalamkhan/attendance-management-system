import * as React from 'react';
import { createPortal } from 'react-dom';
import { SearchX } from 'lucide-react';
import type { ReportColumn, ReportResult, StatusCell } from '@nacta/shared';
import { cn } from '../../lib/utils';
import { useFitHeight } from '../../hooks/use-fit-height';
import { EmptyState } from '../../components/ui/empty-state';
import { Skeleton } from '../../components/ui/skeleton';
import { buildHeader, FetchBar, TABLE_MAX_HEIGHT } from './ReportTable';
import { alignClassOf, CodeChip, isStatusCell, ReportCell, ReportLegend, statusOfCode, textOf } from './report-cells';

const NAME_W = '13rem';
const CODE_W = '4.75rem';

interface Tip {
  x: number;
  y: number;
  title: string;
  detail: string;
  cell: StatusCell | null;
}

type Off = 'weekend' | 'holiday' | null;

/** A day column is tinted when every employee's cell in it is a weekend or a holiday. */
function offColumns(columns: ReportColumn[], rows: Record<string, unknown>[]): Map<string, Off> {
  const out = new Map<string, Off>();
  if (rows.length === 0) return out;
  for (const col of columns) {
    if (col.kind !== 'day_code') continue;
    let kind: Off = null;
    let all = true;
    for (const row of rows) {
      const v = row[col.key];
      if (!isStatusCell(v)) continue;
      const s = statusOfCode(v.code);
      if (s === 'weekend' || s === 'holiday') kind = kind === 'holiday' || s === 'holiday' ? 'holiday' : 'weekend';
      else if (s !== 'inactive') {
        all = false;
        break;
      }
    }
    if (all && kind) out.set(col.key, kind);
  }
  return out;
}

const tintOf = (off: Off | undefined) => (off === 'holiday' ? 'bg-primary-subtle' : off === 'weekend' ? 'bg-muted' : '');

/**
 * Monthly register: employees down the side (frozen), a weekday row grouped above the day numbers, tinted weekend and
 * holiday columns, colour-coded day codes with tooltips, totals on the right and the legend below.
 * Cells are keyboard-navigable (arrow keys, Home / End).
 */
export function RegisterGrid({ result, loading, fetching }: { result?: ReportResult; loading?: boolean; fetching?: boolean }) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const fitted = useFitHeight(wrapRef);
  const columns = React.useMemo(() => result?.columns ?? [], [result]);
  const rows = React.useMemo(() => result?.rows ?? [], [result]);
  const head = React.useMemo(() => buildHeader(columns), [columns]);
  const off = React.useMemo(() => offColumns(columns, rows), [columns, rows]);
  const firstDay = columns.findIndex((c) => c.kind === 'day_code');
  const lastDay = columns.length - 1 - [...columns].reverse().findIndex((c) => c.kind === 'day_code');
  const frozen = Math.min(2, Math.max(0, firstDay));
  const gridRef = React.useRef<HTMLTableSectionElement>(null);
  const [active, setActive] = React.useState<[number, number]>([0, Math.max(0, firstDay)]);
  const [tip, setTip] = React.useState<Tip | null>(null);

  // keep the roving cell valid when the data changes
  React.useEffect(() => {
    setActive(([r, c]) => [Math.min(r, Math.max(0, rows.length - 1)), Math.min(Math.max(c, firstDay), Math.max(firstDay, lastDay))]);
  }, [rows.length, firstDay, lastDay]);

  const leftOf = (i: number) => (i === 0 ? '0' : i === 1 ? NAME_W : undefined);
  const widthOf = (i: number) => (i === 0 ? NAME_W : i === 1 ? CODE_W : undefined);
  const isFrozen = (i: number) => i < frozen;
  const frozenStyle = (i: number): React.CSSProperties | undefined => (isFrozen(i) ? { left: leftOf(i), width: widthOf(i), minWidth: widthOf(i), maxWidth: widthOf(i) } : undefined);
  const frozenCls = (i: number, z: string) => (isFrozen(i) ? cn('sticky', z, i === frozen - 1 && 'shadow-[1px_0_0_rgb(var(--border))]') : '');

  const showTip = (td: HTMLElement | null) => {
    if (!td || td.dataset.r === undefined) return setTip(null);
    const r = Number(td.dataset.r);
    const c = Number(td.dataset.c);
    const row = rows[r];
    const col = columns[c];
    if (!row || !col) return setTip(null);
    const v = row[col.key];
    const rect = td.getBoundingClientRect();
    const name = String(row[columns[0]?.key ?? ''] ?? '');
    const when = [col.group, col.label].filter(Boolean).join(' ');
    setTip({ x: rect.left + rect.width / 2, y: rect.top, title: isStatusCell(v) ? v.label : '-', detail: `${name} · ${when}`, cell: isStatusCell(v) ? v : null });
  };

  const move = (r: number, c: number) => {
    const nr = Math.max(0, Math.min(rows.length - 1, r));
    const nc = Math.max(firstDay, Math.min(lastDay, c));
    setActive([nr, nc]);
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-r="${nr}"][data-c="${nc}"]`);
    el?.focus();
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTableSectionElement>) => {
    const td = (e.target as HTMLElement).closest<HTMLElement>('[data-r]');
    if (!td) return;
    const r = Number(td.dataset.r);
    const c = Number(td.dataset.c);
    const k = e.key;
    if (k === 'ArrowRight') move(r, c + 1);
    else if (k === 'ArrowLeft') move(r, c - 1);
    else if (k === 'ArrowDown') move(r + 1, c);
    else if (k === 'ArrowUp') move(r - 1, c);
    else if (k === 'Home') move(r, firstDay);
    else if (k === 'End') move(r, lastDay);
    else if (k === 'PageDown') move(r + 10, c);
    else if (k === 'PageUp') move(r - 10, c);
    else return;
    e.preventDefault();
  };

  if (!loading && result && firstDay === -1) return null;

  const th = 'bg-muted text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

  return (
    <>
      <div ref={wrapRef} className="relative rounded-lg border bg-card shadow-xs">
        <FetchBar active={Boolean(fetching) && !loading} />
        {loading || !result ? (
          <div className="space-y-2.5 p-4" aria-busy="true" aria-label="Loading register">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-5 w-44 shrink-0" />
                <Skeleton className="h-5 flex-1" />
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-auto rounded-lg" data-print-region="" style={{ maxHeight: fitted ?? TABLE_MAX_HEIGHT }} role="region" tabIndex={-1} aria-label={`${result.title}. Use the arrow keys to move between days.`}>
            <table role="grid" aria-rowcount={rows.length + 2} className="w-full min-w-max border-separate border-spacing-0 text-xs" onMouseLeave={() => setTip(null)}>
              <caption className="sr-only">
                {result.title}. {result.subtitle}
              </caption>
              <thead className="sticky top-0 z-20">
                <tr>
                  {head.top.map((h) => {
                    const isDay = h.col ? h.col.kind === 'day_code' : true;
                    const o = isDay && h.col === undefined ? off.get(columns[h.start]!.key) : undefined;
                    return (
                      <th
                        key={h.key}
                        colSpan={h.colSpan}
                        rowSpan={h.rowSpan}
                        scope={h.colSpan > 1 ? 'colgroup' : 'col'}
                        style={h.col ? frozenStyle(h.start) : undefined}
                        className={cn(
                          th,
                          'whitespace-nowrap border-b px-2',
                          h.col ? alignClassOf(h.col) : 'h-6 text-center text-[10px] font-medium',
                          h.col && frozenCls(h.start, 'z-30'),
                          h.col?.kind !== 'day_code' && h.col && 'h-14',
                          o === 'weekend' && 'bg-accent',
                          o === 'holiday' && 'bg-primary-subtle text-primary-text',
                        )}
                      >
                        {h.label}
                      </th>
                    );
                  })}
                </tr>
                <tr>
                  {head.bottom.map((h) => {
                    const o = off.get(h.col!.key);
                    return (
                      <th
                        key={h.key}
                        scope="col"
                        className={cn(th, 'h-8 w-8 min-w-8 border-b px-0 text-center font-figure text-[11px]', o === 'weekend' && 'bg-accent', o === 'holiday' && 'bg-primary-subtle text-primary-text')}
                      >
                        {h.label}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody ref={gridRef} onKeyDown={onKeyDown} onMouseOver={(e) => showTip((e.target as HTMLElement).closest<HTMLElement>('[data-r]'))} onFocus={(e) => showTip((e.target as HTMLElement).closest<HTMLElement>('[data-r]'))} onBlur={() => setTip(null)}>
                {rows.map((row, r) => (
                  <tr key={r} className="group/row">
                    {columns.map((col, c) => {
                      const isDay = c >= firstDay && c <= lastDay;
                      if (!isDay) {
                        return (
                          <td
                            key={col.key}
                            style={frozenStyle(c)}
                            className={cn(
                              'whitespace-nowrap border-b bg-card px-2 py-1 group-hover/row:bg-muted',
                              alignClassOf(col),
                              frozenCls(c, 'z-[5]'),
                              !isFrozen(c) && 'px-3',
                              col.kind === 'text' && 'truncate',
                            )}
                          >
                            <ReportCell col={col} row={row} />
                          </td>
                        );
                      }
                      const v = row[col.key];
                      const cell = isStatusCell(v) ? v : null;
                      const s = cell ? statusOfCode(cell.code) : null;
                      const quiet = s === 'weekend' || s === 'holiday' || s === 'inactive' || s === 'pending';
                      const o = off.get(col.key);
                      const isActive = active[0] === r && active[1] === c;
                      return (
                        <td
                          key={col.key}
                          role="gridcell"
                          data-r={r}
                          data-c={c}
                          tabIndex={isActive ? 0 : -1}
                          aria-label={cell ? `${String(row[columns[0]?.key ?? ''] ?? '')}, ${[col.group, col.label].filter(Boolean).join(' ')}: ${cell.label}` : undefined}
                          onClick={() => setActive([r, c])}
                          className={cn(
                            'h-8 w-8 min-w-8 border-b p-0.5 text-center align-middle outline-none transition-colors',
                            'focus-visible:relative focus-visible:z-[3] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                            tintOf(o),
                            !o && 'group-hover/row:bg-muted/60',
                          )}
                        >
                          {cell ? (
                            quiet ? (
                              <span className="text-[10px] font-medium text-muted-foreground/60">{s === 'inactive' ? '' : cell.code}</span>
                            ) : (
                              <CodeChip cell={cell} className="h-6 w-full min-w-0" />
                            )
                          ) : (
                            <span className="text-muted-foreground/40">-</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              {result.totals && rows.length > 0 && (
                <tfoot className="sticky bottom-0 z-20">
                  <tr>
                    {columns.map((col, c) => {
                      const v = result.totals?.[col.key];
                      const isDay = c >= firstDay && c <= lastDay;
                      return (
                        <td
                          key={col.key}
                          style={frozenStyle(c)}
                          className={cn('border-t-2 bg-muted px-2 py-2 font-semibold', isDay ? 'text-center font-figure text-[11px]' : alignClassOf(col), frozenCls(c, 'z-30'))}
                        >
                          {v !== undefined && v !== null && v !== '' ? textOf(col, v) : c === 0 ? 'Total' : ''}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
            {rows.length === 0 && <EmptyState bare icon={<SearchX />} title="Nothing to report" description="No employees match these parameters." />}
          </div>
        )}
      </div>
      {result && (
        <div className="mt-3 space-y-2">
          <ReportLegend legend={result.legend} />
          <p className="text-xs text-muted-foreground">Shaded columns are weekends and holidays. Select a cell and use the arrow keys to move around; hover or focus a code for details.</p>
        </div>
      )}
      {tip &&
        createPortal(
          <div role="tooltip" style={{ position: 'fixed', left: tip.x, top: tip.y - 8, transform: 'translate(-50%, -100%)' }} className="pointer-events-none z-[80] max-w-xs rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-lg">
            <p className="flex items-center gap-2 font-semibold">
              {tip.cell && <span className="rounded bg-background/20 px-1 font-mono text-[10px]">{tip.cell.code}</span>}
              {tip.title}
            </p>
            <p className="mt-0.5 opacity-80">{tip.detail}</p>
          </div>,
          document.body,
        )}
    </>
  );
}
