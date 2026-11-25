/**
 * DEV-ONLY mock of the Phase F attendance-rules endpoints: /attendance/daily|days|day-summary|corrections|recompute,
 * /leaves, /leave-types, /holidays, /timings (+ /timings/setup-status), /timing-assignments.
 * Loaded by auth-mock.ts behind `import.meta.env.DEV`; never part of a production bundle.
 *
 * Demo hooks:
 *   - Office timings start UNCONFIGURED (banner + guided editor); saving the default profile configures them.
 *     Open with ?mockConfigured=1 to start configured.
 *   - Daily statuses are generated deterministically for the first ~60 active employees over the last 60 days.
 *   - Marking leave for someone who already has leave answers 409 LEAVE_OVERLAP until replaceOverlapping is sent.
 */
import { DAY_STATUS_LABEL, LEAVE_PART_LABEL, zCorrectionInput, zHolidayInput, zLeaveInput, zLeaveTypeInput, zLeaveUpdate, zTimingAssignmentInput, zTimingProfileInput, zTimingProfileUpdate } from '@nacta/shared';
import type { AttendanceDay, DayStatus, Permission } from '@nacta/shared';
import { addDaysYmd, parseYmd, todayYmd } from '../lib/dates';
import { getMockRoster } from './employees-mock';

type Handler = (ctx: { method: string; query: URLSearchParams; body: any; params: string[] }) => Response | Promise<Response>;
export interface RulesMockContext {
  can: (p: Permission) => boolean;
}

const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'x-request-id': 'mock-req' } });
const err = (status: number, code: string, message: string, details?: unknown) => json(status, { error: { code, message, details } });
const forbidden = () => err(403, 'FORBIDDEN', 'You do not have permission');
function zodDetails(error: { issues: { path: (string | number)[]; message: string }[] }) {
  const details: Record<string, string> = {};
  for (const i of error.issues) details[String(i.path[0] ?? 'form')] ??= i.message;
  return err(400, 'VALIDATION_ERROR', 'Some values are invalid', details);
}
const pad = (n: number) => String(n).padStart(2, '0');
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMin = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
/** Deterministic 0..1 from two ints. */
function hash(a: number, b: number, salt = 0): number {
  let h = (a * 73856093) ^ (b * 19349663) ^ (salt * 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) % 100000) / 100000;
}
const dayNum = (ymd: string) => Math.floor(parseYmd(ymd).getTime() / 86_400_000);

// ----------------------------------------------------------------------------- data
interface MType { id: number; name: string; code: string; color: string; countsAsPresent: boolean; isActive: boolean }
let types: MType[] = [
  { id: 1, name: 'Casual leave', code: 'CL', color: '#2563EB', countsAsPresent: false, isActive: true },
  { id: 2, name: 'Earned leave', code: 'EL', color: '#7C3AED', countsAsPresent: false, isActive: true },
  { id: 3, name: 'Medical leave', code: 'ML', color: '#DB2777', countsAsPresent: false, isActive: true },
  { id: 4, name: 'Short leave', code: 'SL', color: '#D97706', countsAsPresent: false, isActive: true },
  { id: 5, name: 'Official duty', code: 'OD', color: '#0D9488', countsAsPresent: true, isActive: true },
  { id: 6, name: 'Maternity leave', code: 'MAT', color: '#EA580C', countsAsPresent: false, isActive: true },
  { id: 7, name: 'Leave without pay', code: 'LWP', color: '#64748B', countsAsPresent: false, isActive: true },
];
let nextTypeId = 20;

