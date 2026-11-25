import type { z } from 'zod';
import {
  ErrorCode,
  type TimingAssignment,
  type TimingProfile,
  type TimingVersion,
  type WingScope,
  type zTimingAssignmentInput,
  type zTimingProfileInput,
} from '@nacta/shared';
import { pool, withTransaction } from '../../db/pool';
import { addDays, todayLocal } from '../../lib/dates';
import { AppError, MAX_INT, notFound, outOfScope, pgCode, validationError } from '../../lib/errors';
import { inScope } from '../../lib/scope';
import { requireEmployees } from '../attendance/access';
import { markRange } from '../attendance/dirty';
import { versionOn, type DayHours } from '../attendance/resolve';

/** Version date of a profile created in the app: it has no history, so its rules apply to any date it is assigned. */
export const NEW_PROFILE_EPOCH = '2000-01-01';
export const PAST_CHANGE_MESSAGE = 'Timing changes apply from today onwards';

type ProfileRow = { id: number; name: string; is_default: boolean; confirmed: boolean; created_at: Date; updated_at: Date; assignment_count: string };
type VersionRow = {
  profile_id: number;
  ef: string;
  days: (DayHours | null)[];
  gl: number;
  ge: number;
  hd: number;
  created_by_name: string | null;
  created_at: Date;
};

const toVersion = (v: VersionRow): TimingVersion => ({
  effectiveFrom: v.ef,
  days: v.days,
  graceLateMinutes: v.gl,
  graceEarlyMinutes: v.ge,
  halfDayBelowMinutes: v.hd,
  createdBy: v.created_by_name,
  createdAt: v.created_at.toISOString(),
});

const VERSION_SELECT = `SELECT profile_id, to_char(effective_from, 'YYYY-MM-DD') AS ef, days, grace_late_minutes AS gl,
  grace_early_minutes AS ge, half_day_below_minutes AS hd, created_by_name, created_at FROM timing_profile_versions`;

export async function listProfiles(id?: number): Promise<TimingProfile[]> {
  const profiles = await pool.query<ProfileRow>(
    `SELECT p.id, p.name, p.is_default, p.confirmed, p.created_at, p.updated_at,
            (SELECT count(*) FROM timing_assignments a WHERE a.profile_id = p.id) AS assignment_count
     FROM timing_profiles p ${id !== undefined ? 'WHERE p.id = $1' : ''} ORDER BY p.is_default DESC, lower(p.name), p.id`,
    id !== undefined ? [id] : [],
  );
  if (!profiles.rows.length) return [];
  const versions = await pool.query<VersionRow>(`${VERSION_SELECT} WHERE profile_id = ANY($1::int[]) ORDER BY effective_from DESC`, [profiles.rows.map((p) => p.id)]);
  const today = todayLocal();
  return profiles.rows.map((p) => {
    const vs = versions.rows.filter((v) => v.profile_id === p.id);
    const current = versionOn(
      { id: p.id, name: p.name, isDefault: p.is_default, versions: vs.map((v) => ({ effectiveFrom: v.ef, days: v.days, graceLate: v.gl, graceEarly: v.ge, halfDayBelow: v.hd })) },
      today,
    );
    const cur = vs.find((v) => v.ef === current?.effectiveFrom) as VersionRow;
    return {
      id: p.id,
      name: p.name,
      versions: vs.map(toVersion),
      days: cur.days,
      graceLateMinutes: cur.gl,
      graceEarlyMinutes: cur.ge,
      halfDayBelowMinutes: cur.hd,
      isDefault: p.is_default,
      assignmentCount: Number(p.assignment_count),
      createdAt: p.created_at.toISOString(),
      updatedAt: p.updated_at.toISOString(),
    };
  });
}

export async function getProfile(id: number): Promise<TimingProfile> {
  const p = id > MAX_INT ? undefined : (await listProfiles(id))[0];
  if (!p) throw notFound('Timing profile');
  return p;
}

const dupName = () => new AppError(409, ErrorCode.CONFLICT, 'A timing profile with this name already exists');

export function requireAllWings(scope: WingScope, what: string): void {
  if (scope !== 'all') throw new AppError(403, ErrorCode.FORBIDDEN, `${what} requires access to all wings`);
}

/** True while the default profile has never been saved by a user: the first real configuration may reach into the past. */
export async function isInitialSetup(): Promise<boolean> {
  const { rows } = await pool.query<{ confirmed: boolean }>('SELECT confirmed FROM timing_profiles WHERE is_default');
  return rows[0] ? !rows[0].confirmed : false;
}

export async function setupStatus(): Promise<{ configured: boolean }> {
  return { configured: !(await isInitialSetup()) };
}

