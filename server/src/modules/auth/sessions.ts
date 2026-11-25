import { createHash, randomBytes } from 'node:crypto';
import { PERMISSION_KEYS, type Permission, type WingScope } from '@nacta/shared';
import { config } from '../../config';
import { pool, type Queryable } from '../../db/pool';
import type { AuthContext } from './types';

export const SESSION_COOKIE = 'nacta_sid';
/** last_seen_at is refreshed at most this often. */
const TOUCH_INTERVAL = '1 minute';

export const newToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface NewSession {
  token: string;
  id: string;
  csrfToken: string;
  expiresAt: Date;
}

export async function createSession(userId: number, ip: string | null, userAgent: string | null): Promise<NewSession> {
  const token = newToken();
  const id = hashToken(token);
  const csrfToken = newToken();
  const { rows } = await pool.query<{ expires_at: Date }>(
    `INSERT INTO sessions (id, user_id, csrf_token, ip, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6::int * interval '1 hour')) RETURNING expires_at`,
    [id, userId, csrfToken, ip, userAgent ? userAgent.slice(0, 300) : null, config.sessionMaxHours],
  );
  // Housekeeping: forget sessions that ended more than a week ago.
  void pool
    .query(`DELETE FROM sessions WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days'`)
    .catch(() => {});
  return { token, id, csrfToken, expiresAt: (rows[0] as { expires_at: Date }).expires_at };
}

type SessionRow = {
  session_id: string;
  csrf_token: string;
  expires_at: Date;
  user_id: number;
  dead: boolean;
  stale: boolean;
  email: string;
  name: string;
  status: string;
  must_change_password: boolean;
  previous_login_at: Date | null;
  previous_login_ip: string | null;
};

export type Resolved = { kind: 'none' } | { kind: 'dead' } | { kind: 'ok'; ctx: AuthContext; stale: boolean };

/** Role, permission and wing-scope data of a user. Super Admin gets every permission and all wings. */
export async function loadAccess(
  userId: number,
  db: Queryable = pool,
): Promise<{ roles: { id: number; name: string }[]; isSuperAdmin: boolean; permissions: Set<Permission>; scope: WingScope }> {
  const [roles, perms, wings] = await Promise.all([
    db.query<{ id: number; name: string; is_system: boolean; all_wings: boolean }>(
      `SELECT r.id, r.name, r.is_system, r.all_wings FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1 ORDER BY lower(r.name)`,
      [userId],
    ),
    db.query<{ permission: string }>(
      `SELECT DISTINCT rp.permission FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id WHERE ur.user_id = $1`,
      [userId],
    ),
    db.query<{ wing_id: number }>(
      `SELECT DISTINCT rw.wing_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       JOIN role_wings rw ON rw.role_id = r.id WHERE ur.user_id = $1 AND NOT r.all_wings`,
      [userId],
    ),
  ]);
  const isSuperAdmin = roles.rows.some((r) => r.is_system);
  const known = new Set<string>(PERMISSION_KEYS);
  const permissions = new Set<Permission>(
    isSuperAdmin ? PERMISSION_KEYS : (perms.rows.map((p) => p.permission).filter((p) => known.has(p)) as Permission[]),
  );
  const scope: WingScope =
    isSuperAdmin || roles.rows.some((r) => r.all_wings) ? 'all' : wings.rows.map((w) => w.wing_id);
  return { roles: roles.rows.map((r) => ({ id: r.id, name: r.name })), isSuperAdmin, permissions, scope };
}

/** Look up a cookie token. `dead` = unknown-but-valid-looking, revoked, expired, idle-expired or disabled user. */
export async function resolveToken(token: string | undefined): Promise<Resolved> {
  if (!token || token.length < 20 || token.length > 200) return { kind: 'none' };
  const { rows } = await pool.query<SessionRow>(
    `SELECT s.id AS session_id, s.csrf_token, s.expires_at, s.user_id,
            (s.revoked_at IS NOT NULL OR s.expires_at <= now()
               OR s.last_seen_at <= now() - ($2::int * interval '1 minute')) AS dead,
            (s.last_seen_at < now() - interval '${TOUCH_INTERVAL}') AS stale,
            u.email, u.name, u.status, u.must_change_password, u.previous_login_at, u.previous_login_ip
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
    [hashToken(token), config.sessionIdleMinutes],
  );
  const r = rows[0];
  if (!r) return { kind: 'dead' };
  if (r.dead || r.status !== 'active') return { kind: 'dead' };
  const access = await loadAccess(r.user_id);
  return {
    kind: 'ok',
    stale: r.stale,
    ctx: {
      user: {
        id: r.user_id,
        email: r.email,
        name: r.name,
        mustChangePassword: r.must_change_password,
        isSuperAdmin: access.isSuperAdmin,
        roles: access.roles,
        previousLoginAt: r.previous_login_at,
        previousLoginIp: r.previous_login_ip,
      },
      session: { id: r.session_id, csrfToken: r.csrf_token, expiresAt: r.expires_at },
      permissions: access.permissions,
      scope: access.scope,
    },
  };
}

export async function touchSession(id: string): Promise<void> {
  await pool.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [id]);
}

/** SQL fragment: the session is still usable (not revoked, not past its lifetime, not idle). The idle limit is a validated integer. */
export const ACTIVE_SESSION_SQL = (alias: string): string =>
  `(${alias}.revoked_at IS NULL AND ${alias}.expires_at > now() AND ${alias}.last_seen_at > now() - (${Math.trunc(config.sessionIdleMinutes)} * interval '1 minute'))`;

export async function revokeSession(id: string): Promise<boolean> {
  const { rowCount } = await pool.query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [id]);
  return (rowCount ?? 0) > 0;
}

/** Revoke every live session of a user except `exceptId`. Returns how many were revoked. */
export async function revokeUserSessions(userId: number, exceptId: string | null = null, db: Queryable = pool): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE sessions SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() AND ($2::text IS NULL OR id <> $2)`,
    [userId, exceptId],
  );
  return rowCount ?? 0;
}

export interface SessionListRow {
  id: string;
  ip: string | null;
  user_agent: string | null;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
}

export async function listActiveSessions(userId: number): Promise<SessionListRow[]> {
  const { rows } = await pool.query<SessionListRow>(
    `SELECT s.id, s.ip, s.user_agent, s.created_at, s.last_seen_at, s.expires_at FROM sessions s
     WHERE s.user_id = $1 AND ${ACTIVE_SESSION_SQL('s')} ORDER BY s.last_seen_at DESC`,
    [userId],
  );
  return rows;
}

/** Revoke one of the user's own sessions. False when it is not theirs / already gone. */
export async function revokeOwnSession(userId: number, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()`,
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
}

