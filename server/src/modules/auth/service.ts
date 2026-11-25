import type { z } from 'zod';
import {
  ErrorCode,
  PERMISSION_KEYS,
  type CurrentUser,
  type SessionInfo,
  type SessionSummary,
  type zChangePasswordInput,
  type zLoginInput,
} from '@nacta/shared';
import { config } from '../../config';
import { pool } from '../../db/pool';
import { AppError, validationError } from '../../lib/errors';
import { assertPasswordPolicy, burnVerifyTime, hashPassword, verifyPassword } from './password';
import * as sessions from './sessions';
import type { AuthContext } from './types';

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

export function toCurrentUser(ctx: AuthContext): CurrentUser {
  const u = ctx.user;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    isSuperAdmin: u.isSuperAdmin,
    mustChangePassword: u.mustChangePassword,
    // keep catalogue order for stable output
    permissions: PERMISSION_KEYS.filter((k) => ctx.permissions.has(k)),
    wingScope: ctx.scope,
    roles: u.roles,
    previousLoginAt: u.previousLoginAt ? u.previousLoginAt.toISOString() : null,
    previousLoginIp: u.previousLoginIp,
  };
}

export function toSessionInfo(ctx: AuthContext): SessionInfo {
  return {
    user: toCurrentUser(ctx),
    csrfToken: ctx.session.csrfToken,
    expiresAt: ctx.session.expiresAt.toISOString(),
    idleTimeoutMinutes: config.sessionIdleMinutes,
  };
}

type LoginUserRow = {
  id: number;
  password_hash: string;
  email: string;
  name: string;
  status: string;
  locked: boolean;
  locked_until: Date | null;
};

const invalidCredentials = () => new AppError(401, ErrorCode.INVALID_CREDENTIALS, 'Incorrect email or password');
const accountLocked = (until: Date) =>
  new AppError(423, ErrorCode.ACCOUNT_LOCKED, 'Too many failed attempts. This account is temporarily locked', {
    lockedUntil: until.toISOString(),
  });

/** Filled in by login() so the route can audit a failed attempt (who it was about, why). */
export interface LoginTrace {
  user?: { id: number; email: string; name: string };
  reason?: 'unknown_email' | 'bad_password' | 'locked' | 'disabled';
  /** This very attempt tripped the lock. */
  justLocked?: boolean;
  lockedUntil?: Date;
}

export interface LoginResult {
  token: string;
  info: SessionInfo;
}

export async function login(
  input: z.output<typeof zLoginInput>,
  ip: string | null,
  userAgent: string | null,
  trace: LoginTrace = {},
): Promise<LoginResult> {
  const { rows } = await pool.query<LoginUserRow>(
    `SELECT id, email, name, password_hash, status, locked_until, (locked_until IS NOT NULL AND locked_until > now()) AS locked
     FROM users WHERE lower(email) = $1`,
    [input.email],
  );
  const user = rows[0];
  if (!user) {
    trace.reason = 'unknown_email';
    await burnVerifyTime(input.password);
    throw invalidCredentials();
  }
  trace.user = { id: user.id, email: user.email, name: user.name };
  if (user.locked && user.locked_until) {
    trace.reason = 'locked';
    trace.lockedUntil = user.locked_until;
    throw accountLocked(user.locked_until);
  }

  if (!(await verifyPassword(user.password_hash, input.password))) {
    const upd = await pool.query<{ locked_until: Date | null; locked: boolean }>(
      `UPDATE users SET
         failed_attempts = CASE WHEN failed_attempts + 1 >= $2 THEN 0 ELSE failed_attempts + 1 END,
         locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN now() + ($3::int * interval '1 minute') ELSE locked_until END
       WHERE id = $1
       RETURNING locked_until, (locked_until IS NOT NULL AND locked_until > now()) AS locked`,
      [user.id, MAX_FAILURES, LOCK_MINUTES],
    );
    const u = upd.rows[0];
    trace.reason = 'bad_password';
    if (u?.locked && u.locked_until) {
      trace.justLocked = true;
      trace.lockedUntil = u.locked_until;
      throw accountLocked(u.locked_until);
    }
    throw invalidCredentials();
  }
  if (user.status !== 'active') {
    trace.reason = 'disabled';
    throw new AppError(403, ErrorCode.ACCOUNT_DISABLED, 'This account has been disabled. Contact an administrator');
  }

  await pool.query(
    `UPDATE users SET previous_login_at = last_login_at, previous_login_ip = last_login_ip,
                      last_login_at = now(), last_login_ip = $2, failed_attempts = 0, locked_until = NULL
     WHERE id = $1`,
    [user.id, ip],
  );
  const session = await sessions.createSession(user.id, ip, userAgent);
  const found = await sessions.resolveToken(session.token);
  if (found.kind !== 'ok') throw new AppError(500, ErrorCode.INTERNAL, 'Could not start the session');
  return { token: session.token, info: toSessionInfo(found.ctx) };
}

export async function changePassword(
  ctx: AuthContext,
  input: z.output<typeof zChangePasswordInput>,
): Promise<SessionInfo> {
  const { rows } = await pool.query<{ password_hash: string; email: string }>(
    'SELECT password_hash, email FROM users WHERE id = $1',
    [ctx.user.id],
  );
  const row = rows[0];
  if (!row) throw new AppError(401, ErrorCode.UNAUTHENTICATED, 'Sign in to continue');
  if (!(await verifyPassword(row.password_hash, input.currentPassword))) {
    throw validationError('Invalid request body', { currentPassword: 'Current password is incorrect' });
  }
  assertPasswordPolicy(input.newPassword, row.email, 'newPassword');

  const hashed = await hashPassword(input.newPassword);
  await pool.query(
    `UPDATE users SET password_hash = $2, must_change_password = false, password_changed_at = now(),
                      failed_attempts = 0, locked_until = NULL
     WHERE id = $1`,
    [ctx.user.id, hashed],
  );
  await sessions.revokeUserSessions(ctx.user.id, ctx.session.id);
  return toSessionInfo({ ...ctx, user: { ...ctx.user, mustChangePassword: false } });
}

export async function listSessions(ctx: AuthContext): Promise<SessionSummary[]> {
  const rows = await sessions.listActiveSessions(ctx.user.id);
  return rows.map((r) => ({
    id: r.id,
    current: r.id === ctx.session.id,
    ip: r.ip,
    userAgent: r.user_agent,
    createdAt: r.created_at.toISOString(),
    lastSeenAt: r.last_seen_at.toISOString(),
    expiresAt: r.expires_at.toISOString(),
  }));
}


