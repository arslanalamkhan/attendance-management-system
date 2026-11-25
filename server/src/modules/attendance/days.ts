import type { z } from 'zod';
import type { AttendanceDay, DayStatus, DaySummary, Page, WingScope, zDailyQuery } from '@nacta/shared';
import { DAY_STATUSES } from '@nacta/shared';
import { pool } from '../../db/pool';
import { addDays, daysBetween, eachDate, localNow, todayLocal } from '../../lib/dates';
import { MAX_INT, notFound, outOfScope, validationError } from '../../lib/errors';
import { likeContains, toPage } from '../../lib/pagination';
import { scopeClause } from '../../lib/scope';
import { computeKeys, upsertDays } from './compute';
import type { EngineDay } from './engine';

/** Cached rows for today older than this are recomputed on read (the status depends on the clock). */
const TODAY_FRESH_MS = 5 * 60_000;
/** Longest range accepted by the read endpoints. */
export const MAX_RANGE_DAYS = 400;

export interface DayFilter {
  employeeIds?: number[] | undefined;
  wingId?: number | undefined;
  sectionId?: number | undefined;
  q?: string | undefined;
  status?: DayStatus | undefined;
}

const strip = ({ leaveCountsPresent: _l, ...day }: EngineDay): AttendanceDay => day;

/** Employees inside the caller's scope matching the filters, ordered by name. */
export async function listEmployeeIds(scope: WingScope, f: Omit<DayFilter, 'status'> = {}): Promise<number[]> {
  const vals: unknown[] = [];
  const where: string[] = [];
  if (f.employeeIds) {
    vals.push(f.employeeIds.filter((i) => i <= MAX_INT));
    where.push(`e.id = ANY($${vals.length}::int[])`);
  }
  if (f.wingId !== undefined) {
    vals.push(f.wingId);
    where.push(`e.wing_id = $${vals.length}`);
  }
  if (f.sectionId !== undefined) {
    vals.push(f.sectionId);
    where.push(`e.section_id = $${vals.length}`);
  }
  if (f.q) {
    vals.push(likeContains(f.q));
    where.push(`(e.name ILIKE $${vals.length} OR e.emp_code ILIKE $${vals.length})`);
  }
  const sc = scopeClause(scope, 'e.wing_id', vals);
  if (sc) where.push(sc);
  const { rows } = await pool.query<{ id: number }>(
    `SELECT e.id FROM employees e ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY lower(e.name), e.id`,
    vals,
  );
  return rows.map((r) => r.id);
}

type CachedRow = {
  employee_id: number;
  d: string;
  status: DayStatus;
  early_leave: boolean;
  late_minutes: number;
  early_minutes: number;
  first_in: string | null;
  last_out: string | null;
  worked_minutes: number;
  punch_count: number;
  leave: AttendanceDay['leave'];
  holiday: AttendanceDay['holiday'];
  timing: AttendanceDay['timing'];
  corrected: boolean;
  fresh: boolean;
  emp_code: string;
  name: string;
  wing_name: string | null;
  section_name: string | null;
  designation: string | null;
  has_photo: boolean;
};

