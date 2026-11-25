import type { Queryable } from '../../db/pool';
import { pool } from '../../db/pool';
import { addDays, localNow, todayLocal, weekdayOf, SERVER_TZ, type LocalNow } from '../../lib/dates';
import { computeDay, dayStartMinutes, type EngineCorrection, type EngineDay, type EngineEmployee, type EngineLeave, type LeavePart } from './engine';
import {
  holidaysFor,
  resolveTiming,
  type AssignmentRule,
  type DayHours,
  type HolidayRule,
  type ProfileRules,
} from './resolve';
import type { Key } from './dirty';

// Set-based input loading and persistence for the engine. One query per kind of input per chunk of keys.

export interface RulesContext {
  profiles: ProfileRules[];
  assignments: AssignmentRule[];
  holidays: HolidayRule[];
}

/** Timing profiles (all versions), assignments, and the holidays overlapping [from, to]. */
export async function loadRules(from: string, to: string, db: Queryable = pool): Promise<RulesContext> {
  // Sequential: `db` may be a single transaction client, which cannot run queries concurrently.
  const [profiles, versions, assignments, holidays] = await seq([
    () => db.query<{ id: number; name: string; is_default: boolean }>('SELECT id, name, is_default FROM timing_profiles'),
    () => db.query<{ profile_id: number; ef: string; days: (DayHours | null)[]; gl: number; ge: number; hd: number }>(
      `SELECT profile_id, to_char(effective_from, 'YYYY-MM-DD') AS ef, days, grace_late_minutes AS gl,
              grace_early_minutes AS ge, half_day_below_minutes AS hd FROM timing_profile_versions`,
    ),
    () => db.query<{ id: number; profile_id: number; scope: 'all' | 'wing' | 'employee'; scope_id: number | null; ef: string; et: string | null }>(
      `SELECT id, profile_id, scope, scope_id, to_char(effective_from, 'YYYY-MM-DD') AS ef, to_char(effective_to, 'YYYY-MM-DD') AS et
       FROM timing_assignments`,
    ),
    () => db.query<{ id: number; name: string; f: string; t: string; kind: 'holiday' | 'working_day'; wing_ids: number[] }>(
      `SELECT h.id, h.name, to_char(h.from_date, 'YYYY-MM-DD') AS f, to_char(h.to_date, 'YYYY-MM-DD') AS t, h.kind,
              COALESCE(array_agg(hw.wing_id) FILTER (WHERE hw.wing_id IS NOT NULL), '{}') AS wing_ids
       FROM holidays h LEFT JOIN holiday_wings hw ON hw.holiday_id = h.id
       WHERE h.from_date <= $2::date AND h.to_date >= $1::date GROUP BY h.id`,
      [from, to],
    ),
  ]);
  return {
    profiles: profiles.rows.map((p) => ({
      id: p.id,
      name: p.name,
      isDefault: p.is_default,
      versions: versions.rows
        .filter((v) => v.profile_id === p.id)
        .map((v) => ({ effectiveFrom: v.ef, days: v.days, graceLate: v.gl, graceEarly: v.ge, halfDayBelow: v.hd })),
    })),
    assignments: assignments.rows.map((a) => ({
      id: a.id,
      profileId: a.profile_id,
      scope: a.scope,
      scopeId: a.scope_id,
      effectiveFrom: a.ef,
      effectiveTo: a.et,
    })),
    holidays: holidays.rows.map((h) => ({ id: h.id, name: h.name, from: h.f, to: h.t, kind: h.kind, wingIds: h.wing_ids })),
  };
}

const CHUNK = 4000;

/** Await the thunks one after another (a transaction client runs one query at a time). */
async function seq<T extends readonly (() => Promise<unknown>)[]>(fns: [...T]): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const out: unknown[] = [];
  for (const f of fns) out.push(await f());
  return out as { [K in keyof T]: Awaited<ReturnType<T[K]>> };
}

