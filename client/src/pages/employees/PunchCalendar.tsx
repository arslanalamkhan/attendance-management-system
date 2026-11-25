import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonthsYmd, formatMonth, parseYmd, startOfMonthYmd, todayYmd, toYmd } from '../../lib/dates';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { IconButton } from '../../components/ui/icon-button';
import { Skeleton } from '../../components/ui/skeleton';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Heat level 0-4 from a day's punch count. */
function level(n: number): 0 | 1 | 2 | 3 | 4 {
  if (n <= 0) return 0;
  if (n <= 2) return 1;
  if (n <= 4) return 2;
  if (n <= 8) return 3;
  return 4;
}

const LEVEL_CLASS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'bg-muted/60 text-muted-foreground hover:bg-muted',
  1: 'bg-primary/20 text-foreground hover:bg-primary/30',
  2: 'bg-primary/40 text-foreground hover:bg-primary/50',
  3: 'bg-primary/70 text-primary-foreground hover:bg-primary/80',
  4: 'bg-primary text-primary-foreground hover:bg-primary-hover',
};

export interface PunchCalendarProps {
  /** Any date in the month shown, "YYYY-MM-DD". */
  month: string;
  onMonthChange: (month: string) => void;
  /** "YYYY-MM-DD" -> punch count. */
  counts: Record<string, number> | undefined;
  loading?: boolean;
  selected: string | null;
  onSelect: (day: string | null) => void;
}

export function PunchCalendar({ month, onMonthChange, counts, loading, selected, onSelect }: PunchCalendarProps) {
  const first = parseYmd(startOfMonthYmd(month));
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // Monday-first
  const today = todayYmd();
  const currentMonth = startOfMonthYmd(today);
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => toYmd(new Date(first.getFullYear(), first.getMonth(), i + 1))),
  ];
  const monthTotal = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;
  const activeDays = counts ? Object.values(counts).filter((n) => n > 0).length : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">{formatMonth(month)}</h3>
          <p className="text-[13px] tabular-nums text-muted-foreground" aria-live="polite">
            {loading ? 'Loading...' : `${monthTotal.toLocaleString()} ${monthTotal === 1 ? 'punch' : 'punches'} on ${activeDays} ${activeDays === 1 ? 'day' : 'days'}`}
          </p>
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

      <div role="group" aria-label={`Punch calendar for ${formatMonth(month)}`} className="grid grid-cols-7 gap-1.5">
        {cells.map((day, i) => {
          if (day === null) return <div key={`b${i}`} aria-hidden="true" />;
          if (loading) return <Skeleton key={day} className="h-12 rounded-md sm:h-14" />;
          const n = counts?.[day] ?? 0;
          const isSelected = selected === day;
          const isToday = day === today;
          const dom = Number(day.slice(8));
          return (
            <button
              key={day}
              type="button"
              aria-pressed={isSelected}
              aria-label={`${parseYmd(day).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}: ${n} ${n === 1 ? 'punch' : 'punches'}${isToday ? ' (today)' : ''}`}
              onClick={() => onSelect(isSelected ? null : day)}
              className={cn(
                'relative flex h-12 flex-col items-start justify-between rounded-md p-1.5 text-left transition-colors duration-150 sm:h-14',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                LEVEL_CLASS[level(n)],
                isSelected && 'ring-2 ring-foreground ring-offset-2 ring-offset-background',
              )}
            >
              <span className={cn('text-xs tabular-nums', isToday ? 'font-bold underline decoration-2 underline-offset-4' : 'font-medium')}>{dom}</span>
              {n > 0 && <span className="self-end text-[11px] font-semibold tabular-nums leading-none">{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>Select a day to filter the list below.</span>
        <span className="flex items-center gap-1.5" aria-hidden="true">
          Less
          {([0, 1, 2, 3, 4] as const).map((l) => (
            <span key={l} className={cn('size-3.5 rounded-[4px]', LEVEL_CLASS[l].split(' ').filter((c) => c.startsWith('bg-') && !c.startsWith('hover:')).join(' '))} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}
