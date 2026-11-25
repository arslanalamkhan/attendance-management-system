import { PunchStatusLabel, VerifyTypeLabel } from '@nacta/shared';
import { pool } from '../../db/pool';
import { validationError } from '../../lib/errors';
import { likeContains, limitOffset } from '../../lib/pagination';
import { scopeClause } from '../../lib/scope';
import { filtersText, fmtRange, lookupNames, MAX_REPORT_ROWS, slug } from './common';
import type { ReportContext, ReportData, ReportParams, Row } from './types';

/** Raw terminal punches, oldest first. `paged` limits the rows to one screen page (SQL LIMIT); exports read them all. */
export async function buildPunchLog(p: ReportParams, ctx: ReportContext, paged: boolean): Promise<ReportData> {
  const names = await lookupNames(p, ctx.scope);
  const vals: unknown[] = [p.from, p.to];
  const where = ['a.punch_time >= $1::date', 'a.punch_time < $2::date + 1'];
  const add = (sql: string, v: unknown) => {
    vals.push(v);
    where.push(sql.replace('?', `$${vals.length}`));
  };
  if (p.deviceId !== undefined) add('a.device_id = ?', p.deviceId);
  if (p.wingId !== undefined) add('e.wing_id = ?', p.wingId);
  if (p.sectionId !== undefined) add('e.section_id = ?', p.sectionId);
  if (p.employeeId !== undefined) add('e.id = ?', p.employeeId);
  if (p.q) {
    vals.push(likeContains(p.q));
    where.push(`(e.name ILIKE $${vals.length} OR e.emp_code ILIKE $${vals.length} OR a.pin ILIKE $${vals.length})`);
  }
  // A limited scope never sees punches of people outside it, nor punches whose PIN matches nobody.
  const sc = scopeClause(ctx.scope, 'e.wing_id', vals);
  if (sc) where.push(sc);
  const from = `FROM attendance_logs a JOIN devices dv ON dv.id = a.device_id
                LEFT JOIN employees e ON e.emp_code = a.pin LEFT JOIN wings w ON w.id = e.wing_id
                WHERE ${where.join(' AND ')}`;

  const stats = await pool.query<{ n: string; people: string; devices: string }>(
    `SELECT count(*) AS n, count(DISTINCT a.pin) AS people, count(DISTINCT a.device_id) AS devices ${from}`,
    vals,
  );
  const s = stats.rows[0] as { n: string; people: string; devices: string };
  const total = Number(s.n);
  if (!paged && total > MAX_REPORT_ROWS) {
    throw validationError('This report is too large', { to: `${total.toLocaleString('en-US')} punches match; narrow the date range, wing or device` });
  }

  let sql = `SELECT to_char(a.punch_time, 'YYYY-MM-DD') AS d, to_char(a.punch_time, 'HH24:MI:SS') AS t, a.pin, e.id AS employee_id, e.name, w.name AS wing,
                    (e.id IS NOT NULL AND EXISTS (SELECT 1 FROM user_photos p WHERE p.pin = e.emp_code AND COALESCE(p.content, '') <> '')) AS has_photo,
                    a.status, a.verify_type, dv.name AS device ${from} ORDER BY a.punch_time, a.id`;
  const q = [...vals];
  if (paged) {
    const { limit, offset } = limitOffset(p);
    q.push(limit, offset);
    sql += ` LIMIT $${q.length - 1} OFFSET $${q.length}`;
  }
  const { rows: raw } = await pool.query<{
    d: string;
    t: string;
    pin: string;
    employee_id: number | null;
    has_photo: boolean;
    name: string | null;
    wing: string | null;
    status: number | null;
    verify_type: number | null;
    device: string;
  }>(sql, q);

  const rows: Row[] = raw.map((r) => ({
    employeeId: r.employee_id,
    hasPhoto: r.has_photo,
    date: r.d,
    time: r.t,
    code: r.pin,
    name: r.name ?? 'Not enrolled',
    wing: r.wing,
    type: r.status === null ? null : (PunchStatusLabel[r.status] ?? `Status ${r.status}`),
    method: r.verify_type === null ? null : (VerifyTypeLabel[r.verify_type] ?? `Method ${r.verify_type}`),
    device: r.device,
  }));

  return {
    type: 'punch_log',
    title: 'Device Punch Log',
    subtitle: `${fmtRange(p.from, p.to)} · ${names.device ?? 'All devices'} · ${names.wing ?? names.scopeLabel}`,
    filters: filtersText(p, names),
    columns: [
      { key: 'date', label: 'Date', kind: 'date' },
      { key: 'time', label: 'Time', kind: 'time', align: 'center' },
      { key: 'code', label: 'Code', kind: 'mono' },
      { key: 'name', label: 'Name', kind: 'text' },
      { key: 'wing', label: 'Wing', kind: 'text' },
      { key: 'type', label: 'Punch type', kind: 'text' },
      { key: 'method', label: 'Method', kind: 'text' },
      { key: 'device', label: 'Device', kind: 'text' },
    ],
    rows,
    total,
    totals: null,
    highlights: [
      { label: 'Punches', value: total.toLocaleString('en-US') },
      { label: 'Employees', value: Number(s.people).toLocaleString('en-US') },
      { label: 'Devices', value: s.devices },
    ],
    legend: [],
    columnShade: {},
    extraTables: [],
    file: { label: 'Punch-Log', scope: slug(names.device ?? names.wing ?? names.scopeLabel), period: `${p.from}_to_${p.to}` },
  };
}