type By = { id: number; name: string };

export async function createProfile(input: z.output<typeof zTimingProfileInput>, by: By): Promise<TimingProfile> {
  try {
    const id = await withTransaction(async (c) => {
      const { rows } = await c.query<{ id: number }>('INSERT INTO timing_profiles (name, confirmed) VALUES ($1, true) RETURNING id', [input.name]);
      const pid = (rows[0] as { id: number }).id;
      await c.query(
        `INSERT INTO timing_profile_versions (profile_id, effective_from, days, grace_late_minutes, grace_early_minutes, half_day_below_minutes, created_by, created_by_name)
         VALUES ($1, $2::date, $3::jsonb, $4, $5, $6, $7, $8)`,
        [pid, NEW_PROFILE_EPOCH, JSON.stringify(input.days), input.graceLateMinutes, input.graceEarlyMinutes, input.halfDayBelowMinutes, by.id, by.name],
      );
      return pid;
    });
    return await getProfile(id);
  } catch (err) {
    throw pgCode(err) === '23505' ? dupName() : err;
  }
}

/** Queue the days a rule change on `profile` can affect: [from, to] for everyone the profile applies to. */
async function markProfileRange(profileId: number, isDefault: boolean, from: string, to: string | null): Promise<void> {
  if (isDefault) await markRange({ from, to });
  const { rows } = await pool.query<{ scope: 'all' | 'wing' | 'employee'; scope_id: number | null; ef: string; et: string | null }>(
    `SELECT scope, scope_id, to_char(effective_from, 'YYYY-MM-DD') AS ef, to_char(effective_to, 'YYYY-MM-DD') AS et FROM timing_assignments WHERE profile_id = $1`,
    [profileId],
  );
  for (const a of rows) {
    const f = a.ef > from ? a.ef : from;
    const t = a.et && (to === null || a.et < to) ? a.et : to;
    if (t !== null && t < f) continue;
    await markAssignmentRange(a.scope, a.scope_id, f, t);
  }
}

async function markAssignmentRange(scope: 'all' | 'wing' | 'employee', scopeId: number | null, from: string, to: string | null): Promise<void> {
  if (scope === 'all') await markRange({ from, to });
  else if (scope === 'wing') await markRange({ from, to, wingId: scopeId as number });
  else await markRange({ from, to, employeeIds: [scopeId as number] });
}

export interface UpdateOutcome {
  before: TimingProfile;
  after: TimingProfile;
  effectiveFrom: string;
  initialSetup: boolean;
  replacedVersion: boolean;
}

/**
 * PUT: renames the profile and saves its rules as the version effective from `effectiveFrom` (default today).
 * A version already starting that day is replaced. Earlier days keep the rules that applied then.
 */
export async function updateProfile(id: number, input: z.output<typeof zTimingProfileInput>, effectiveFrom: string | undefined, by: By): Promise<UpdateOutcome> {
  const before = await getProfile(id);
  const today = todayLocal();
  const from = effectiveFrom ?? today;
  const initialSetup = await isInitialSetup();
  if (from < today && !initialSetup) throw validationError('Invalid timing change', { effectiveFrom: PAST_CHANGE_MESSAGE });
  let replaced = false;
  try {
    await withTransaction(async (c) => {
      await c.query('UPDATE timing_profiles SET name = $2, confirmed = true WHERE id = $1', [id, input.name]);
      const r = await c.query(
        `INSERT INTO timing_profile_versions (profile_id, effective_from, days, grace_late_minutes, grace_early_minutes, half_day_below_minutes, created_by, created_by_name)
         VALUES ($1, $2::date, $3::jsonb, $4, $5, $6, $7, $8)
         ON CONFLICT (profile_id, effective_from) DO UPDATE SET days = EXCLUDED.days, grace_late_minutes = EXCLUDED.grace_late_minutes,
           grace_early_minutes = EXCLUDED.grace_early_minutes, half_day_below_minutes = EXCLUDED.half_day_below_minutes,
           created_by = EXCLUDED.created_by, created_by_name = EXCLUDED.created_by_name, created_at = now()
         RETURNING (xmax <> 0) AS replaced`,
        [id, from, JSON.stringify(input.days), input.graceLateMinutes, input.graceEarlyMinutes, input.halfDayBelowMinutes, by.id, by.name],
      );
      replaced = Boolean((r.rows[0] as { replaced: boolean }).replaced);
    });
  } catch (err) {
    throw pgCode(err) === '23505' ? dupName() : err;
  }
  // Only days from `from` until the next version starts can change.
  const next = (await pool.query<{ d: string | null }>(
    `SELECT to_char(min(effective_from), 'YYYY-MM-DD') AS d FROM timing_profile_versions WHERE profile_id = $1 AND effective_from > $2::date`,
    [id, from],
  )).rows[0]?.d;
  await markProfileRange(id, before.isDefault, from, next ? addDays(next, -1) : null);
  return { before, after: await getProfile(id), effectiveFrom: from, initialSetup, replacedVersion: replaced };
}

