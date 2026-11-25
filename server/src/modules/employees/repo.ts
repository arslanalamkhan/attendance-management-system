import type { Employee, EmployeeDeviceRef, EmployeeStatus, WingScope } from '@nacta/shared';
import { pool, type Queryable } from '../../db/pool';
import { scopeClause } from '../../lib/scope';
import { byColumn, byNumericText, likeContains, limitOffset, orderBy, type SortConfig } from '../../lib/pagination';

/** Counts and flags per employee, computed once per row (LATERAL) and reused by the filters. */
const FROM = `
  FROM employees e
  LEFT JOIN wings w ON w.id = e.wing_id
  LEFT JOIN sections s ON s.id = e.section_id
  CROSS JOIN LATERAL (
    SELECT
      (SELECT count(*) FROM device_users du WHERE du.pin = e.emp_code) AS device_count,
      -- BIODATA Type 1 = fingerprint, 2/9 = face (NIR / visible light); other types stay "bio" (palm, vein...)
      (SELECT count(*) FROM biometric_templates t WHERE t.pin = e.emp_code AND (t.kind = 'fp' OR (t.kind = 'bio' AND t.bio_type = 1))) AS fp_count,
      (SELECT count(*) FROM biometric_templates t WHERE t.pin = e.emp_code AND (t.kind = 'face' OR (t.kind = 'bio' AND t.bio_type IN (2, 9)))) AS face_count,
      (SELECT count(*) FROM biometric_templates t WHERE t.pin = e.emp_code AND t.kind = 'bio' AND t.bio_type IS DISTINCT FROM 1 AND t.bio_type NOT IN (2, 9)) AS bio_count,
      EXISTS (SELECT 1 FROM user_photos p WHERE p.pin = e.emp_code AND COALESCE(p.content, '') <> '') AS has_photo,
      -- latest command per device decides: a later success clears an earlier failure
      EXISTS (SELECT 1 FROM (SELECT DISTINCT ON (c.device_id) c.status FROM device_commands c WHERE c.employee_id = e.id ORDER BY c.device_id, c.id DESC) l WHERE l.status = 'failed') AS cmd_failed,
      EXISTS (SELECT 1 FROM (SELECT DISTINCT ON (c.device_id) c.status FROM device_commands c WHERE c.employee_id = e.id ORDER BY c.device_id, c.id DESC) l WHERE l.status IN ('pending', 'sent')) AS cmd_pending
  ) x`;

/** active: on devices (or queued) = synced/pending, never pushed = not_on_device. disabled/left: nothing should be on devices. */
const SYNC_EXPR = `(CASE
    WHEN x.cmd_failed THEN 'failed'
    WHEN x.cmd_pending THEN 'pending'
    WHEN e.status = 'active' THEN CASE WHEN x.device_count = 0 THEN 'not_on_device' ELSE 'synced' END
    ELSE CASE WHEN x.device_count = 0 THEN 'synced' ELSE 'pending' END
  END)`;

const SELECT = `
  SELECT e.id, e.emp_code, e.name, e.father_name, e.cnic, e.gender, e.wing_id, w.name AS wing_name,
         e.section_id, s.name AS section_name, e.designation, e.bps, e.employment_type,
         e.status, e.status_reason, e.status_changed_at, to_char(e.join_date, 'YYYY-MM-DD') AS join_date,
         to_char(e.left_date, 'YYYY-MM-DD') AS left_date, e.card_no, e.device_password, e.privilege, e.phone, e.email,
         e.emergency_contact_name, e.emergency_contact_phone, e.address, e.notes, e.created_at, e.updated_at,
         x.device_count, x.fp_count, x.face_count, x.bio_count, x.has_photo, ${SYNC_EXPR} AS device_sync
  ${FROM}`;

