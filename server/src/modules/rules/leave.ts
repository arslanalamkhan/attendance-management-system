import type pg from 'pg';
import type { z } from 'zod';
import {
  ErrorCode,
  type Leave,
  type LeaveType,
  type Page,
  type WingScope,
  type zLeaveInput,
  type zLeaveQuery,
  type zLeaveTypeInput,
  type zLeaveUpdate,
} from '@nacta/shared';
import { pool, withTransaction } from '../../db/pool';
import { addDays, daysBetween, eachDate } from '../../lib/dates';
import { AppError, MAX_INT, notFound, outOfScope, pgCode, validationError } from '../../lib/errors';
import { byColumn, likeContains, limitOffset, orderBy, toPage, type SortConfig } from '../../lib/pagination';
import { scopeClause } from '../../lib/scope';
import { requireEmployees } from '../attendance/access';
import { loadRules } from '../attendance/compute';
import { markKeys, markLeaveType, markRange } from '../attendance/dirty';
import { holidaysFor, resolveTiming, workingDaysIn } from '../attendance/resolve';

// ---------- leave types ----------
type TypeRow = { id: number; name: string; code: string; color: string; counts_as_present: boolean; is_active: boolean; usage: string };
const toType = (r: TypeRow): LeaveType => ({
  id: r.id,
  name: r.name,
  code: r.code,
  color: r.color,
  countsAsPresent: r.counts_as_present,
  isActive: r.is_active,
  usageCount: Number(r.usage),
});
const TYPE_SELECT = `SELECT t.id, t.name, t.code, t.color, t.counts_as_present, t.is_active, (SELECT count(*) FROM leaves l WHERE l.leave_type_id = t.id) AS usage FROM leave_types t`;
const dupType = () => new AppError(409, ErrorCode.DUPLICATE_LEAVE_TYPE, 'A leave type with this name or code already exists');

export async function listTypes(): Promise<LeaveType[]> {
  const { rows } = await pool.query<TypeRow>(`${TYPE_SELECT} ORDER BY t.is_active DESC, t.id`);
  return rows.map(toType);
}

export async function getType(id: number): Promise<LeaveType> {
  const { rows } = id > MAX_INT ? { rows: [] as TypeRow[] } : await pool.query<TypeRow>(`${TYPE_SELECT} WHERE t.id = $1`, [id]);
  if (!rows[0]) throw notFound('Leave type');
  return toType(rows[0]);
}

export async function createType(input: z.output<typeof zLeaveTypeInput>): Promise<LeaveType> {
  try {
    const { rows } = await pool.query<{ id: number }>(
      'INSERT INTO leave_types (name, code, color, counts_as_present, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [input.name, input.code, input.color, input.countsAsPresent, input.isActive],
    );
    return await getType((rows[0] as { id: number }).id);
  } catch (err) {
    throw pgCode(err) === '23505' ? dupType() : err;
  }
}

export async function updateType(id: number, input: z.output<typeof zLeaveTypeInput>): Promise<{ before: LeaveType; after: LeaveType }> {
  const before = await getType(id);
  try {
    await pool.query('UPDATE leave_types SET name = $2, code = $3, color = $4, counts_as_present = $5, is_active = $6 WHERE id = $1', [
      id,
      input.name,
      input.code,
      input.color,
      input.countsAsPresent,
      input.isActive,
    ]);
  } catch (err) {
    throw pgCode(err) === '23505' ? dupType() : err;
  }
  await markLeaveType(id);
  return { before, after: await getType(id) };
}

// ---------- leaves ----------
type LeaveRow = {
  id: number;
  employee_id: number;
  emp_code: string;
  employee_name: string;
  wing_id: number | null;
  wing_name: string | null;
  leave_type_id: number;
  type_name: string;
  type_code: string;
  type_color: string;
  f: string;
  t: string;
  part: Leave['part'];
  reason: string | null;
  created_by_name: string | null;
  created_at: Date;
};

