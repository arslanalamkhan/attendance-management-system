import * as React from 'react';
import { Minus, Plus } from 'lucide-react';
import { WEEKDAYS } from '@nacta/shared';
import type { TimingVersion } from '@nacta/shared';
import { formatDate } from '../../../lib/dates';
import { cn } from '../../../lib/utils';
import { useFieldProps } from '../../../components/ui/form-field-context';
import { controlBase } from '../../../components/ui/input';

export type Hours = { start: string; end: string } | null;
/** Monday-first order of getDay() indexes. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** "Mon-Fri 09:00-17:00" or "Mon-Thu 09:00-15:00, Fri 09:00-12:30". */
export function summarizeDays(days: Hours[]): string {
  const groups: { from: number; to: number; h: Hours }[] = [];
  WEEK_ORDER.forEach((dow, i) => {
    const h = days[dow] ?? null;
    if (!h) return;
    const last = groups[groups.length - 1];
    if (last && last.to === i - 1 && last.h && last.h.start === h.start && last.h.end === h.end) last.to = i;
    else groups.push({ from: i, to: i, h });
  });
  if (groups.length === 0) return 'No working days';
  const name = (i: number) => WEEKDAYS[WEEK_ORDER[i]!]!.short;
  return groups.map((g) => `${g.from === g.to ? name(g.from) : `${name(g.from)}–${name(g.to)}`} ${g.h!.start}–${g.h!.end}`).join(', ');
}

/** The seven day chips of a profile; off days are greyed. */
export function WeekStrip({ days }: { days: Hours[] }) {
  return (
    <ul className="grid grid-cols-7 gap-1.5" aria-label="Weekly hours">
      {WEEK_ORDER.map((dow) => {
        const h = days[dow] ?? null;
        return (
          <li
            key={dow}
            className={cn('flex flex-col items-center rounded-md border px-1 py-1.5 text-center', h ? 'border-primary/25 bg-primary-subtle' : 'border-dashed bg-muted/40 text-muted-foreground/70')}
            aria-label={`${WEEKDAYS[dow]!.name}: ${h ? `${h.start} to ${h.end}` : 'day off'}`}
          >
            <span className={cn('text-[11px] font-semibold uppercase tracking-wide', h ? 'text-primary-text' : '')}>{WEEKDAYS[dow]!.short}</span>
            {h ? (
              <span className="mt-0.5 font-mono text-[10px] leading-tight tabular-nums text-foreground">
                {h.start}
                <br />
                {h.end}
              </span>
            ) : (
              <span className="mt-0.5 text-[10px] leading-tight">Off</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** One line per version: "From 24 Nov 2026: Mon-Fri 09:00-17:00, grace 15/15 - by admin@...". Newest first. */
export function VersionHistory({ versions, compact }: { versions: TimingVersion[]; compact?: boolean }) {
  if (versions.length === 0) return null;
  const sorted = [...versions].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return (
    <ol className="space-y-1.5" aria-label="Version history">
      {sorted.map((v, i) => (
        <li key={`${v.effectiveFrom}-${v.createdAt}`} className={cn('flex gap-2 text-[12px] leading-snug', compact ? 'text-muted-foreground' : '')}>
          <span aria-hidden="true" className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', i === 0 ? 'bg-primary' : 'bg-border-strong')} />
          <span>
            <span className="font-medium text-foreground">From {formatDate(v.effectiveFrom)}:</span> {summarizeDays(v.days)}, grace {v.graceLateMinutes}/{v.graceEarlyMinutes}
            {v.createdBy ? <span className="text-muted-foreground"> {'—'} by {v.createdBy}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

export interface NumberStepperProps {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  id?: string;
  'aria-label'?: string;
  className?: string;
}

/** Numeric input with - / + buttons. Typing is allowed; the value is clamped on blur. */
export function NumberStepper({ value, onChange, min = 0, max = 240, step = 5, suffix, id, className, ...rest }: NumberStepperProps) {
  const field = useFieldProps({ id });
  const [text, setText] = React.useState(String(value));
  React.useEffect(() => setText(String(value)), [value]);
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
  const commit = () => {
    const n = Number(text);
    const next = text.trim() === '' || Number.isNaN(n) ? value : clamp(n);
    setText(String(next));
    onChange(next);
  };
  const btn = 'grid h-full w-9 place-content-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-40 [&_svg]:size-3.5';
  return (
    <div className={cn(controlBase, 'flex h-9 w-auto items-stretch overflow-hidden p-0', className)}>
      <button type="button" aria-label="Decrease" className={cn(btn, 'border-r')} disabled={value <= min} onClick={() => onChange(clamp(value - step))}>
        <Minus aria-hidden="true" />
      </button>
      <input
        id={field.id}
        inputMode="numeric"
        aria-label={rest['aria-label']}
        aria-describedby={field['aria-describedby']}
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            onChange(clamp(value + 1));
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            onChange(clamp(value - 1));
          }
        }}
        className="w-12 bg-transparent text-center font-mono text-[13px] tabular-nums outline-none"
      />
      {suffix && <span className="flex items-center pr-2 text-xs text-muted-foreground">{suffix}</span>}
      <button type="button" aria-label="Increase" className={cn(btn, 'border-l')} disabled={value >= max} onClick={() => onChange(clamp(value + step))}>
        <Plus aria-hidden="true" />
      </button>
    </div>
  );
}
