import type { DeviceUser } from '@nacta/shared';
import { pool, type Queryable } from '../../db/pool';
import { byColumn, byNumericText, likeContains, limitOffset, orderBy, type SortConfig } from '../../lib/pagination';

type DeviceUserRow = {
  device_id: number;
  pin: string;
  name: string | null;
  privilege: number | null;
  card_no: string | null;
  password: string | null;
  grp: string | null;
  last_seen_at: Date | null;
  employee_id: number | null;
  employee_name: string | null;
  fp_count: string;
  face_count: string;
  bio_count: string;
};

const toDeviceUser = (r: DeviceUserRow): DeviceUser => ({
  deviceId: r.device_id,
  pin: r.pin,
  name: r.name,
  privilege: r.privilege,
  cardNo: r.card_no,
  hasPassword: !!r.password,
  group: r.grp,
  lastSeenAt: r.last_seen_at ? r.last_seen_at.toISOString() : null,
  employeeId: r.employee_id,
  employeeName: r.employee_name,
  templates: { fp: Number(r.fp_count), face: Number(r.face_count), bio: Number(r.bio_count) },
});

const SORT: SortConfig = {
  keys: {
    pin: byNumericText('du.pin'),
    name: byColumn('lower(du.name)', 'du.pin', true),
    lastSeenAt: byColumn('du.last_seen_at', 'du.pin', true),
  },
  defaultKey: 'pin',
  defaultOrder: 'asc',
};

export interface DeviceUserListParams {
  deviceId: number;
  q?: string | undefined;
  linked?: 'true' | 'false' | undefined;
  page: number;
  pageSize: number;
  sort?: string | undefined;
  order?: 'asc' | 'desc' | undefined;
}

export async function list(p: DeviceUserListParams): Promise<{ items: DeviceUser[]; total: number }> {
  const vals: unknown[] = [p.deviceId];
  const where = ['du.device_id = $1'];
  if (p.q) {
    vals.push(likeContains(p.q));
    where.push(`(du.pin ILIKE $${vals.length} OR du.name ILIKE $${vals.length} OR du.card_no ILIKE $${vals.length})`);
  }
  if (p.linked === 'true') where.push('e.id IS NOT NULL');
  if (p.linked === 'false') where.push('e.id IS NULL');
  const w = `WHERE ${where.join(' AND ')}`;
  const from = 'FROM device_users du LEFT JOIN employees e ON e.emp_code = du.pin';

  const total = await pool.query<{ n: string }>(`SELECT count(*) AS n ${from} ${w}`, vals);
  const { limit, offset } = limitOffset(p);
  const { rows } = await pool.query<DeviceUserRow>(
    `SELECT du.device_id, du.pin, du.name, du.privilege, du.card_no, du.password, du.grp, du.last_seen_at,
            e.id AS employee_id, e.name AS employee_name,
            -- BIODATA Type 1 = fingerprint, 2/9 = face (NIR / visible light); other types stay "bio"
            (SELECT count(*) FROM biometric_templates t WHERE t.pin = du.pin AND (t.kind = 'fp' OR (t.kind = 'bio' AND t.bio_type = 1))) AS fp_count,
            (SELECT count(*) FROM biometric_templates t WHERE t.pin = du.pin AND (t.kind = 'face' OR (t.kind = 'bio' AND t.bio_type IN (2, 9)))) AS face_count,
            (SELECT count(*) FROM biometric_templates t WHERE t.pin = du.pin AND t.kind = 'bio' AND t.bio_type IS DISTINCT FROM 1 AND t.bio_type NOT IN (2, 9)) AS bio_count
     ${from}
     ${w} ORDER BY ${orderBy(p, SORT)} LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
    [...vals, limit, offset],
  );
  return { items: rows.map(toDeviceUser), total: Number((total.rows[0] as { n: string }).n) };
}

export type ImportSourceRow = { pin: string; name: string | null; privilege: number | null; card_no: string | null; password: string | null };

export async function sourceRows(deviceId: number, pins: string[] | null): Promise<ImportSourceRow[]> {
  const { rows } = pins
    ? await pool.query<ImportSourceRow>(
        'SELECT pin, name, privilege, card_no, password FROM device_users WHERE device_id = $1 AND pin = ANY($2::text[])',
        [deviceId, pins],
      )
    : await pool.query<ImportSourceRow>('SELECT pin, name, privilege, card_no, password FROM device_users WHERE device_id = $1', [deviceId]);
  return rows;
}

export interface ImportRow {
  pin: string;
  name: string;
  hasName: boolean;
  privilege: number;
  card: string | null;
  password: string | null;
}

/** Create (and optionally overwrite) employees from device users inside the caller's transaction. */
export async function importRows(client: Queryable, rows: ImportRow[], overwrite: boolean): Promise<{ created: number; updated: number }> {
  const ex = await client.query<{ emp_code: string }>('SELECT emp_code FROM employees WHERE emp_code = ANY($1::text[])', [
    rows.map((r) => r.pin),
  ]);
  const existing = new Set(ex.rows.map((r) => r.emp_code));
  const fresh = rows.filter((r) => !existing.has(r.pin));
  const known = rows.filter((r) => existing.has(r.pin));

  let created = 0;
  if (fresh.length) {
    const ins = await client.query(
      `INSERT INTO employees (emp_code, name, privilege, card_no, device_password)
       SELECT * FROM unnest($1::text[], $2::text[], $3::int[], $4::text[], $5::text[])
       ON CONFLICT (emp_code) DO NOTHING`,
      [fresh.map((r) => r.pin), fresh.map((r) => r.name), fresh.map((r) => r.privilege), fresh.map((r) => r.card), fresh.map((r) => r.password)],
    );
    created = ins.rowCount ?? 0;
  }
  let updated = 0;
  if (overwrite && known.length) {
    const upd = await client.query(
      `UPDATE employees e SET
         name = CASE WHEN s.has_name THEN s.name ELSE e.name END,
         privilege = s.privilege, card_no = s.card_no, device_password = s.password
       FROM unnest($1::text[], $2::text[], $3::int[], $4::text[], $5::text[], $6::boolean[])
            AS s(pin, name, privilege, card_no, password, has_name)
       WHERE e.emp_code = s.pin`,
      [
        known.map((r) => r.pin),
        known.map((r) => r.name),
        known.map((r) => r.privilege),
        known.map((r) => r.card),
        known.map((r) => r.password),
        known.map((r) => r.hasName),
      ],
    );
    updated = upd.rowCount ?? 0;
  }
  return { created, updated };
}