type Day = { start: string; end: string } | null;
interface MVersion { effectiveFrom: string; days: Day[]; graceLateMinutes: number; graceEarlyMinutes: number; halfDayBelowMinutes: number; createdBy: string | null; createdAt: string }
interface MProfile { id: number; name: string; days: Day[]; graceLateMinutes: number; graceEarlyMinutes: number; halfDayBelowMinutes: number; versions: MVersion[]; isDefault: boolean; createdAt: string; updatedAt: string }
const verOf = (p: Pick<MProfile, 'days' | 'graceLateMinutes' | 'graceEarlyMinutes' | 'halfDayBelowMinutes'>, effectiveFrom: string, by: string | null): MVersion => ({ effectiveFrom, days: p.days, graceLateMinutes: p.graceLateMinutes, graceEarlyMinutes: p.graceEarlyMinutes, halfDayBelowMinutes: p.halfDayBelowMinutes, createdBy: by, createdAt: new Date().toISOString() });
/** The rules of a profile in force on date (history is never rewritten). */
function resolveAt(p: MProfile, date: string): MProfile {
  const v = p.versions.find((x) => x.effectiveFrom <= date) ?? p.versions[p.versions.length - 1]!;
  return { ...p, days: v.days, graceLateMinutes: v.graceLateMinutes, graceEarlyMinutes: v.graceEarlyMinutes, halfDayBelowMinutes: v.halfDayBelowMinutes };
}
function withTopLevel(p: MProfile) {
  p.versions.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  const cur = resolveAt(p, todayYmd());
  p.days = cur.days;
  p.graceLateMinutes = cur.graceLateMinutes;
  p.graceEarlyMinutes = cur.graceEarlyMinutes;
  p.halfDayBelowMinutes = cur.halfDayBelowMinutes;
}
const weekdays = (start: string, end: string) => [null, ...Array.from({ length: 5 }, () => ({ start, end })), null];
const seedVersion = (p: Omit<MProfile, 'versions'>): MProfile => ({ ...p, versions: [verOf(p, '2026-01-01', 'admin@nacta.gov.pk')] });
let profiles: MProfile[] = ([
  { id: 1, name: 'Standard office hours', days: weekdays('09:00', '17:00'), graceLateMinutes: 15, graceEarlyMinutes: 15, halfDayBelowMinutes: 240, isDefault: true, createdAt: iso(30000), updatedAt: iso(30000) },
  { id: 2, name: 'Ramadan hours', days: [null, ...[1, 2, 3, 4].map(() => ({ start: '09:00', end: '15:00' })), { start: '09:00', end: '12:30' }, null], graceLateMinutes: 15, graceEarlyMinutes: 15, halfDayBelowMinutes: 180, isDefault: false, createdAt: iso(20000), updatedAt: iso(20000) },
] as Omit<MProfile, 'versions'>[]).map(seedVersion);
let nextProfileId = 20;
let configured = new URLSearchParams(location.search).get('mockConfigured') === '1';

interface MAssign { id: number; profileId: number; scope: 'all' | 'wing' | 'employee'; scopeId: number | null; effectiveFrom: string; effectiveTo: string | null; label: string | null }
let assignments: MAssign[] = [{ id: 1, profileId: 2, scope: 'all', scopeId: null, effectiveFrom: '2027-02-08', effectiveTo: '2027-03-09', label: 'Ramadan 2027' }];
let nextAssignId = 20;

interface MHoliday { id: number; name: string; from: string; to: string; kind: 'holiday' | 'working_day'; wingIds: number[]; createdAt: string }
let holidays: MHoliday[] = [];
let nextHolidayId = 20;

interface MLeave { id: number; employeeId: number; leaveTypeId: number; from: string; to: string; part: 'full' | 'first_half' | 'second_half'; reason: string | null; createdBy: string | null; createdAt: string }
let leaves: MLeave[] = [];
let nextLeaveId = 100;

interface MCorrection { id: number; employeeId: number; date: string; type: 'add_punch' | 'set_status'; time: string | null; status: string | null; reason: string; createdBy: string | null; createdAt: string }
let corrections: MCorrection[] = [];
let nextCorrectionId = 1;

let seeded = false;
function seed() {
  if (seeded) return;
  seeded = true;
  const today = todayYmd();
  holidays = [
    { id: 1, name: 'Allama Iqbal Day', from: '2026-11-09', to: '2026-11-09', kind: 'holiday', wingIds: [], createdAt: iso(9000) },
    { id: 2, name: 'Make-up working Saturday', from: '2026-12-12', to: '2026-12-12', kind: 'working_day', wingIds: [], createdAt: iso(8000) },
    { id: 3, name: 'Quaid-e-Azam Day', from: '2026-12-25', to: '2026-12-25', kind: 'holiday', wingIds: [], createdAt: iso(8000) },
    { id: 4, name: 'Kashmir Solidarity Day', from: '2027-02-05', to: '2027-02-05', kind: 'holiday', wingIds: [], createdAt: iso(8000) },
    { id: 5, name: 'Pakistan Day', from: '2027-03-23', to: '2027-03-23', kind: 'holiday', wingIds: [], createdAt: iso(8000) },
    { id: 6, name: 'Training Wing foundation day', from: addDaysYmd(today, -20), to: addDaysYmd(today, -20), kind: 'holiday', wingIds: [6], createdAt: iso(7000) },
    { id: 7, name: 'Gazetted holiday (mock)', from: addDaysYmd(today, 9), to: addDaysYmd(today, 10), kind: 'holiday', wingIds: [], createdAt: iso(7000) },
  ];
  const roster = activeRoster();
  const mk = (i: number, typeId: number, from: number, len: number, part: MLeave['part'] = 'full', reason: string | null = null) => {
    const e = roster[i];
    if (!e) return;
    const f = addDaysYmd(today, from);
    leaves.push({ id: nextLeaveId++, employeeId: e.id, leaveTypeId: typeId, from: f, to: addDaysYmd(f, len - 1), part, reason, createdBy: 'Hira Malik', createdAt: iso(2000 + i * 20) });
  };
  mk(1, 1, -1, 3, 'full', 'Family function');
  mk(4, 3, -3, 5, 'full', 'Recovering from flu');
  mk(7, 2, 2, 10, 'full', 'Annual leave');
  mk(9, 5, 0, 2, 'full', 'Training at NACTA academy');
  mk(11, 1, 0, 1, 'first_half', 'Doctor appointment');
  mk(12, 4, 0, 1, 'second_half', null);
  mk(15, 5, 0, 3, 'full', 'Field visit, Peshawar');
  mk(16, 7, 1, 4);
  mk(20, 6, -12, 40, 'full', null);
  mk(22, 1, -25, 2);
  mk(23, 3, -30, 7, 'full', 'Surgery');
  mk(25, 1, 6, 3);
  mk(27, 2, -45, 12);
  mk(30, 1, 0, 1);
  mk(31, 5, 4, 2, 'full', 'Conference, Lahore');
  mk(33, 4, -6, 1, 'first_half');
  mk(35, 1, 12, 1);
  mk(38, 3, -2, 2);
  mk(40, 2, 20, 5);
}