const LEAVE_SELECT = `
  SELECT l.id, l.employee_id, e.emp_code, e.name AS employee_name, e.wing_id, w.name AS wing_name, l.leave_type_id,
         t.name AS type_name, t.code AS type_code, t.color AS type_color,
         to_char(l.from_date, 'YYYY-MM-DD') AS f, to_char(l.to_date, 'YYYY-MM-DD') AS t, l.part, l.reason, l.created_by_name, l.created_at
  FROM leaves l JOIN employees e ON e.id = l.employee_id LEFT JOIN wings w ON w.id = e.wing_id JOIN leave_types t ON t.id = l.leave_type_id`;

async function toLeaves(rows: LeaveRow[]): Promise<Leave[]> {
  if (!rows.length) return [];
  const from = rows.reduce((a, r) => (r.f < a ? r.f : a), rows[0]!.f);
  const to = rows.reduce((a, r) => (r.t > a ? r.t : a), rows[0]!.t);
  const rules = await loadRules(from, to);
  return rows.map((r) => {
    const emp = { id: r.employee_id, wingId: r.wing_id };
    const workingDays = workingDaysIn(
      { from: r.f, to: r.t, part: r.part },
      eachDate(r.f, r.t),
      (d) => resolveTiming(rules.profiles, rules.assignments, emp, d),
      (d) => holidaysFor(rules.holidays, r.wing_id, d),
    );
    return {
      id: r.id,
      employeeId: r.employee_id,
      empCode: r.emp_code,
      employeeName: r.employee_name,
      wingName: r.wing_name,
      leaveTypeId: r.leave_type_id,
      leaveTypeName: r.type_name,
      leaveTypeCode: r.type_code,
      leaveTypeColor: r.type_color,
      from: r.f,
      to: r.t,
      part: r.part,
      workingDays,
      reason: r.reason,
      createdBy: r.created_by_name,
      createdAt: r.created_at.toISOString(),
    };
  });
}

const SORT: SortConfig = {
  keys: {
    from: byColumn('l.from_date', 'l.id'),
    employee: byColumn('lower(e.name)', 'l.id'),
    type: byColumn('lower(t.name)', 'l.id'),
  },
  defaultKey: 'from',
  defaultOrder: 'desc',
};

