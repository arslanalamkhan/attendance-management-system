import { createHash } from 'node:crypto';
import {
  API_BASE,
  ErrorCode,
  FINGERS,
  type BiometricTemplate,
  type EmployeeBiometrics,
  type EmployeeStatus,
  type WingScope,
} from '@nacta/shared';
import * as commands from '../../adms/commands';
import { parseUserLine } from '../../adms/parse';
import { pool, withTransaction, type Queryable } from '../../db/pool';
import { AppError, notFound, outOfScope } from '../../lib/errors';
import { inScope } from '../../lib/scope';
import * as commandRepo from '../commands/repo';
import * as devSync from '../employees/deviceSync';

/** The terminals take baseline JPEGs between these sizes (measured on the stored photos: 600x600 and 720x1280). */
export const PHOTO_MAX_BYTES = 256 * 1024;
export const PHOTO_MIN_DIM = 240;
export const PHOTO_MAX_DIM = 1280;

export interface EmpRef {
  id: number;
  empCode: string;
  name: string;
  status: EmployeeStatus;
  wingId: number | null;
}

/** Employee by id inside the caller's wing scope (404 otherwise; an out-of-scope hit is audited as denied). */
export async function loadEmployee(id: number, scope: WingScope, db: Queryable = pool): Promise<EmpRef> {
  const { rows } = await db.query<{ id: number; emp_code: string; name: string; status: EmployeeStatus; wing_id: number | null }>(
    'SELECT id, emp_code, name, status, wing_id FROM employees WHERE id = $1',
    [id],
  );
  const r = rows[0];
  if (!r) throw notFound('Employee');
  if (!inScope(scope, r.wing_id)) throw outOfScope('Employee');
  return { id: r.id, empCode: r.emp_code, name: r.name, status: r.status, wingId: r.wing_id };
}

// ---------------------------------------------------------------------------------------------------------------
// Photo
// ---------------------------------------------------------------------------------------------------------------

export const photoEtag = (pin: string, version: number): string =>
  `"${createHash('sha1').update(`${pin}:${version}`).digest('hex').slice(0, 20)}"`;

export async function photoVersion(pin: string): Promise<number | null> {
  const { rows } = await pool.query<{ version: number }>(
    `SELECT version FROM user_photos WHERE pin = $1 AND COALESCE(content, '') <> ''`,
    [pin],
  );
  return rows[0]?.version ?? null;
}

export async function photoBytes(pin: string): Promise<Buffer | null> {
  const { rows } = await pool.query<{ content: string }>(`SELECT content FROM user_photos WHERE pin = $1 AND COALESCE(content, '') <> ''`, [pin]);
  return rows[0] ? Buffer.from(rows[0].content, 'base64') : null;
}

export interface PhotoQueueOptions {
  syncToDevices: boolean;
  /** undefined = default: true when the employee is on at least one device. */
  createFace: boolean | undefined;
}

export interface PhotoStoreResult {
  version: number;
  devices: { id: number; name: string }[];
  createFace: boolean;
  queued: number;
}

/** Store the uploaded JPEG as the app photo (bumping `version`) and queue USERPIC / BIOPHOTO for active employees on devices. */
export async function storePhoto(emp: EmpRef, jpeg: Buffer, opts: PhotoQueueOptions): Promise<PhotoStoreResult> {
  const content = jpeg.toString('base64');
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ version: number }>(
      `INSERT INTO user_photos (pin, file_name, content, source_device_id, source, size_bytes, version)
       VALUES ($1, $2, $3, NULL, 'app', $4, 1)
       ON CONFLICT (pin) DO UPDATE SET file_name = EXCLUDED.file_name, content = EXCLUDED.content, source_device_id = NULL,
         source = 'app', size_bytes = EXCLUDED.size_bytes, version = user_photos.version + 1
       RETURNING version`,
      [emp.empCode, `${emp.empCode}.jpg`, content, jpeg.length],
    );
    const version = (rows[0] as { version: number }).version;
    const devices = emp.status === 'active' ? await devSync.holdingDevices(client, emp.empCode) : [];
    const createFace = opts.createFace ?? devices.length > 0;
    const items: commandRepo.NewCommand[] = [];
    for (const d of devices) {
      if (opts.syncToDevices) {
        items.push({ deviceId: d.id, employeeId: emp.id, command: commands.updateUserPic({ pin: emp.empCode, fileName: `${emp.empCode}.jpg`, content }) });
      }
      if (createFace) items.push({ deviceId: d.id, employeeId: emp.id, command: commands.updateBioPhoto({ pin: emp.empCode, content }) });
    }
    const queued = await commandRepo.insertMany(items, client);
    return { version, devices, createFace, queued };
  });
}