function activeRoster() {
  return getMockRoster()
    .employees.filter((e) => e.status === 'active')
    .slice(0, 60);
}

// ----------------------------------------------------------------------------- engine
function profileFor(empId: number, wingId: number | null, date: string): MProfile {
  const def = profiles.find((p) => p.isDefault)!;
  const applicable = (a: MAssign) => a.effectiveFrom <= date && (!a.effectiveTo || a.effectiveTo >= date);
  const pick = (scope: MAssign['scope'], id: number | null) => {
    const c = assignments.filter((a) => a.scope === scope && (scope === 'all' || a.scopeId === id) && applicable(a));
    c.sort((a, b) => Number(!!b.effectiveTo) - Number(!!a.effectiveTo) || b.effectiveFrom.localeCompare(a.effectiveFrom));
    return c[0];
  };
  const a = pick('employee', empId) ?? (wingId ? pick('wing', wingId) : undefined) ?? pick('all', null);
  return resolveAt((a && profiles.find((p) => p.id === a.profileId)) || def, date);
}

function holidayFor(date: string, wingId: number | null) {
  return holidays.find((h) => h.kind === 'holiday' && date >= h.from && date <= h.to && (h.wingIds.length === 0 || (wingId !== null && h.wingIds.includes(wingId))));
}
function specialWorking(date: string, wingId: number | null) {
  return holidays.find((h) => h.kind === 'working_day' && date >= h.from && date <= h.to && (h.wingIds.length === 0 || (wingId !== null && h.wingIds.includes(wingId))));
}

type Emp = ReturnType<typeof activeRoster>[number];
function wingNameOf(id: number | null) {
  return getMockRoster().wings.find((w) => w.id === id)?.name ?? null;
}
function sectionNameOf(wingId: number | null, sectionId: number | null) {
  return getMockRoster().wings.find((w) => w.id === wingId)?.sections.find((s) => s.id === sectionId)?.name ?? null;
}

