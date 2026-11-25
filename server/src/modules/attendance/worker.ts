import { pool, withTransaction } from '../../db/pool';
import { localNow, todayLocal, addDays } from '../../lib/dates';
import { logger } from '../../lib/logger';
import { computeKeys, upsertDays } from './compute';

const log = logger.child({ component: 'attendance-worker' });

export const BATCH_SIZE = 500;
const TICK_MS = 5_000;
const REFRESH_TODAY_MS = 15 * 60_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Recompute one batch of queued employee-days. The keys are removed from the queue in the same transaction that
 * writes the results, so a failure leaves them queued; a change arriving meanwhile re-queues its key afterwards.
 * Returns how many keys were processed.
 */
export async function processBatch(limit = BATCH_SIZE): Promise<number> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ employee_id: number; date: string }>(
      `DELETE FROM attendance_dirty WHERE (employee_id, date) IN (
         SELECT employee_id, date FROM attendance_dirty ORDER BY queued_at, employee_id, date LIMIT $1 FOR UPDATE SKIP LOCKED
       ) RETURNING employee_id, to_char(date, 'YYYY-MM-DD') AS date`,
      [limit],
    );
    if (!rows.length) return 0;
    const days = await computeKeys(
      rows.map((r) => ({ employeeId: r.employee_id, date: r.date })),
      { db: client },
    );
    await upsertDays(days, client);
    return rows.length;
  });
}

export async function queueSize(): Promise<number> {
  const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM attendance_dirty');
  return Number((rows[0] as { n: string }).n);
}

let draining = false;
/** Process the queue until it is empty, yielding to the event loop between batches. Never overlaps itself. */
export async function drain(opts: { yieldMs?: number } = {}): Promise<number> {
  if (draining) return 0;
  draining = true;
  let total = 0;
  let batches = 0;
  try {
    for (;;) {
      const n = await processBatch();
      if (!n) break;
      total += n;
      batches += 1;
      if (batches % 20 === 0) log.info(`recomputed ${total} employee-days so far (${await queueSize()} still queued)`);
      await sleep(opts.yieldMs ?? 10);
    }
  } catch (err) {
    log.error({ err }, 'recompute batch failed; will retry');
  } finally {
    draining = false;
  }
  if (total > 0) log.info(`recomputed ${total} employee-days`);
  return total;
}

/**
 * First start (or after the cache was emptied): queue every employee for every day from the earliest punch to today.
 * Returns the number of queued rows (0 when nothing to do).
 */
export async function backfillIfEmpty(): Promise<number> {
  const cached = await pool.query<{ n: string }>('SELECT count(*) AS n FROM (SELECT 1 FROM attendance_days LIMIT 1) x');
  if (Number((cached.rows[0] as { n: string }).n) > 0 || (await queueSize()) > 0) return 0;
  const first = await pool.query<{ d: string | null }>(`SELECT to_char(min(punch_time)::date, 'YYYY-MM-DD') AS d FROM attendance_logs`);
  const from = (first.rows[0] as { d: string | null }).d;
  if (!from) return 0;
  const r = await pool.query(
    `INSERT INTO attendance_dirty (employee_id, date)
     SELECT e.id, g::date FROM employees e CROSS JOIN generate_series($1::date, $2::date, interval '1 day') g
     ON CONFLICT DO NOTHING`,
    [from, todayLocal()],
  );
  log.info(`attendance backfill queued: ${r.rowCount ?? 0} employee-days from ${from} to ${todayLocal()}`);
  return r.rowCount ?? 0;
}

/**
 * Re-queue today for everybody: status changes with the clock (pending -> absent, early leave, half day). Yesterday's
 * night shifts too: they end this morning.
 */
export async function refreshToday(): Promise<number> {
  const today = todayLocal();
  const r = await pool.query(
    `INSERT INTO attendance_dirty (employee_id, date)
     SELECT employee_id, date FROM attendance_days
     WHERE date = $1::date OR (date = $1::date - 1 AND (timing->>'end') < (timing->>'start'))
     ON CONFLICT (employee_id, date) DO UPDATE SET queued_at = now()`,
    [today],
  );
  return r.rowCount ?? 0;
}

/** Nightly: yesterday and today for every employee. */
export async function nightly(): Promise<number> {
  const today = todayLocal();
  const r = await pool.query(
    `INSERT INTO attendance_dirty (employee_id, date)
     SELECT e.id, g::date FROM employees e CROSS JOIN generate_series($1::date, $2::date, interval '1 day') g
     ON CONFLICT (employee_id, date) DO UPDATE SET queued_at = now()`,
    [addDays(today, -1), today],
  );
  log.info(`nightly attendance refresh queued ${r.rowCount ?? 0} employee-days`);
  return r.rowCount ?? 0;
}

let tickTimer: NodeJS.Timeout | null = null;
let todayTimer: NodeJS.Timeout | null = null;
let nightlyTimer: NodeJS.Timeout | null = null;
let lastNightly = '';

export function start(): void {
  if (tickTimer) return;
  void backfillIfEmpty().catch((err: unknown) => log.error({ err }, 'backfill failed'));
  tickTimer = setInterval(() => void drain(), TICK_MS);
  todayTimer = setInterval(() => void refreshToday().catch((err: unknown) => log.error({ err }, 'refresh today failed')), REFRESH_TODAY_MS);
  nightlyTimer = setInterval(() => {
    const now = localNow();
    if (now.minutes >= 60 && now.minutes < 120 && lastNightly !== now.date) {
      lastNightly = now.date;
      void nightly().catch((err: unknown) => log.error({ err }, 'nightly refresh failed'));
    }
  }, 60_000);
  for (const t of [tickTimer, todayTimer, nightlyTimer]) t.unref();
}

export function stop(): void {
  for (const t of [tickTimer, todayTimer, nightlyTimer]) if (t) clearInterval(t);
  tickTimer = todayTimer = nightlyTimer = null;
}