export async function listLeaves(q: z.output<typeof zLeaveQuery>, scope: WingScope): Promise<Page<Leave>> {
  for (const k of ['employeeId', 'wingId', 'leaveTypeId'] as const) {
    if ((q[k] ?? 0) > MAX_INT) throw validationError('Invalid query', { [k]: `${k} is out of range` });
  }
  const vals: unknown[] = [];
  const where: string[] = [];
  const add = (sql: string, v: unknown) => {
    vals.push(v);
    where.push(sql.replace('?', `$${vals.length}`));
  };
  if (q.employeeId !== undefined) add('l.employee_id = ?', q.employeeId);
  if (q.wingId !== undefined) add('e.wing_id = ?', q.wingId);
  if (q.leaveTypeId !== undefined) add('l.leave_type_id = ?', q.leaveTypeId);
  if (q.from) add('l.to_date >= ?::date', q.from);
  if (q.to) add('l.from_date <= ?::date', q.to);
  if (q.q) {
    vals.push(likeContains(q.q));
    where.push(`(e.name ILIKE $${vals.length} OR e.emp_code ILIKE $${vals.length})`);
  }
  const sc = scopeClause(scope, 'e.wing_id', vals);
  if (sc) where.push(sc);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = orderBy(q, SORT);
  const total = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM leaves l JOIN employees e ON e.id = l.employee_id JOIN leave_types t ON t.id = l.leave_type_id ${w}`,
    vals,
  );
  const { limit, offset } = limitOffset(q);
  const { rows } = await pool.query<LeaveRow>(`${LEAVE_SELECT} ${w} ORDER BY ${order} LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`, [...vals, limit, offset]);
  return toPage(await toLeaves(rows), Number((total.rows[0] as { n: string }).n), q);
}

async function leavesByIds(ids: number[], db: pg.PoolClient | typeof pool = pool): Promise<Leave[]> {
  if (!ids.length) return [];
  const { rows } = await db.query<LeaveRow>(`${LEAVE_SELECT} WHERE l.id = ANY($1::int[])`, [ids]);
  const order = new Map(ids.map((id, i) => [id, i]));
  const leaves = await toLeaves(rows);
  return leaves.sort((a, b) => (order.get(a.id) as number) - (order.get(b.id) as number));
}

export async function getLeave(id: number, scope: WingScope): Promise<Leave> {
  const { rows } = id > MAX_INT ? { rows: [] as LeaveRow[] } : await pool.query<LeaveRow>(`${LEAVE_SELECT} WHERE l.id = $1`, [id]);
  const r = rows[0];
  if (!r) throw notFound('Leave');
  if (scope !== 'all' && (r.wing_id === null || !scope.includes(r.wing_id))) throw outOfScope('Leave');
  return (await toLeaves([r]))[0] as Leave;
}

async function requireType(id: number, mustBeActive: boolean): Promise<LeaveType> {
  if (id > MAX_INT) throw validationError('Invalid leave', { leaveTypeId: 'Unknown leave type' });
  const t = await getType(id).catch(() => null);
  if (!t) throw validationError('Invalid leave', { leaveTypeId: 'Unknown leave type' });
  if (mustBeActive && !t.isActive) throw validationError('Invalid leave', { leaveTypeId: 'This leave type is not in use any more' });
  return t;
}

const checkSpan = (from: string, to: string) => {
  if (daysBetween(from, to) > 365) throw validationError('Invalid leave', { to: 'At most one year at a time' });
};

type Existing = { type_name: string; type_code: string; type_color: string; id: number; employee_id: number; f: string; t: string; part: Leave['part']; leave_type_id: number; reason: string | null; created_by: number | null; created_by_name: string | null };

/** One 409 detail per clashing existing leave: the employee, the clashing dates and the type already booked. */
const clashDetail = (x: { employee_id: number; f: string; t: string; type_name: string; type_code: string; type_color: string }, name: string, from: string, to: string) => ({
  employeeId: x.employee_id,
  name,
  dates: [{ from: x.f > from ? x.f : from, to: x.t < to ? x.t : to }],
  leaveType: { name: x.type_name, code: x.type_code, color: x.type_color },
});

export interface ReplacedLeave {
  leaveId: number;
  employeeId: number;
  action: 'deleted' | 'trimmed' | 'split';
  before: { from: string; to: string };
  after: { from: string; to: string }[];
}

export interface CreateOutcome {
  leaves: Leave[];
  replaced: ReplacedLeave[];
}

export async function createLeaves(input: z.output<typeof zLeaveInput>, scope: WingScope, by: { id: number; name: string }): Promise<CreateOutcome> {
  const employees = await requireEmployees(input.employeeIds, scope);
  await requireType(input.leaveTypeId, true);
  checkSpan(input.from, input.to);
  const ids = employees.map((e) => e.id);
  const replaced: ReplacedLeave[] = [];

  const createdIds = await withTransaction(async (c) => {
    // Serialise concurrent leave entry for the same people so the overlap check cannot be raced.
    await c.query('SELECT id FROM employees WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [ids]);
    const { rows: clash } = await c.query<Existing>(
      `SELECT l.id, l.employee_id, to_char(l.from_date, 'YYYY-MM-DD') AS f, to_char(l.to_date, 'YYYY-MM-DD') AS t, l.part, l.leave_type_id, l.reason, l.created_by, l.created_by_name,
              t.name AS type_name, t.code AS type_code, t.color AS type_color
       FROM leaves l JOIN leave_types t ON t.id = l.leave_type_id WHERE l.employee_id = ANY($1::int[]) AND l.from_date <= $3::date AND l.to_date >= $2::date ORDER BY l.employee_id, l.from_date`,
      [ids, input.from, input.to],
    );
    if (clash.length && !input.replaceOverlapping) {
      const names = new Map(employees.map((e) => [e.id, e.name]));
      const details = clash.map((x) => clashDetail(x, names.get(x.employee_id) as string, input.from, input.to));      throw new AppError(409, ErrorCode.LEAVE_OVERLAP, 'Some employees already have leave on these dates', details);
    }
    for (const x of clash) {
      const keepBefore = x.f < input.from;
      const keepAfter = x.t > input.to;
      const after: { from: string; to: string }[] = [];
      if (keepBefore) after.push({ from: x.f, to: addDays(input.from, -1) });
      if (keepAfter) after.push({ from: addDays(input.to, 1), to: x.t });
      if (!after.length) {
        await c.query('DELETE FROM leaves WHERE id = $1', [x.id]);
      } else {
        const first = after[0] as { from: string; to: string };
        await c.query("UPDATE leaves SET from_date = $2::date, to_date = $3::date, part = 'full' WHERE id = $1", [x.id, first.from, first.to]);
        if (after[1]) {
          await c.query(
            `INSERT INTO leaves (employee_id, leave_type_id, from_date, to_date, part, reason, created_by, created_by_name)
             VALUES ($1, $2, $3::date, $4::date, 'full', $5, $6, $7)`,
            [x.employee_id, x.leave_type_id, after[1].from, after[1].to, x.reason, x.created_by, x.created_by_name],
          );
        }
      }
      replaced.push({
        leaveId: x.id,
        employeeId: x.employee_id,
        action: after.length === 0 ? 'deleted' : after.length === 1 ? 'trimmed' : 'split',
        before: { from: x.f, to: x.t },
        after,
      });
    }
    const { rows } = await c.query<{ id: number; employee_id: number }>(
      `INSERT INTO leaves (employee_id, leave_type_id, from_date, to_date, part, reason, created_by, created_by_name)
       SELECT e, $2::int, $3::date, $4::date, $5::text, $6::text, $7::int, $8::text FROM unnest($1::int[]) WITH ORDINALITY AS u(e, n) ORDER BY n RETURNING id, employee_id`,
      [ids, input.leaveTypeId, input.from, input.to, input.part, input.reason, by.id, by.name],
    );
    return ids.map((eid) => (rows.find((r) => r.employee_id === eid) as { id: number }).id);
  });
  await markRange({ from: input.from, to: input.to, employeeIds: ids });
  return { leaves: await leavesByIds(createdIds), replaced };
}

export async function updateLeave(id: number, input: z.output<typeof zLeaveUpdate>, scope: WingScope): Promise<{ before: Leave; after: Leave }> {
  const before = await getLeave(id, scope);
  const typeChanged = input.leaveTypeId !== before.leaveTypeId;
  await requireType(input.leaveTypeId, typeChanged);
  checkSpan(input.from, input.to);
  await withTransaction(async (c) => {
    await c.query('SELECT id FROM employees WHERE id = $1 FOR UPDATE', [before.employeeId]);
    const clash = await c.query<{ employee_id: number; f: string; t: string; type_name: string; type_code: string; type_color: string }>(
      `SELECT l.employee_id, to_char(l.from_date, 'YYYY-MM-DD') AS f, to_char(l.to_date, 'YYYY-MM-DD') AS t, t.name AS type_name, t.code AS type_code, t.color AS type_color
       FROM leaves l JOIN leave_types t ON t.id = l.leave_type_id
       WHERE l.employee_id = $1 AND l.id <> $2 AND l.from_date <= $4::date AND l.to_date >= $3::date`,
      [before.employeeId, id, input.from, input.to],
    );
    if (clash.rows.length) {
      throw new AppError(409, ErrorCode.LEAVE_OVERLAP, 'This employee already has leave on these dates', clash.rows.map((x) => clashDetail(x, before.employeeName, input.from, input.to)));
    }
    await c.query('UPDATE leaves SET leave_type_id = $2, from_date = $3::date, to_date = $4::date, part = $5, reason = $6 WHERE id = $1', [
      id,
      input.leaveTypeId,
      input.from,
      input.to,
      input.part,
      input.reason,
    ]);
  });
  const lo = before.from < input.from ? before.from : input.from;
  const hi = before.to > input.to ? before.to : input.to;
  await markRange({ from: lo, to: hi, employeeIds: [before.employeeId] });
  return { before, after: await getLeave(id, 'all') };
}

export async function deleteLeave(id: number, scope: WingScope): Promise<Leave> {
  const before = await getLeave(id, scope);
  await pool.query('DELETE FROM leaves WHERE id = $1', [id]);
  await markRange({ from: before.from, to: before.to, employeeIds: [before.employeeId] });
  return before;
}

/** Re-exported for tests that need to requeue specific days. */
export { markKeys };
