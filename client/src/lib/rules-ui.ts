import { DAY_STATUS_LABEL } from '@nacta/shared';
import type { AttendanceDay, DayStatus, Holiday, TimingProfile } from '@nacta/shared';
import type { CSSProperties } from 'react';
import { addDaysYmd, parseYmd } from './dates';

export const PAGE_SIZE_DAILY = 50;

/** Visual language for every computed status (pill tone + calendar cell classes). Leave uses its own type colour. */
export const STATUS_STYLE: Record<DayStatus, { tone: 'success' | 'warning' | 'info' | 'danger' | 'primary' | 'neutral' | 'outline'; cell: string; swatch: string }> = {
  present: { tone: 'success', cell: 'bg-success-subtle text-success-text', swatch: 'bg-success' },
  late: { tone: 'warning', cell: 'bg-warning-subtle text-warning-text', swatch: 'bg-warning' },
  half_day: { tone: 'info', cell: 'bg-info-subtle text-info-text', swatch: 'bg-info' },
  incomplete: { tone: 'warning', cell: 'bg-warning-subtle/60 text-warning-text ring-1 ring-inset ring-warning/40', swatch: 'bg-warning/50' },
  absent: { tone: 'danger', cell: 'bg-danger-subtle text-danger-text', swatch: 'bg-danger' },
  leave: { tone: 'primary', cell: 'bg-primary-subtle text-primary-text', swatch: 'bg-primary' },
  holiday: { tone: 'primary', cell: 'bg-primary-subtle/60 text-primary-text', swatch: 'bg-primary/50' },
  weekend: { tone: 'neutral', cell: 'bg-muted/40 text-muted-foreground', swatch: 'bg-border-strong' },
  pending: { tone: 'outline', cell: 'bg-muted/60 text-muted-foreground', swatch: 'bg-muted-foreground/40' },
  inactive: { tone: 'neutral', cell: 'bg-transparent text-muted-foreground/50', swatch: 'bg-transparent' },
};

export const statusLabel = (s: DayStatus) => DAY_STATUS_LABEL[s];

/** Inline style that tints a leave-type colour so it reads in both themes (never hard-coded per type). */
export function leaveTint(color: string): CSSProperties {
  return {
    backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`,
    color: `color-mix(in srgb, ${color} 62%, rgb(var(--foreground)))`,
  };
}
export function leaveSolid(color: string): CSSProperties {
  return { backgroundColor: `color-mix(in srgb, ${color} 78%, transparent)`, color: '#fff' };
}

/** 95 -> "1h 35m"; 0 -> "0m". */
export function formatMinutes(min: number): string {
  if (min <= 0) return '0m';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/** "HH:mm" + minutes -> "HH:mm". */
/**
 * For a night shift: the clock time where its day hands over to the next (halfway through the off-duty gap, the same
 * rule the server uses). 17:00-09:00 -> "13:00". Punches before it on the next date belong to the shift.
 */
export function nightSplitTime(h: { start: string; end: string }): string {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const mid = Math.floor((m(h.start) + m(h.end)) / 2);
  return `${String(Math.floor(mid / 60)).padStart(2, '0')}:${String(mid % 60).padStart(2, '0')}`;
}

export function addToTime(t: string, delta: number): string {
  const [h = 0, m = 0] = t.split(':').map(Number);
  const total = Math.min(24 * 60 - 1, Math.max(0, h * 60 + m + delta));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Sat 30 Nov" */
export function dayLabel(ymd: string): string {
  const d = parseYmd(ymd);
  return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
}
/** "24-26 Nov", "30 Nov - 2 Dec", "24 Nov". */
export function rangeLabel(from: string, to: string): string {
  const a = parseYmd(from);
  const b = parseYmd(to);
  if (from === to) return `${a.getDate()} ${MON[a.getMonth()]}`;
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${a.getDate()}–${b.getDate()} ${MON[b.getMonth()]}`;
  return `${a.getDate()} ${MON[a.getMonth()]} – ${b.getDate()} ${MON[b.getMonth()]}`;
}

export interface HolidayHit {
  holiday: Holiday;
}

/** Holiday (kind=holiday) covering the date for everyone, or for the given wing. */
export function holidayOn(date: string, holidays: Holiday[] | undefined, wingId?: number | null): Holiday | null {
  if (!holidays) return null;
  for (const h of holidays) {
    if (h.kind !== 'holiday' || date < h.from || date > h.to) continue;
    if (h.wingIds.length === 0 || (wingId != null && h.wingIds.includes(wingId))) return h;
  }
  return null;
}

export function specialWorkingOn(date: string, holidays: Holiday[] | undefined): Holiday | null {
  return holidays?.find((h) => h.kind === 'working_day' && date >= h.from && date <= h.to && h.wingIds.length === 0) ?? null;
}

export interface WorkingDayEstimate {
  count: number;
  total: number;
  skipped: { date: string; reason: 'weekend' | 'holiday'; name?: string }[];
}

/** Client-side ESTIMATE of working days (the server's `workingDays` is authoritative). Uses the default profile and all-wings holidays. */
export function estimateWorkingDays(from: string, to: string, holidays: Holiday[] | undefined, profile: TimingProfile | undefined): WorkingDayEstimate {
  const out: WorkingDayEstimate = { count: 0, total: 0, skipped: [] };
  if (!from || !to || to < from) return out;
  let cursor = from;
  for (let guard = 0; guard < 400 && cursor <= to; guard++) {
    out.total++;
    const dow = parseYmd(cursor).getDay();
    const hol = holidayOn(cursor, holidays);
    const off = profile ? profile.days[dow] == null : dow === 0 || dow === 6;
    const special = specialWorkingOn(cursor, holidays);
    if (hol) out.skipped.push({ date: cursor, reason: 'holiday', name: hol.name });
    else if (off && !special) out.skipped.push({ date: cursor, reason: 'weekend' });
    else out.count++;
    cursor = addDaysYmd(cursor, 1);
  }
  return out;
}

/** "skips Sat 30 Nov, Sun 1 Dec and the 2 Dec holiday (Youm-e-X)". */
export function describeSkipped(e: WorkingDayEstimate): string {
  if (e.skipped.length === 0) return '';
  const parts = e.skipped.map((s) => (s.reason === 'weekend' ? dayLabel(s.date) : `the ${dayLabel(s.date).split(' ').slice(1).join(' ')} holiday`));
  const shown = parts.length > 4 ? [...parts.slice(0, 3), `${parts.length - 3} more days`] : parts;
  const list = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0];
  return `skips ${list}`;
}

