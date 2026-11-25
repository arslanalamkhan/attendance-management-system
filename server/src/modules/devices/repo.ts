import type { Device, DeviceStatus } from '@nacta/shared';
import { config } from '../../config';
import { pool } from '../../db/pool';

// status is computed from last_seen_at; $1 must be the online window in milliseconds.
const STATUS_SQL = `(CASE
  WHEN last_seen_at IS NULL THEN 'unknown'
  WHEN last_seen_at > now() - ($1::double precision * interval '1 millisecond') THEN 'online'
  ELSE 'offline' END)`;

const SELECT = `
  id, name, serial_number, location, ip_address, is_active, ${STATUS_SQL} AS status,
  last_seen_at, device_name, firmware_version, platform, push_version,
  user_count, fp_count, face_count, att_count, auto_registered, created_at, updated_at`;

type DeviceRow = {
  id: number;
  name: string;
  serial_number: string;
  location: string | null;
  ip_address: string | null;
  is_active: boolean;
  status: DeviceStatus;
  last_seen_at: Date | null;
  device_name: string | null;
  firmware_version: string | null;
  platform: string | null;
  push_version: string | null;
  user_count: number | null;
  fp_count: number | null;
  face_count: number | null;
  att_count: number | null;
  auto_registered: boolean;
  created_at: Date;
  updated_at: Date;
};

