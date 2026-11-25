import type { AppUser } from '@nacta/shared';
import { pool, type Queryable } from '../../db/pool';
import { byColumn, likeContains, limitOffset, orderBy, type SortConfig } from '../../lib/pagination';
import { ACTIVE_SESSION_SQL } from '../auth/sessions';

type UserRow = {
  id: number;
  email: string;
  name: string;
  status: 'active' | 'disabled';
  must_change_password: boolean;
  locked_until: Date | null;
  last_login_at: Date | null;
  last_login_ip: string | null;
  created_at: Date;
  updated_at: Date;
  is_super_admin: boolean;
  roles: { id: number; name: string }[];
  active_sessions: string;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

const toAppUser = (r: UserRow): AppUser => ({
  id: r.id,
  email: r.email,
  name: r.name,
  status: r.status,
  isSuperAdmin: r.is_super_admin,
  roles: r.roles,
  mustChangePassword: r.must_change_password,
  lockedUntil: iso(r.locked_until),
  lastLoginAt: iso(r.last_login_at),
  lastLoginIp: r.last_login_ip,
  activeSessions: Number(r.active_sessions),
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const SELECT = `
  SELECT u.id, u.email, u.name, u.status, u.must_change_password,
         CASE WHEN u.locked_until > now() THEN u.locked_until END AS locked_until,
         u.last_login_at, u.last_login_ip, u.created_at, u.updated_at,
         EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.is_system) AS is_super_admin,
         COALESCE((SELECT json_agg(json_build_object('id', r.id, 'name', r.name) ORDER BY lower(r.name))
                   FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '[]'::json) AS roles,
         (SELECT count(*) FROM sessions s WHERE s.user_id = u.id AND ${ACTIVE_SESSION_SQL('s')}) AS active_sessions
  FROM users u`;

const SORT: SortConfig = {
  keys: {
    name: byColumn('lower(u.name)', 'u.id'),
    email: byColumn('u.email', 'u.id'),
    lastLoginAt: byColumn('u.last_login_at', 'u.id', true),
    createdAt: byColumn('u.created_at', 'u.id'),
  },
  defaultKey: 'name',
  defaultOrder: 'asc',
};

export interface UserListParams {
  q?: string | undefined;
  status?: 'active' | 'disabled' | undefined;
  roleId?: number | undefined;
  page: number;
  pageSize: number;
  sort?: string | undefined;
  order?: 'asc' | 'desc' | undefined;
}

export async function list(p: UserListParams): Promise<{ items: AppUser[]; total: number }> {
  const where: string[] = [];
  const vals: unknown[] = [];
  if (p.q) {
    vals.push(likeContains(p.q));
    where.push(`(u.name ILIKE $${vals.length} OR u.email ILIKE $${vals.length})`);
  }
  if (p.status) {
    vals.push(p.status);
    where.push(`u.status = $${vals.length}`);
  }
  if (p.roleId !== undefined) {
    vals.push(p.roleId);
    where.push(`EXISTS (SELECT 1 FROM user_roles x WHERE x.user_id = u.id AND x.role_id = $${vals.length})`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM users u ${w}`, vals);
  const { limit, offset } = limitOffset(p);
  const { rows } = await pool.query<UserRow>(
    `${SELECT} ${w} ORDER BY ${orderBy(p, SORT)} LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
    [...vals, limit, offset],
  );
  return { items: rows.map(toAppUser), total: Number((total.rows[0] as { n: string }).n) };
}

export async function find(id: number, db: Queryable = pool): Promise<AppUser | null> {
  const { rows } = await db.query<UserRow>(`${SELECT} WHERE u.id = $1`, [id]);
  return rows[0] ? toAppUser(rows[0]) : null;
}

export async function insert(
  db: Queryable,
  v: { email: string; name: string; passwordHash: string; createdBy: number | null },
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO users (email, name, password_hash, must_change_password, created_by)
     VALUES ($1, $2, $3, true, $4) RETURNING id`,
    [v.email, v.name, v.passwordHash, v.createdBy],
  );
  return (rows[0] as { id: number }).id;
}

export async function setRoles(db: Queryable, userId: number, roleIds: number[]): Promise<void> {
  await db.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
  if (roleIds.length) {
    await db.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, unnest($2::int[])', [userId, roleIds]);
  }
}

export async function rolesByIds(ids: number[]): Promise<{ id: number; is_system: boolean }[]> {
  const { rows } = await pool.query<{ id: number; is_system: boolean }>('SELECT id, is_system FROM roles WHERE id = ANY($1::int[])', [ids]);
  return rows;
}

export async function updateFields(db: Queryable, id: number, v: { name?: string; status?: 'active' | 'disabled' }): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (v.name !== undefined) {
    vals.push(v.name);
    sets.push(`name = $${vals.length}`);
  }
  if (v.status !== undefined) {
    vals.push(v.status);
    sets.push(`status = $${vals.length}`);
  }
  if (!sets.length) return;
  vals.push(id);
  await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
}

export async function remove(id: number): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

export async function setPassword(db: Queryable, id: number, passwordHash: string): Promise<void> {
  await db.query(
    `UPDATE users SET password_hash = $2, must_change_password = true, password_changed_at = now(),
                      failed_attempts = 0, locked_until = NULL WHERE id = $1`,
    [id, passwordHash],
  );
}

export async function unlock(id: number): Promise<void> {
  await pool.query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [id]);
}

export async function emailOf(id: number): Promise<string | null> {
  const { rows } = await pool.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [id]);
  return rows[0]?.email ?? null;
}