/** Removes the app copy only. False when the stored photo is the devices' (or there is none). */
export async function deleteAppPhoto(pin: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM user_photos WHERE pin = $1 AND source = 'app'`, [pin]);
  return (rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------------------------------------------

type TemplateRow = {
  id: number;
  pin: string;
  kind: string;
  bio_type: number | null;
  idx: number;
  valid: number | null;
  raw: string;
  size_bytes: number;
  source: 'device' | 'app';
  device_name: string | null;
  updated_at: Date;
};

const TEMPLATE_SELECT = `
  SELECT t.id, t.pin, t.kind, t.bio_type, t.idx, t.valid, t.raw, t.source, d.name AS device_name, t.updated_at,
         floor(length(rtrim(t.data, '=')) * 3 / 4)::int AS size_bytes
  FROM biometric_templates t LEFT JOIN devices d ON d.id = t.source_device_id`;

/** Algorithm version "13.0" from the stored BIODATA line (MajorVer / MinorVer). */
function versionOf(raw: string): string | null {
  const f = parseUserLine(raw, 'BIODATA')?.fields;
  if (!f || f.majorver === undefined || f.majorver === '') return null;
  return `${f.majorver}.${f.minorver || '0'}`;
}

/** finger: Type 1 or legacy FP; face: Type 9 / 2 or legacy FACE; everything else is "other". */
export function classify(r: { kind: string; bio_type: number | null }): 'finger' | 'face' | 'other' {
  if (r.kind === 'fp' || (r.kind === 'bio' && r.bio_type === 1)) return 'finger';
  if (r.kind === 'face' || (r.kind === 'bio' && (r.bio_type === 9 || r.bio_type === 2))) return 'face';
  return 'other';
}

function toTemplate(r: TemplateRow): BiometricTemplate {
  const c = classify(r);
  return {
    id: r.id,
    kind: c,
    fingerIndex: c === 'finger' ? r.idx : null,
    bioType: r.kind === 'bio' ? r.bio_type : null,
    version: r.kind === 'bio' ? versionOf(r.raw) : null,
    valid: r.valid !== 0,
    sizeBytes: r.size_bytes,
    source: r.source,
    sourceDeviceName: r.source === 'device' ? r.device_name : null,
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function getBiometrics(emp: EmpRef): Promise<EmployeeBiometrics> {
  const [tpl, photo, act] = await Promise.all([
    pool.query<TemplateRow>(`${TEMPLATE_SELECT} WHERE t.pin = $1 ORDER BY t.kind, t.bio_type NULLS FIRST, t.idx`, [emp.empCode]),
    pool.query<{ version: number; source: 'device' | 'app'; device_name: string | null; size_bytes: number; updated_at: Date }>(
      `SELECT p.version, p.source, d.name AS device_name, p.updated_at,
              CASE WHEN p.size_bytes > 0 THEN p.size_bytes ELSE floor(length(rtrim(p.content, '=')) * 3 / 4)::int END AS size_bytes
       FROM user_photos p LEFT JOIN devices d ON d.id = p.source_device_id
       WHERE p.pin = $1 AND COALESCE(p.content, '') <> ''`,
      [emp.empCode],
    ),
    pool.query<{ id: number; device_id: number; device_name: string; name: string; status: string; created_at: Date; completed_at: Date | null }>(
      `SELECT c.id, c.device_id, d.name AS device_name, c.status, c.created_at, c.completed_at,
              substring(c.command from '^(ENROLL_[A-Z]+|DATA (?:UPDATE|DELETE|QUERY) [A-Z]+)') AS name
       FROM device_commands c JOIN devices d ON d.id = c.device_id
       WHERE c.employee_id = $1
         AND c.command ~ '^(ENROLL_|DATA UPDATE BIOPHOTO|DATA UPDATE USERPIC|DATA DELETE BIODATA|DATA DELETE FINGERTMP|DATA UPDATE BIODATA|DATA QUERY BIODATA)'
       ORDER BY c.id DESC LIMIT 20`,
      [emp.id],
    ),
  ]);
  const all = tpl.rows.map((r) => ({ c: classify(r), t: toTemplate(r) }));
  const p = photo.rows[0];
  return {
    employeeId: emp.id,
    pin: emp.empCode,
    photo: p
      ? {
          url: `${API_BASE}/employees/${emp.id}/photo?v=${p.version}`,
          source: p.source,
          sourceDeviceName: p.source === 'device' ? p.device_name : null,
          sizeBytes: p.size_bytes,
          updatedAt: p.updated_at.toISOString(),
        }
      : null,
    fingers: all.filter((x) => x.c === 'finger').map((x) => x.t),
    faces: all.filter((x) => x.c === 'face').map((x) => x.t),
    other: all.filter((x) => x.c === 'other').map((x) => x.t),
    activity: act.rows.map((r) => ({
      commandId: r.id,
      deviceId: r.device_id,
      deviceName: r.device_name,
      command: r.name,
      status: r.status,
      createdAt: r.created_at.toISOString(),
      completedAt: r.completed_at ? r.completed_at.toISOString() : null,
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Remote enrolment
// ---------------------------------------------------------------------------------------------------------------

/** Forget a pending tombstone: the person is enrolling that finger/face again, so the next upload must be stored. */
async function clearTombstones(db: Queryable, pin: string, kind: 'finger' | 'face', fingerIndex: number | null): Promise<void> {
  if (kind === 'finger') {
    await db.query(`DELETE FROM biometric_tombstones WHERE pin = $1 AND ((kind = 'bio' AND bio_type = 1) OR kind = 'fp') AND idx = $2`, [pin, fingerIndex ?? 0]);
  } else {
    await db.query(`DELETE FROM biometric_tombstones WHERE pin = $1 AND (kind = 'face' OR (kind = 'bio' AND bio_type IN (2, 9)))`, [pin]);
  }
}

export async function requestEnrol(
  emp: EmpRef,
  input: { deviceId: number; kind: 'finger' | 'face'; fingerIndex?: number | undefined; overwrite: boolean },
): Promise<{ commandId: number; deviceName: string; command: string }> {
  const { rows } = await pool.query<{ name: string; on_device: boolean }>(
    `SELECT d.name, EXISTS (SELECT 1 FROM device_users du WHERE du.device_id = d.id AND du.pin = $2) AS on_device FROM devices d WHERE d.id = $1`,
    [input.deviceId, emp.empCode],
  );
  const dev = rows[0];
  if (!dev) throw notFound('Device');
  if (emp.status !== 'active' || !dev.on_device) {
    throw new AppError(409, ErrorCode.NOT_ON_DEVICE, 'The employee must be active and already on that device before enrolling there');
  }
  const command =
    input.kind === 'finger'
      ? commands.enrollFinger(emp.empCode, input.fingerIndex as number, input.overwrite)
      : commands.enrollFace(emp.empCode, input.overwrite);
  const commandId = await withTransaction(async (client) => {
    await clearTombstones(client, emp.empCode, input.kind, input.fingerIndex ?? null);
    return commandRepo.insertOne({ deviceId: input.deviceId, command, employeeId: emp.id }, client);
  });
  return { commandId, deviceName: dev.name, command };
}

// ---------------------------------------------------------------------------------------------------------------
// Template deletion
// ---------------------------------------------------------------------------------------------------------------

export interface DeleteResult {
  template: BiometricTemplate;
  devices: { id: number; name: string }[];
  queued: number;
  command: string | null;
}

export async function deleteTemplate(emp: EmpRef, templateId: number, fromDevices: boolean): Promise<DeleteResult> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<TemplateRow>(`${TEMPLATE_SELECT} WHERE t.id = $1 AND t.pin = $2 FOR UPDATE OF t`, [templateId, emp.empCode]);
    const row = rows[0];
    if (!row) throw notFound('Template');
    await client.query('DELETE FROM biometric_templates WHERE id = $1', [templateId]);
    let command: string | null = null;
    if (row.kind === 'fp') command = commands.deleteFingerTmp(row.pin, row.idx);
    else if (row.kind === 'face') command = commands.deleteFace(row.pin, row.idx);
    else if (row.bio_type !== null) command = commands.deleteBiodata(row.pin, row.bio_type, row.idx);
    const devices = fromDevices && command ? await devSync.holdingDevices(client, emp.empCode) : [];
    let queued = 0;
    if (devices.length && command) {
      // The device still holds the template and would upload it again: remember the deletion until it confirms.
      await client.query(`DELETE FROM biometric_tombstones WHERE deleted_at < now() - interval '1 day'`);
      await client.query(
        `INSERT INTO biometric_tombstones (pin, kind, bio_type, idx) VALUES ($1, $2, $3, $4)
         ON CONFLICT (pin, kind, (COALESCE(bio_type, -1)), idx) DO UPDATE SET deleted_at = now()`,
        [row.pin, row.kind, row.kind === 'bio' ? row.bio_type : null, row.idx],
      );
      queued = await commandRepo.insertMany(
        devices.map((d) => ({ deviceId: d.id, employeeId: emp.id, command: command as string })),
        client,
      );
    }
    return { template: toTemplate(row), devices, queued, command };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Fingerprint capture (USB reader bridge)
// ---------------------------------------------------------------------------------------------------------------

/** Fingerprint algorithm major versions stored from the devices this employee is on (most common first). */
export async function deviceFingerVersions(pin: string): Promise<number[]> {
  const q = (where: string, vals: unknown[]) =>
    pool.query<{ major: number }>(
      `SELECT NULLIF(substring(t.raw from '(?i)MajorVer=(\\d+)'), '')::int AS major
       FROM biometric_templates t WHERE t.kind = 'bio' AND t.bio_type = 1 AND t.source = 'device' ${where}
       GROUP BY 1 HAVING NULLIF(substring(t.raw from '(?i)MajorVer=(\\d+)'), '')::int IS NOT NULL ORDER BY count(*) DESC`,
      vals,
    );
  const own = await q(`AND t.source_device_id IN (SELECT device_id FROM device_users WHERE pin = $1)`, [pin]);
  if (own.rows.length) return own.rows.map((r) => r.major);
  const any = await q('', []);
  return any.rows.map((r) => r.major);
}

/** Fallback when nothing is stored yet: the SenseFace 7A reports FPVersion 13. */
export const DEFAULT_FINGER_MAJOR = 13;

export async function captureFingerprint(
  emp: EmpRef,
  input: { fingerIndex: number; template: string; majorVersion: number; minorVersion: number; syncToDevices: boolean },
): Promise<{ template: BiometricTemplate; devices: { id: number; name: string }[]; queued: number }> {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.template)) {
    throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Invalid request body', { template: 'Must be base64' });
  }
  const versions = await deviceFingerVersions(emp.empCode);
  const allowed = versions.length ? versions : [DEFAULT_FINGER_MAJOR];
  if (!allowed.includes(input.majorVersion)) {
    throw new AppError(
      409,
      ErrorCode.TEMPLATE_INCOMPATIBLE,
      `The devices use fingerprint algorithm version ${allowed[0]}, this template is version ${input.majorVersion}`,
      { expected: allowed[0], got: input.majorVersion },
    );
  }
  const pin = emp.empCode;
  const raw =
    `BIODATA Pin=${pin}\tNo=${input.fingerIndex}\tIndex=0\tValid=1\tDuress=0\tType=1\tMajorVer=${input.majorVersion}` +
    `\tMinorVer=${input.minorVersion}\tFormat=0\tTmp=${input.template}`;
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO biometric_templates (pin, kind, bio_type, idx, valid, size, data, raw, source_device_id, source)
       VALUES ($1, 'bio', 1, $2, 1, NULL, $3, $4, NULL, 'app')
       ON CONFLICT (pin, kind, (COALESCE(bio_type, -1)), idx) DO UPDATE SET
         valid = 1, size = NULL, data = EXCLUDED.data, raw = EXCLUDED.raw, source_device_id = NULL, source = 'app'
       RETURNING id`,
      [pin, input.fingerIndex, input.template, raw],
    );
    const id = (rows[0] as { id: number }).id;
    await clearTombstones(client, pin, 'finger', input.fingerIndex);
    const stored = await client.query<TemplateRow>(`${TEMPLATE_SELECT} WHERE t.id = $1`, [id]);
    const devices = input.syncToDevices && emp.status === 'active' ? await devSync.holdingDevices(client, pin) : [];
    const command = commands.updateBiodata({ pin, kind: 'bio', bioType: 1, idx: input.fingerIndex, valid: 1, data: input.template, raw });
    const queued = await commandRepo.insertMany(
      devices.map((d) => ({ deviceId: d.id, employeeId: emp.id, command })),
      client,
    );
    return { template: toTemplate(stored.rows[0] as TemplateRow), devices, queued };
  });
}

export const fingerName = (idx: number | null): string | null => (idx === null ? null : (FINGERS[idx]?.name ?? null));
