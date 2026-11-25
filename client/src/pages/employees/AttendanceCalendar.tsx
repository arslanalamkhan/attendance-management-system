import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DAY_STATUS_LABEL } from '@nacta/shared';
import type { AttendanceDay, DayStatus } from '@nacta/shared';
import { addMonthsYmd, formatMonth, parseYmd, startOfMonthYmd, todayYmd, toYmd } from '../../lib/dates';
import { formatMinutes, leaveTint, STATUS_STYLE } from '../../lib/rules-ui';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { IconButton } from '../../components/ui/icon-button';
import { Skeleton } from '../../components/ui/skeleton';
import { Tooltip } from '../../components/ui/tooltip';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface AttendanceCalendarProps {
  month: string;
  onMonthChange: (month: string) => void;
  days: AttendanceDay[] | undefined;
  loading?: boolean;
  selected: string | null;
  onSelect: (day: string | null) => void;
}

function tip(d: AttendanceDay): React.ReactNode {
  const lines: string[] = [d.leave && d.status === 'leave' ? `${d.leave.typeName} (${d.leave.code})` : DAY_STATUS_LABEL[d.status]];
  if (d.holiday) lines.push(d.holiday.name);
  if (d.firstIn || d.lastOut) lines.push(`In ${d.firstIn ?? '--:--'} · Out ${d.lastOut ?? '--:--'}`);
  if (d.workedMinutes > 0) lines.push(`Worked ${formatMinutes(d.workedMinutes)}`);
  if (d.lateMinutes > 0) lines.push(`${d.lateMinutes} min late`);
  if (d.earlyLeave && d.earlyMinutes > 0) lines.push(`${d.earlyMinutes} min early`);
  if (d.corrected) lines.push('Corrected');
  return (
    <span className="block">
      {lines.map((l, i) => (
        <span key={i} className={cn('block', i === 0 && 'font-semibold')}>
          {l}
        </span>
      ))}
    </span>
  );
}

export function AttendanceCalendar({ month, onMonthChange, days, loading, selected, onSelect }: AttendanceCalendarProps) {
  const first = parseYmd(startOfMonthYmd(month));
  const dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const today = todayYmd();
  const currentMonth = startOfMonthYmd(today);
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: dim }, (_, i) => toYmd(new Date(first.getFullYear(), first.getMonth(), i + 1)))];
  const byDate = new Map((days ?? []).map((d) => [d.date, d]));

  const count = (s: DayStatus) => (days ?? []).filter((d) => d.status === s).length;
  const totals = [
    { label: 'Present', short: 'P', n: count('present'), tone: 'text-success-text bg-success-subtle' },
    { label: 'Late', short: 'L', n: count('late'), tone: 'text-warning-text bg-warning-subtle' },
    { label: 'Absent', short: 'A', n: count('absent'), tone: 'text-danger-text bg-danger-subtle' },
    { label: 'Leave', short: 'Leave', n: count('leave'), tone: 'text-primary-text bg-primary-subtle' },
    { label: 'Half day / missing punch', short: 'H/M', n: count('half_day') + count('incomplete'), tone: 'text-info-text bg-info-subtle' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">{formatMonth(month)}</h3>
          <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Month totals" aria-live="polite">
            {totals.map((t) => (
              <li key={t.label} title={t.label} className={cn('inline-flex items-baseline gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium', t.tone)}>
                <span className="opacity-80">{t.short}</span>
                <span className="font-figure text-[13px] font-semibold">{loading ? '-' : t.n}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center gap-1">
          <IconButton label="Previous month" icon={<ChevronLeft />} size="icon-sm" variant="secondary" onClick={() => onMonthChange(addMonthsYmd(month, -1))} />
          <Button size="sm" variant="secondary" disabled={startOfMonthYmd(month) === currentMonth} onClick={() => onMonthChange(currentMonth)}>
            Today
          </Button>
          <IconButton label="Next month" icon={<ChevronRight />} size="icon-sm" variant="secondary" onClick={() => onMonthChange(addMonthsYmd(month, 1))} />
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5" aria-hidden="true">
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      <div role="group" aria-label={`Attendance calendar for ${formatMonth(month)}`} className="grid grid-cols-7 gap-1.5">
        {cells.map((day, i) => {
          if (day === null) return <div key={`b${i}`} aria-hidden="true" />;
          if (loading) return <Skeleton key={day} className="h-14 rounded-md sm:h-16" />;
          const d = byDate.get(day);
          const isSelected = selected === day;
          const style = d ? STATUS_STYLE[d.status] : null;
          const leaveColored = d?.leave && (d.status === 'leave' || d.status === 'half_day');
          const label = d ? (d.leave && d.status === 'leave' ? `${d.leave.typeName}` : DAY_STATUS_LABEL[d.status]) : 'No data';
          const cell = (
            <button
              type="button"
              aria-pressed={isSelected}
              aria-label={`${parseYmd(day).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}: ${label}${d?.corrected ? ', corrected' : ''}${day === today ? ' (today)' : ''}`}
              onClick={() => onSelect(isSelected ? null : day)}
              style={d?.status === 'leave' && d.leave ? leaveTint(d.leave.color) : undefined}
              className={cn(
                'relative flex h-14 w-full flex-col items-start justify-between rounded-md p-1.5 text-left transition-[filter,box-shadow] duration-150 hover:brightness-95 sm:h-16',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                style && !(d?.status === 'leave' && d.leave) ? style.cell : !style && 'bg-muted/40 text-muted-foreground',
                isSelected && 'ring-2 ring-foreground ring-offset-2 ring-offset-background',
              )}
            >
              <span className={cn('text-xs tabular-nums', day === today ? 'font-bold underline decoration-2 underline-offset-4' : 'font-medium')}>{Number(day.slice(8))}</span>
              {d && d.status !== 'inactive' && (
                <span className="w-full truncate text-[10px] font-semibold uppercase leading-none tracking-wide opacity-90">
                  {leaveColored && d.leave ? `${d.leave.code}${d.status === 'half_day' ? '½' : ''}` : d.status === 'weekend' || d.status === 'pending' ? '' : codeOf(d.status)}
                </span>
              )}
              {d?.corrected && <span aria-hidden="true" className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-info ring-2 ring-card" />}
              {leaveColored && d?.status === 'half_day' && d.leave && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 rounded-b-md" style={{ backgroundColor: d.leave.color }} />}
            </button>
          );
          return d ? (
            <Tooltip key={day} content={tip(d)} side="top">
              {cell}
            </Tooltip>
          ) : (
            <div key={day}>{cell}</div>
          );
        })}
      </div>

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground" aria-label="Legend">
        {(['present', 'late', 'half_day', 'incomplete', 'absent', 'holiday', 'weekend'] as const).map((s) => (
          <li key={s} className="inline-flex items-center gap-1.5">
            <span className={cn('size-3 rounded-[4px]', STATUS_STYLE[s].swatch)} aria-hidden="true" /> {DAY_STATUS_LABEL[s]}
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-[4px] bg-primary" aria-hidden="true" /> Leave (type colour)
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-info" aria-hidden="true" /> Corrected
        </li>
      </ul>
    </div>
  );
}

function codeOf(s: DayStatus): string {
  return { present: 'P', late: 'L', half_day: 'H', incomplete: 'M', absent: 'A', holiday: 'Hol', leave: 'LV', weekend: '', pending: '', inactive: '' }[s];
}
