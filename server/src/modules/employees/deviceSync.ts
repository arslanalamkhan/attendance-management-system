// Everything that turns an employee change into device commands. Used by edit, push, status change and Excel import.
// Commands are only queued here (wait-free): devices pick them up in id order on their next poll.
import type { EmployeeStatus } from '@nacta/shared';
import * as commands from '../../adms/commands';
import type { Queryable } from '../../db/pool';
import * as commandRepo from '../commands/repo';
import * as repo from './repo';

export interface DeviceProfile {
  id: number;
  emp_code: string;
  name: string;
  privilege: number;
  device_password: string | null;
  card_no: string | null;
  status: EmployeeStatus;
}

export async function profilesByIds(db: Queryable, ids: number[]): Promise<DeviceProfile[]> {
  if (!ids.length) return [];
  const { rows } = await db.query<DeviceProfile>(
    'SELECT id, emp_code, name, privilege, device_password, card_no, status FROM employees WHERE id = ANY($1::int[]) ORDER BY id',
    [ids],
  );
  return rows;
}

export const userInfoCommand = (e: Pick<DeviceProfile, 'emp_code' | 'name' | 'privilege' | 'device_password' | 'card_no'>): string =>
  commands.updateUserInfo({
    pin: e.emp_code,
    name: e.name,
    privilege: e.privilege,
    password: e.device_password || '',
    card: e.card_no || '',
  });

/** Devices that currently hold this PIN (from the device_users mirror). */
export async function holdingDevices(db: Queryable, pin: string): Promise<{ id: number; name: string }[]> {
  const { rows } = await db.query<{ id: number; name: string }>(
    `SELECT d.id, d.name FROM device_users du JOIN devices d ON d.id = du.device_id WHERE du.pin = $1 ORDER BY d.id`,
    [pin],
  );
  return rows;
}

/** DATA UPDATE USERINFO to each device that holds the employee. Never call for a non-active employee. */
export async function queueProfileUpdate(
  db: Queryable,
  e: DeviceProfile,
  devices: { id: number; name: string }[],
): Promise<number> {
  if (e.status !== 'active' || !devices.length) return 0;
  return commandRepo.insertMany(
    devices.map((d) => ({ deviceId: d.id, command: userInfoCommand(e), employeeId: e.id })),
    db,
  );
}

export interface BackupRisk {
  risk: boolean;
  reasons: string[];
}

/**
 * Could this employee have biometrics on a device that the application has not stored?
 *
 * The mirror cannot say what a device holds per user, but each device reports totals (FPCount, FaceCount in its
 * options). For every device holding the PIN we compare that total with what we have stored for the pins on that
 * device. The employee is "at risk" when they have NO stored template of a kind while the device reports more
 * templates of that kind than we hold in total (e.g. device FaceCount 676 vs 612 stored: 64 faces are unaccounted
 * for, and this person may be one). Employees who simply never enrolled can trip this too; they pass with
 * `force: true`. The check never blocks anyone when the device reports no totals.
 */
export async function backupRisk(db: Queryable, pin: string): Promise<BackupRisk> {
  const { rows } = await db.query<{
    name: string;
    dev_fp: number | null;
    dev_face: number | null;
    stored_fp: string;
    stored_face: string;
    own_fp: string;
    own_face: string;
  }>(
    `SELECT d.name, d.fp_count AS dev_fp, NULLIF(d.options->>'FaceCount', '')::int AS dev_face,
       (SELECT count(*) FROM biometric_templates t JOIN device_users u ON u.pin = t.pin AND u.device_id = d.id
         WHERE t.kind = 'fp' OR (t.kind = 'bio' AND t.bio_type = 1)) AS stored_fp,
       (SELECT count(*) FROM biometric_templates t JOIN device_users u ON u.pin = t.pin AND u.device_id = d.id
         WHERE t.kind = 'face' OR (t.kind = 'bio' AND t.bio_type IN (2, 9))) AS stored_face,
       (SELECT count(*) FROM biometric_templates t WHERE t.pin = $1 AND (t.kind = 'fp' OR (t.kind = 'bio' AND t.bio_type = 1))) AS own_fp,
       (SELECT count(*) FROM biometric_templates t WHERE t.pin = $1 AND (t.kind = 'face' OR (t.kind = 'bio' AND t.bio_type IN (2, 9)))) AS own_face
     FROM devices d JOIN device_users du ON du.device_id = d.id AND du.pin = $1`,
    [pin],
  );
  const reasons: string[] = [];
  for (const r of rows) {
    if (Number(r.own_fp) === 0 && r.dev_fp !== null && r.dev_fp > Number(r.stored_fp)) {
      reasons.push(`${r.name} reports ${r.dev_fp} fingerprints but only ${r.stored_fp} are stored`);
    }
    // Faces are deliberately not compared: the SenseFace's FaceCount (676) overcounts. A full re-upload on
    // 2026-11-24 returned exactly the 612 face templates already stored. The refresh queued before every removal
    // covers faces anyway.
    void r.dev_face;
    void r.stored_face;
    void r.own_face;
  }
  return { risk: reasons.length > 0, reasons };
}

