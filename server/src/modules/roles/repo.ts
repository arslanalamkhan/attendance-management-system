import { PERMISSION_KEYS, type Permission, type Role } from '@nacta/shared';
import { pool, type Queryable } from '../../db/pool';

type RoleRow = {
  id: number;
  name: string;
  description: string | null;
  is_system: boolean;
  all_wings: boolean;
  permissions: string[];
  wing_ids: number[];
  user_count: string;
  created_at: Date;
  updated_at: Date;
};

const known = new Set<string>(PERMISSION_KEYS);

const toRole = (r: RoleRow): Role => ({
  id: r.id,
  name: r.name,
  description: r.description,
  isSystem: r.is_system,
  // The built-in role has no rows: it implicitly holds everything.
  permissions: r.is_system
    ? [...PERMISSION_KEYS]
    : (PERMISSION_KEYS.filter((k) => r.permissions.includes(k)) as Permission[]),
  allWings: r.is_system ? true : r.all_wings,
  wingIds: r.is_system || r.all_wings ? [] : r.wing_ids,
  userCount: Number(r.user_count),
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const SELECT = `
  SELECT r.id, r.name, r.description, r.is_system, r.all_wings, r.created_at, r.updated_at,
         COALESCE((SELECT array_agg(rp.permission ORDER BY rp.permission) FROM role_permissions rp WHERE rp.role_id = r.id), '{}') AS permissions,
         COALESCE((SELECT array_agg(rw.wing_id ORDER BY rw.wing_id) FROM role_wings rw WHERE rw.role_id = r.id), '{}') AS wing_ids,
         (SELECT count(*) FROM user_roles ur WHERE ur.role_id = r.id) AS user_count
  FROM roles r`;

export async function list(): Promise<Role[]> {
  const { rows } = await pool.query<RoleRow>(`${SELECT} ORDER BY r.is_system DESC, lower(r.name), r.id`);
  return rows.map(toRole);
}

export async function find(id: number, db: Queryable = pool): Promise<Role | null> {
  const { rows } = await db.query<RoleRow>(`${SELECT} WHERE r.id = $1`, [id]);
  return rows[0] ? toRole(rows[0]) : null;
}

export interface RoleFields {
  name: string;
  description: string | null;
  permissions: Permission[];
  allWings: boolean;
  wingIds: number[];
}

async function writeChildren(db: Queryable, id: number, f: RoleFields): Promise<void> {
  await db.query('DELETE FROM role_permissions WHERE role_id = $1', [id]);
  await db.query('DELETE FROM role_wings WHERE role_id = $1', [id]);
  if (f.permissions.length) {
    await db.query('INSERT INTO role_permissions (role_id, permission) SELECT $1, unnest($2::text[])', [id, f.permissions]);
  }
  if (!f.allWings && f.wingIds.length) {
    await db.query('INSERT INTO role_wings (role_id, wing_id) SELECT $1, unnest($2::int[])', [id, f.wingIds]);
  }
}

export async function insert(db: Queryable, f: RoleFields): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    'INSERT INTO roles (name, description, all_wings) VALUES ($1, $2, $3) RETURNING id',
    [f.name, f.description, f.allWings],
  );
  const id = (rows[0] as { id: number }).id;
  await writeChildren(db, id, f);
  return id;
}

export async function update(db: Queryable, id: number, f: RoleFields): Promise<void> {
  await db.query('UPDATE roles SET name = $2, description = $3, all_wings = $4, updated_at = now() WHERE id = $1', [
    id,
    f.name,
    f.description,
    f.allWings,
  ]);
  await writeChildren(db, id, f);
}

export async function remove(id: number): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM roles WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

export async function existingWingIds(ids: number[]): Promise<number[]> {
  const { rows } = await pool.query<{ id: number }>('SELECT id FROM wings WHERE id = ANY($1::int[])', [ids]);
  return rows.map((r) => r.id);
}

export async function wingNames(ids: number[]): Promise<string[]> {
  if (!ids.length) return [];
  const { rows } = await pool.query<{ name: string }>('SELECT name FROM wings WHERE id = ANY($1::int[]) ORDER BY name', [ids]);
  return rows.map((r) => r.name);
}