type EmployeeRow = {
  id: number;
  emp_code: string;
  name: string;
  father_name: string | null;
  cnic: string | null;
  gender: Employee['gender'];
  wing_id: number | null;
  wing_name: string | null;
  section_id: number | null;
  section_name: string | null;
  designation: string | null;
  bps: number | null;
  employment_type: Employee['employmentType'];
  status: EmployeeStatus;
  status_reason: string | null;
  status_changed_at: Date | null;
  join_date: string | null;
  left_date: string | null;
  card_no: string | null;
  device_password: string | null;
  privilege: number;
  phone: string | null;
  email: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  address: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  device_count: string;
  fp_count: string;
  face_count: string;
  bio_count: string;
  has_photo: boolean;
  device_sync: Employee['deviceSync'];
};

/** "12345-1234567-1" -> "*****-*******-1". */
export const maskCnic = (cnic: string | null): string | null => (cnic ? `*****-*******-${cnic.slice(-1)}` : null);

const toEmployee = (r: EmployeeRow, canSeeCnic: boolean): Employee => ({
  id: r.id,
  empCode: r.emp_code,
  name: r.name,
  fatherName: r.father_name,
  cnic: canSeeCnic ? r.cnic : maskCnic(r.cnic),
  gender: r.gender,
  wingId: r.wing_id,
  wingName: r.wing_name,
  sectionId: r.section_id,
  sectionName: r.section_name,
  designation: r.designation,
  bps: r.bps,
  employmentType: r.employment_type,
  status: r.status,
  statusReason: r.status_reason,
  statusChangedAt: r.status_changed_at ? r.status_changed_at.toISOString() : null,
  joinDate: r.join_date,
  leftDate: r.left_date,
  cardNo: r.card_no,
  devicePassword: r.device_password,
  privilege: r.privilege,
  phone: r.phone,
  email: r.email,
  emergencyContactName: r.emergency_contact_name,
  emergencyContactPhone: r.emergency_contact_phone,
  address: r.address,
  notes: r.notes,
  deviceCount: Number(r.device_count),
  deviceSync: r.device_sync,
  templates: { fp: Number(r.fp_count), face: Number(r.face_count), bio: Number(r.bio_count) },
  hasPhoto: r.has_photo,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const SORT: SortConfig = {
  keys: {
    empCode: byNumericText('e.emp_code', 'e.id'),
    name: byColumn('lower(e.name)', 'e.id'),
    wing: byColumn('lower(w.name)', 'e.id', true),
    bps: byColumn('e.bps', 'e.id', true),
    joinDate: byColumn('e.join_date', 'e.id', true),
    createdAt: byColumn('e.created_at', 'e.id'),
  },
  defaultKey: 'empCode',
  defaultOrder: 'asc',
};

export interface EmployeeFilter {
  q?: string | undefined;
  wingId?: number | undefined;
  sectionId?: number | undefined;
  status?: EmployeeStatus | undefined;
  employmentType?: string | undefined;
  biometrics?: 'has_fingerprint' | 'has_face' | 'has_photo' | 'none' | undefined;
  deviceSync?: string | undefined;
}

export interface EmployeeListParams extends EmployeeFilter {
  page: number;
  pageSize: number;
  sort?: string | undefined;
  order?: 'asc' | 'desc' | undefined;
}

/** `canSeeCnic` (employees.manage) lets `q` match CNIC digits and returns the full CNIC. */
function buildWhere(p: EmployeeFilter, scope: WingScope, canSeeCnic: boolean): { w: string; vals: unknown[]; needsX: boolean } {
  const where: string[] = [];
  const vals: unknown[] = [];
  const scoped = scopeClause(scope, 'e.wing_id', vals);
  if (scoped) where.push(scoped);
  if (p.q) {
    vals.push(likeContains(p.q));
    const ph = `$${vals.length}`;
    const parts = [`e.emp_code ILIKE ${ph}`, `e.name ILIKE ${ph}`, `e.card_no ILIKE ${ph}`, `e.designation ILIKE ${ph}`];
    const digits = p.q.replace(/\D/g, '');
    if (canSeeCnic && digits.length >= 3) {
      vals.push(`%${digits}%`);
      parts.push(`replace(e.cnic, '-', '') LIKE $${vals.length}`);
    }
    where.push(`(${parts.join(' OR ')})`);
  }
  const eq = (col: string, v: unknown) => {
    vals.push(v);
    where.push(`${col} = $${vals.length}`);
  };
  if (p.wingId !== undefined) eq('e.wing_id', p.wingId);
  if (p.sectionId !== undefined) eq('e.section_id', p.sectionId);
  if (p.status !== undefined) eq('e.status', p.status);
  if (p.employmentType !== undefined) eq('e.employment_type', p.employmentType);
  let needsX = false;
  if (p.biometrics) {
    needsX = true;
    where.push(
      {
        has_fingerprint: 'x.fp_count > 0',
        has_face: 'x.face_count > 0',
        has_photo: 'x.has_photo',
        none: '(x.fp_count = 0 AND x.face_count = 0 AND x.bio_count = 0 AND NOT x.has_photo)',
      }[p.biometrics],
    );
  }
  if (p.deviceSync) {
    needsX = true;
    vals.push(p.deviceSync);
    where.push(`${SYNC_EXPR} = $${vals.length}`);
  }
  return { w: where.length ? `WHERE ${where.join(' AND ')}` : '', vals, needsX };
}

export async function list(p: EmployeeListParams, scope: WingScope, canSeeCnic: boolean): Promise<{ items: Employee[]; total: number }> {
  const { w, vals, needsX } = buildWhere(p, scope, canSeeCnic);
  const countFrom = needsX ? FROM : 'FROM employees e';
  const total = await pool.query<{ n: string }>(`SELECT count(*) AS n ${countFrom} ${w}`, vals);
  const { limit, offset } = limitOffset(p);
  const { rows } = await pool.query<EmployeeRow>(
    `${SELECT} ${w} ORDER BY ${orderBy(p, SORT)} LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
    [...vals, limit, offset],
  );
  return { items: rows.map((r) => toEmployee(r, canSeeCnic)), total: Number((total.rows[0] as { n: string }).n) };
}

/** Every matching employee (no paging), for the Excel export. */
export async function listAll(p: EmployeeFilter & { sort?: string | undefined; order?: 'asc' | 'desc' | undefined }, scope: WingScope, canSeeCnic: boolean): Promise<Employee[]> {
  const { w, vals } = buildWhere(p, scope, canSeeCnic);
  const { rows } = await pool.query<EmployeeRow>(`${SELECT} ${w} ORDER BY ${orderBy(p, SORT)}`, vals);
  return rows.map((r) => toEmployee(r, canSeeCnic));
}

/** An employee outside the caller's wing scope is reported as missing. */
export async function find(id: number, scope: WingScope, canSeeCnic: boolean, db: Queryable = pool): Promise<Employee | null> {
  const vals: unknown[] = [id];
  const cond = scopeClause(scope, 'e.wing_id', vals);
  const { rows } = await db.query<EmployeeRow>(`${SELECT} WHERE e.id = $1${cond ? ` AND ${cond}` : ''}`, vals);
  return rows[0] ? toEmployee(rows[0], canSeeCnic) : null;
}

/** By employee code, full (unmasked) CNIC, no scope: the Excel import applies scope itself. */
export async function findByCodes(codes: string[], db: Queryable = pool): Promise<Employee[]> {
  if (!codes.length) return [];
  const { rows } = await db.query<EmployeeRow>(`${SELECT} WHERE e.emp_code = ANY($1::text[])`, [codes]);
  return rows.map((r) => toEmployee(r, true));
}

export async function deviceRefs(empId: number, empCode: string): Promise<EmployeeDeviceRef[]> {
  const { rows } = await pool.query<{
    device_id: number;
    device_name: string;
    last_seen_at: Date | null;
    on_device: boolean;
    cmd: string | null;
    cmd_status: string | null;
    cmd_at: Date | null;
  }>(
    `SELECT d.id AS device_id, d.name AS device_name, du.last_seen_at, (du.pin IS NOT NULL) AS on_device,
            lc.cmd, lc.status AS cmd_status, lc.at AS cmd_at
     FROM devices d
     LEFT JOIN device_users du ON du.device_id = d.id AND du.pin = $2
     LEFT JOIN LATERAL (
       -- only the command name (never its payload: it may hold a password or a photo)
       SELECT COALESCE(substring(c.command from '^DATA (?:UPDATE|DELETE|QUERY) [A-Z]+'), split_part(c.command, ' ', 1)) AS cmd,
              c.status, COALESCE(c.completed_at, c.sent_at, c.created_at) AS at
       FROM device_commands c WHERE c.device_id = d.id AND c.employee_id = $1 ORDER BY c.id DESC LIMIT 1
     ) lc ON true
     ORDER BY d.name, d.id`,
    [empId, empCode],
  );
  return rows.map((r) => ({
    deviceId: r.device_id,
    deviceName: r.device_name,
    onDevice: r.on_device,
    lastCommand: r.cmd && r.cmd_status && r.cmd_at ? { command: r.cmd, status: r.cmd_status, at: r.cmd_at.toISOString() } : null,
    lastSeenAt: r.last_seen_at ? r.last_seen_at.toISOString() : null,
  }));
}

export interface EmployeeFields {
  empCode: string;
  name: string;
  fatherName: string | null;
  cnic: string | null;
  gender: string | null;
  wingId: number | null;
  sectionId: number | null;
  designation: string | null;
  bps: number | null;
  employmentType: string | null;
  joinDate: string | null;
  cardNo: string | null;
  devicePassword: string | null;
  privilege: number;
  phone: string | null;
  email: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  address: string | null;
  notes: string | null;
}

const COLS: Record<keyof EmployeeFields, string> = {
  empCode: 'emp_code',
  name: 'name',
  fatherName: 'father_name',
  cnic: 'cnic',
  gender: 'gender',
  wingId: 'wing_id',
  sectionId: 'section_id',
  designation: 'designation',
  bps: 'bps',
  employmentType: 'employment_type',
  joinDate: 'join_date',
  cardNo: 'card_no',
  devicePassword: 'device_password',
  privilege: 'privilege',
  phone: 'phone',
  email: 'email',
  emergencyContactName: 'emergency_contact_name',
  emergencyContactPhone: 'emergency_contact_phone',
  address: 'address',
  notes: 'notes',
};

const keysOf = (d: Partial<EmployeeFields>) => (Object.keys(COLS) as (keyof EmployeeFields)[]).filter((k) => d[k] !== undefined);

export async function insert(d: Partial<EmployeeFields> & { empCode: string; name: string }, db: Queryable = pool): Promise<number> {
  const keys = keysOf(d);
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO employees (${keys.map((k) => COLS[k]).join(', ')})
     VALUES (${keys.map((k, i) => `$${i + 1}${k === 'joinDate' ? '::date' : ''}`).join(', ')}) RETURNING id`,
    keys.map((k) => d[k]),
  );
  return (rows[0] as { id: number }).id;
}

/** Writes only the keys present. Returns false when no row matched. */
export async function update(id: number, d: Partial<EmployeeFields>, scope: WingScope, db: Queryable = pool): Promise<boolean> {
  const keys = keysOf(d);
  const vals: unknown[] = keys.map((k) => d[k]);
  const sets = keys.map((k, i) => `${COLS[k]} = $${i + 1}${k === 'joinDate' ? '::date' : ''}`);
  vals.push(id);
  const idPos = vals.length;
  const cond = scopeClause(scope, 'wing_id', vals);
  const { rowCount } = await db.query(
    `UPDATE employees SET ${sets.join(', ')} WHERE id = $${idPos}${cond ? ` AND ${cond}` : ''}`,
    vals,
  );
  return (rowCount ?? 0) > 0;
}

/** Status columns (only the status workflow writes them). */
export async function setStatus(
  db: Queryable,
  id: number,
  s: { status: EmployeeStatus; reason: string | null; leftDate: string | null },
): Promise<void> {
  await db.query(
    `UPDATE employees SET status = $2, status_reason = $3, status_changed_at = now(), left_date = $4::date WHERE id = $1`,
    [id, s.status, s.reason, s.leftDate],
  );
}

export async function deviceHoldsPin(pin: string): Promise<boolean> {
  const { rowCount } = await pool.query('SELECT 1 FROM device_users WHERE pin = $1 LIMIT 1', [pin]);
  return (rowCount ?? 0) > 0;
}

/** Delete inside the caller's transaction; returns the employee code or null. */
export async function deleteReturningCode(client: Queryable, id: number, scope: WingScope): Promise<string | null> {
  const vals: unknown[] = [id];
  const cond = scopeClause(scope, 'wing_id', vals);
  const { rows } = await client.query<{ emp_code: string }>(
    `DELETE FROM employees WHERE id = $1${cond ? ` AND ${cond}` : ''} RETURNING emp_code`,
    vals,
  );
  return rows[0]?.emp_code ?? null;
}

export async function activeDeviceIds(client: Queryable = pool): Promise<number[]> {
  const { rows } = await client.query<{ id: number }>('SELECT id FROM devices WHERE is_active = true ORDER BY id');
  return rows.map((r) => r.id);
}

export async function existingDeviceIds(ids: number[]): Promise<number[]> {
  const { rows } = await pool.query<{ id: number }>('SELECT id FROM devices WHERE id = ANY($1::int[])', [ids]);
  return rows.map((r) => r.id);
}

export type PushEmployee = {
  id: number;
  emp_code: string;
  name: string;
  privilege: number;
  device_password: string | null;
  card_no: string | null;
};

/** ids = null means every active employee. Always limited to the caller's wing scope. Only status "active" is sent. */
export async function pushEmployees(ids: number[] | null, scope: WingScope): Promise<{ emps: PushEmployee[]; skipped: number }> {
  const cols = 'id, emp_code, name, privilege, device_password, card_no';
  const vals: unknown[] = [];
  const where: string[] = [];
  if (ids) {
    vals.push(ids);
    where.push(`id = ANY($${vals.length}::int[])`);
  }
  const cond = scopeClause(scope, 'wing_id', vals);
  if (cond) where.push(cond);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await pool.query<PushEmployee & { status: string }>(`SELECT ${cols}, status FROM employees ${w} ORDER BY id`, vals);
  const emps = rows.filter((r) => r.status === 'active');
  return { emps, skipped: rows.length - emps.length };
}

export type TemplateRow = {
  pin: string;
  kind: string;
  bio_type: number | null;
  idx: number;
  valid: number | null;
  size: number | null;
  data: string;
  raw: string;
};

export async function templatesForPins(pins: string[], db: Queryable = pool): Promise<TemplateRow[]> {
  const { rows } = await db.query<TemplateRow>(
    `SELECT pin, kind, bio_type, idx, valid, size, data, raw FROM biometric_templates
     WHERE pin = ANY($1::text[]) ORDER BY pin, kind, bio_type NULLS FIRST, idx`,
    [pins],
  );
  return rows;
}

export async function deviceNames(ids: number[]): Promise<{ id: number; name: string }[]> {
  if (!ids.length) return [];
  const { rows } = await pool.query<{ id: number; name: string }>('SELECT id, name FROM devices WHERE id = ANY($1::int[]) ORDER BY name, id', [ids]);
  return rows;
}
