import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDaysYmd, addMonthsYmd, parseYmd, startOfMonthYmd, todayYmd, toYmd } from '../../lib/dates';
import { cn } from '../../lib/utils';
import { IconButton } from './icon-button';

export interface CalendarRange {
  from: string | null;
  to: string | null;
}

export type DayMark = 'holiday' | 'off' | 'working' | undefined;

interface BaseProps {
  /** How many months to show side by side (1 or 2). */
  months?: 1 | 2;
  /** First visible month (any date in it). */
  defaultMonth?: string;
  /** Marks that decorate a day (holiday dot, weekend tint). */
  markFor?: (ymd: string) => DayMark;
  /** Return true to block a date. */
  isDisabled?: (ymd: string) => boolean;
  className?: string;
}
interface SingleProps extends BaseProps {
  mode: 'single';
  value: string | null;
  onChange: (value: string) => void;
}
interface RangeProps extends BaseProps {
  mode: 'range';
  value: CalendarRange;
  onChange: (value: CalendarRange) => void;
}
export type CalendarProps = SingleProps | RangeProps;

const HEAD = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const monthTitle = (ymd: string) => parseYmd(ymd).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const longLabel = (ymd: string) => parseYmd(ymd).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** Month grid (Monday first) for picking one day or a range. Click-click range selection, arrow-key navigation. */
export function Calendar(props: CalendarProps) {
  const { months = 1, markFor, isDisabled, className } = props;
  const today = todayYmd();
  const initial = props.mode === 'single' ? props.value : props.value.from;
  const [month, setMonth] = React.useState(() => startOfMonthYmd(props.defaultMonth ?? initial ?? today));
  const [hover, setHover] = React.useState<string | null>(null);
  const [focusDay, setFocusDay] = React.useState<string>(() => initial ?? today);
  const gridRef = React.useRef<HTMLDivElement>(null);
  const wantFocus = React.useRef(false);

  // Range selection state: when `from` is set and `to` is null we are waiting for the second click.
  const range = props.mode === 'range' ? props.value : null;
  const picking = range !== null && range.from !== null && range.to === null;

  const shown = Array.from({ length: months }, (_, i) => addMonthsYmd(month, i));

  React.useEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`button[data-date="${focusDay}"]`)?.focus();
  }, [focusDay, month]);

  const choose = (d: string) => {
    if (isDisabled?.(d)) return;
    if (props.mode === 'single') return props.onChange(d);
    const r = props.value;
    if (r.from && !r.to) {
      props.onChange(d < r.from ? { from: d, to: r.from } : { from: r.from, to: d });
      setHover(null);
    } else {
      props.onChange({ from: d, to: null });
    }
  };

  const move = (target: string) => {
    setFocusDay(target);
    wantFocus.current = true;
    const m = startOfMonthYmd(target);
    const last = addMonthsYmd(month, months - 1);
    if (m < month) setMonth(m);
    else if (m > last) setMonth(addMonthsYmd(m, -(months - 1)));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in step) {
      e.preventDefault();
      move(addDaysYmd(focusDay, step[e.key]!));
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      move(addMonthsYmd(focusDay, e.key === 'PageDown' ? 1 : -1).slice(0, 8) + focusDay.slice(8));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const d = parseYmd(focusDay);
      move(addDaysYmd(focusDay, e.key === 'Home' ? -((d.getDay() + 6) % 7) : 6 - ((d.getDay() + 6) % 7)));
    }
  };

  const lo = range ? (range.from && range.to ? range.from : range.from && hover && hover < range.from ? hover : range.from) : null;
  const hi = range ? (range.from && range.to ? range.to : range.from && hover ? (hover < range.from ? range.from : hover) : range.from) : null;

  return (
    <div className={cn('inline-flex flex-col gap-2', className)}>
      <div className="flex items-start gap-5" ref={gridRef} onKeyDown={onKeyDown}>
        {shown.map((m, mi) => {
          const first = parseYmd(m);
          const dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
          const lead = (first.getDay() + 6) % 7;
          const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: dim }, (_, i) => toYmd(new Date(first.getFullYear(), first.getMonth(), i + 1)))];
          return (
            <div key={m} className="w-[17.5rem]">
              <div className="mb-2 flex h-8 items-center justify-between">
                {mi === 0 ? <IconButton label="Previous month" icon={<ChevronLeft />} size="icon-sm" onClick={() => setMonth(addMonthsYmd(month, -1))} /> : <span className="size-8" />}
                <p className="text-sm font-semibold tracking-tight" aria-live="polite">
                  {monthTitle(m)}
                </p>
                {mi === months - 1 ? <IconButton label="Next month" icon={<ChevronRight />} size="icon-sm" onClick={() => setMonth(addMonthsYmd(month, 1))} /> : <span className="size-8" />}
              </div>
              <div role="grid" aria-label={monthTitle(m)} className="grid grid-cols-7 gap-y-0.5">
                {HEAD.map((h) => (
                  <div key={h} role="columnheader" className="grid h-7 place-content-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {h}
                  </div>
                ))}
                {cells.map((d, i) => {
                  if (!d) return <div key={`b${i}`} role="gridcell" />;
                  const mark = markFor?.(d);
                  const disabled = isDisabled?.(d) ?? false;
                  const isStart = (range ? d === range.from : props.mode === 'single' && d === props.value) || false;
                  const isEnd = range ? d === range.to || (picking && !hover && d === range.from) : false;
                  const inRange = lo !== null && hi !== null && d >= lo && d <= hi;
                  const selected = isStart || isEnd || (range !== null && picking && hover !== null && d === hover);
                  return (
                    <div
                      key={d}
                      role="gridcell"
                      className={cn('relative flex h-9 items-center justify-center', inRange && 'bg-primary-subtle', inRange && d === lo && 'rounded-l-md', inRange && d === hi && 'rounded-r-md')}
                    >
                      <button
                        type="button"
                        data-date={d}
                        tabIndex={d === focusDay ? 0 : -1}
                        disabled={disabled}
                        aria-label={`${longLabel(d)}${mark === 'holiday' ? ', holiday' : mark === 'off' ? ', day off' : mark === 'working' ? ', special working day' : ''}`}
                        aria-pressed={selected}
                        onClick={() => {
                          setFocusDay(d);
                          choose(d);
                        }}
                        onFocus={() => setFocusDay(d)}
                        onMouseEnter={() => picking && setHover(d)}
                        className={cn(
                          'relative grid size-8 place-content-center rounded-md text-[13px] tabular-nums transition-colors duration-100',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          'disabled:pointer-events-none disabled:opacity-35',
                          !selected && 'hover:bg-accent',
                          !selected && mark === 'off' && 'text-muted-foreground',
                          !selected && inRange && 'hover:bg-primary/15',
                          selected && 'bg-primary font-semibold text-primary-foreground',
                          !selected && d === today && 'font-bold text-primary-text',
                        )}
                      >
                        {Number(d.slice(8))}
                        {mark === 'holiday' && <span aria-hidden="true" className={cn('absolute bottom-0.5 size-1 rounded-full', selected ? 'bg-primary-foreground' : 'bg-warning')} />}
                        {mark === 'working' && <span aria-hidden="true" className={cn('absolute bottom-0.5 size-1 rounded-full', selected ? 'bg-primary-foreground' : 'bg-info')} />}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {markFor && (
        <p className="flex items-center gap-3 text-[11px] text-muted-foreground" aria-hidden="true">
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-warning" /> Holiday
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-info" /> Special working day
          </span>
        </p>
      )}
    </div>
  );
}