export async function deleteProfile(id: number): Promise<TimingProfile> {
  const p = await getProfile(id);
  if (p.isDefault) throw new AppError(409, ErrorCode.CONFLICT, 'The default timing cannot be deleted. Make another timing the default first.');
  if (p.assignmentCount > 0) {
    throw new AppError(409, ErrorCode.PROFILE_IN_USE, 'This timing is assigned to wings, employees or dates. Remove those assignments first.', { assignmentCount: p.assignmentCount });
  }
  await pool.query('DELETE FROM timing_profiles WHERE id = $1', [id]);
  return p;
}

/**
 * Make `id` the default from today on. Days before today keep the previous default: it is pinned to the past with an
 * organisation-wide assignment labelled "Previous default".
 */
export async function setDefault(id: number): Promise<{ before: TimingProfile; after: TimingProfile; previous: TimingProfile | null }> {
  const target = await getProfile(id);
  const previous = (await listProfiles()).find((p) => p.isDefault) ?? null;
  if (previous?.id === id) {
    await pool.query('UPDATE timing_profiles SET confirmed = true WHERE id = $1', [id]);
    return { before: target, after: await getProfile(id), previous: null };
  }
  const today = todayLocal();
  await withTransaction(async (c) => {
    if (previous) {
      const last = await c.query<{ d: string | null }>(
        `SELECT to_char(max(effective_to), 'YYYY-MM-DD') AS d FROM timing_assignments WHERE scope = 'all' AND label = 'Previous default'`,
      );
      const start = last.rows[0]?.d ? addDays(last.rows[0].d, 1) : NEW_PROFILE_EPOCH;
      const end = addDays(today, -1);
      if (start <= end) {
        await c.query(
          `INSERT INTO timing_assignments (profile_id, scope, scope_id, effective_from, effective_to, label) VALUES ($1, 'all', NULL, $2::date, $3::date, 'Previous default')`,
          [previous.id, start, end],
        );
      }
      await c.query('UPDATE timing_profiles SET is_default = false WHERE id = $1', [previous.id]);
    }
    await c.query('UPDATE timing_profiles SET is_default = true, confirmed = true WHERE id = $1', [id]);
  });
  await markRange({ from: today, to: today });
  return { before: target, after: await getProfile(id), previous };
}

// ---------- assignments ----------
type AssignRow = {
  id: number;
  profile_id: number;
  profile_name: string;
  scope: 'all' | 'wing' | 'employee';
  scope_id: number | null;
  ef: string;
  et: string | null;
  label: string | null;
  scope_label: string;
  wing_id: number | null;
};

const ASSIGN_SELECT = `
  SELECT a.id, a.profile_id, p.name AS profile_name, a.scope, a.scope_id, to_char(a.effective_from, 'YYYY-MM-DD') AS ef,
         to_char(a.effective_to, 'YYYY-MM-DD') AS et, a.label,
         CASE a.scope WHEN 'all' THEN 'Everyone' WHEN 'wing' THEN COALESCE(w.name, 'Wing #' || a.scope_id)
              ELSE COALESCE(e.emp_code || ' · ' || e.name, 'Employee #' || a.scope_id) END AS scope_label,
         CASE a.scope WHEN 'wing' THEN a.scope_id WHEN 'employee' THEN e.wing_id END AS wing_id
  FROM timing_assignments a JOIN timing_profiles p ON p.id = a.profile_id
  LEFT JOIN wings w ON a.scope = 'wing' AND w.id = a.scope_id
  LEFT JOIN employees e ON a.scope = 'employee' AND e.id = a.scope_id`;

const toAssignment = (r: AssignRow): TimingAssignment => ({
  id: r.id,
  profileId: r.profile_id,
  profileName: r.profile_name,
  scope: r.scope,
  scopeId: r.scope_id,
  scopeLabel: r.scope_label,
  effectiveFrom: r.ef,
  effectiveTo: r.et,
  label: r.label,
});

/** Organisation-wide assignments are visible to everyone; wing/employee ones only inside the caller's scope. */
const visible = (scope: WingScope, r: AssignRow): boolean => r.scope === 'all' || inScope(scope, r.wing_id);

