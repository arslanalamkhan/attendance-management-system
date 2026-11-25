import type { Section, Wing, WingScope } from '@nacta/shared';
import { pool, type Queryable } from '../../db/pool';
import { scopeClause } from '../../lib/scope';

type WingRow = {
  id: number;
  name: string;
  code: string | null;
  head_name: string | null;
  employee_count: string;
  created_at: Date;
  updated_at: Date;
};

type SectionRow = { id: number; wing_id: number; name: string; employee_count: string };

const toSection = (r: SectionRow): Section => ({
  id: r.id,
  wingId: r.wing_id,
  name: r.name,
  employeeCount: Number(r.employee_count),
});

const toWing = (r: WingRow, sections: Section[]): Wing => ({
  id: r.id,
  name: r.name,
  code: r.code,
  headName: r.head_name,
  employeeCount: Number(r.employee_count),
  sections,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const WING_SELECT = `
  SELECT w.id, w.name, w.code, w.head_name, w.created_at, w.updated_at,
         (SELECT count(*) FROM employees e WHERE e.wing_id = w.id) AS employee_count
  FROM wings w`;

const SECTION_SELECT = `
  SELECT s.id, s.wing_id, s.name, (SELECT count(*) FROM employees e WHERE e.section_id = s.id) AS employee_count
  FROM sections s`;

/** Only the wings inside the caller's scope, each with its sections. */
export async function list(scope: WingScope): Promise<Wing[]> {
  const vals: unknown[] = [];
  const cond = scopeClause(scope, 'w.id', vals);
  const { rows } = await pool.query<WingRow>(`${WING_SELECT} ${cond ? `WHERE ${cond}` : ''} ORDER BY lower(w.name), w.id`, vals);
  if (!rows.length) return [];
  const secs = await pool.query<SectionRow>(`${SECTION_SELECT} WHERE s.wing_id = ANY($1::int[]) ORDER BY lower(s.name), s.id`, [rows.map((r) => r.id)]);
  const byWing = new Map<number, Section[]>();
  for (const s of secs.rows) {
    const list = byWing.get(s.wing_id);
    if (list) list.push(toSection(s));
    else byWing.set(s.wing_id, [toSection(s)]);
  }
  return rows.map((r) => toWing(r, byWing.get(r.id) ?? []));
}

/** Out-of-scope wings are reported as missing. */
export async function find(id: number, scope: WingScope): Promise<Wing | null> {
  const vals: unknown[] = [id];
  const cond = scopeClause(scope, 'w.id', vals);
  const { rows } = await pool.query<WingRow>(`${WING_SELECT} WHERE w.id = $1${cond ? ` AND ${cond}` : ''}`, vals);
  const row = rows[0];
  if (!row) return null;
  const secs = await pool.query<SectionRow>(`${SECTION_SELECT} WHERE s.wing_id = $1 ORDER BY lower(s.name), s.id`, [id]);
  return toWing(row, secs.rows.map(toSection));
}

export interface WingFields {
  name: string;
  code: string | null;
  headName: string | null;
}

export async function insert(f: WingFields, db: Queryable = pool): Promise<number> {
  const { rows } = await db.query<{ id: number }>('INSERT INTO wings (name, code, head_name) VALUES ($1, $2, $3) RETURNING id', [f.name, f.code, f.headName]);
  return (rows[0] as { id: number }).id;
}

export async function update(id: number, f: WingFields, scope: WingScope): Promise<boolean> {
  const vals: unknown[] = [id, f.name, f.code, f.headName];
  const cond = scopeClause(scope, 'id', vals);
  const { rowCount } = await pool.query(
    `UPDATE wings SET name = $2, code = $3, head_name = $4 WHERE id = $1${cond ? ` AND ${cond}` : ''}`,
    vals,
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Employees keep their records but lose the wing (and section). The section reference is cleared first because a
 * section must always belong to the employee's wing.
 */
export async function remove(client: Queryable, id: number, scope: WingScope): Promise<boolean> {
  const vals: unknown[] = [id];
  const cond = scopeClause(scope, 'id', vals);
  const exists = await client.query(`SELECT 1 FROM wings WHERE id = $1${cond ? ` AND ${cond}` : ''}`, vals);
  if (!exists.rowCount) return false;
  await client.query('UPDATE employees SET section_id = NULL WHERE wing_id = $1 AND section_id IS NOT NULL', [id]);
  await client.query('DELETE FROM wings WHERE id = $1', [id]);
  return true;
}

// ---------- sections ----------
export async function findSection(id: number, scope: WingScope): Promise<Section | null> {
  const vals: unknown[] = [id];
  const cond = scopeClause(scope, 's.wing_id', vals);
  const { rows } = await pool.query<SectionRow>(`${SECTION_SELECT} WHERE s.id = $1${cond ? ` AND ${cond}` : ''}`, vals);
  return rows[0] ? toSection(rows[0]) : null;
}

export async function insertSection(wingId: number, name: string, db: Queryable = pool): Promise<number> {
  const { rows } = await db.query<{ id: number }>('INSERT INTO sections (wing_id, name) VALUES ($1, $2) RETURNING id', [wingId, name]);
  return (rows[0] as { id: number }).id;
}

export async function renameSection(id: number, name: string): Promise<void> {
  await pool.query('UPDATE sections SET name = $2 WHERE id = $1', [id, name]);
}

export async function removeSection(id: number): Promise<void> {
  await pool.query('DELETE FROM sections WHERE id = $1', [id]);
}

/** Every wing with its sections regardless of scope (for Excel name resolution). */
export async function allWithSections(db: Queryable = pool): Promise<{ id: number; name: string; code: string | null; sections: { id: number; name: string }[] }[]> {
  const w = await db.query<{ id: number; name: string; code: string | null }>('SELECT id, name, code FROM wings ORDER BY lower(name), id');
  const s = await db.query<{ id: number; wing_id: number; name: string }>('SELECT id, wing_id, name FROM sections ORDER BY lower(name), id');
  return w.rows.map((r) => ({ ...r, sections: s.rows.filter((x) => x.wing_id === r.id).map((x) => ({ id: x.id, name: x.name })) }));
}
