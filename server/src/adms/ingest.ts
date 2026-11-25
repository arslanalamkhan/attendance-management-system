import type pg from 'pg';
import { pool, withTransaction } from '../db/pool';
import { intOrNull, parseUserLine, type BioRecord, type DeviceRecord, type PhotoRecord, type TemplateRecord, type UserRecord } from './parse';

// Rows per multi-row statement. Parameters per row stay well below the 65535 limit.
const CHUNK = 200;

const chunks = <T>(arr: T[], n = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** Last record wins for the same key (ON CONFLICT DO UPDATE cannot touch a row twice per statement). */
function dedupe<T>(records: T[], keyFn: (r: T) => string): T[] {
  const m = new Map<string, T>();
  for (const r of records) m.set(keyFn(r), r);
  return [...m.values()];
}

/** Build "($1,$2,..),($n,..)" and the flat value list. cols: array of (row) => value. */
function multiValues<T>(rows: T[], cols: ((row: T) => unknown)[]): { sql: string; vals: unknown[] } {
  const vals: unknown[] = [];
  const ph = rows.map((r) => {
    const parts = cols.map((fn) => {
      vals.push(fn(r));
      return `$${vals.length}`;
    });
    return `(${parts.join(', ')})`;
  });
  return { sql: ph.join(', '), vals };
}

async function upsertUsers(client: pg.PoolClient, deviceId: number, users: UserRecord[]): Promise<void> {
  for (const part of chunks(dedupe(users, (u) => u.pin))) {
    const { sql, vals } = multiValues(part, [
      () => deviceId,
      (u) => u.pin,
      (u) => u.name,
      (u) => u.privilege,
      (u) => u.card,
      (u) => u.password,
      (u) => u.grp,
      (u) => u.raw,
    ]);
    await client.query(
      `INSERT INTO device_users (device_id, pin, name, privilege, card_no, password, grp, raw)
       VALUES ${sql}
       ON CONFLICT (device_id, pin) DO UPDATE SET
         name = EXCLUDED.name, privilege = EXCLUDED.privilege, card_no = EXCLUDED.card_no,
         password = EXCLUDED.password, grp = EXCLUDED.grp, raw = EXCLUDED.raw, last_seen_at = now()`,
      vals,
    );
  }
}

async function upsertTemplates(client: pg.PoolClient, deviceId: number, templates: (TemplateRecord | BioRecord)[]): Promise<number> {
  const all = templates.map((t) => ({
    pin: t.pin,
    kind: t.kind,
    bioType: t.kind === 'bio' ? (t.bioType ?? null) : null,
    idx: t.idx ?? 0,
    valid: t.valid ?? null,
    size: t.size ?? null,
    data: t.data,
    raw: t.raw,
  }));
  const rows = await dropTombstoned(client, all);
  for (const part of chunks(dedupe(rows, (t) => `${t.pin}|${t.kind}|${t.bioType ?? -1}|${t.idx}`), 100)) {
    const { sql, vals } = multiValues(part, [
      (t) => t.pin,
      (t) => t.kind,
      (t) => t.bioType,
      (t) => t.idx,
      (t) => t.valid,
      (t) => t.size,
      (t) => t.data,
      (t) => t.raw,
      () => deviceId,
    ]);
    await client.query(
      `INSERT INTO biometric_templates (pin, kind, bio_type, idx, valid, size, data, raw, source_device_id)
       VALUES ${sql}
       ON CONFLICT (pin, kind, (COALESCE(bio_type, -1)), idx) DO UPDATE SET
         valid = EXCLUDED.valid, size = EXCLUDED.size, data = EXCLUDED.data, raw = EXCLUDED.raw,
         source_device_id = EXCLUDED.source_device_id, source = 'device'`,
      vals,
    );
  }
  return all.length - rows.length;
}

async function upsertPhotos(client: pg.PoolClient, deviceId: number, photos: PhotoRecord[]): Promise<void> {
  // A USERPIC always wins; a BIOPHOTO only fills a pin that has no photo yet.
  const order = { biophoto: 0, pic: 1 };
  const sorted = [...photos].sort((a, b) => order[a.kind] - order[b.kind]);
  for (const kind of ['pic', 'biophoto'] as const) {
    const list = dedupe(
      sorted.filter((p) => p.kind === kind),
      (p) => p.pin,
    );
    for (const part of chunks(list, 50)) {
      const { sql, vals } = multiValues(part, [
        (p) => p.pin,
        (p) => p.fileName,
        (p) => p.content,
        () => deviceId,
        (p) => Buffer.from(p.content, 'base64').length,
      ]);
      // A changed picture bumps `version` and becomes a device picture; an identical one (a device echoing what the
      // app sent) leaves version and source alone, so cached images stay valid and the app copy stays "app".
      const action =
        kind === 'pic'
          ? `DO UPDATE SET file_name = EXCLUDED.file_name, source_device_id = EXCLUDED.source_device_id,
               version = CASE WHEN user_photos.content IS DISTINCT FROM EXCLUDED.content THEN user_photos.version + 1 ELSE user_photos.version END,
               source = CASE WHEN user_photos.content IS DISTINCT FROM EXCLUDED.content THEN 'device' ELSE user_photos.source END,
               size_bytes = EXCLUDED.size_bytes, content = EXCLUDED.content`
          : 'DO NOTHING';
      await client.query(
        `INSERT INTO user_photos (pin, file_name, content, source_device_id, size_bytes) VALUES ${sql} ON CONFLICT (pin) ${action}`,
        vals,
      );
    }
  }
}

/** Templates the user deleted in the app less than 10 minutes ago and the device has not yet confirmed deleting. */
export const TOMBSTONE_MINUTES = 10;

async function dropTombstoned<T extends { pin: string; kind: string; bioType: number | null; idx: number }>(
  client: pg.PoolClient,
  rows: T[],
): Promise<T[]> {
  const pins = [...new Set(rows.map((r) => r.pin))];
  if (!pins.length) return rows;
  const { rows: tomb } = await client.query<{ pin: string; kind: string; bt: number; idx: number }>(
    `SELECT pin, kind, COALESCE(bio_type, -1) AS bt, idx FROM biometric_tombstones
     WHERE pin = ANY($1::text[]) AND deleted_at > now() - ($2::int * interval '1 minute')`,
    [pins, TOMBSTONE_MINUTES],
  );
  if (!tomb.length) return rows;
  const dead = new Set(tomb.map((t) => `${t.pin}|${t.kind}|${t.bt}|${t.idx}`));
  return rows.filter((r) => !dead.has(`${r.pin}|${r.kind}|${r.bioType ?? -1}|${r.idx}`));
}

export interface IngestCounts {
  users: number;
  templates: number;
  photos: number;
  /** Templates received but not stored because the app deleted them moments ago (see biometric_tombstones). */
  skippedTombstoned?: number;
}

/**
 * Upsert parsed user data (parse.parseUserData().records) for one device in a single transaction.
 * Returns counts per kind.
 */
export async function ingest(deviceId: number, records: DeviceRecord[]): Promise<IngestCounts> {
  const counts: IngestCounts = { users: 0, templates: 0, photos: 0 };
  if (!records.length) return counts;
  const users = records.filter((r): r is UserRecord => r.kind === 'user');
  const templates = records.filter((r): r is TemplateRecord | BioRecord => r.kind === 'fp' || r.kind === 'face' || r.kind === 'bio');
  const photos = records.filter((r): r is PhotoRecord => r.kind === 'pic' || r.kind === 'biophoto');
  let skipped = 0;
  await withTransaction(async (client) => {
    if (users.length) await upsertUsers(client, deviceId, users);
    if (templates.length) skipped = await upsertTemplates(client, deviceId, templates);
    if (photos.length) await upsertPhotos(client, deviceId, photos);
  });
  counts.users = users.length;
  counts.templates = templates.length;
  counts.photos = photos.length;
  counts.skippedTombstoned = skipped;
  return counts;
}

/**
 * A device confirmed `DATA DELETE BIODATA|FINGERTMP|FACE ...`: drop the matching tombstone, unless another device
 * still has such a delete queued or in flight (it may yet re-upload the template).
 */
export async function confirmTemplateDelete(command: string): Promise<void> {
  const m = /^DATA DELETE (BIODATA|FINGERTMP|FACE) (.*)$/s.exec(command);
  if (!m) return;
  const f = parseUserLine(m[2] as string, m[1] as string);
  const pin = f?.fields.pin;
  if (!f || !pin) return;
  const kind = m[1] === 'BIODATA' ? 'bio' : m[1] === 'FINGERTMP' ? 'fp' : 'face';
  const bioType = kind === 'bio' ? intOrNull(f.fields.type) : null;
  const idx = intOrNull(f.fields.no ?? f.fields.fid) ?? 0;
  const like = `DATA DELETE ${m[1]} %`;
  // Same pin and same finger/type still queued for another device: keep the tombstone (matched precisely in JS).
  const pend = await pool.query<{ command: string }>(
    `SELECT command FROM device_commands WHERE status IN ('pending', 'sent') AND command LIKE $1 AND command LIKE $2`,
    [like, `%${pin}%`],
  );
  const same = pend.rows.some((r) => {
    const p = parseUserLine(r.command.slice(`DATA DELETE ${m[1]} `.length), m[1]);
    return p && p.fields.pin === pin && intOrNull(p.fields.type) === bioType && (intOrNull(p.fields.no ?? p.fields.fid) ?? 0) === idx;
  });
  if (same) return;
  await pool.query(
    `DELETE FROM biometric_tombstones WHERE pin = $1 AND kind = $2 AND COALESCE(bio_type, -1) = $3 AND idx = $4`,
    [pin, kind, bioType ?? -1, idx],
  );
}

export async function removeUser(deviceId: number, pin: string): Promise<void> {
  await pool.query('DELETE FROM device_users WHERE device_id = $1 AND pin = $2', [deviceId, pin]);
}

