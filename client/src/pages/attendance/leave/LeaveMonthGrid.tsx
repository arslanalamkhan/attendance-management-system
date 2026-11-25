import * as React from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { LEAVE_PART_LABEL } from '@nacta/shared';
import type { Holiday, Leave, TimingProfile } from '@nacta/shared';
import { addDaysYmd, endOfMonthYmd, formatDate, parseYmd, startOfMonthYmd, todayYmd } from '../../../lib/dates';
import { holidayOn, rangeLabel } from '../../../lib/rules-ui';
import { cn } from '../../../lib/utils';
import { Button } from '../../../components/ui/button';
import { EmployeeAvatar } from '../../../components/ui/employee-avatar';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import { LeavePill } from '../../../components/rules/pills';

const CELL = 30;
const NAME_W = 232;
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export interface LeaveMonthGridProps {
  month: string;
  leaves: Leave[];
  holidays: Holiday[] | undefined;
  timing: TimingProfile | undefined;
  canManage: boolean;
  onEdit: (l: Leave) => void;
  onCancel: (l: Leave) => void;
  pageSize?: number;
}

interface Row {
  employeeId: number;
  name: string;
  empCode: string;
  wingName: string | null;
  leaves: Leave[];
}

/**
 * Month timeline: one row per employee who has leave in the month (not all ~800 people), one column per day.
 * Leave appears as a bar in the leave type's own colour. Names stay in view while scrolling sideways.
 */
