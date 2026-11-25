import {
  DAY_STATUSES,
  DAY_STATUS_CODE,
  DAY_STATUS_LABEL,
  LEAVE_PART_LABEL,
  REPORT_TYPES,
  zReportParams,
  type AttendanceDay,
  type DayStatus,
  type ReportType,
  type StatusCell,
  type WingScope,
} from '@nacta/shared';
import { pool } from '../../db/pool';
import { addDays, daysBetween, localNowAt, todayLocal, weekdayOf } from '../../lib/dates';
import { MAX_INT, validationError } from '../../lib/errors';
import { inScope } from '../../lib/scope';
import { parseQuery } from '../../lib/validate';
import { getDaysFor, listEmployeeIds } from '../attendance/days';
import type { ReportContext, ReportParams } from './types';

// ---------------------------------------------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------------------------------------------
export const MAX_RANGE_DAYS = 366;
export const MAX_PUNCH_RANGE_DAYS = 92;
/** Most rows one report may hold (on screen or in a file). */
export const MAX_REPORT_ROWS = 100_000;
/** The PDF engine lays out every row in memory; beyond this Excel is the right format. */
export const MAX_PDF_ROWS = 25_000;
/** Employee-days a report may read before it asks for a narrower selection. */
export const MAX_GRID_CELLS = 500_000;

// ---------------------------------------------------------------------------------------------------------------
// Colours (the application palette for statuses; leave types bring their own)
// ---------------------------------------------------------------------------------------------------------------
export const STATUS_COLOR: Record<DayStatus, string> = {
  present: '#047857',
  late: '#B45309',
  half_day: '#1D4ED8',
  incomplete: '#A16207',
  absent: '#B91C1C',
  leave: '#2563EB',
  holiday: '#0E7490',
  weekend: '#64748B',
  pending: '#94A3B8',
  inactive: '#94A3B8',
};

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16) || 0, parseInt(v.slice(2, 4), 16) || 0, parseInt(v.slice(4, 6), 16) || 0];
};
const rgbToHex = (r: number, g: number, b: number): string =>
  [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('').toUpperCase();

/** A light tint of a colour (mix with white). amount 0..1 = how much white. Returns RRGGBB (no #). */
export function tint(hex: string, amount = 0.86): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}
/** A dark ink derived from a colour (mix with black). Returns RRGGBB (no #). */
export function ink(hex: string, amount = 0.38): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

// ---------------------------------------------------------------------------------------------------------------
// Date formatting ("24 Nov 2026")
// ---------------------------------------------------------------------------------------------------------------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const parts = (s: string): [number, number, number] => s.split('-').map(Number) as [number, number, number];
export const fmtDate = (s: string): string => {
  const [y, m, d] = parts(s);
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
};
export const weekdayName = (s: string): string => WEEKDAYS_FULL[weekdayOf(s)] as string;
export const weekdayShort = (s: string): string => WEEKDAYS_SHORT[weekdayOf(s)] as string;
export const monthLabel = (ym: string): string => {
  const [y, m] = parts(`${ym}-01`);
  return `${MONTHS_FULL[m - 1]} ${y}`;
};
/** "1-30 Nov 2026", "28 Oct 2026 - 05 Nov 2026" or a single date. */
export function fmtRange(from: string, to: string): string {
  if (from === to) return fmtDate(from);
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  if (fy === ty && fm === tm) return `${fd}–${td} ${MONTHS[tm - 1]} ${ty}`;
  return `${fmtDate(from)} – ${fmtDate(to)}`;
}
/** "24 Nov 2026, 16:40" in Pakistan time. */
export function fmtGenerated(d: Date): string {
  const n = localNowAt(d);
  return `${fmtDate(n.date)}, ${String(Math.floor(n.minutes / 60)).padStart(2, '0')}:${String(n.minutes % 60).padStart(2, '0')}`;
}
export const monthBounds = (ym: string): { from: string; to: string } => {
  const from = `${ym}-01`;
  const [y, m] = parts(from);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { from, to: addDays(next, -1) };
};