/**
 * Removal, in the order the device must run it: refresh the user's biometrics from the device, then delete the user.
 * The delete is held back (after_command_id) until the refresh finished and the device had time to upload its
 * answer, so the backup is not racing the delete. Also records where the person was removed from.
 */
export async function queueRemoval(
  db: Queryable,
  e: { id: number; emp_code: string },
  devices: { id: number; name: string }[],
  reason: string | null,
): Promise<number> {
  let queued = 0;
  for (const d of devices) {
    // The SenseFace ignores the PIN filter and re-sends its whole biometric set; the delete waits until that upload
    // has finished (see takePending). Photos are NOT re-fetched: a USERPIC query makes it re-send every photo
    // (~90 MB), and photos already arrive with enrolment and the initial sync.
    const fetch = await commandRepo.insertOne({ deviceId: d.id, command: commands.queryBiodataForPin(e.emp_code), employeeId: e.id }, db);
    await commandRepo.insertOne(
      { deviceId: d.id, command: commands.deleteUserInfo(e.emp_code), employeeId: e.id, afterCommandId: fetch },
      db,
    );
    queued += 2;
    await db.query(
      `INSERT INTO employee_device_holds (employee_id, device_id, reason) VALUES ($1, $2, $3)
       ON CONFLICT (employee_id, device_id) DO UPDATE SET removed_at = now(), reason = EXCLUDED.reason`,
      [e.id, d.id, reason],
    );
  }
  return queued;
}

/**
 * Restore to the devices the person was removed from (or every active device when none is recorded), in order:
 * user, every stored template (BIODATA rebuilt from its raw line, Type 1 fingers / Type 9 faces), then the photo.
 */
export async function queueRestore(
  db: Queryable,
  e: DeviceProfile,
): Promise<{ queued: number; devices: { id: number; name: string }[] }> {
  const held = await db.query<{ id: number; name: string }>(
    `SELECT d.id, d.name FROM employee_device_holds h JOIN devices d ON d.id = h.device_id WHERE h.employee_id = $1 ORDER BY d.id`,
    [e.id],
  );
  let devices = held.rows;
  if (!devices.length) {
    const active = await repo.activeDeviceIds(db);
    devices = await deviceNamesOn(db, active);
  }
  await db.query('DELETE FROM employee_device_holds WHERE employee_id = $1', [e.id]);
  if (!devices.length) return { queued: 0, devices };

  const tpl = await repo.templatesForPins([e.emp_code], db);
  const photo = await db.query<{ file_name: string | null; content: string | null }>(
    `SELECT file_name, content FROM user_photos WHERE pin = $1 AND COALESCE(content, '') <> ''`,
    [e.emp_code],
  );
  const items: commandRepo.NewCommand[] = [];
  for (const d of devices) {
    items.push({ deviceId: d.id, command: userInfoCommand(e), employeeId: e.id });
    for (const t of tpl) {
      items.push({
        deviceId: d.id,
        employeeId: e.id,
        command: commands.updateTemplate({ pin: t.pin, kind: t.kind, bioType: t.bio_type, idx: t.idx, valid: t.valid, size: t.size, data: t.data, raw: t.raw }),
      });
    }
    const p = photo.rows[0];
    if (p?.content) items.push({ deviceId: d.id, employeeId: e.id, command: commands.updateUserPic({ pin: e.emp_code, fileName: p.file_name, content: p.content }) });
  }
  const queued = await commandRepo.insertMany(items, db);
  return { queued, devices };
}

async function deviceNamesOn(db: Queryable, ids: number[]): Promise<{ id: number; name: string }[]> {
  if (!ids.length) return [];
  const { rows } = await db.query<{ id: number; name: string }>('SELECT id, name FROM devices WHERE id = ANY($1::int[]) ORDER BY id', [ids]);
  return rows;
}