/** Compute (never persist) the engine output for the given employee-days. Keys of unknown employees are dropped. */
export async function computeKeys(keysIn: Key[], opts: { db?: Queryable; now?: LocalNow; rules?: RulesContext } = {}): Promise<EngineDay[]> {
  const db = opts.db ?? pool;
  const now = opts.now ?? localNow();
  const seen = new Set<string>();
  const keys = keysIn.filter((k) => {
    const id = `${k.employeeId}|${k.date}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const out: EngineDay[] = [];
  for (let i = 0; i < keys.length; i += CHUNK) out.push(...(await computeChunk(keys.slice(i, i + CHUNK), db, now, opts.rules)));
  return out;
}

async function computeChunk(keys: Key[], db: Queryable, now: LocalNow, preRules?: RulesContext): Promise<EngineDay[]> {
  if (!keys.length) return [];
  const empIds = [...new Set(keys.map((k) => k.employeeId))];
  const dates = keys.map((k) => k.date);
  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));

  const emps = await db.query<{
    id: number;
    emp_code: string;
    name: string;
    wing_id: number | null;
    wing_name: string | null;
    section_name: string | null;
    designation: string | null;
    status: 'active' | 'disabled' | 'left';
    join_date: string | null;
    left_date: string | null;
    changed: string | null;
    has_photo: boolean;
  }>(
    `SELECT e.id, e.emp_code, e.name, e.wing_id, w.name AS wing_name, s.name AS section_name, e.designation, e.status,
            to_char(e.join_date, 'YYYY-MM-DD') AS join_date, to_char(e.left_date, 'YYYY-MM-DD') AS left_date,
            to_char(e.status_changed_at AT TIME ZONE '${SERVER_TZ}', 'YYYY-MM-DD') AS changed,
            EXISTS (SELECT 1 FROM user_photos p WHERE p.pin = e.emp_code AND COALESCE(p.content, '') <> '') AS has_photo
     FROM employees e LEFT JOIN wings w ON w.id = e.wing_id LEFT JOIN sections s ON s.id = e.section_id
     WHERE e.id = ANY($1::int[])`,
    [empIds],
  );
  const empById = new Map(emps.rows.map((r) => [r.id, r]));
  const live = keys.filter((k) => empById.has(k.employeeId));
  if (!live.length) return [];

  const kEmp = live.map((k) => k.employeeId);
  const kCode = live.map((k) => (empById.get(k.employeeId) as { emp_code: string }).emp_code);
  const kDate = live.map((k) => k.date);

  const rules = preRules ?? (await loadRules(minDate, maxDate, db));
  // Each day's punch window: from its own beginning to the next day's beginning (midnight to midnight, except around
  // night shifts, whose morning punches belong to the day the shift started).
  const scheduled = (eid: number, wingId: number | null, date: string) =>
    resolveTiming(rules.profiles, rules.assignments, { id: eid, wingId }, date).days[weekdayOf(date)] ?? null;
  const startsAt = (eid: number, wingId: number | null, date: string) => {
    const m = dayStartMinutes(scheduled(eid, wingId, date), scheduled(eid, wingId, addDays(date, -1)));
    return `${date} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
  };
  const kFrom: string[] = [];
  const kTo: string[] = [];
  for (const k of live) {
    const wingId = (empById.get(k.employeeId) as { wing_id: number | null }).wing_id;
    kFrom.push(startsAt(k.employeeId, wingId, k.date));
    kTo.push(startsAt(k.employeeId, wingId, addDays(k.date, 1)));
  }

  const [punches, leaves, corrs] = await seq([
    () => db.query<{ eid: number; d: string; t: string }>(
      `SELECT k.eid, to_char(k.d, 'YYYY-MM-DD') AS d, to_char(a.punch_time, 'YYYY-MM-DD HH24:MI:SS') AS t
       FROM unnest($1::int[], $2::text[], $3::date[], $4::timestamp[], $5::timestamp[]) AS k(eid, code, d, f, t)
       JOIN attendance_logs a ON a.pin = k.code AND a.punch_time >= k.f AND a.punch_time < k.t`,
      [kEmp, kCode, kDate, kFrom, kTo],
    ),
    () => db.query<{ eid: number; d: string; id: number; part: LeavePart; name: string; code: string; color: string; cap: boolean }>(
      `SELECT k.eid, to_char(k.d, 'YYYY-MM-DD') AS d, l.id, l.part, t.name, t.code, t.color, t.counts_as_present AS cap
       FROM unnest($1::int[], $2::date[]) AS k(eid, d)
       JOIN leaves l ON l.employee_id = k.eid AND k.d BETWEEN l.from_date AND l.to_date
       JOIN leave_types t ON t.id = l.leave_type_id`,
      [kEmp, kDate],
    ),
    () => db.query<{ eid: number; d: string; id: number; type: 'add_punch' | 'set_status'; time: string | null; status: 'present' | 'absent' | 'half_day' | null }>(
      `SELECT k.eid, to_char(k.d, 'YYYY-MM-DD') AS d, c.id, c.type, c.time, c.status
       FROM unnest($1::int[], $2::date[]) AS k(eid, d)
       JOIN attendance_corrections c ON c.employee_id = k.eid AND c.date = k.d`,
      [kEmp, kDate],
    ),
  ]);

  const kk = (eid: number, d: string) => `${eid}|${d}`;
  const punchMap = new Map<string, string[]>();
  for (const p of punches.rows) {
    const key = kk(p.eid, p.d);
    const arr = punchMap.get(key);
    if (arr) arr.push(p.t);
    else punchMap.set(key, [p.t]);
  }
  const leaveMap = new Map<string, EngineLeave>();
  for (const l of leaves.rows) {
    leaveMap.set(kk(l.eid, l.d), { leaveId: l.id, typeName: l.name, code: l.code, color: l.color, part: l.part, countsAsPresent: l.cap });
  }
  const corrMap = new Map<string, EngineCorrection[]>();
  for (const c of corrs.rows) {
    const key = kk(c.eid, c.d);
    const item: EngineCorrection = { id: c.id, type: c.type, time: c.time, status: c.status };
    const arr = corrMap.get(key);
    if (arr) arr.push(item);
    else corrMap.set(key, [item]);
  }

  return live.map((k) => {
    const r = empById.get(k.employeeId) as NonNullable<ReturnType<typeof empById.get>>;
    const employee: EngineEmployee = {
      id: r.id,
      empCode: r.emp_code,
      name: r.name,
      wingName: r.wing_name,
      sectionName: r.section_name,
      designation: r.designation,
      hasPhoto: r.has_photo,
      joinDate: r.join_date,
      status: r.status,
      statusChangedDate: r.changed,
      leftDate: r.left_date,
    };
    const timing = resolveTiming(rules.profiles, rules.assignments, { id: r.id, wingId: r.wing_id }, k.date);
    return computeDay({
      date: k.date,
      now,
      employee,
      timing,
      holidays: holidaysFor(rules.holidays, r.wing_id, k.date),
      leave: leaveMap.get(kk(k.employeeId, k.date)) ?? null,
      corrections: corrMap.get(kk(k.employeeId, k.date)) ?? [],
      punches: punchMap.get(kk(k.employeeId, k.date)) ?? [],
    });
  });
}

/** Persist computed days (days after today are never cached). */
export async function upsertDays(days: EngineDay[], db: Queryable = pool): Promise<number> {
  const today = todayLocal();
  const rows = days.filter((d) => d.date <= today);
  const j = (v: unknown) => (v === null ? null : JSON.stringify(v));
  for (let i = 0; i < rows.length; i += 2000) {
    const p = rows.slice(i, i + 2000);
    await db.query(
      `INSERT INTO attendance_days (employee_id, date, status, early_leave, late_minutes, early_minutes, first_in, last_out,
                                    worked_minutes, punch_count, leave, holiday, timing, corrected, leave_counts_present, computed_at)
       SELECT t.*, now() FROM unnest($1::int[], $2::date[], $3::text[], $4::bool[], $5::int[], $6::int[], $7::text[], $8::text[],
                                     $9::int[], $10::int[], $11::jsonb[], $12::jsonb[], $13::jsonb[], $14::bool[], $15::bool[])
         AS t(employee_id, date, status, early_leave, late_minutes, early_minutes, first_in, last_out, worked_minutes, punch_count,
              leave, holiday, timing, corrected, leave_counts_present)
       ON CONFLICT (employee_id, date) DO UPDATE SET
         status = EXCLUDED.status, early_leave = EXCLUDED.early_leave, late_minutes = EXCLUDED.late_minutes,
         early_minutes = EXCLUDED.early_minutes, first_in = EXCLUDED.first_in, last_out = EXCLUDED.last_out,
         worked_minutes = EXCLUDED.worked_minutes, punch_count = EXCLUDED.punch_count, leave = EXCLUDED.leave,
         holiday = EXCLUDED.holiday, timing = EXCLUDED.timing, corrected = EXCLUDED.corrected,
         leave_counts_present = EXCLUDED.leave_counts_present, computed_at = now()`,
      [
        p.map((d) => d.employeeId),
        p.map((d) => d.date),
        p.map((d) => d.status),
        p.map((d) => d.earlyLeave),
        p.map((d) => d.lateMinutes),
        p.map((d) => d.earlyMinutes),
        p.map((d) => d.firstIn),
        p.map((d) => d.lastOut),
        p.map((d) => d.workedMinutes),
        p.map((d) => d.punchCount),
        p.map((d) => j(d.leave)),
        p.map((d) => j(d.holiday)),
        p.map((d) => j(d.timing)),
        p.map((d) => d.corrected),
        p.map((d) => d.leaveCountsPresent),
      ],
    );
  }
  return rows.length;
}
