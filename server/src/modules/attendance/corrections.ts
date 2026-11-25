import type { z } from 'zod';
import type { Correction, WingScope, zCorrectionInput } from '@nacta/shared';
import { pool } from '../../db/pool';
import { todayLocal } from '../../lib/dates';
import { MAX_INT, notFound, outOfScope, validationError } from '../../lib/errors';
import { scopeClause } from '../../lib/scope';
import { requireEmployees, type EmployeeRef } from './access';
import { markKeys } from './dirty';

type Row = { id: number; employee_id: number; d: string; type: 'add_punch' | 'set_status'; time: string | null; status: string | null; reason: string; created_by_name: string | null; created_at: Date };

const toCorrection = (r: Row): Correction => ({
  id: r.id,
  employeeId: r.employee_id,
  date: r.d,
  type: r.type,
  time: r.time,
  status: r.status,
  reason: r.reason,
  createdBy: r.created_by_name,
  createdAt: r.created_at.toISOString(),
});

const SELECT = `SELECT c.id, c.employee_id, to_char(c.date, 'YYYY-MM-DD') AS d, c.type, c.time, c.status, c.reason, c.created_by_name, c.created_at
                FROM attendance_corrections c JOIN employees e ON e.id = c.employee_id`;

export async function list(q: { employeeId?: number | undefined; from?: string | undefined; to?: string | undefined }, scope: WingScope): Promise<Correction[]> {
  const vals: unknown[] = [];
  const where: string[] = [];
  if (q.employeeId !== undefined) {
    if (q.employeeId > MAX_INT) return [];
    vals.push(q.employeeId);
    where.push(`c.employee_id = $${vals.length}`);
  }
  if (q.from) {
    vals.push(q.from);
    where.push(`c.date >= $${vals.length}::date`);
  }
  if (q.to) {
    vals.push(q.to);
    where.push(`c.date <= $${vals.length}::date`);
  }
  const sc = scopeClause(scope, 'e.wing_id', vals);
  if (sc) where.push(sc);
  const { rows } = await pool.query<Row>(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.date DESC, c.id DESC LIMIT 1000`, vals);
  return rows.map(toCorrection);
}

export async function create(
  input: z.output<typeof zCorrectionInput>,
  scope: WingScope,
  by: { id: number; name: string },
): Promise<{ correction: Correction; employee: EmployeeRef }> {
  const [employee] = await requireEmployees([input.employeeId], scope);
  if (!employee) throw notFound('Employee');
  if (input.date > todayLocal()) throw validationError('Invalid correction', { date: 'Cannot correct a future date' });
  const { rows } = await pool.query<Row>(
    `WITH ins AS (
       INSERT INTO attendance_corrections (employee_id, date, type, time, status, reason, created_by, created_by_name)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8) RETURNING *
     ) SELECT ins.id, ins.employee_id, to_char(ins.date, 'YYYY-MM-DD') AS d, ins.type, ins.time, ins.status, ins.reason, ins.created_by_name, ins.created_at FROM ins`,
    [input.employeeId, input.date, input.type, input.type === 'add_punch' ? (input.time ?? null) : null, input.type === 'set_status' ? (input.status ?? null) : null, input.reason, by.id, by.name],
  );
  await markKeys([{ employeeId: input.employeeId, date: input.date }]);
  return { correction: toCorrection(rows[0] as Row), employee };
}

export async function remove(id: number, scope: WingScope): Promise<{ correction: Correction; employee: EmployeeRef }> {
  if (id > MAX_INT) throw notFound('Correction');
  const { rows } = await pool.query<Row & { wing_id: number | null }>(`${SELECT.replace('c.reason,', 'c.reason, e.wing_id,')} WHERE c.id = $1`, [id]);
  const row = rows[0];
  if (!row) throw notFound('Correction');
  let employee: EmployeeRef;
  try {
    [employee] = (await requireEmployees([row.employee_id], scope)) as [EmployeeRef];
  } catch {
    throw outOfScope('Correction');
  }
  await pool.query('DELETE FROM attendance_corrections WHERE id = $1', [id]);
  await markKeys([{ employeeId: row.employee_id, date: row.d }]);
  return { correction: toCorrection(row), employee };
}