function computeDay(e: Emp, date: string): AttendanceDay {
  const today = todayYmd();
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const prof = profileFor(e.id, e.wingId, date);
  const dow = parseYmd(date).getDay();
  const hours = prof.days[dow] ?? null;
  const hol = holidayFor(date, e.wingId);
  const leave = leaves.find((l) => l.employeeId === e.id && date >= l.from && date <= l.to) ?? null;
  const fix = corrections.filter((c) => c.employeeId === e.id && c.date === date);
  const setStatus = fix.find((c) => c.type === 'set_status');
  const addPunch = fix.filter((c) => c.type === 'add_punch');
  const type = leave ? types.find((t) => t.id === leave.leaveTypeId)! : null;

  const base = {
    employeeId: e.id,
    empCode: e.empCode,
    name: e.name,
    wingName: wingNameOf(e.wingId),
    sectionName: sectionNameOf(e.wingId, e.sectionId),
    designation: e.designation,
    hasPhoto: e.hasPhoto,
    date,
    earlyLeave: false,
    lateMinutes: 0,
    earlyMinutes: 0,
    firstIn: null as string | null,
    lastOut: null as string | null,
    workedMinutes: 0,
    punchCount: 0,
    leave: leave && type ? { leaveId: leave.id, typeName: type.name, code: type.code, color: type.color, part: leave.part } : null,
    holiday: hol ? { name: hol.name } : null,
    timing: hours ? { profileName: prof.name, start: hours.start, end: hours.end } : null,
    corrected: fix.length > 0,
  };
  const mkDay = (status: DayStatus, extra: Partial<AttendanceDay> = {}): AttendanceDay => ({ ...base, status, ...extra } as AttendanceDay);

  if (e.joinDate && date < e.joinDate) return mkDay('inactive', { timing: null });
  if (hol) return mkDay('holiday');
  const off = !hours && !specialWorking(date, e.wingId);
  const effHours = hours ?? (specialWorking(date, e.wingId) ? { start: '09:00', end: '14:00' } : null);
  if (off || !effHours) return mkDay('weekend');
  if (leave && leave.part === 'full') return mkDay('leave');
  if (date > today) return mkDay('pending');

  const start = toMin(effHours.start);
  const end = toMin(effHours.end);
  const r = hash(e.id, dayNum(date));
  const r2 = hash(e.id, dayNum(date), 2);
  const r3 = hash(e.id, dayNum(date), 3);
  let kind: 'ok' | 'late' | 'half' | 'miss' | 'absent' = r < 0.7 ? 'ok' : r < 0.84 ? 'late' : r < 0.89 ? 'half' : r < 0.93 ? 'miss' : 'absent';
  if (leave && leave.part !== 'full') kind = r < 0.85 ? 'half' : 'ok';
  if (e.id % 11 === 0 && r < 0.9) kind = 'ok'; // a few exemplary people
  if (e.id % 13 === 0 && r > 0.5) kind = 'late'; // and a few habitual late-comers

  let inMin: number | null = null;
  let outMin: number | null = null;
  if (kind === 'ok') {
    inMin = start - 25 + Math.floor(r2 * (prof.graceLateMinutes + 20));
    outMin = end + Math.floor(r3 * 55) - (r3 < 0.1 ? prof.graceEarlyMinutes + 20 : 0);
  } else if (kind === 'late') {
    inMin = start + prof.graceLateMinutes + 4 + Math.floor(r2 * 55);
    outMin = end + Math.floor(r3 * 40);
  } else if (kind === 'half') {
    inMin = start + 5 + Math.floor(r2 * 20);
    outMin = inMin + 120 + Math.floor(r3 * Math.max(10, prof.halfDayBelowMinutes - 135));
  } else if (kind === 'miss') {
    inMin = start - 5 + Math.floor(r2 * 30);
  }
  for (const p of addPunch) {
    const t = toMin(p.time!);
    if (inMin === null || t < inMin) inMin = t;
    else outMin = t;
  }

  // Today: only punches that have already happened exist yet.
  let finished = date < today || nowMin > end + 30;
  if (date === today) {
    if (inMin !== null && inMin > nowMin) inMin = null;
    if (outMin !== null && outMin > nowMin) outMin = null;
    if (!finished && inMin === null) return setStatus ? override(mkDay('pending'), setStatus.status!) : mkDay('pending');
  }
  if (kind === 'absent' && addPunch.length === 0 && inMin === null) {
    const d = mkDay('absent');
    return setStatus ? override(d, setStatus.status!) : d;
  }
  if (date === today && !finished) outMin = null; // still in the building

  const worked = inMin !== null && outMin !== null ? Math.max(0, outMin - inMin) : 0;
  const lateBy = inMin !== null ? Math.max(0, inMin - start) : 0;
  const isLate = inMin !== null && inMin > start + prof.graceLateMinutes;
  const early = outMin !== null && outMin < end - prof.graceEarlyMinutes;
  let status: DayStatus = 'present';
  if (inMin !== null && outMin === null && finished) status = 'incomplete';
  else if (inMin !== null && outMin !== null && worked < prof.halfDayBelowMinutes) status = 'half_day';
  else if (isLate) status = 'late';
  if (leave && leave.part !== 'full' && status !== 'incomplete') status = 'half_day';
  const day = mkDay(status, {
    firstIn: inMin !== null ? fromMin(inMin) : null,
    lastOut: outMin !== null ? fromMin(outMin) : null,
    workedMinutes: worked,
    lateMinutes: isLate ? lateBy : 0,
    earlyMinutes: early && outMin !== null ? end - outMin : 0,
    earlyLeave: early,
    punchCount: (inMin !== null ? 1 : 0) + (outMin !== null ? 1 : 0),
  });
  return setStatus ? override(day, setStatus.status!) : day;
}

function override(d: AttendanceDay, status: string): AttendanceDay {
  return { ...d, status: status as DayStatus, corrected: true };
}

const toLeave = (l: MLeave) => {
  const e = getMockRoster().employees.find((x) => x.id === l.employeeId);
  const t = types.find((x) => x.id === l.leaveTypeId)!;
  return {
    id: l.id,
    employeeId: l.employeeId,
    empCode: e?.empCode ?? '?',
    employeeName: e?.name ?? 'Unknown',
    wingName: e ? wingNameOf(e.wingId) : null,
    leaveTypeId: t.id,
    leaveTypeName: t.name,
    leaveTypeCode: t.code,
    leaveTypeColor: t.color,
    from: l.from,
    to: l.to,
    part: l.part,
    workingDays: workingDaysFor(e?.id ?? 0, e?.wingId ?? null, l.from, l.to, l.part),
    reason: l.reason,
    createdBy: l.createdBy,
    createdAt: l.createdAt,
  };
};