const toDevice = (r: DeviceRow): Device => ({
  id: r.id,
  name: r.name,
  serialNumber: r.serial_number,
  location: r.location,
  ipAddress: r.ip_address,
  isActive: r.is_active,
  status: r.status,
  lastSeenAt: r.last_seen_at ? r.last_seen_at.toISOString() : null,
  deviceName: r.device_name,
  firmwareVersion: r.firmware_version,
  platform: r.platform,
  pushVersion: r.push_version,
  userCount: r.user_count,
  fpCount: r.fp_count,
  faceCount: r.face_count,
  attCount: r.att_count,
  autoRegistered: r.auto_registered,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

export async function list(): Promise<Device[]> {
  const { rows } = await pool.query<DeviceRow>(`SELECT ${SELECT} FROM devices ORDER BY name, id`, [
    config.deviceOnlineWindowMs,
  ]);
  return rows.map(toDevice);
}

export async function find(id: number): Promise<Device | null> {
  const { rows } = await pool.query<DeviceRow>(`SELECT ${SELECT} FROM devices WHERE id = $2`, [
    config.deviceOnlineWindowMs,
    id,
  ]);
  return rows[0] ? toDevice(rows[0]) : null;
}

export async function exists(id: number): Promise<boolean> {
  const { rowCount } = await pool.query('SELECT 1 FROM devices WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

export interface NewDevice {
  name: string;
  serialNumber: string;
  location: string | null;
  isActive: boolean;
}

export async function insert(d: NewDevice): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO devices (name, serial_number, location, is_active) VALUES ($1, $2, $3, $4) RETURNING id`,
    [d.name, d.serialNumber, d.location, d.isActive],
  );
  return (rows[0] as { id: number }).id;
}

const UPDATE_COLS = { name: 'name', serialNumber: 'serial_number', location: 'location', isActive: 'is_active' } as const;

/** Returns false when no such device. Only keys present (not undefined) are written. */
export async function update(id: number, d: Partial<NewDevice>): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, col] of Object.entries(UPDATE_COLS) as [keyof NewDevice, string][]) {
    if (d[k] !== undefined) {
      vals.push(d[k]);
      sets.push(`${col} = $${vals.length}`);
    }
  }
  vals.push(id);
  const { rowCount } = await pool.query(`UPDATE devices SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
  return (rowCount ?? 0) > 0;
}

export async function remove(id: number): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM devices WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

// ---- ADMS side ------------------------------------------------------------

export interface TouchedDevice {
  id: number;
  is_active: boolean;
  serial_number: string;
  attlog_stamp: string | null;
  operlog_stamp: string | null;
}

/**
 * Heartbeat: update last_seen_at/status/ip for the device with this serial number; auto-register
 * it if unknown and enabled. Returns the device or null when unknown and auto-register is off.
 */
export async function touch(serialNumber: string, ip: string | null, pushVersion: string | null): Promise<TouchedDevice | null> {
  const upd = await pool.query<TouchedDevice>(
    `UPDATE devices SET last_seen_at = now(), last_checked_at = now(), status = 'online',
            ip_address = COALESCE($2, ip_address), push_version = COALESCE($3, push_version)
     WHERE serial_number = $1 RETURNING id, is_active, serial_number, attlog_stamp, operlog_stamp`,
    [serialNumber, ip || null, pushVersion || null],
  );
  if (upd.rows[0]) return upd.rows[0];
  if (!config.admsAutoRegister) return null;
  // ON CONFLICT covers two devices racing to register the same serial.
  const ins = await pool.query<TouchedDevice>(
    `INSERT INTO devices (name, serial_number, ip_address, status, last_seen_at, last_checked_at, push_version, auto_registered)
     VALUES ($1, $2, $3, 'online', now(), now(), $4, true)
     ON CONFLICT (serial_number) DO UPDATE SET last_seen_at = now(), last_checked_at = now(), status = 'online'
     RETURNING id, is_active, serial_number, attlog_stamp, operlog_stamp`,
    [`Device ${serialNumber}`.slice(0, 100), serialNumber, ip || null, pushVersion || null],
  );
  return ins.rows[0] ?? null;
}

export interface DeviceInfo {
  fwVersion?: string | null;
  userCount?: number | null;
  fpCount?: number | null;
  attCount?: number | null;
  faceCount?: number | null;
  deviceName?: string | null;
  platform?: string | null;
}

/** Update info columns (only non-null values) and optionally merge an options object. */
export async function updateInfo(id: number, info: DeviceInfo = {}, options: Record<string, string> | null = null): Promise<void> {
  const hasOptions = options !== null && Object.keys(options).length > 0;
  await pool.query(
    `UPDATE devices SET
       firmware_version = COALESCE($2, firmware_version),
       user_count = COALESCE($3, user_count),
       fp_count = COALESCE($4, fp_count),
       att_count = COALESCE($5, att_count),
       face_count = COALESCE($6, face_count),
       device_name = COALESCE($7, device_name),
       platform = COALESCE($8, platform),
       options = CASE WHEN $9::jsonb IS NULL THEN options ELSE COALESCE(options, '{}'::jsonb) || $9::jsonb END
     WHERE id = $1`,
    [
      id,
      info.fwVersion ?? null,
      info.userCount ?? null,
      info.fpCount ?? null,
      info.attCount ?? null,
      info.faceCount ?? null,
      info.deviceName ?? null,
      info.platform ?? null,
      hasOptions ? JSON.stringify(options) : null,
    ],
  );
}

/** Store the Stamp / OpStamp value the device last uploaded. */
export async function setStamp(id: number, column: 'attlog_stamp' | 'operlog_stamp', value: unknown): Promise<void> {
  if (column !== 'attlog_stamp' && column !== 'operlog_stamp') return;
  const v = value === undefined || value === null ? '' : String(value).trim();
  if (!v || v.length > 64) return;
  await pool.query(`UPDATE devices SET ${column} = $2 WHERE id = $1 AND ${column} IS DISTINCT FROM $2`, [id, v]);
}

/** Mark online devices not seen within the window as offline. Returns number changed. */
export async function sweepStatus(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE devices SET status = 'offline', last_checked_at = now()
     WHERE status = 'online' AND (last_seen_at IS NULL OR last_seen_at <= now() - ($1::double precision * interval '1 millisecond'))`,
    [config.deviceOnlineWindowMs],
  );
  return rowCount ?? 0;
}

/** Keep only the newest `keep` rows of the raw ADMS request log. */
export async function trimAdmsLog(keep: number): Promise<void> {
  await pool.query(`DELETE FROM adms_requests WHERE id <= (SELECT id FROM adms_requests ORDER BY id DESC OFFSET $1 LIMIT 1)`, [keep]);
}
