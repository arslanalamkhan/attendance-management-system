import * as React from 'react';
import { Link } from 'react-router-dom';
import { DAY_STATUSES, DAY_STATUS_CODE, DAY_STATUS_LABEL } from '@nacta/shared';
import type { DayStatus, ReportColumn, StatusCell } from '@nacta/shared';
import { cn } from '../../lib/utils';
import { formatDate, isYmd } from '../../lib/dates';
import { dayLabel, formatMinutes, leaveTint, STATUS_STYLE } from '../../lib/rules-ui';
import { LeavePill } from '../../components/rules/pills';
import { StatusPill } from '../../components/ui/badge';
import { EmployeeAvatar } from '../../components/ui/employee-avatar';

const CODE_TO_STATUS: Record<string, DayStatus> = Object.fromEntries((DAY_STATUSES as readonly DayStatus[]).map((s) => [DAY_STATUS_CODE[s], s]));

export function isStatusCell(v: unknown): v is StatusCell {
  return typeof v === 'object' && v !== null && typeof (v as StatusCell).code === 'string' && typeof (v as StatusCell).label === 'string';
}

/** A report's status code resolved to the app's visual language (DayStatus), or null for an unknown code. */
export function statusOfCode(code: string): DayStatus | null {
  if ((DAY_STATUSES as readonly string[]).includes(code)) return code as DayStatus;
  return CODE_TO_STATUS[code] ?? CODE_TO_STATUS[code.toUpperCase()] ?? null;
}

/** Visual for a status / day_code cell: leave types bring their own colour, statuses use the app palette. */
export function cellLook(cell: StatusCell): { className?: string; style?: React.CSSProperties; status: DayStatus | null } {
  if (cell.color) return { style: leaveTint(cell.color), status: null };
  const status = statusOfCode(cell.code);
  return { className: status ? STATUS_STYLE[status].cell : 'bg-muted text-muted-foreground', status };
}

export const dash = <span className="text-muted-foreground/70">-</span>;

/** Decimal hours (7.75) -> "7h 45m". */
export const formatHours = (hours: number): string => formatMinutes(Math.round(hours * 60));

/** Percentages arrive as 0-100. */
export const formatPercent = (v: number): string => `${(Math.round(v * 10) / 10).toFixed(1)}%`;

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;
export function alignOf(col: ReportColumn): 'left' | 'right' | 'center' {
  if (col.align) return col.align;
  switch (col.kind) {
    case 'number':
    case 'minutes':
    case 'hours':
    case 'percent':
      return 'right';
    case 'day_code':
      return 'center';
    default:
      return 'left';
  }
}
export const alignClassOf = (col: ReportColumn) => alignClass[alignOf(col)];

/** Plain-text value (tooltips, totals fallbacks). */
export function textOf(col: ReportColumn, v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (isStatusCell(v)) return v.label;
  if (typeof v === 'number') {
    if (col.kind === 'hours') return formatHours(v);
    if (col.kind === 'minutes') return formatMinutes(v);
    if (col.kind === 'percent') return formatPercent(v);
    return v.toLocaleString();
  }
  return String(v);
}

export function StatusChip({ cell }: { cell: StatusCell }) {
  if (cell.color) return <LeavePill code={cell.code} name={cell.label} color={cell.color} />;
  const status = statusOfCode(cell.code);
  const tone = status ? STATUS_STYLE[status].tone : 'neutral';
  return <StatusPill tone={tone === 'outline' ? 'neutral' : tone}>{cell.label}</StatusPill>;
}

/** Compact coloured code (P, L, CL ...) for dense grids. */
export function CodeChip({ cell, className }: { cell: StatusCell; className?: string }) {
  const look = cellLook(cell);
  return (
    <span className={cn('inline-flex h-5 min-w-[1.375rem] items-center justify-center rounded px-1 text-[11px] font-semibold leading-none', look.className, className)} style={look.style}>
      {cell.code}
    </span>
  );
}

const NAME_KEYS = new Set(['name', 'employee', 'employeeName', 'employee_name']);

export function isPersonColumn(col: ReportColumn, row: Record<string, unknown>): boolean {
  return NAME_KEYS.has(col.key) && typeof row.employeeId === 'number' && col.kind === 'text';
}

/** One body cell, rendered by the column's kind. */
export function ReportCell({ col, row }: { col: ReportColumn; row: Record<string, unknown> }) {
  const v = row[col.key];
  if (isPersonColumn(col, row) && typeof v === 'string') {
    const id = row.employeeId as number;
    return (
      <Link to={`/employees/${id}`} className="inline-flex min-w-0 items-center gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <EmployeeAvatar employee={{ id, name: v, hasPhoto: typeof row.hasPhoto === 'boolean' ? row.hasPhoto : undefined }} size="xs" />
        <span className="truncate font-medium hover:underline">{v}</span>
      </Link>
    );
  }
  if (v === null || v === undefined || v === '') return dash;
  switch (col.kind) {
    case 'status':
      return isStatusCell(v) ? <StatusChip cell={v} /> : <span>{String(v)}</span>;
    case 'day_code':
      return isStatusCell(v) ? <CodeChip cell={v} /> : <span>{String(v)}</span>;
    case 'mono':
    case 'time':
      return <span className="whitespace-nowrap font-mono text-[13px] tabular-nums">{String(v)}</span>;
    case 'date': {
      const s = String(v);
      return <span className="whitespace-nowrap tabular-nums" title={isYmd(s) ? formatDate(s) : undefined}>{isYmd(s) ? dayLabel(s) : s}</span>;
    }
    case 'number':
      return <span className="font-figure tabular-nums">{typeof v === 'number' ? v.toLocaleString() : String(v)}</span>;
    case 'minutes':
      return <span className="font-figure whitespace-nowrap tabular-nums">{typeof v === 'number' ? (v > 0 ? formatMinutes(v) : '0m') : String(v)}</span>;
    case 'hours':
      return <span className="font-figure whitespace-nowrap tabular-nums">{typeof v === 'number' ? formatHours(v) : String(v)}</span>;
    case 'percent': {
      if (typeof v !== 'number') return <span>{String(v)}</span>;
      const tone = v >= 90 ? 'bg-success' : v >= 75 ? 'bg-warning' : 'bg-danger';
      return (
        <span className="inline-flex items-center justify-end gap-2">
          <span className="hidden h-1 w-10 overflow-hidden rounded-full bg-muted sm:block" aria-hidden="true">
            <span className={cn('block h-full rounded-full', tone)} style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
          </span>
          <span className="font-figure tabular-nums">{formatPercent(v)}</span>
        </span>
      );
    }
    default:
      return <span className="truncate">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>;
  }
}

/** Legend: one chip per status/day code used in the report. */
export function ReportLegend({ legend, className }: { legend: StatusCell[]; className?: string }) {
  if (legend.length === 0) return null;
  return (
    <ul aria-label="Legend" className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', className)}>
      {legend.map((c) => (
        <li key={`${c.code}-${c.label}`} className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <CodeChip cell={c} />
          {c.label}
        </li>
      ))}
    </ul>
  );
}

export const STATUS_LABELS = DAY_STATUS_LABEL;
