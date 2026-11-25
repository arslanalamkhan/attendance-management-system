import type { CommandStatus, DeviceCommand } from '@nacta/shared';
import { pool, type Queryable } from '../../db/pool';
import { byColumn, limitOffset, orderBy, type SortConfig } from '../../lib/pagination';

type CommandRow = {
  id: number;
  device_id: number;
  command: string;
  status: CommandStatus;
  return_code: number | null;
  result: string | null;
  created_at: Date;
  sent_at: Date | null;
  completed_at: Date | null;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

const toCommand = (r: CommandRow): DeviceCommand => ({
  id: r.id,
  deviceId: r.device_id,
  command: r.command,
  status: r.status,
  returnCode: r.return_code,
  result: r.result,
  createdAt: r.created_at.toISOString(),
  sentAt: iso(r.sent_at),
  completedAt: iso(r.completed_at),
});

export async function insert(deviceId: number, command: string): Promise<DeviceCommand> {
  const { rows } = await pool.query<CommandRow>(
    `INSERT INTO device_commands (device_id, command) VALUES ($1, $2) RETURNING *`,
    [deviceId, command],
  );
  return toCommand(rows[0] as CommandRow);
}

const SORT: SortConfig = {
  keys: {
    id: byColumn('id'),
    createdAt: byColumn('created_at', 'id'),
    status: byColumn('status', 'id'),
  },
  defaultKey: 'id',
  defaultOrder: 'desc',
};

export interface CommandListParams {
  deviceId: number;
  status?: CommandStatus | undefined;
  page: number;
  pageSize: number;
  sort?: string | undefined;
  order?: 'asc' | 'desc' | undefined;
}

export async function listForDevice(p: CommandListParams): Promise<{ items: DeviceCommand[]; total: number }> {
  const vals: unknown[] = [p.deviceId];
  let where = 'WHERE device_id = $1';
  if (p.status) {
    vals.push(p.status);
    where += ` AND status = $${vals.length}`;
  }
  const total = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM device_commands ${where}`, vals);
  const { limit, offset } = limitOffset(p);
  const { rows } = await pool.query<CommandRow>(
    `SELECT * FROM device_commands ${where} ORDER BY ${orderBy(p, SORT)} LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
    [...vals, limit, offset],
  );
  return { items: rows.map(toCommand), total: Number((total.rows[0] as { n: string }).n) };
}

/**
 * Returns up to `max` pending commands and marks them sent (atomic, safe under concurrent polls).
 * A command with after_command_id waits until that command has finished (success or failed), at least
 * DEPENDENCY_GRACE_SECONDS have passed, AND the device has gone quiet: no biometric upload (table=BIODATA, or any
 * full-size 64 KB upload chunk) from it for DEPENDENCY_GRACE_SECONDS. The SenseFace answers a biometric query with
 * its whole set over about a minute, so a fixed delay could delete a user before their backup arrived. It stops
 * waiting DEPENDENCY_TIMEOUT_MINUTES after the dependency was SENT, so an unanswered command can never block a
 * removal forever; a dependency not sent yet always holds (a device that was offline for hours must still answer
 * the query before the delete goes out, not receive both in the same poll). A held command also
 * holds back every later command of the same device (the device would otherwise run them out of order).
 */
export const DEPENDENCY_GRACE_SECONDS = 30;
export const DEPENDENCY_TIMEOUT_MINUTES = 15;
export async function takePending(deviceId: number, max = 10): Promise<{ id: number; command: string }[]> {
  const { rows } = await pool.query<{ id: number; command: string }>(
    `WITH quiet AS (
       -- Evaluated once per poll (every candidate belongs to this device), not once per waiting command.
       SELECT NOT EXISTS (
         SELECT 1 FROM adms_requests r JOIN devices d ON d.serial_number = r.serial_number
         WHERE d.id = $1 AND r.path ILIKE '%/cdata%'
           AND r.created_at > now() - ($3::int * interval '1 second')
           AND (r.query ILIKE '%table=BIODATA%' OR length(r.body) >= 60000)
       ) AS ok
     ), cand AS (
       SELECT c.id,
              (c.after_command_id IS NOT NULL
               AND EXISTS (SELECT 1 FROM device_commands p WHERE p.id = c.after_command_id)
               AND NOT EXISTS (
                 SELECT 1 FROM device_commands p
                 WHERE p.id = c.after_command_id
                   AND ((p.status IN ('success', 'failed') AND p.completed_at < now() - ($3::int * interval '1 second')
                         AND (SELECT ok FROM quiet))
                        OR (p.status <> 'pending' AND COALESCE(p.sent_at, p.created_at) < now() - ($4::int * interval '1 minute')))
               )) AS held
       FROM device_commands c WHERE c.device_id = $1 AND c.status = 'pending'
     ), ok AS (
       SELECT id FROM cand
       WHERE id < COALESCE((SELECT min(id) FROM cand WHERE held), 2147483647)
       ORDER BY id LIMIT $2
     )
     UPDATE device_commands SET status = 'sent', sent_at = now()
     WHERE id IN (SELECT id FROM device_commands WHERE id IN (SELECT id FROM ok) AND status = 'pending' ORDER BY id FOR UPDATE SKIP LOCKED)
     RETURNING id, command`,
    [deviceId, max, DEPENDENCY_GRACE_SECONDS, DEPENDENCY_TIMEOUT_MINUTES],
  );
  return rows.sort((a, b) => a.id - b.id);
}