function workingDaysFor(empId: number, wingId: number | null, from: string, to: string, part: MLeave['part']): number {
  let n = 0;
  for (let d = from, g = 0; d <= to && g < 800; d = addDaysYmd(d, 1), g++) {
    const prof = profileFor(empId, wingId, d);
    const off = !prof.days[parseYmd(d).getDay()] && !specialWorking(d, wingId);
    if (!off && !holidayFor(d, wingId)) n++;
  }
  return part === 'full' ? n : n * 0.5;
}

const toProfile = (p: MProfile) => ({ ...p, assignmentCount: assignments.filter((a) => a.profileId === p.id).length });
const toAssign = (a: MAssign) => ({
  id: a.id,
  profileId: a.profileId,
  profileName: profiles.find((p) => p.id === a.profileId)?.name ?? '?',
  scope: a.scope,
  scopeId: a.scopeId,
  scopeLabel: a.scope === 'all' ? 'Everyone' : a.scope === 'wing' ? (wingNameOf(a.scopeId) ?? 'Wing') : (getMockRoster().employees.find((e) => e.id === a.scopeId)?.name ?? 'Employee'),
  effectiveFrom: a.effectiveFrom,
  effectiveTo: a.effectiveTo,
  label: a.label,
});
const toHoliday = (h: MHoliday) => ({ ...h, wingNames: h.wingIds.map((id) => wingNameOf(id) ?? '?') });

