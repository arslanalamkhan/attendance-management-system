import type { Overview, WingScope } from '@nacta/shared';
import { config } from '../../config';
import { pool } from '../../db/pool';
import { todayStatusCounts } from '../attendance/days';

/**
 * Headline numbers. "Today" is the database session's current_date: the server PC and the device both run
 * on Pakistan time and punch_time is stored as the device's wall clock, so no timezone conversion is needed.
 */
export async function getOverview(scope: WingScope = 'all'): Promise<Overview & { todayStatus: Awaited<ReturnType<typeof todayStatusCounts>> }> {
  // Employee-based numbers only count the caller's wings. Devices are shared infrastructure and are not scoped.
  const limited = scope !== 'all';
  const wings = limited ? scope : null;
  const [devices, employees, today, daily, todayStatus] = await Promise.all([
    pool.query<{ total: string; online: string }>(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE last_seen_at > now() - ($1::double precision * interval '1 millisecond')) AS online
       FROM devices`,
      [config.deviceOnlineWindowMs],
    ),
    pool.query<{ total: string; active: string }>(
      `SELECT count(*) AS total, count(*) FILTER (WHERE status = 'active') AS active FROM employees
       WHERE ($1::int[] IS NULL OR wing_id = ANY($1::int[]))`,
      [wings],
    ),
    pool.query<{ date: string; punches: string; present: string }>(
      `SELECT to_char(current_date, 'YYYY-MM-DD') AS date,
              (SELECT count(*) FROM attendance_logs a
                WHERE a.punch_time >= current_date AND a.punch_time < current_date + 1
                  AND ($1::int[] IS NULL OR EXISTS (SELECT 1 FROM employees x WHERE x.emp_code = a.pin AND x.wing_id = ANY($1::int[])))) AS punches,
              (SELECT count(DISTINCT e.id) FROM attendance_logs a JOIN employees e ON e.emp_code = a.pin
                WHERE a.punch_time >= current_date AND a.punch_time < current_date + 1
                  AND ($1::int[] IS NULL OR e.wing_id = ANY($1::int[]))) AS present`,
      [wings],
    ),
    pool.query<{ date: string; present: string }>(
      `SELECT to_char(s.d, 'YYYY-MM-DD') AS date, COALESCE(c.present, 0) AS present
       FROM (SELECT current_date - g AS d FROM generate_series(13, 0, -1) AS g) s
       LEFT JOIN (
         SELECT a.punch_time::date AS d, count(DISTINCT e.id) AS present
         FROM attendance_logs a JOIN employees e ON e.emp_code = a.pin
         WHERE a.punch_time >= current_date - 13 AND a.punch_time < current_date + 1
           AND ($1::int[] IS NULL OR e.wing_id = ANY($1::int[]))
         GROUP BY 1
       ) c ON c.d = s.d
       ORDER BY s.d`,
      [wings],
    ),
    todayStatusCounts(scope),
  ]);

  const dv = devices.rows[0] as { total: string; online: string };
  const em = employees.rows[0] as { total: string; active: string };
  const td = today.rows[0] as { date: string; punches: string; present: string };
  return {
    devices: { total: Number(dv.total), online: Number(dv.online) },
    employees: { total: Number(em.total), active: Number(em.active) },
    today: { date: td.date, punches: Number(td.punches), present: Number(td.present) },
    dailyPresence: daily.rows.map((r) => ({ date: r.date, present: Number(r.present) })),
    // Beyond the shared Overview schema (Phase F): today's computed status counts.
    todayStatus,
  };
}