export function LeaveMonthGrid({ month, leaves, holidays, timing, canManage, onEdit, onCancel, pageSize = 40 }: LeaveMonthGridProps) {
  const start = startOfMonthYmd(month);
  const end = endOfMonthYmd(month);
  const today = todayYmd();
  const days = Array.from({ length: Number(end.slice(8)) }, (_, i) => addDaysYmd(start, i));
  const [page, setPage] = React.useState(1);
  React.useEffect(() => setPage(1), [month, leaves]);

  const rows = React.useMemo<Row[]>(() => {
    const m = new Map<number, Row>();
    for (const l of leaves) {
      const r = m.get(l.employeeId) ?? { employeeId: l.employeeId, name: l.employeeName, empCode: l.empCode, wingName: l.wingName, leaves: [] };
      r.leaves.push(l);
      m.set(l.employeeId, r);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [leaves]);

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const shown = rows.slice((page - 1) * pageSize, page * pageSize);

  const dayKind = (d: string): 'holiday' | 'off' | null => {
    if (holidayOn(d, holidays)) return 'holiday';
    const dow = parseYmd(d).getDay();
    return (timing ? timing.days[dow] == null : dow === 0 || dow === 6) ? 'off' : null;
  };
  const kinds = days.map(dayKind);
  const width = days.length * CELL;

  return (
    <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
      <div className="max-h-[calc(100dvh-22rem)] min-h-[16rem] overflow-auto" role="region" aria-label="Leave timeline, scrolls sideways" tabIndex={0}>
        <div style={{ width: NAME_W + width, minWidth: '100%' }}>
          {/* header */}
          <div className="sticky top-0 z-20 flex border-b bg-card">
            <div style={{ width: NAME_W }} className="sticky left-0 z-30 flex shrink-0 items-end border-r bg-card px-4 pb-2 text-xs font-medium text-muted-foreground">
              Employee
            </div>
            <div className="flex" style={{ width }}>
              {days.map((d, i) => {
                const dow = parseYmd(d).getDay();
                return (
                  <div
                    key={d}
                    style={{ width: CELL }}
                    title={`${formatDate(d)}${kinds[i] === 'holiday' ? ` · ${holidayOn(d, holidays)?.name}` : ''}`}
                    className={cn('flex shrink-0 flex-col items-center py-1.5 text-[11px] tabular-nums', kinds[i] && 'bg-muted/50 text-muted-foreground', d === today && 'font-bold text-primary-text')}
                  >
                    <span className="text-[10px] uppercase opacity-70">{DOW[dow]}</span>
                    <span className={cn('grid size-5 place-content-center rounded-full', d === today && 'bg-primary text-primary-foreground')}>{Number(d.slice(8))}</span>
                    {kinds[i] === 'holiday' && <span className="mt-0.5 size-1 rounded-full bg-warning" aria-hidden="true" />}
                  </div>
                );
              })}
            </div>
          </div>

          {shown.map((r) => (
            <div key={r.employeeId} className="group flex border-b last:border-b-0 hover:bg-muted/30">
              <div style={{ width: NAME_W }} className="sticky left-0 z-10 flex shrink-0 items-center gap-2.5 border-r bg-card px-4 py-2 group-hover:bg-muted/60">
                <EmployeeAvatar employee={{ id: r.employeeId, name: r.name }} size="xs" />
                <Link to={`/employees/${r.employeeId}?tab=attendance`} className="min-w-0 rounded-sm leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="block truncate text-[13px] font-medium hover:underline">{r.name}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">{r.empCode}</span>
                </Link>
              </div>
              <div className="relative h-12 shrink-0" style={{ width }}>
                {/* day stripes */}
                <div className="absolute inset-0 flex" aria-hidden="true">
                  {days.map((d, i) => (
                    <div key={d} style={{ width: CELL }} className={cn('shrink-0 border-r border-border/40', kinds[i] && 'bg-muted/50', d === today && 'bg-primary-subtle/50')} />
                  ))}
                </div>
                {r.leaves.map((l) => {
                  const from = l.from < start ? start : l.from;
                  const to = l.to > end ? end : l.to;
                  const col = Number(from.slice(8)) - 1;
                  const span = Number(to.slice(8)) - col;
                  const half = l.part !== 'full';
                  return (
                    <Popover key={l.id}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-label={`${r.name}: ${l.leaveTypeName}, ${rangeLabel(l.from, l.to)}${half ? `, ${LEAVE_PART_LABEL[l.part].toLowerCase()}` : ''}`}
                          style={{
                            left: col * CELL + 2,
                            width: span * CELL - 4,
                            backgroundColor: `color-mix(in srgb, ${l.leaveTypeColor} 82%, transparent)`,
                            top: half ? 24 : 10,
                            height: half ? 14 : 28,
                          }}
                          className={cn(
                            'absolute flex items-center overflow-hidden rounded-md px-1.5 text-[11px] font-semibold text-white shadow-xs transition-[filter] hover:brightness-110',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                            l.from < start && 'rounded-l-none',
                            l.to > end && 'rounded-r-none',
                          )}
                        >
                          <span className="truncate [text-shadow:0_1px_1px_rgb(0_0_0/0.25)]">
                            {span >= 2 || half ? l.leaveTypeCode : ''}
                            {half && span >= 1 ? ` ½` : ''}
                          </span>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 space-y-3 p-3.5" align="start">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{l.employeeName}</p>
                            <p className="text-xs text-muted-foreground">{l.wingName ?? 'No wing'}</p>
                          </div>
                          <LeavePill code={l.leaveTypeCode} name={l.leaveTypeName} color={l.leaveTypeColor} short />
                        </div>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
                          <dt className="text-muted-foreground">Dates</dt>
                          <dd className="tabular-nums">{l.from === l.to ? formatDate(l.from) : `${formatDate(l.from)} – ${formatDate(l.to)}`}</dd>
                          <dt className="text-muted-foreground">Counted</dt>
                          <dd>
                            {l.workingDays} working {l.workingDays === 1 ? 'day' : 'days'}
                            {half && ` (${LEAVE_PART_LABEL[l.part].toLowerCase()})`}
                          </dd>
                          {l.reason && (
                            <>
                              <dt className="text-muted-foreground">Reason</dt>
                              <dd className="break-words">{l.reason}</dd>
                            </>
                          )}
                          <dt className="text-muted-foreground">Marked by</dt>
                          <dd>{l.createdBy ?? 'Unknown'}</dd>
                        </dl>
                        {canManage && (
                          <div className="flex gap-2 border-t pt-3">
                            <Button size="sm" variant="secondary" onClick={() => onEdit(l)}>
                              <Pencil aria-hidden="true" /> Edit
                            </Button>
                            <Button size="sm" variant="destructive-ghost" onClick={() => onCancel(l)}>
                              <Trash2 aria-hidden="true" /> Cancel leave
                            </Button>
                          </div>
                        )}
                      </PopoverContent>
                    </Popover>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
        <span aria-live="polite">
          {rows.length.toLocaleString()} {rows.length === 1 ? 'person' : 'people'} with leave in this month
        </span>
        {pages > 1 && (
          <span className="flex items-center gap-1.5">
            <Button size="icon-sm" variant="ghost" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft />
            </Button>
            <span className="tabular-nums">
              Page {page} of {pages}
            </span>
            <Button size="icon-sm" variant="ghost" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              <ChevronRight />
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}
