import { DAY_STATUSES, type Dashboard, type DayStatus, type WingScope } from '@nacta/shared';
import { pool } from '../../db/pool';
import { addDays, todayLocal } from '../../lib/dates';
import { scopeClause } from '../../lib/scope';
import { ensureCached, listEmployeeIds } from '../attendance/days';
import * as deviceRepo from '../devices/repo';

const round1 = (n: number): number => Math.round(n * 10) / 10;
const NO_WING = 'No wing';
/** Statuses that count towards the day's headcount: holiday, weekend and inactive people are left out. */
const COUNTED = new Set<DayStatus>(['present', 'late', 'half_day', 'incomplete', 'absent', 'leave', 'pending']);
const HAS_PHOTO = `EXISTS (SELECT 1 FROM user_photos p WHERE p.pin = e.emp_code AND COALESCE(p.content, '') <> '')`;

/**
 * Everything the dashboard shows, wing-scoped. Set-based: one call makes sure the last 30 days are computed and cached
 * (a no-op once they are), then a handful of aggregate queries read them. No query per employee.
 * "Present" here means arrived and not late: present + half day + missing punch (those people were in).
 */
export async function getDashboard(scope: WingScope, wingId?: number): Promise<Dashboard> {
  const today = todayLocal();
  const from = addDays(today, -29);
  const ids = await listEmployeeIds(scope, { wingId });
  await ensureCached(ids, from, today);

  const feedVals: unknown[] = [today];
  const feedScope = [scopeClause(scope, 'e.wing_id', feedVals), wingId !== undefined ? (feedVals.push(wingId), `e.wing_id = $${feedVals.length}`) : null].filter(Boolean).join(' AND ');

  const [statusRows, trendRows, lateRows, leaveRows, feedRows, devices] = await Promise.all([
    // today by wing and status
    pool.query<{ wing_id: number | null; wing_name: string | null; status: DayStatus; n: string }>(
      `SELECT e.wing_id, w.name AS wing_name, ad.status, count(*) AS n
       FROM attendance_days ad JOIN employees e ON e.id = ad.employee_id LEFT JOIN wings w ON w.id = e.wing_id
       WHERE ad.employee_id = ANY($1::int[]) AND ad.date = $2::date
       GROUP BY e.wing_id, w.name, ad.status`,
      [ids, today],
    ),
    // 30-day trend by date and status
    pool.query<{ d: string; status: DayStatus; n: string; lp: string }>(
      `SELECT to_char(date, 'YYYY-MM-DD') AS d, status, count(*) AS n,
              count(*) FILTER (WHERE status = 'leave' AND leave_counts_present) AS lp
       FROM attendance_days WHERE employee_id = ANY($1::int[]) AND date BETWEEN $2::date AND $3::date
       GROUP BY date, status`,
      [ids, from, today],
    ),
    // most late days in the window
    pool.query<{ id: number; emp_code: string; name: string; wing_name: string | null; has_photo: boolean; late_days: number; avg_late: number }>(
      `SELECT t.id, t.emp_code, t.name, t.wing_name, t.late_days, t.avg_late,
              EXISTS (SELECT 1 FROM user_photos p WHERE p.pin = t.emp_code AND COALESCE(p.content, '') <> '') AS has_photo
       FROM (
         SELECT e.id, e.emp_code, e.name, w.name AS wing_name, count(*)::int AS late_days, round(avg(ad.late_minutes))::int AS avg_late
         FROM attendance_days ad JOIN employees e ON e.id = ad.employee_id LEFT JOIN wings w ON w.id = e.wing_id
         WHERE ad.employee_id = ANY($1::int[]) AND ad.date BETWEEN $2::date AND $3::date AND ad.status = 'late'
         GROUP BY e.id, w.name
         ORDER BY late_days DESC, avg_late DESC, lower(e.name), e.id
         LIMIT 8
       ) t ORDER BY t.late_days DESC, t.avg_late DESC, lower(t.name), t.id`,
      [ids, from, today],
    ),
    // people on leave today
    pool.query<{ id: number; name: string; emp_code: string; has_photo: boolean; leave: { typeName: string; code: string; color: string } }>(
      `SELECT e.id, e.name, e.emp_code, ${HAS_PHOTO} AS has_photo, ad.leave
       FROM attendance_days ad JOIN employees e ON e.id = ad.employee_id
       WHERE ad.employee_id = ANY($1::int[]) AND ad.date = $2::date AND ad.status = 'leave' AND ad.leave IS NOT NULL
       ORDER BY lower(e.name), e.id LIMIT 10`,
      [ids, today],
    ),
    // live feed: the latest 15 punches today
    pool.query<{
      id: string;
      employee_id: number | null;
      name: string | null;
      pin: string;
      has_photo: boolean;
      wing_name: string | null;
      t: string;
      verify_type: number | null;
      device: string;
    }>(
      `SELECT a.id, e.id AS employee_id, e.name, a.pin,
              (e.id IS NOT NULL AND ${HAS_PHOTO}) AS has_photo, w.name AS wing_name,
              to_char(a.punch_time, 'YYYY-MM-DD HH24:MI:SS') AS t, a.verify_type, dv.name AS device
       FROM attendance_logs a JOIN devices dv ON dv.id = a.device_id
         LEFT JOIN employees e ON e.emp_code = a.pin LEFT JOIN wings w ON w.id = e.wing_id
       WHERE a.punch_time >= $1::date AND a.punch_time < $1::date + 1${feedScope ? ` AND ${feedScope}` : ''}
       ORDER BY a.punch_time DESC, a.id DESC LIMIT 15`,
      feedVals,
    ),
    deviceRepo.list(),
  ]);

  // ---- today ----
  const counts = Object.fromEntries(DAY_STATUSES.map((s) => [s, 0])) as Record<DayStatus, number>;
  const wings = new Map<string, { wingId: number | null; wingName: string; c: Record<DayStatus, number> }>();
  for (const r of statusRows.rows) {
    const n = Number(r.n);
    counts[r.status] += n;
    const key = String(r.wing_id ?? 'none');
    const g = wings.get(key) ?? {
      wingId: r.wing_id,
      wingName: r.wing_name ?? NO_WING,
      c: Object.fromEntries(DAY_STATUSES.map((s) => [s, 0])) as Record<DayStatus, number>,
    };
    g.c[r.status] += n;
    wings.set(key, g);
  }
  const byWing = [...wings.values()]
    .map((g) => ({
      wingId: g.wingId,
      wingName: g.wingName,
      headcount: DAY_STATUSES.reduce((s, k) => s + (COUNTED.has(k) ? g.c[k] : 0), 0),
      present: g.c.present + g.c.half_day + g.c.incomplete,
      late: g.c.late,
      onLeave: g.c.leave,
      absent: g.c.absent,
      pending: g.c.pending,
    }))
    .filter((w) => w.headcount > 0)
    .sort((a, b) => (a.wingId === null ? 1 : b.wingId === null ? -1 : a.wingName.localeCompare(b.wingName)));
  const headcount = DAY_STATUSES.reduce((s, k) => s + (COUNTED.has(k) ? counts[k] : 0), 0);

  // ---- 30-day trend (oldest first) ----
  type Acc = { present: number; late: number; absent: number; leave: number; expected: number; attended: number; punctual: number };
  const byDate = new Map<string, Acc>();
  for (const r of trendRows.rows) {
    const n = Number(r.n);
    const a = byDate.get(r.d) ?? { present: 0, late: 0, absent: 0, leave: 0, expected: 0, attended: 0, punctual: 0 };
    switch (r.status) {
      case 'present': a.present += n; a.punctual += n; a.expected += n; a.attended += n; break;
      case 'half_day': a.present += n; a.expected += n; a.attended += n; break;
      case 'incomplete': a.present += n; a.expected += n; break;
      case 'late': a.late += n; a.expected += n; a.attended += n; break;
      case 'absent': a.absent += n; a.expected += n; break;
      case 'leave': a.leave += n; a.expected += n; a.attended += Number(r.lp); break;
      default:
    }
    byDate.set(r.d, a);
  }
  const trend: Dashboard['trend'] = [];
  for (let i = 0; i < 30; i++) {
    const date = addDays(from, i);
    const a = byDate.get(date);
    const arrived = a ? a.punctual + a.late : 0;
    trend.push({
      date,
      workingDay: !!a && a.expected > 0,
      present: a?.present ?? 0,
      late: a?.late ?? 0,
      absent: a?.absent ?? 0,
      onLeave: a?.leave ?? 0,
      attendanceRate: a && a.expected ? round1((100 * a.attended) / a.expected) : 0,
      punctualityRate: a && arrived ? round1((100 * a.punctual) / arrived) : 0,
    });
  }

  return {
    date: today,
    today: counts,
    headcount,
    byWing,
    trend,
    topLate: lateRows.rows.map((r) => ({
      employeeId: r.id,
      empCode: r.emp_code,
      name: r.name,
      wingName: r.wing_name,
      hasPhoto: r.has_photo,
      lateDays: r.late_days,
      avgLateMinutes: r.avg_late,
    })),
    liveFeed: feedRows.rows.map((r) => ({
      id: Number(r.id),
      employeeId: r.employee_id,
      name: r.name,
      empCode: r.pin,
      hasPhoto: r.has_photo,
      wingName: r.wing_name,
      time: r.t,
      verifyType: r.verify_type,
      deviceName: r.device,
    })),
    devices: devices.map((d) => ({ id: d.id, name: d.name, status: d.status, lastSeenAt: d.lastSeenAt })),
    onLeaveToday: leaveRows.rows.map((r) => ({
      employeeId: r.id,
      name: r.name,
      empCode: r.emp_code,
      hasPhoto: r.has_photo,
      typeName: r.leave.typeName,
      code: r.leave.code,
      color: r.leave.color,
    })),
  };
}
