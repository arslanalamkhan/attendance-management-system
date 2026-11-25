import type { z } from 'zod';
import { ErrorCode, type Holiday, type WingScope, type zHolidayInput } from '@nacta/shared';
import { pool, withTransaction } from '../../db/pool';
import { daysBetween } from '../../lib/dates';
import { AppError, MAX_INT, notFound, outOfScope, validationError } from '../../lib/errors';
import { markRange } from '../attendance/dirty';

type Row = {
  id: number;
  name: string;
  f: string;
  t: string;
  kind: 'holiday' | 'working_day';
  wing_ids: number[];
  wing_names: string[];
  created_at: Date;
};

const SELECT = `
  SELECT h.id, h.name, to_char(h.from_date, 'YYYY-MM-DD') AS f, to_char(h.to_date, 'YYYY-MM-DD') AS t, h.kind, h.created_at,
         COALESCE(array_agg(hw.wing_id ORDER BY lower(w.name)) FILTER (WHERE hw.wing_id IS NOT NULL), '{}') AS wing_ids,
         COALESCE(array_agg(w.name ORDER BY lower(w.name)) FILTER (WHERE hw.wing_id IS NOT NULL), '{}') AS wing_names
  FROM holidays h LEFT JOIN holiday_wings hw ON hw.holiday_id = h.id LEFT JOIN wings w ON w.id = hw.wing_id`;

/** What a caller with `scope` sees: all-wings holidays, and wing holidays that touch their wings (only those wings listed). */
function present(r: Row, scope: WingScope): Holiday | null {
  let ids = r.wing_ids;
  let names = r.wing_names;
  if (scope !== 'all' && ids.length) {
    const keep = ids.map((id, i) => ({ id, name: names[i] as string })).filter((x) => scope.includes(x.id));
    if (!keep.length) return null;
    ids = keep.map((x) => x.id);
    names = keep.map((x) => x.name);
  }
  return { id: r.id, name: r.name, from: r.f, to: r.t, kind: r.kind, wingIds: ids, wingNames: names, createdAt: r.created_at.toISOString() };
}

export async function list(year: number | undefined, scope: WingScope): Promise<Holiday[]> {
  const y = year ?? new Date().getFullYear();
  const { rows } = await pool.query<Row>(
    `${SELECT} WHERE h.from_date <= make_date($1, 12, 31) AND h.to_date >= make_date($1, 1, 1) GROUP BY h.id ORDER BY h.from_date, h.id`,
    [y],
  );
  return rows.map((r) => present(r, scope)).filter((h): h is Holiday => h !== null);
}

async function findRow(id: number): Promise<Row | null> {
  if (id > MAX_INT) return null;
  const { rows } = await pool.query<Row>(`${SELECT} WHERE h.id = $1 GROUP BY h.id`, [id]);
  return rows[0] ?? null;
}

/** The caller may change a holiday only when every wing it covers (or all wings, for an organisation-wide one) is theirs. */
function assertManageable(r: Row, scope: WingScope): void {
  if (scope === 'all') return;
  if (!r.wing_ids.length || r.wing_ids.some((w) => !scope.includes(w))) throw outOfScope('Holiday');
}

async function checkInput(input: z.output<typeof zHolidayInput>, scope: WingScope): Promise<void> {
  if (daysBetween(input.from, input.to) > 365) throw validationError('Invalid holiday', { to: 'At most one year' });
  const wingIds = [...new Set(input.wingIds)];
  if (wingIds.some((w) => w > MAX_INT)) throw notFound('Wing');
  if (wingIds.length) {
    const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM wings WHERE id = ANY($1::int[])', [wingIds]);
    if (Number((rows[0] as { n: string }).n) !== wingIds.length) throw notFound('Wing');
  }
  if (scope !== 'all' && (!wingIds.length || wingIds.some((w) => !scope.includes(w)))) {
    if (!wingIds.length) throw new AppError(403, ErrorCode.FORBIDDEN, 'A holiday for all wings requires access to all wings');
    throw outOfScope('Wing');
  }
}

async function markHoliday(from: string, to: string, wingIds: number[]): Promise<void> {
  if (!wingIds.length) await markRange({ from, to });
  else for (const wingId of wingIds) await markRange({ from, to, wingId });
}

export async function create(input: z.output<typeof zHolidayInput>, scope: WingScope, by: { id: number }): Promise<Holiday> {
  await checkInput(input, scope);
  const wingIds = [...new Set(input.wingIds)];
  const id = await withTransaction(async (c) => {
    const { rows } = await c.query<{ id: number }>(
      'INSERT INTO holidays (name, from_date, to_date, kind, created_by) VALUES ($1, $2::date, $3::date, $4, $5) RETURNING id',
      [input.name, input.from, input.to, input.kind, by.id],
    );
    const hid = (rows[0] as { id: number }).id;
    if (wingIds.length) await c.query('INSERT INTO holiday_wings (holiday_id, wing_id) SELECT $1, unnest($2::int[])', [hid, wingIds]);
    return hid;
  });
  await markHoliday(input.from, input.to, wingIds);
  return get(id, 'all');
}

export async function get(id: number, scope: WingScope): Promise<Holiday> {
  const r = await findRow(id);
  const h = r ? present(r, scope) : null;
  if (!h) throw notFound('Holiday');
  return h;
}

export async function update(id: number, input: z.output<typeof zHolidayInput>, scope: WingScope): Promise<{ before: Holiday; after: Holiday }> {
  const row = await findRow(id);
  if (!row) throw notFound('Holiday');
  assertManageable(row, scope);
  await checkInput(input, scope);
  const before = present(row, 'all') as Holiday;
  const wingIds = [...new Set(input.wingIds)];
  await withTransaction(async (c) => {
    await c.query('UPDATE holidays SET name = $2, from_date = $3::date, to_date = $4::date, kind = $5 WHERE id = $1', [id, input.name, input.from, input.to, input.kind]);
    await c.query('DELETE FROM holiday_wings WHERE holiday_id = $1', [id]);
    if (wingIds.length) await c.query('INSERT INTO holiday_wings (holiday_id, wing_id) SELECT $1, unnest($2::int[])', [id, wingIds]);
  });
  await markHoliday(before.from, before.to, before.wingIds);
  await markHoliday(input.from, input.to, wingIds);
  return { before, after: await get(id, 'all') };
}

export async function remove(id: number, scope: WingScope): Promise<Holiday> {
  const row = await findRow(id);
  if (!row) throw notFound('Holiday');
  assertManageable(row, scope);
  const h = present(row, 'all') as Holiday;
  await pool.query('DELETE FROM holidays WHERE id = $1', [id]);
  await markHoliday(h.from, h.to, h.wingIds);
  return h;
}
