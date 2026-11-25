import type { AttendanceRecord, WingScope } from '@nacta/shared';
import { pool } from '../../db/pool';
import type { AttlogRecord } from '../../adms/parse';
import { scopeClause } from '../../lib/scope';
import { byColumn, byNumericText, likeContains, limitOffset, orderBy, type SortConfig } from '../../lib/pagination';

/** records: parsed ATTLOG lines. Returns rows actually inserted (duplicates are ignored). */
export async function insertBatch(deviceId: number, records: AttlogRecord[]): Promise<number> {
  if (!records.length) return 0;
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const part = records.slice(i, i + CHUNK);
    const vals: unknown[] = [];
    const ph = part.map((r, j) => {
      const o = j * 7;
      vals.push(deviceId, r.pin, r.punchTime, r.status, r.verifyType, r.workCode, r.raw);
      return `($${o + 1}, $${o + 2}, $${o + 3}::timestamp, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7})`;
    });
    // Newly stored punches queue their (employee, day) for recomputation, in the same statement.
    const { rows } = await pool.query<{ n: string }>(
      `WITH ins AS (
         INSERT INTO attendance_logs (device_id, pin, punch_time, status, verify_type, work_code, raw)
         VALUES ${ph.join(', ')} ON CONFLICT (device_id, pin, punch_time) DO NOTHING RETURNING pin, punch_time
       ), q AS (
         INSERT INTO attendance_dirty (employee_id, date)
         SELECT DISTINCT e.id, i.punch_time::date FROM ins i JOIN employees e ON e.emp_code = i.pin
         ON CONFLICT (employee_id, date) DO UPDATE SET queued_at = now()
       )
       SELECT count(*) AS n FROM ins`,
      vals,
    );
    inserted += Number((rows[0] as { n: string }).n);
  }
  return inserted;
}

type AttendanceRow = {
  id: string;
  device_id: number;
  device_name: string;
  pin: string;
  employee_id: number | null;
  employee_name: string | null;
  wing_name: string | null;
  section_name: string | null;
  punch_time: string;
  status: number | null;
  verify_type: number | null;
  work_code: string | null;
  received_at: Date;
};

const toRecord = (r: AttendanceRow): AttendanceRecord => ({
  id: Number(r.id),
  deviceId: r.device_id,
  deviceName: r.device_name,
  pin: r.pin,
  employeeId: r.employee_id,
  employeeName: r.employee_name,
  wingName: r.wing_name,
  sectionName: r.section_name,
  punchTime: r.punch_time,
  status: r.status,
  verifyType: r.verify_type,
  workCode: r.work_code,
  receivedAt: r.received_at.toISOString(),
});

const SORT: SortConfig = {
  keys: {
    punchTime: byColumn('a.punch_time', 'a.id'),
    pin: byNumericText('a.pin', 'a.id'),
    employeeName: byColumn('lower(e.name)', 'a.id', true),
    wingName: byColumn('lower(w.name)', 'a.id', true),
    sectionName: byColumn('lower(sec.name)', 'a.id', true),
    deviceName: byColumn('lower(d.name)', 'a.id'),
    receivedAt: byColumn('a.received_at', 'a.id'),
  },
  defaultKey: 'punchTime',
  defaultOrder: 'desc',
};

export interface AttendanceListParams {
  deviceId?: number | undefined;
  employeeId?: number | undefined;
  wingId?: number | undefined;
  sectionId?: number | undefined;
  pin?: string | undefined;
  q?: string | undefined;
  /** Inclusive calendar dates (YYYY-MM-DD), device-local. */
  from?: string | undefined;
  to?: string | undefined;
  page: number;
  pageSize: number;
  sort?: string | undefined;
  order?: 'asc' | 'desc' | undefined;
}

export async function list(p: AttendanceListParams, scope: WingScope): Promise<{ items: AttendanceRecord[]; total: number }> {
  const where: string[] = [];
  const vals: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    vals.push(v);
    where.push(sql.replace('?', `$${vals.length}`));
  };

  if (p.deviceId !== undefined) add('a.device_id = ?', p.deviceId);
  if (p.employeeId !== undefined) add('e.id = ?', p.employeeId);
  if (p.wingId !== undefined) add('e.wing_id = ?', p.wingId);
  if (p.sectionId !== undefined) add('e.section_id = ?', p.sectionId);
  if (p.pin) add('a.pin = ?', p.pin);
  if (p.q) {
    vals.push(likeContains(p.q));
    where.push(`(a.pin ILIKE $${vals.length} OR e.name ILIKE $${vals.length})`);
  }
  if (p.from) add('a.punch_time >= ?::date', p.from);
  // "to" is inclusive: everything before the start of the next day.
  if (p.to) add('a.punch_time < (?::date + 1)', p.to);
  // Wing scope, enforced here: punches whose PIN has no employee, or an employee without a wing, match no limited scope.
  const scoped = scopeClause(scope, 'e.wing_id', vals);
  if (scoped) where.push(scoped);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const joins = `FROM attendance_logs a JOIN devices d ON d.id = a.device_id
     LEFT JOIN employees e ON e.emp_code = a.pin
     LEFT JOIN wings w ON w.id = e.wing_id
     LEFT JOIN sections sec ON sec.id = e.section_id`;
  // The count only needs the joins that filters reference.
  const needsEmployee = p.employeeId !== undefined || p.wingId !== undefined || p.sectionId !== undefined || !!p.q || scope !== 'all';
  const countFrom = needsEmployee
    ? 'FROM attendance_logs a LEFT JOIN employees e ON e.emp_code = a.pin'
    : 'FROM attendance_logs a';

  const total = await pool.query<{ n: string }>(`SELECT count(*) AS n ${countFrom} ${w}`, vals);
  const { limit, offset } = limitOffset(p);
  const { rows } = await pool.query<AttendanceRow>(
    `SELECT a.id, a.device_id, d.name AS device_name,
            to_char(a.punch_time, 'YYYY-MM-DD HH24:MI:SS') AS punch_time,
            a.pin, e.id AS employee_id, e.name AS employee_name, w.name AS wing_name, sec.name AS section_name,
            a.status, a.verify_type, a.work_code, a.received_at
     ${joins}
     ${w} ORDER BY ${orderBy(p, SORT)} LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
    [...vals, limit, offset],
  );
  return { items: rows.map(toRecord), total: Number((total.rows[0] as { n: string }).n) };
}