/** The explanation line in the timing editor. */
export function explainTiming(startTime: string | null, endTime: string | null, graceLate: number, graceEarly: number, halfDayBelow: number): string {
  if (!startTime || !endTime) return 'Switch on at least one working day to see how late, early and half days are decided.';
  const night = endTime < startTime;
  return `${night ? `Night shift: ${startTime} to ${endTime} the next morning, counted on the day it starts. ` : ''}Arriving after ${addToTime(startTime, graceLate)} is late; leaving before ${addToTime(endTime, -graceEarly)}${night ? ' the next morning' : ''} is early; under ${formatMinutes(halfDayBelow)} worked is a half day.`;
}

/** Plain-language reason for a computed day (shown in the day panel). */
export function explainDay(d: AttendanceDay): string {
  const hours = d.timing ? `${d.timing.profileName}, ${d.timing.start}\u2013${d.timing.end}${d.timing.end < d.timing.start ? ' next day' : ''}` : null;
  const corrected = d.corrected ? ' A correction was applied to this day.' : '';
  switch (d.status) {
    case 'present':
      return `Arrived ${d.firstIn ?? '-'}${d.lastOut ? ` and left ${d.lastOut}` : ''}, within the grace period${hours ? ` (${hours})` : ''}.${corrected}`;
    case 'late':
      return `First punch at ${d.firstIn}, ${d.lateMinutes} minutes after the start time${hours ? ` (${hours})` : ''}.${d.earlyLeave ? ` Left ${d.earlyMinutes} minutes early.` : ''}${corrected}`;
    case 'half_day':
      return d.leave
        ? `${d.leave.typeName} (${d.leave.part === 'first_half' ? 'first half' : 'second half'}) is marked${d.workedMinutes ? `; worked ${formatMinutes(d.workedMinutes)}` : ''}.${corrected}`
        : `Worked only ${formatMinutes(d.workedMinutes)}, under the half-day threshold${hours ? ` (${hours})` : ''}.${corrected}`;
    case 'incomplete':
      return `Only one punch (${d.firstIn ?? d.lastOut ?? '-'}) on a finished day: the arrival or the departure is missing. A correction can add the missing punch.${corrected}`;
    case 'absent':
      return `A working day with no punch and no leave${hours ? ` (${hours})` : ''}.${corrected}`;
    case 'leave':
      return `${d.leave?.typeName ?? 'Leave'} is marked for this day.${corrected}`;
    case 'holiday':
      return `${d.holiday?.name ?? 'Holiday'}: the office is closed.`;
    case 'weekend':
      return 'A day off in the office timings.';
    case 'pending':
      return 'No punch yet. This is not counted as absent until the day ends.';
    case 'inactive':
      return 'The employee was not active on this date.';
  }
}