/** Every (employee, date) in the grid as AttendanceDay: from the cache where valid, computed (and cached) otherwise. */
export async function getDaysFor(ids: number[], from: string, to: string): Promise<AttendanceDay[]> {
  if (!ids.length) return [];
  const today = todayLocal();
  const dates = eachDate(from, to);
  const cachedTo = to < today ? to : today;
  const hit = new Map<string, AttendanceDay>();
  if (from <= cachedTo) {
    const { rows } = await pool.query<CachedRow>(
      `SELECT ad.employee_id, to_char(ad.date, 'YYYY-MM-DD') AS d, ad.status, ad.early_leave, ad.late_minutes, ad.early_minutes,
              ad.first_in, ad.last_out, ad.worked_minutes, ad.punch_count, ad.leave, ad.holiday, ad.timing, ad.corrected,
              (ad.date < $4::date OR ad.computed_at > now() - ($5::double precision * interval '1 millisecond')) AS fresh,
              e.emp_code, e.name, w.name AS wing_name, s.name AS section_name, e.designation,
              EXISTS (SELECT 1 FROM user_photos p WHERE p.pin = e.emp_code AND COALESCE(p.content, '') <> '') AS has_photo
       FROM attendance_days ad JOIN employees e ON e.id = ad.employee_id
       LEFT JOIN wings w ON w.id = e.wing_id LEFT JOIN sections s ON s.id = e.section_id
       WHERE ad.employee_id = ANY($1::int[]) AND ad.date BETWEEN $2::date AND $3::date
         AND NOT EXISTS (SELECT 1 FROM attendance_dirty q WHERE q.employee_id = ad.employee_id AND q.date = ad.date)`,
      [ids, from, cachedTo, today, TODAY_FRESH_MS],
    );
    for (const r of rows) {
      if (!r.fresh) continue;
      hit.set(`${r.employee_id}|${r.d}`, {
        employeeId: r.employee_id,
        empCode: r.emp_code,
        name: r.name,
        wingName: r.wing_name,
        sectionName: r.section_name,
        designation: r.designation,
        hasPhoto: r.has_photo,
        date: r.d,
        status: r.status,
        earlyLeave: r.early_leave,
        lateMinutes: r.late_minutes,
        earlyMinutes: r.early_minutes,
        firstIn: r.first_in,
        lastOut: r.last_out,
        workedMinutes: r.worked_minutes,
        punchCount: r.punch_count,
        leave: r.leave,
        holiday: r.holiday,
        timing: r.timing,
        corrected: r.corrected,
      });
    }
  }
  const missing: { employeeId: number; date: string }[] = [];
  for (const id of ids) for (const d of dates) if (!hit.has(`${id}|${d}`)) missing.push({ employeeId: id, date: d });
  if (missing.length) {
    const computed = await computeKeys(missing);
    await upsertDays(computed);
    for (const c of computed) hit.set(`${c.employeeId}|${c.date}`, strip(c));
  }
  const out: AttendanceDay[] = [];
  for (const id of ids) {
    for (const d of dates) {
      const v = hit.get(`${id}|${d}`);
      if (v) out.push(v);
    }
  }
  return out;
}

export function checkRange(from: string, to: string): void {
  if (to < from) throw validationError('Invalid query', { to: 'Must be on or after the start date' });
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) throw validationError('Invalid query', { to: `At most ${MAX_RANGE_DAYS} days at a time` });
}

/**
 * Attendance days for every employee in scope matching the filter, over an inclusive date range. Complete (absent
 * employees included) and cached. Phase G exports reuse this. Ordered by employee name, then date.
 */
export async function getDays(scope: WingScope, filter: DayFilter, range: { from: string; to: string }): Promise<AttendanceDay[]> {
  checkRange(range.from, range.to);
  const ids = await listEmployeeIds(scope, filter);
  const days = await getDaysFor(ids, range.from, range.to);
  return filter.status ? days.filter((d) => d.status === filter.status) : days;
}