// ---------------------------------------------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------------------------------------------
export function resolveParams(type: ReportType, query: unknown): ReportParams {
  const raw = parseQuery(zReportParams, query);
  const today = todayLocal();
  const bad = (field: string, message: string) => validationError('Invalid query', { [field]: message });
  for (const k of ['wingId', 'sectionId', 'employeeId', 'deviceId', 'leaveTypeId'] as const) {
    if ((raw[k] ?? 0) > MAX_INT) throw bad(k, `${k} is out of range`);
  }

  // The shared contract lists daily without q, and punch_log without sectionId and q; the client uses them.
  const extra: Partial<Record<ReportType, string[]>> = { daily: ['q'], punch_log: ['sectionId', 'q'] };
  const allowed = [...(REPORT_TYPES[type].params as readonly string[]), ...(extra[type] ?? [])];
  const qRaw = (query as Record<string, unknown> | null | undefined)?.q;
  const q = typeof qRaw === 'string' && qRaw.trim() ? qRaw.trim().slice(0, 100) : undefined;
  const use = <T>(key: string, v: T): T | undefined => (allowed.includes(key) ? v : undefined);

  const date = raw.date ?? today;
  const month = raw.month ?? today.slice(0, 7);
  let from: string;
  let to: string;
  if (type === 'daily') {
    from = to = date;
  } else if (type === 'monthly_register') {
    ({ from, to } = monthBounds(month));
  } else if (type === 'punch_log') {
    from = raw.from ?? raw.to ?? today;
    to = raw.to ?? (today >= from ? today : from);
  } else {
    to = raw.to ?? (raw.from ? (today >= raw.from ? today : raw.from) : today);
    from = raw.from ?? to.slice(0, 8) + '01';
  }
  if (to < from) throw bad('to', 'Must be on or after the start date');
  const limit = type === 'punch_log' ? MAX_PUNCH_RANGE_DAYS : MAX_RANGE_DAYS;
  if (daysBetween(from, to) + 1 > limit) throw bad('to', `At most ${limit} days at a time`);

  let status: string | undefined;
  if (type === 'daily' && raw.status !== undefined) {
    if (!(DAY_STATUSES as readonly string[]).includes(raw.status)) throw bad('status', `Status must be one of: ${DAY_STATUSES.join(', ')}`);
    status = raw.status;
  }
  if (type === 'time_card' && raw.employeeId === undefined) throw bad('employeeId', 'Choose an employee');

  return {
    date,
    month,
    from,
    to,
    wingId: use('wingId', raw.wingId),
    sectionId: use('sectionId', raw.sectionId),
    employeeId: use('employeeId', raw.employeeId),
    deviceId: use('deviceId', raw.deviceId),
    leaveTypeId: use('leaveTypeId', raw.leaveTypeId),
    status,
    q: use('q', q),
    minLateMinutes: use('minLateMinutes', raw.minLateMinutes) ?? 0,
    page: raw.page,
    pageSize: raw.pageSize,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Names for subtitles / file names
// ---------------------------------------------------------------------------------------------------------------
export interface Names {
  wing: string | null;
  section: string | null;
  leaveType: string | null;
  device: string | null;
  employee: { code: string; name: string } | null;
  /** "Operations Wing" / "All wings" / the caller's own wing when they have exactly one. */
  scopeLabel: string;
}

export async function lookupNames(p: ReportParams, scope: WingScope): Promise<Names> {
  const one = async <T>(sql: string, id: number | undefined): Promise<T | null> =>
    id === undefined ? null : ((await pool.query<T & Record<string, unknown>>(sql, [id])).rows[0] ?? null);
  const [w, s, lt, d, e] = await Promise.all([
    one<{ name: string; id: number }>('SELECT id, name FROM wings WHERE id = $1', p.wingId),
    one<{ name: string; wing_id: number }>('SELECT name, wing_id FROM sections WHERE id = $1', p.sectionId),
    one<{ name: string; code: string }>('SELECT name, code FROM leave_types WHERE id = $1', p.leaveTypeId),
    one<{ name: string }>('SELECT name FROM devices WHERE id = $1', p.deviceId),
    one<{ emp_code: string; name: string; wing_id: number | null }>('SELECT emp_code, name, wing_id FROM employees WHERE id = $1', p.employeeId),
  ]);
  // Never reveal the name of a wing or person outside the caller's scope.
  const wing = w && inScope(scope, w.id) ? w.name : w ? 'Selected wing' : null;
  const section = s && inScope(scope, s.wing_id) ? s.name : s ? 'Selected section' : null;
  const employee = e && inScope(scope, e.wing_id) ? { code: e.emp_code, name: e.name } : null;
  let scopeLabel = 'All Wings';
  if (wing) scopeLabel = wing;
  else if (scope !== 'all') {
    if (scope.length === 1) {
      const r = await pool.query<{ name: string }>('SELECT name FROM wings WHERE id = $1', [scope[0]]);
      scopeLabel = r.rows[0]?.name ?? 'Assigned Wings';
    } else scopeLabel = 'Assigned Wings';
  }
  return { wing, section, leaveType: lt ? `${lt.code} ${lt.name}` : null, device: d?.name ?? null, employee, scopeLabel };
}

/** "Wing: Operations Wing  |  Section: Records" for the file header (screen subtitles use the short form). */
export function filtersText(p: ReportParams, n: Names, extra: string[] = []): string {
  const out: string[] = [`Wing: ${n.wing ?? n.scopeLabel}`];
  if (p.sectionId !== undefined) out.push(`Section: ${n.section ?? 'Selected section'}`);
  if (p.status) out.push(`Status: ${DAY_STATUS_LABEL[p.status as DayStatus]}`);
  if (p.leaveTypeId !== undefined) out.push(`Leave type: ${n.leaveType ?? 'Selected type'}`);
  if (p.deviceId !== undefined) out.push(`Device: ${n.device ?? 'Selected device'}`);
  if (p.employeeId !== undefined && n.employee) out.push(`Employee: ${n.employee.code} ${n.employee.name}`);
  if (p.q) out.push(`Search: ${p.q}`);
  if (p.minLateMinutes > 0) out.push(`Minimum lateness: ${p.minLateMinutes} min`);
  return [...out, ...extra].join('   |   ');
}

/** ASCII-safe file name part. */
export const slug = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'All';

// ---------------------------------------------------------------------------------------------------------------
// Attendance days
// ---------------------------------------------------------------------------------------------------------------
export const round1 = (n: number): number => Math.round(n * 10) / 10;
export const round2 = (n: number): number => Math.round(n * 100) / 100;
export const hoursOf = (minutes: number): number => round2(minutes / 60);
export const pct = (num: number, den: number): number | null => (den > 0 ? round1((100 * num) / den) : null);

/** Employees' days in scope for the filters, ordered by wing, name, date. Refuses grids that are too large. */
export async function loadDays(
  ctx: ReportContext,
  filter: { wingId?: number | undefined; sectionId?: number | undefined; q?: string | undefined; employeeIds?: number[] },
  range: { from: string; to: string },
  status?: DayStatus,
): Promise<AttendanceDay[]> {
  const ids = await listEmployeeIds(ctx.scope, filter);
  const nDays = daysBetween(range.from, range.to) + 1;
  if (ids.length * nDays > MAX_GRID_CELLS) {
    throw validationError('This report is too large', { to: `Narrow the date range or choose a wing (${ids.length} employees x ${nDays} days)` });
  }
  const days = await getDaysFor(ids, range.from, range.to);
  const sorted = [...days].sort((a, b) => {
    const wa = a.wingName === null ? '￿' : a.wingName.toLowerCase();
    const wb = b.wingName === null ? '￿' : b.wingName.toLowerCase();
    return wa < wb ? -1 : wa > wb ? 1 : 0;
  });
  return status ? sorted.filter((d) => d.status === status) : sorted;
}

export interface LeaveTypeInfo {
  code: string;
  name: string;
  color: string;
  countsAsPresent: boolean;
}
export async function leaveTypeMap(): Promise<Map<string, LeaveTypeInfo>> {
  const { rows } = await pool.query<{ code: string; name: string; color: string; counts_as_present: boolean }>(
    'SELECT code, name, color, counts_as_present FROM leave_types',
  );
  return new Map(rows.map((r) => [r.code, { code: r.code, name: r.name, color: r.color, countsAsPresent: r.counts_as_present }]));
}

/** Employee-days where someone was expected to attend (same definition as GET /attendance/day-summary). */
export const isExpected = (d: AttendanceDay): boolean =>
  d.status === 'present' || d.status === 'late' || d.status === 'half_day' || d.status === 'incomplete' || d.status === 'absent' || d.status === 'leave';

export const isAttended = (d: AttendanceDay, types: Map<string, LeaveTypeInfo>): boolean =>
  d.status === 'present' ||
  d.status === 'late' ||
  d.status === 'half_day' ||
  (d.status === 'leave' && !!d.leave && types.get(d.leave.code)?.countsAsPresent === true);

export interface Tally {
  present: number;
  late: number;
  halfDay: number;
  missing: number;
  absent: number;
  leave: number;
  expected: number;
  attended: number;
  holiday: number;
  weekend: number;
  worked: number;
  leaveByCode: Map<string, number>;
}
export const emptyTally = (): Tally => ({
  present: 0,
  late: 0,
  halfDay: 0,
  missing: 0,
  absent: 0,
  leave: 0,
  expected: 0,
  attended: 0,
  holiday: 0,
  weekend: 0,
  worked: 0,
  leaveByCode: new Map(),
});
export function addToTally(t: Tally, d: AttendanceDay, types: Map<string, LeaveTypeInfo>): void {
  switch (d.status) {
    case 'present': t.present += 1; break;
    case 'late': t.late += 1; break;
    case 'half_day': t.halfDay += 1; break;
    case 'incomplete': t.missing += 1; break;
    case 'absent': t.absent += 1; break;
    case 'leave':
      t.leave += 1;
      if (d.leave) t.leaveByCode.set(d.leave.code, (t.leaveByCode.get(d.leave.code) ?? 0) + 1);
      break;
    case 'holiday': t.holiday += 1; break;
    case 'weekend': t.weekend += 1; break;
    default:
  }
  if (isExpected(d)) t.expected += 1;
  if (isAttended(d, types)) t.attended += 1;
  t.worked += d.workedMinutes;
}
/** "CL 4  ML 2" (by type, biggest first). */
export const leaveText = (m: Map<string, number>): string =>
  [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c, n]) => `${c} ${n}`).join('   ');

