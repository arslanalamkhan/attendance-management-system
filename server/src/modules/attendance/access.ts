import type { WingScope } from '@nacta/shared';
import { pool, type Queryable } from '../../db/pool';
import { MAX_INT, notFound, outOfScope } from '../../lib/errors';
import { inScope } from '../../lib/scope';

export interface EmployeeRef {
  id: number;
  empCode: string;
  name: string;
  wingId: number | null;
  wingName: string | null;
}

export async function findEmployees(ids: number[], db: Queryable = pool): Promise<EmployeeRef[]> {
  const valid = ids.filter((i) => i <= MAX_INT);
  if (!valid.length) return [];
  const { rows } = await db.query<{ id: number; emp_code: string; name: string; wing_id: number | null; wing_name: string | null }>(
    `SELECT e.id, e.emp_code, e.name, e.wing_id, w.name AS wing_name FROM employees e LEFT JOIN wings w ON w.id = e.wing_id
     WHERE e.id = ANY($1::int[])`,
    [valid],
  );
  return rows.map((r) => ({ id: r.id, empCode: r.emp_code, name: r.name, wingId: r.wing_id, wingName: r.wing_name }));
}

/** All employees must exist and lie in the caller's wing scope; otherwise 404 (out-of-scope ones are audited as denied). */
export async function requireEmployees(ids: number[], scope: WingScope, db: Queryable = pool): Promise<EmployeeRef[]> {
  const unique = [...new Set(ids)];
  const found = await findEmployees(unique, db);
  if (found.length !== unique.length) throw notFound('Employee');
  if (found.some((e) => !inScope(scope, e.wingId))) throw outOfScope('Employee');
  const order = new Map(unique.map((id, i) => [id, i]));
  return found.sort((a, b) => (order.get(a.id) as number) - (order.get(b.id) as number));
}

export const employeeLabel = (e: { empCode: string; name: string }): string => `${e.empCode} · ${e.name}`;
