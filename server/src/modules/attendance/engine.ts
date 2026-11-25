import type { AttendanceDay, DayStatus } from '@nacta/shared';
import { addDays, daysBetween, type LocalNow } from '../../lib/dates';
import { dayKind, type ResolvedTiming } from './resolve';

// The attendance rules engine: a pure function from one employee-day's inputs to its computed status.

export type LeavePart = 'full' | 'first_half' | 'second_half';

export interface EngineEmployee {
  id: number;
  empCode: string;
  name: string;
  wingName: string | null;
  sectionName: string | null;
  designation: string | null;
  hasPhoto: boolean;
  /** YYYY-MM-DD or null (unknown: active from the start). */
  joinDate: string | null;
  status: 'active' | 'disabled' | 'left';
  /** Local date the status last changed (disabled / left). */
  statusChangedDate: string | null;
  /** Last working day for status "left". */
  leftDate: string | null;
}

export interface EngineLeave {
  leaveId: number;
  typeName: string;
  code: string;
  color: string;
  part: LeavePart;
  countsAsPresent: boolean;
}

export interface EngineCorrection {
  id: number;
  type: 'add_punch' | 'set_status';
  /** HH:mm, for add_punch. */
  time: string | null;
  status: 'present' | 'absent' | 'half_day' | null;
}

export interface EngineInput {
  /** The calendar date being computed. */
  date: string;
  /** Server-local "now" (Asia/Karachi). */
  now: LocalNow;
  employee: EngineEmployee;
  /** The rules in force for this employee on this date. */
  timing: ResolvedTiming;
  /** Holidays / special working days that cover this date and apply to the employee's wing. */
  holidays: { name: string; kind: 'holiday' | 'working_day' }[];
  leave: EngineLeave | null;
  corrections: EngineCorrection[];
  /**
   * Device-local punches that belong to this day, from every device: "HH:mm[:ss]" on `date`, or a full
   * "YYYY-MM-DD HH:mm:ss" (a night shift's morning punches fall on the next calendar date).
   */
  punches: string[];
}

export type EngineDay = AttendanceDay & {
  /** The leave type counts as present in summaries (official duty). */
  leaveCountsPresent: boolean;
};

const toMin = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toSec = (t: string): number => toMin(t) * 60 + (t.length >= 8 ? Number(t.slice(6, 8)) : 0);
/** Seconds from midnight of `date`; a punch on a later date counts past 24:00. */
const secOn = (date: string, p: string): number => {
  if (p.length > 10 && p[10] === ' ') return daysBetween(date, p.slice(0, 10)) * 86_400 + toSec(p.slice(11));
  return toSec(p);
};
/** Clock time for display; a time past midnight shows as the next morning's clock time. */
const hhmm = (min: number): string => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Day boundaries after which "no punch" means absent: office end + 2 hours. */
export const DAY_OVER_AFTER_END_MINUTES = 120;

/**
 * Where one attendance day hands over to the next around a night shift, in minutes from midnight: halfway through
 * the off-duty gap between the shift's end (next morning) and its start. 17:00-09:00 -> 13:00, 22:00-06:00 -> 14:00.
 * Punches before it on the next calendar date still belong to the night shift that started the day before.
 */
export function overnightAnchorMinutes(h: { start: string; end: string }): number {
  return Math.floor((toMin(h.start) + toMin(h.end)) / 2);
}

/**
 * Where the attendance day of a date begins, in minutes after its midnight, from the scheduled hours of that date and
 * the date before (null = day off). Normally midnight. A night shift's day begins at its anchor; the day after a night
 * shift begins once that shift's morning is over, so the check-out is never counted twice. Each day's punches are
 * those from its own beginning up to the next day's beginning.
 */
export function dayStartMinutes(own: { start: string; end: string } | null, prev: { start: string; end: string } | null): number {
  if (own && own.end < own.start) return overnightAnchorMinutes(own);
  if (prev && prev.end < prev.start) {
    if (!own) return overnightAnchorMinutes(prev);
    // A day shift right after a night shift: split between the night's end and the day's start.
    const prevEnd = toMin(prev.end);
    return Math.floor((prevEnd + Math.max(toMin(own.start), prevEnd)) / 2);
  }
  return 0;
}

export function isInactive(e: EngineEmployee, date: string): boolean {
  if (e.joinDate && date < e.joinDate) return true;
  if (e.status === 'disabled') return e.statusChangedDate === null || date >= e.statusChangedDate;
  if (e.status === 'left') {
    const from = e.leftDate ? addDays(e.leftDate, 1) : e.statusChangedDate;
    return from === null || date >= from;
  }
  return false;
}

