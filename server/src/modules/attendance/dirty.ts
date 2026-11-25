import { pool, type Queryable } from '../../db/pool';
import { addDays, daysBetween, todayLocal } from '../../lib/dates';

// The recompute queue: (employee, date) pairs whose cached attendance_days row is stale.

export interface Key {
  employeeId: number;
  date: string;
}

/** Ranges up to this many days are queued for every employee-day (so the worker materialises them); longer ones only requeue days already cached. */
const MATERIALIZE_MAX_DAYS = 62;

/** Queue specific employee-days (dates after today are never cached, so they are ignored). */
export async function markKeys(keys: Key[], db: Queryable = pool): Promise<number> {
  const today = todayLocal();
  const ks = keys.filter((k) => k.date <= today);
  let n = 0;
  for (let i = 0; i < ks.length; i += 5000) {
    const part = ks.slice(i, i + 5000);
    const r = await db.query(
      `INSERT INTO attendance_dirty (employee_id, date)
       SELECT * FROM unnest($1::int[], $2::date[])
       ON CONFLICT (employee_id, date) DO UPDATE SET queued_at = now()`,
      [part.map((k) => k.employeeId), part.map((k) => k.date)],
    );
    n += r.rowCount ?? 0;
  }
  return n;
}

export interface RangeTarget {
  /** Inclusive; null = from the earliest cached day. */
  from: string | null;
  /** Inclusive; null or after today = today. */
  to: string | null;
  /** Who: everyone (default), these employees, or the members of a wing. */
  employeeIds?: number[];
  wingId?: number;
  /** Force every employee-day (true) or only cached ones (false); default decided by range length. */
  materialize?: boolean;
}

/** Queue every day of the range for the targeted employees. Returns the number of rows queued. */
export async function markRange(t: RangeTarget, db: Queryable = pool): Promise<number> {
  const today = todayLocal();
  const to = t.to && t.to < today ? t.to : today;
  const vals: unknown[] = [];
  const who: string[] = [];
  if (t.employeeIds) {
    if (!t.employeeIds.length) return 0;
    vals.push(t.employeeIds);
    who.push(`e.id = ANY($${vals.length}::int[])`);
  }
  if (t.wingId !== undefined) {
    vals.push(t.wingId);
    who.push(`e.wing_id = $${vals.length}`);
  }
  const cond = who.length ? who.join(' AND ') : 'true';

  if (t.from !== null && t.from > to) return 0;
  const days = t.from === null ? Number.POSITIVE_INFINITY : daysBetween(t.from, to) + 1;
  const materialize = t.materialize ?? (days <= MATERIALIZE_MAX_DAYS);
  if (materialize && t.from !== null) {
    vals.push(t.from, to);
    const r = await db.query(
      `INSERT INTO attendance_dirty (employee_id, date)
       SELECT e.id, g::date FROM employees e CROSS JOIN generate_series($${vals.length - 1}::date, $${vals.length}::date, interval '1 day') g
       WHERE ${cond}
       ON CONFLICT (employee_id, date) DO UPDATE SET queued_at = now()`,
      vals,
    );
    return r.rowCount ?? 0;
  }
  vals.push(t.from ?? '1900-01-01', to);
  const r = await db.query(
    `INSERT INTO attendance_dirty (employee_id, date)
     SELECT ad.employee_id, ad.date FROM attendance_days ad JOIN employees e ON e.id = ad.employee_id
     WHERE ad.date BETWEEN $${vals.length - 1}::date AND $${vals.length}::date AND ${cond}
     ON CONFLICT (employee_id, date) DO UPDATE SET queued_at = now()`,
    vals,
  );
  return r.rowCount ?? 0;
}

/** Everything cached for one leave type (its name/colour/"counts as present" changed). */
export async function markLeaveType(leaveTypeId: number, db: Queryable = pool): Promise<number> {
  const r = await db.query(
    `INSERT INTO attendance_dirty (employee_id, date)
     SELECT ad.employee_id, ad.date FROM attendance_days ad
     JOIN leaves l ON l.id = (ad.leave->>'leaveId')::int
     WHERE l.leave_type_id = $1
     ON CONFLICT (employee_id, date) DO UPDATE SET queued_at = now()`,
    [leaveTypeId],
  );
  return r.rowCount ?? 0;
}

/** The day after `date` (helper for "until the next version starts"). */
export const dayBefore = (date: string): string => addDays(date, -1);