export interface NewCommand {
  deviceId: number;
  command: string;
  employeeId?: number | null;
  afterCommandId?: number | null;
}

/** Insert many commands in one statement per chunk. Returns count queued. */
export async function insertMany(items: NewCommand[], client: Queryable = pool): Promise<number> {
  const CHUNK = 400;
  let n = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const part = items.slice(i, i + CHUNK);
    const vals: unknown[] = [];
    const ph = part.map((it) => {
      vals.push(it.deviceId, it.command, it.employeeId ?? null, it.afterCommandId ?? null);
      return `($${vals.length - 3}, $${vals.length - 2}, $${vals.length - 1}, $${vals.length})`;
    });
    const { rowCount } = await client.query(
      `INSERT INTO device_commands (device_id, command, employee_id, after_command_id) VALUES ${ph.join(', ')}`,
      vals,
    );
    n += rowCount ?? 0;
  }
  return n;
}

/**
 * The id of a biometric query for this device that has not been sent yet (oldest first), or null. Once it is sent,
 * the device uploads its whole set, so anyone still on the device at that moment is covered by it.
 */
export async function pendingBiodataQuery(deviceId: number, client: Queryable = pool): Promise<number | null> {
  const { rows } = await client.query<{ id: number }>(
    `SELECT id FROM device_commands
     WHERE device_id = $1 AND status = 'pending' AND command LIKE 'DATA QUERY BIODATA%'
     ORDER BY id LIMIT 1`,
    [deviceId],
  );
  return rows[0]?.id ?? null;
}

/** The unfiltered biometric refresh. The SenseFace ignores a PIN filter and always sends its whole set. */
export const BIODATA_REFRESH_COMMAND = 'DATA QUERY BIODATA';

/**
 * Queue one full biometric refresh for a device, unless one is already pending/sent (not yet answered).
 * Returns the id of the queued or already-waiting command.
 */
export async function queueBiodataRefresh(deviceId: number, client: Queryable = pool): Promise<number> {
  const waiting = await client.query<{ id: number }>(
    `SELECT id FROM device_commands
     WHERE device_id = $1 AND command LIKE 'DATA QUERY BIODATA%' AND status IN ('pending', 'sent')
       AND created_at > now() - interval '10 minutes'
     ORDER BY id DESC LIMIT 1`,
    [deviceId],
  );
  if (waiting.rows[0]) return waiting.rows[0].id;
  return insertOne({ deviceId, command: BIODATA_REFRESH_COMMAND }, client);
}

/** Insert one command and return its id (for ordering dependencies). */
export async function insertOne(item: NewCommand, client: Queryable = pool): Promise<number> {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO device_commands (device_id, command, employee_id, after_command_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [item.deviceId, item.command, item.employeeId ?? null, item.afterCommandId ?? null],
  );
  return (rows[0] as { id: number }).id;
}

/**
 * Record a device's reply. Only touches commands belonging to this device.
 * Returns null when no such command, else { ok, command }.
 */
export async function complete(
  deviceId: number,
  id: number,
  returnCode: number | null,
  result: string | null,
): Promise<{ ok: boolean; command: string } | null> {
  const ok = returnCode !== null && returnCode !== undefined && returnCode >= 0;
  const { rows } = await pool.query<{ command: string }>(
    `UPDATE device_commands SET status = $3, return_code = $4, result = $5, completed_at = now()
     WHERE id = $1 AND device_id = $2 RETURNING command`,
    [id, deviceId, ok ? 'success' : 'failed', returnCode ?? null, result ? String(result).slice(0, 65536) : null],
  );
  return rows[0] ? { ok, command: rows[0].command } : null;
}