export async function listAssignments(scope: WingScope): Promise<TimingAssignment[]> {
  const { rows } = await pool.query<AssignRow>(`${ASSIGN_SELECT} ORDER BY a.effective_from DESC, a.id DESC`);
  return rows.filter((r) => visible(scope, r)).map(toAssignment);
}

export async function createAssignment(input: z.output<typeof zTimingAssignmentInput>, scope: WingScope): Promise<TimingAssignment> {
  if (input.profileId > MAX_INT) throw notFound('Timing profile');
  await getProfile(input.profileId);
  if (input.scope === 'all') requireAllWings(scope, 'Assigning a timing to everyone');
  if (input.scope === 'wing') {
    const w = await pool.query<{ id: number }>('SELECT id FROM wings WHERE id = $1', [input.scopeId]);
    if (!w.rows.length || (input.scopeId as number) > MAX_INT) throw notFound('Wing');
    if (!inScope(scope, input.scopeId as number)) throw outOfScope('Wing');
  }
  if (input.scope === 'employee') await requireEmployees([input.scopeId as number], scope);
  if (input.effectiveFrom < todayLocal() && !(await isInitialSetup())) {
    throw validationError('Invalid assignment', { effectiveFrom: PAST_CHANGE_MESSAGE });
  }
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO timing_assignments (profile_id, scope, scope_id, effective_from, effective_to, label)
     VALUES ($1, $2, $3, $4::date, $5::date, $6) RETURNING id`,
    [input.profileId, input.scope, input.scope === 'all' ? null : input.scopeId, input.effectiveFrom, input.effectiveTo ?? null, input.label],
  );
  await markAssignmentRange(input.scope, input.scope === 'all' ? null : (input.scopeId as number), input.effectiveFrom, input.effectiveTo ?? null);
  return getAssignment((rows[0] as { id: number }).id, scope);
}

export async function getAssignment(id: number, scope: WingScope): Promise<TimingAssignment> {
  const { rows } = id > MAX_INT ? { rows: [] as AssignRow[] } : await pool.query<AssignRow>(`${ASSIGN_SELECT} WHERE a.id = $1`, [id]);
  const r = rows[0];
  if (!r) throw notFound('Timing assignment');
  if (!visible(scope, r)) throw outOfScope('Timing assignment');
  return toAssignment(r);
}

export async function deleteAssignment(id: number, scope: WingScope): Promise<TimingAssignment> {
  const a = await getAssignment(id, scope);
  if (a.scope === 'all') requireAllWings(scope, 'Removing an organisation-wide timing assignment');
  if (a.effectiveFrom <= todayLocal() && !(await isInitialSetup())) {
    throw validationError('Cannot remove assignment', { effectiveFrom: 'This assignment has already started. End it instead of removing it.' });
  }
  await pool.query('DELETE FROM timing_assignments WHERE id = $1', [id]);
  await markAssignmentRange(a.scope, a.scopeId, a.effectiveFrom, a.effectiveTo);
  return a;
}

/**
 * PATCH: end an assignment (or extend / shorten its future part, or make it open-ended with null). Days before today are
 * never rewritten: both the old and the new end must be today - 1 or later, except during initial setup.
 */
export async function setAssignmentEnd(id: number, effectiveTo: string | null, scope: WingScope): Promise<{ before: TimingAssignment; after: TimingAssignment }> {
  const before = await getAssignment(id, scope);
  if (before.scope === 'all') requireAllWings(scope, 'Changing an organisation-wide timing assignment');
  if (effectiveTo !== null && effectiveTo < before.effectiveFrom) throw validationError('Invalid assignment', { effectiveTo: 'Must be on or after the start date' });
  const floor = addDays(todayLocal(), -1);
  const touchesPast = (effectiveTo !== null && effectiveTo < floor) || (before.effectiveTo !== null && before.effectiveTo < floor);
  if (touchesPast && !(await isInitialSetup())) {
    throw validationError('Invalid assignment', { effectiveTo: 'Changes apply from today onwards: the end date cannot be moved before yesterday' });
  }
  await pool.query('UPDATE timing_assignments SET effective_to = $2::date WHERE id = $1', [id, effectiveTo]);
  // Days between the old and the new end change hands.
  const oldEnd = before.effectiveTo;
  const lo = oldEnd === null ? effectiveTo : effectiveTo === null ? oldEnd : oldEnd < effectiveTo ? oldEnd : effectiveTo;
  const hi = oldEnd === null || effectiveTo === null ? null : oldEnd > effectiveTo ? oldEnd : effectiveTo;
  if (lo !== null) await markAssignmentRange(before.scope, before.scopeId, addDays(lo, 1), hi);
  return { before, after: await getAssignment(id, scope) };
}