// ---------- GET /attendance/daily ----------
const SORTS: Record<string, (a: AttendanceDay, b: AttendanceDay) => number> = {
  name: (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  empCode: (a, b) => a.empCode.localeCompare(b.empCode, undefined, { numeric: true }),
  wing: (a, b) => (a.wingName ?? '￿').toLowerCase().localeCompare((b.wingName ?? '￿').toLowerCase()),
  status: (a, b) => DAY_STATUSES.indexOf(a.status) - DAY_STATUSES.indexOf(b.status),
  firstIn: (a, b) => (a.firstIn ?? '99:99').localeCompare(b.firstIn ?? '99:99'),
  lastOut: (a, b) => (a.lastOut ?? '99:99').localeCompare(b.lastOut ?? '99:99'),
  workedMinutes: (a, b) => a.workedMinutes - b.workedMinutes,
  lateMinutes: (a, b) => a.lateMinutes - b.lateMinutes,
};

export async function getDaily(q: z.output<typeof zDailyQuery>, scope: WingScope): Promise<Page<AttendanceDay>> {
  const sort = q.sort ?? 'name';
  const cmp = Object.hasOwn(SORTS, sort) ? SORTS[sort] : undefined;
  if (!cmp) throw validationError('Invalid query', { sort: `Sort must be one of: ${Object.keys(SORTS).join(', ')}` });
  for (const key of ['wingId', 'sectionId'] as const) {
    if ((q[key] ?? 0) > MAX_INT) throw validationError('Invalid query', { [key]: `${key} is out of range` });
  }
  let days = await getDays(scope, { wingId: q.wingId, sectionId: q.sectionId, q: q.q, status: q.status }, { from: q.date, to: q.date });
  const dir = (q.order ?? 'asc') === 'desc' ? -1 : 1;
  days = [...days].sort((a, b) => dir * cmp(a, b) || SORTS.name!(a, b));
  const start = (q.page - 1) * q.pageSize;
  return toPage(days.slice(start, start + q.pageSize), days.length, q);
}

// ---------- GET /attendance/days ----------
export async function getEmployeeDays(employeeId: number, range: { from: string; to: string }, scope: WingScope): Promise<AttendanceDay[]> {
  checkRange(range.from, range.to);
  if (employeeId > MAX_INT) throw notFound('Employee');
  const visible = await listEmployeeIds(scope, { employeeIds: [employeeId] });
  if (!visible.length) {
    if (scope !== 'all' && (await listEmployeeIds('all', { employeeIds: [employeeId] })).length) throw outOfScope('Employee');
    throw notFound('Employee');
  }
  return getDaysFor(visible, range.from, range.to);
}

// ---------- GET /attendance/day-summary ----------
const round1 = (n: number) => Math.round(n * 10) / 10;

export async function getDaySummary(scope: WingScope, p: { from: string; to: string; wingId?: number | undefined }): Promise<DaySummary> {
  checkRange(p.from, p.to);
  const ids = await listEmployeeIds(scope, { wingId: p.wingId });
  const counts = Object.fromEntries(DAY_STATUSES.map((s) => [s, 0])) as Record<DayStatus, number>;
  let leavePresent = 0;
  const today = todayLocal();
  const pastTo = p.to < today ? p.to : today;

  if (ids.length && p.from <= pastTo) {
    await ensureCached(ids, p.from, pastTo);
    const { rows } = await pool.query<{ status: DayStatus; n: string; lp: string }>(
      `SELECT status, count(*) AS n, count(*) FILTER (WHERE leave_counts_present) AS lp
       FROM attendance_days WHERE employee_id = ANY($1::int[]) AND date BETWEEN $2::date AND $3::date GROUP BY status`,
      [ids, p.from, pastTo],
    );
    for (const r of rows) {
      counts[r.status] += Number(r.n);
      leavePresent += Number(r.lp);
    }
  }
  if (ids.length && p.to > today) {
    const futureFrom = p.from > today ? p.from : addDays(today, 1);
    const future = await computeKeys(ids.flatMap((employeeId) => eachDate(futureFrom, p.to).map((date) => ({ employeeId, date }))));
    for (const d of future) {
      counts[d.status] += 1;
      if (d.leaveCountsPresent) leavePresent += 1;
    }
  }
  const expected = counts.present + counts.late + counts.half_day + counts.incomplete + counts.absent + counts.leave;
  const attended = counts.present + counts.late + counts.half_day + leavePresent;
  const arrived = counts.present + counts.late;
  return {
    from: p.from,
    to: p.to,
    employees: ids.length,
    counts,
    attendanceRate: expected ? round1((100 * attended) / expected) : 0,
    punctualityRate: arrived ? round1((100 * counts.present) / arrived) : 0,
  };
}

/** Make sure every (employee, date) up to today in the grid has a valid cached row, without returning them. */
export async function ensureCached(ids: number[], from: string, to: string): Promise<number> {
  const today = todayLocal();
  const upto = to < today ? to : today;
  if (!ids.length || from > upto) return 0;
  let done = 0;
  const { rows } = await pool.query<{ employee_id: number; d: string }>(
    `SELECT i.id AS employee_id, to_char(g, 'YYYY-MM-DD') AS d
     FROM unnest($1::int[]) AS i(id) CROSS JOIN generate_series($2::date, $3::date, interval '1 day') g
     WHERE NOT EXISTS (SELECT 1 FROM attendance_days ad WHERE ad.employee_id = i.id AND ad.date = g::date
                         AND (ad.date < $4::date OR ad.computed_at > now() - ($5::double precision * interval '1 millisecond')))
        OR EXISTS (SELECT 1 FROM attendance_dirty q WHERE q.employee_id = i.id AND q.date = g::date)`,
    [ids, from, upto, today, TODAY_FRESH_MS],
  );
  for (let i = 0; i < rows.length; i += 20000) {
    const part = rows.slice(i, i + 20000).map((r) => ({ employeeId: r.employee_id, date: r.d }));
    done += await upsertDays(await computeKeys(part, { now: localNow() }));
  }
  return done;
}

/** Counts per status for today (dashboard); the same completeness guarantee as /attendance/daily. */
export async function todayStatusCounts(scope: WingScope): Promise<Record<DayStatus, number>> {
  const ids = await listEmployeeIds(scope);
  const counts = Object.fromEntries(DAY_STATUSES.map((s) => [s, 0])) as Record<DayStatus, number>;
  const today = todayLocal();
  for (const d of await getDaysFor(ids, today, today)) counts[d.status] += 1;
  return counts;
}