// ---------------------------------------------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------------------------------------------
const leavePartText = (part: 'full' | 'first_half' | 'second_half'): string => LEAVE_PART_LABEL[part];

/** The status cell of a day. Leave always carries its type: "On leave · CL Casual". */
export function statusCellOf(d: AttendanceDay): StatusCell {
  const l = d.leave;
  if (d.status === 'leave' && l) return { code: l.code, label: `On leave · ${l.code} ${l.typeName}`, color: l.color };
  if (d.status === 'half_day' && l) {
    return { code: `${l.code}½`, label: `Half day · ${l.code} ${l.typeName} (${leavePartText(l.part).toLowerCase()})`, color: l.color };
  }
  return { code: DAY_STATUS_CODE[d.status] || '', label: DAY_STATUS_LABEL[d.status], color: STATUS_COLOR[d.status] };
}

/** Short code for a register cell; null = blank (inactive or not yet due). */
export function dayCodeCell(d: AttendanceDay): StatusCell | null {
  if (d.status === 'inactive' || d.status === 'pending') return null;
  if (d.status === 'holiday') return { code: 'HD', label: d.holiday ? `Holiday · ${d.holiday.name}` : 'Holiday', color: STATUS_COLOR.holiday };
  return statusCellOf(d);
}

/** The "leave / holiday / remark" text of a day. */
export function dayNote(d: AttendanceDay): string {
  const out: string[] = [];
  if (d.leave) {
    const part = d.leave.part === 'full' ? '' : ` · ${leavePartText(d.leave.part)}`;
    out.push(`${d.leave.typeName} (${d.leave.code})${part}`);
  }
  if (d.holiday) out.push(d.holiday.name);
  if (d.status === 'incomplete') out.push('Only one punch recorded');
  if (d.earlyLeave) out.push('Left early');
  return out.join(' · ');
}

/** Legend entries (unique by code) in a stable order: base statuses first, then leave types. */
export function legendOf(cells: Iterable<StatusCell | null | undefined>): StatusCell[] {
  const seen = new Map<string, StatusCell>();
  for (const c of cells) if (c && c.code && !seen.has(c.code)) seen.set(c.code, c);
  const base = new Map<string, number>(DAY_STATUSES.map((s, i) => [DAY_STATUS_CODE[s], i]));
  base.set('HD', base.get('HD') ?? 99);
  return [...seen.values()].sort((a, b) => {
    const ia = base.has(a.code) ? (base.get(a.code) as number) : 100;
    const ib = base.has(b.code) ? (base.get(b.code) as number) : 100;
    return ia - ib || a.code.localeCompare(b.code);
  });
}
/** Legend text for a day-code: "Present", "On leave · CL Casual", ... (holiday names collapse to "Holiday"). */
export const legendLabel = (c: StatusCell): string => (c.code === 'HD' ? 'Holiday' : c.label.replace(/ \([^)]*\)$/, ''));

/** Corrections are visible to the Super Admin only. */
export const showCorrected = (ctx: ReportContext): boolean => ctx.isSuperAdmin;