// ----------------------------------------------------------------------------- routes
export function createRulesRoutes(ctx: RulesMockContext): [RegExp, Handler][] {
  seed();
  const page = <T,>(rows: T[], q: URLSearchParams) => {
    const p = Number(q.get('page')) || 1;
    const ps = Number(q.get('pageSize')) || 50;
    return json(200, { items: rows.slice((p - 1) * ps, p * ps), total: rows.length, page: p, pageSize: ps });
  };
  const canView = () => ctx.can('attendance.view');
  const canSeeLeave = () => ctx.can('leave.manage') || ctx.can('attendance.view');

  return [
    // ---- daily
    [/^\/attendance\/daily$/, ({ query }) => {
      if (!canView()) return forbidden();
      const date = query.get('date') ?? todayYmd();
      const text = query.get('q')?.trim().toLowerCase();
      const wing = Number(query.get('wingId')) || null;
      const section = Number(query.get('sectionId')) || null;
      const status = query.get('status');
      let rows = activeRoster()
        .filter((e) => (!wing || e.wingId === wing) && (!section || e.sectionId === section) && (!text || `${e.name} ${e.empCode}`.toLowerCase().includes(text)))
        .map((e) => computeDay(e, date));
      if (status) rows = rows.filter((r) => r.status === status);
      const sort = query.get('sort');
      const dir = query.get('order') === 'desc' ? -1 : 1;
      if (sort === 'firstIn') rows.sort((a, b) => dir * (a.firstIn ?? '99').localeCompare(b.firstIn ?? '99'));
      else if (sort === 'workedMinutes') rows.sort((a, b) => dir * (a.workedMinutes - b.workedMinutes));
      else if (sort === 'status') rows.sort((a, b) => dir * a.status.localeCompare(b.status));
      else rows.sort((a, b) => dir * a.name.localeCompare(b.name));
      return page(rows, query);
    }],
    [/^\/attendance\/days$/, ({ query }) => {
      if (!canView()) return forbidden();
      const e = getMockRoster().employees.find((x) => x.id === Number(query.get('employeeId')));
      const from = query.get('from')!;
      const to = query.get('to')!;
      if (!e) return json(200, []);
      const out = [];
      for (let d = from, g = 0; d <= to && g < 400; d = addDaysYmd(d, 1), g++) out.push(computeDay(e, d));
      return json(200, out);
    }],
    [/^\/attendance\/day-summary$/, ({ query }) => {
      if (!canView()) return forbidden();
      const from = query.get('from')!;
      const to = query.get('to') ?? from;
      const wing = Number(query.get('wingId')) || null;
      const roster = activeRoster().filter((e) => !wing || e.wingId === wing);
      const counts: Record<string, number> = {};
      for (let d = from, g = 0; d <= to && g < 100; d = addDaysYmd(d, 1), g++) for (const e of roster) {
        const s = computeDay(e, d).status;
        counts[s] = (counts[s] ?? 0) + 1;
      }
      const worked = (counts.present ?? 0) + (counts.late ?? 0) + (counts.half_day ?? 0);
      const expected = worked + (counts.absent ?? 0) + (counts.incomplete ?? 0) + (counts.leave ?? 0);
      return json(200, { from, to, employees: roster.length, counts, attendanceRate: expected ? worked / expected : 0, punctualityRate: worked ? (counts.present ?? 0) / worked : 0 });
    }],
    [/^\/attendance\/recompute$/, ({ body }) => {
      if (!ctx.can('timings.manage')) return forbidden();
      const from = String(body?.from ?? '');
      const to = String(body?.to ?? '');
      if (!from || !to || to < from) return err(400, 'VALIDATION_ERROR', 'Invalid range', { to: 'Must be on or after the start date' });
      return json(202, { queuedDays: dayNum(to) - dayNum(from) + 1 });
    }],

    // ---- corrections
    [/^\/attendance\/corrections$/, ({ method, query, body }) => {
      if (method === 'GET') {
        if (!canView()) return forbidden();
        const id = Number(query.get('employeeId'));
        const from = query.get('from') ?? '0000';
        const to = query.get('to') ?? '9999';
        return json(200, corrections.filter((c) => c.employeeId === id && c.date >= from && c.date <= to));
      }
      if (!ctx.can('attendance.correct')) return forbidden();
      const p = zCorrectionInput.safeParse(body);
      if (!p.success) return zodDetails(p.error);
      const c: MCorrection = { id: nextCorrectionId++, employeeId: p.data.employeeId, date: p.data.date, type: p.data.type, time: p.data.time ?? null, status: p.data.status ?? null, reason: p.data.reason, createdBy: 'Super Admin', createdAt: new Date().toISOString() };
      corrections.push(c);
      return json(201, c);
    }],
    [/^\/attendance\/corrections\/(\d+)$/, ({ params }) => {
      if (!ctx.can('attendance.correct')) return forbidden();
      corrections = corrections.filter((c) => c.id !== Number(params[0]));
      return json(204, undefined);
    }],

    // ---- leave types
    [/^\/leave-types$/, ({ method, body }) => {
      if (method === 'GET') return canSeeLeave() || ctx.can('leave.configure') ? json(200, types.map((t) => ({ ...t, usageCount: leaves.filter((l) => l.leaveTypeId === t.id).length }))) : forbidden();
      if (!ctx.can('leave.configure')) return forbidden();
      const p = zLeaveTypeInput.safeParse(body);
      if (!p.success) return zodDetails(p.error);
      if (types.some((t) => t.code === p.data.code)) return err(409, 'DUPLICATE_LEAVE_TYPE', `A leave type with code ${p.data.code} already exists`, { code: 'Already used' });
      const t: MType = { id: nextTypeId++, ...p.data };
      types.push(t);
      return json(201, { ...t, usageCount: 0 });
    }],
    [/^\/leave-types\/(\d+)$/, ({ body, params }) => {
      if (!ctx.can('leave.configure')) return forbidden();
      const t = types.find((x) => x.id === Number(params[0]));
      if (!t) return err(404, 'NOT_FOUND', 'Leave type not found');
      const p = zLeaveTypeInput.safeParse(body);
      if (!p.success) return zodDetails(p.error);
      if (types.some((x) => x.id !== t.id && x.code === p.data.code)) return err(409, 'DUPLICATE_LEAVE_TYPE', `A leave type with code ${p.data.code} already exists`, { code: 'Already used' });
      Object.assign(t, p.data);
      return json(200, { ...t, usageCount: leaves.filter((l) => l.leaveTypeId === t.id).length });
    }],

    // ---- leaves
    [/^\/leaves$/, ({ method, query, body }) => {
      if (method === 'GET') {
        if (!canSeeLeave()) return forbidden();
        const text = query.get('q')?.trim().toLowerCase();
        const wing = Number(query.get('wingId')) || null;
        const typeId = Number(query.get('leaveTypeId')) || null;
        const empId = Number(query.get('employeeId')) || null;
        const from = query.get('from');
        const to = query.get('to');
        let rows = leaves.map(toLeave).filter((l) => {
          const e = getMockRoster().employees.find((x) => x.id === l.employeeId);
          if (wing && e?.wingId !== wing) return false;
          if (typeId && l.leaveTypeId !== typeId) return false;
          if (empId && l.employeeId !== empId) return false;
          if (from && l.to < from) return false;
          if (to && l.from > to) return false;
          if (text && !`${l.employeeName} ${l.empCode}`.toLowerCase().includes(text)) return false;
          return true;
        });
        const dir = query.get('order') === 'asc' ? 1 : -1;
        const sort = query.get('sort') ?? 'from';
        rows.sort((a, b) => (sort === 'employee' ? a.employeeName.localeCompare(b.employeeName) * -dir : sort === 'type' ? a.leaveTypeName.localeCompare(b.leaveTypeName) * -dir : a.from.localeCompare(b.from) * dir));
        return page(rows, query);
      }
      if (!ctx.can('leave.manage')) return forbidden();
      const p = zLeaveInput.safeParse(body);
      if (!p.success) return zodDetails(p.error);
      const v = p.data;
      const clashes = v.employeeIds
        .map((id) => ({ id, hits: leaves.filter((l) => l.employeeId === id && l.from <= v.to && l.to >= v.from) }))
        .filter((c) => c.hits.length > 0);
      if (clashes.length > 0 && !v.replaceOverlapping) {
        const roster = getMockRoster().employees;
        return err(409, 'LEAVE_OVERLAP', `${clashes.length} ${clashes.length === 1 ? 'person already has' : 'people already have'} leave on these dates`, clashes.map((c) => ({
          employeeId: c.id,
          name: roster.find((e) => e.id === c.id)?.name ?? '?',
          dates: c.hits.map((h) => (h.from === h.to ? h.from : `${h.from}..${h.to}`)),
          leaveType: (() => {
            const t = types.find((x) => x.id === c.hits[0]!.leaveTypeId)!;
            return { name: t.name, code: t.code, color: t.color };
          })(),
        })));
      }
      if (clashes.length > 0) {
        const ids = new Set(v.employeeIds);
        leaves = leaves.flatMap((l) => {
          if (!ids.has(l.employeeId) || l.from > v.to || l.to < v.from) return [l];
          const keep: MLeave[] = [];
          if (l.from < v.from) keep.push({ ...l, to: addDaysYmd(v.from, -1), part: 'full' });
          if (l.to > v.to) keep.push({ ...l, id: nextLeaveId++, from: addDaysYmd(v.to, 1), part: 'full' });
          return keep;
        });
      }
      const created = v.employeeIds.map((employeeId) => {
        const l: MLeave = { id: nextLeaveId++, employeeId, leaveTypeId: v.leaveTypeId, from: v.from, to: v.to, part: v.part, reason: v.reason ?? null, createdBy: 'Super Admin', createdAt: new Date().toISOString() };
        leaves.push(l);
        return toLeave(l);
      });
      return json(201, created);
    }],
    [/^\/leaves\/(\d+)$/, ({ method, body, params }) => {
      if (!ctx.can('leave.manage')) return forbidden();
      const l = leaves.find((x) => x.id === Number(params[0]));
      if (!l) return err(404, 'NOT_FOUND', 'Leave not found');
      if (method === 'DELETE') {
        leaves = leaves.filter((x) => x !== l);
        return json(204, undefined);
      }
      const p = zLeaveUpdate.safeParse(body);
      if (!p.success) return zodDetails(p.error);
      const clash = leaves.find((x) => x !== l && x.employeeId === l.employeeId && x.from <= p.data.to && x.to >= p.data.from);
      if (clash) return err(409, 'LEAVE_OVERLAP', 'This employee already has leave on these dates', [{ employeeId: l.employeeId, name: getMockRoster().employees.find((e) => e.id === l.employeeId)?.name ?? '?', dates: [clash.from === clash.to ? clash.from : `${clash.from}..${clash.to}`] }]);
      Object.assign(l, { leaveTypeId: p.data.leaveTypeId, from: p.data.from, to: p.data.to, part: p.data.part, reason: p.data.reason ?? null });
      return json(200, toLeave(l));
    }],

    // ---- holidays
    [/^\/holidays$/, ({ method, query, body }) => {
      if (method === 'GET') {
        if (!canSeeLeave() && !ctx.can('holidays.manage')) return forbidden();
        const year = Number(query.get('year')) || null;
        return json(200, holidays.filter((h) => !year || h.from.startsWith(String(year)) || h.to.startsWith(String(year))).sort((a, b) => a.from.localeCompare(b.from)).map(toHoliday));
      }
      if (!ctx.can('holidays.manage')) return forbidden();
      const p = zHolidayInput.safeParse(body);
      if (!p.success) return zodDetails(p.error);
      const h: MHoliday = { id: nextHolidayId++, ...p.data, createdAt: new Date().toISOString() };
      holidays.push(h);
      return json(201, toHoliday(h));
    }],
    [/^\/holidays\/(\d+)$/, ({ method, body, params }) => {
      if (!ctx.can('holidays.manage')) return forbidden();
      const h = holidays.find((x) => x.id === Number(params[0]));
      if (!h) return err(404, 'NOT_FOUND', 'Holiday not found');
      if (method === 'DELETE') {
        holidays = holidays.filter((x) => x !== h);
        return json(204, undefined);
      }
      const p = zHolidayInput.safeParse(body);
      if (!p.success) return zodDetails(p.error);
      Object.assign(h, p.data);
      return json(200, toHoliday(h));
    }],

    // ---- timings
    [/^\/timings\/setup-status$/, () => json(200, { configured })],
    [/^\/timings$/, ({ method, body }) => {
      if (method === 'GET') return ctx.can('timings.manage') || canView() ? json(200, profiles.map(toProfile)) : forbidden();
      if (!ctx.can('timings.manage')) return forbidden();
      const p = zTimingProfileInput.safeParse(body);
      if (!p.success) return zodDetails(p.error);
      const t = new Date().toISOString();
      const row: MProfile = { id: nextProfileId++, ...p.data, days: p.data.days, versions: [], isDefault: false, createdAt: t, updatedAt: t };
      row.versions = [verOf(row, todayYmd(), 'admin@nacta.gov.pk')];
      profiles.push(row);
      return json(201, toProfile(row));
    }],
    [/^\/timings\/(\d+)\/default$/, ({ params }) => {
      if (!ctx.can('timings.manage')) return forbidden();
      const row = profiles.find((x) => x.id === Number(params[0]));
      if (!row) return err(404, 'NOT_FOUND', 'Profile not found');
      profiles.forEach((x) => (x.isDefault = x === row));
      configured = true;
      return json(200, toProfile(row));
    }],
    [/^\/timings\/(\d+)$/, ({ method, body, params }) => {
      if (!ctx.can('timings.manage')) return forbidden();
      const row = profiles.find((x) => x.id === Number(params[0]));
      if (!row) return err(404, 'NOT_FOUND', 'Profile not found');
      if (method === 'DELETE') {
        if (row.isDefault) return err(409, 'PROFILE_IN_USE', 'The default profile cannot be deleted. Make another profile the default first.');
        const n = assignments.filter((a) => a.profileId === row.id).length;
        if (n > 0) return err(409, 'PROFILE_IN_USE', `This profile is used by ${n} assignment${n === 1 ? '' : 's'}. Remove them first.`);
        profiles = profiles.filter((x) => x !== row);
        return json(204, undefined);
      }
      const p = zTimingProfileUpdate.safeParse(body);
      if (!p.success) return zodDetails(p.error);
      const from = p.data.effectiveFrom ?? todayYmd();
      // Forwards only: a past start date is allowed once, while setting up the default profile for the first time.
      if (from < todayYmd() && !(row.isDefault && !configured)) return err(400, 'VALIDATION_ERROR', 'Some values are invalid', { effectiveFrom: 'Changes apply from today onwards; earlier days keep their timings.' });
      const rules = { days: p.data.days as Day[], graceLateMinutes: p.data.graceLateMinutes ?? 15, graceEarlyMinutes: p.data.graceEarlyMinutes ?? 15, halfDayBelowMinutes: p.data.halfDayBelowMinutes ?? 240 };
      row.name = p.data.name;
      row.versions = row.versions.filter((v) => v.effectiveFrom !== from);
      row.versions.push(verOf(rules, from, 'admin@nacta.gov.pk'));
      if (row.isDefault && !configured && from < todayYmd()) row.versions = row.versions.filter((v) => v.effectiveFrom >= from || v.effectiveFrom === from);
      withTopLevel(row);
      row.updatedAt = new Date().toISOString();
      if (row.isDefault) configured = true;
      return json(200, toProfile(row));
    }],
    [/^\/timing-assignments$/, ({ method, body }) => {
      if (!ctx.can('timings.manage')) return forbidden();
      if (method === 'GET') return json(200, assignments.map(toAssign));
      const p = zTimingAssignmentInput.safeParse(body);
      if (!p.success) return zodDetails(p.error);
      const a: MAssign = { id: nextAssignId++, profileId: p.data.profileId, scope: p.data.scope, scopeId: p.data.scopeId ?? null, effectiveFrom: p.data.effectiveFrom, effectiveTo: p.data.effectiveTo ?? null, label: p.data.label ?? null };
      assignments.push(a);
      return json(201, toAssign(a));
    }],
    [/^\/timing-assignments\/(\d+)$/, ({ params }) => {
      if (!ctx.can('timings.manage')) return forbidden();
      assignments = assignments.filter((a) => a.id !== Number(params[0]));
      return json(204, undefined);
    }],
  ];
}

// Referenced so tree-shaking keeps the labels for debugging in the console.
export const __labels = { DAY_STATUS_LABEL, LEAVE_PART_LABEL };

/** Read-only handles on the attendance engine for the reports / dashboard mock (reports-mock.ts). */
export function getMockEngine() {
  seed();
  return {
    computeDay,
    activeRoster,
    leaveRows: () => leaves.map(toLeave),
    leaveTypes: () => types.map((t) => ({ ...t })),
    wingNameOf,
    sectionNameOf,
  };
}