export function computeDay(input: EngineInput): EngineDay {
  const { date, now, employee, timing } = input;
  const base: EngineDay = {
    employeeId: employee.id,
    empCode: employee.empCode,
    name: employee.name,
    wingName: employee.wingName,
    sectionName: employee.sectionName,
    designation: employee.designation,
    hasPhoto: employee.hasPhoto,
    date,
    status: 'pending',
    earlyLeave: false,
    lateMinutes: 0,
    earlyMinutes: 0,
    firstIn: null,
    lastOut: null,
    workedMinutes: 0,
    punchCount: 0,
    leave: null,
    holiday: null,
    timing: null,
    corrected: false,
    leaveCountsPresent: false,
  };

  if (isInactive(employee, date)) return { ...base, status: 'inactive' };

  // ---- what kind of day is it ----
  const kind = dayKind(timing, date, input.holidays);
  // A night shift (end earlier than start) runs into the next morning: its end is counted past 24:00.
  const night = kind.kind === 'working' && kind.hours.end < kind.hours.start;

  // ---- punches (device punches plus manual ones from corrections) ----
  const manual = input.corrections.filter((c) => c.type === 'add_punch' && c.time);
  const override = [...input.corrections].filter((c) => c.type === 'set_status' && c.status).sort((a, b) => b.id - a.id)[0];
  // On a night shift a manual punch earlier in the clock than the middle of the off-duty gap is the next morning's
  // (e.g. 17:00-09:00: a correction at 08:55 is the check-out, one at 16:50 the check-in).
  const nightSplit = night && kind.kind === 'working' ? overnightAnchorMinutes(kind.hours) * 60 : 0;
  const manualSec = (t: string) => (night && toSec(t) < nightSplit ? toSec(t) + 86_400 : toSec(t));
  const secs = [...input.punches.map((p) => secOn(date, p)), ...manual.map((c) => manualSec(c.time as string))].sort((a, b) => a - b);
  const corrected = manual.length > 0 || !!override;
  base.corrected = corrected;
  base.punchCount = secs.length;
  const first = secs[0];
  const last = secs[secs.length - 1];
  const hasOut = first !== undefined && last !== undefined && last - first >= 60;
  if (first !== undefined) base.firstIn = hhmm(Math.floor(first / 60));
  if (hasOut && last !== undefined) base.lastOut = hhmm(Math.floor(last / 60));
  const firstMin = first !== undefined ? Math.floor(first / 60) : null;
  const lastMin = hasOut && last !== undefined ? Math.floor(last / 60) : null;
  base.workedMinutes = hasOut && first !== undefined && last !== undefined ? Math.floor((last - first) / 60) : 0;

  const finish =(status: DayStatus, extra: Partial<EngineDay> = {}): EngineDay => {
    const day: EngineDay = { ...base, ...extra, status };
    if (override) day.status = override.status as DayStatus;
    return day;
  };

  if (kind.kind === 'holiday') return finish('holiday', { holiday: { name: kind.name } });
  if (kind.kind === 'weekend') return finish('weekend');

  const { start, end } = kind.hours;
  base.timing = { profileName: timing.profileName, start, end };
  const startMin = toMin(start);
  const endMin = toMin(end) + (night ? 1440 : 0);
  // "now" in minutes from midnight of `date` (a night shift is still running the next morning).
  const nowMin = daysBetween(date, now.date) * 1440 + now.minutes;
  const over = night ? nowMin > endMin + DAY_OVER_AFTER_END_MINUTES : date < now.date || (date === now.date && now.minutes > endMin + DAY_OVER_AFTER_END_MINUTES);
  const closed = night ? nowMin >= endMin : date < now.date || (date === now.date && now.minutes >= endMin);
  const leave = input.leave;
  if (leave) {
    base.leave = { leaveId: leave.leaveId, typeName: leave.typeName, code: leave.code, color: leave.color, part: leave.part };
    base.leaveCountsPresent = leave.countsAsPresent;
  }

  if (leave && leave.part === 'full') return finish('leave');

  // The part of the day the employee is expected to work (the whole day, or the half not on leave).
  const mid = Math.floor((startMin + endMin) / 2);
  const workStart = leave?.part === 'first_half' ? mid : startMin;
  const workEnd = leave?.part === 'second_half' ? mid : endMin;

  // Lateness / early departure are measured against the working window.
  const flags: Partial<EngineDay> = {};
  const late = firstMin !== null && firstMin > workStart + timing.graceLate;
  if (late && firstMin !== null) flags.lateMinutes = firstMin - workStart;
  const leftEarly = closed && lastMin !== null && lastMin < workEnd - timing.graceEarly;
  if (leftEarly && lastMin !== null) {
    flags.earlyLeave = true;
    flags.earlyMinutes = workEnd - lastMin;
  }

  if (secs.length === 0) {
    if (leave) return finish(over ? 'half_day' : 'pending', flags); // half-day leave, other half not worked
    return finish(over ? 'absent' : 'pending');
  }

  if (leave) {
    // Half-day leave: present when the punches cover the half that was not on leave.
    // Covered: they stayed to the end of the working half and worked at least half of it.
    const covered = lastMin !== null && firstMin !== null && lastMin >= workEnd - timing.graceEarly && lastMin - firstMin >= (workEnd - workStart) / 2;
    if (covered) return finish(late ? 'late' : 'present', flags);
    if (!over && !closed) return finish(late ? 'late' : 'present', flags); // still in progress
    return finish('half_day', flags);
  }

  if (over && !hasOut) return finish('incomplete', flags);
  if (closed && hasOut && base.workedMinutes < timing.halfDayBelow) return finish('half_day', flags);
  return finish(late ? 'late' : 'present', flags);
}
