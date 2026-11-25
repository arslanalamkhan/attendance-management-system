import { LEAVE_PART_LABEL } from '@nacta/shared';
import { pool } from '../../db/pool';
import { eachDate } from '../../lib/dates';
import { scopeClause } from '../../lib/scope';
import { loadRules } from '../attendance/compute';
import { holidaysFor, resolveTiming, workingDaysIn } from '../attendance/resolve';
import { filtersText, fmtRange, legendOf, lookupNames, slug } from './common';
import { MAX_REPORT_ROWS } from './common';
import { validationError } from '../../lib/errors';
import type { ReportContext, ReportData, ReportParams, Row } from './types';

type LeaveRow = {
  employee_id: number;
  wing_id: number | null;
  emp_code: string;
  name: string;
  wing_name: string | null;
  type_name: string;
  type_code: string;
  type_color: string;
  f: string;
  t: string;
  part: 'full' | 'first_half' | 'second_half';
  reason: string | null;
  has_photo: boolean;
};

/** Leave overlapping the period. Working days are counted inside the period (weekends and holidays excluded). */
export async function buildLeave(p: ReportParams, ctx: ReportContext): Promise<ReportData> {
  const names = await lookupNames(p, ctx.scope);
  const vals: unknown[] = [p.from, p.to];
  const where = ['l.to_date >= $1::date', 'l.from_date <= $2::date'];
  const add = (sql: string, v: unknown) => {
    vals.push(v);
    where.push(sql.replace('?', `$${vals.length}`));
  };
  if (p.wingId !== undefined) add('e.wing_id = ?', p.wingId);
  if (p.sectionId !== undefined) add('e.section_id = ?', p.sectionId);
  if (p.leaveTypeId !== undefined) add('l.leave_type_id = ?', p.leaveTypeId);
  const sc = scopeClause(ctx.scope, 'e.wing_id', vals);
  if (sc) where.push(sc);

  const { rows: raw } = await pool.query<LeaveRow>(
    `SELECT l.employee_id, e.wing_id, e.emp_code, e.name, w.name AS wing_name, t.name AS type_name, t.code AS type_code, t.color AS type_color,
            to_char(l.from_date, 'YYYY-MM-DD') AS f, to_char(l.to_date, 'YYYY-MM-DD') AS t, l.part, l.reason,
            EXISTS (SELECT 1 FROM user_photos p WHERE p.pin = e.emp_code AND COALESCE(p.content, '') <> '') AS has_photo
     FROM leaves l JOIN employees e ON e.id = l.employee_id LEFT JOIN wings w ON w.id = e.wing_id
       JOIN leave_types t ON t.id = l.leave_type_id
     WHERE ${where.join(' AND ')}
     ORDER BY l.from_date, lower(e.name), l.id`,
    vals,
  );
  if (raw.length > MAX_REPORT_ROWS) throw validationError('This report is too large', { to: 'Narrow the date range or choose a wing' });

  const rules = await loadRules(p.from, p.to);
  const byType = new Map<string, { label: string; days: number; records: number }>();
  let totalDays = 0;
  const rows: Row[] = raw.map((r) => {
    const from = r.f < p.from ? p.from : r.f;
    const to = r.t > p.to ? p.to : r.t;
    const emp = { id: r.employee_id, wingId: r.wing_id };
    const days = workingDaysIn(
      { from, to, part: r.part },
      eachDate(from, to),
      (d) => resolveTiming(rules.profiles, rules.assignments, emp, d),
      (d) => holidaysFor(rules.holidays, r.wing_id, d),
    );
    totalDays += days;
    const label = `${r.type_code} ${r.type_name}`;
    const g = byType.get(r.type_code) ?? { label, days: 0, records: 0 };
    g.days += days;
    g.records += 1;
    byType.set(r.type_code, g);
    return {
      employeeId: r.employee_id,
      hasPhoto: r.has_photo,
      code: r.emp_code,
      name: r.name,
      wing: r.wing_name,
      type: { code: r.type_code, label, color: r.type_color },
      from: r.f,
      to: r.t,
      part: LEAVE_PART_LABEL[r.part],
      days,
      reason: r.reason,
    };
  });

  const typeHighlights = [...byType.values()]
    .sort((a, b) => b.days - a.days || a.label.localeCompare(b.label))
    .slice(0, 6)
    .map((g) => ({ label: g.label, value: `${g.days} ${g.days === 1 ? 'day' : 'days'}` }));
  const scopeText = names.section ? `${names.wing ?? names.scopeLabel} · ${names.section}` : (names.wing ?? names.scopeLabel);

  return {
    type: 'leave',
    title: 'Leave Report',
    subtitle: `${fmtRange(p.from, p.to)} · ${scopeText}`,
    filters: filtersText(p, names),
    columns: [
      { key: 'code', label: 'Code', kind: 'mono' },
      { key: 'name', label: 'Name', kind: 'text' },
      { key: 'wing', label: 'Wing', kind: 'text' },
      { key: 'type', label: 'Leave type', kind: 'status' },
      { key: 'from', label: 'From', kind: 'date' },
      { key: 'to', label: 'To', kind: 'date' },
      { key: 'part', label: 'Part', kind: 'text' },
      { key: 'days', label: 'Working days in period', kind: 'number' },
      { key: 'reason', label: 'Reason', kind: 'text' },
    ],
    rows,
    total: rows.length,
    totals: rows.length ? { name: 'Total', days: totalDays } : null,
    highlights: [{ label: 'Leave records', value: String(rows.length) }, { label: 'Working days', value: String(totalDays) }, ...typeHighlights],
    legend: legendOf(rows.map((r) => r.type as { code: string; label: string; color: string })).map((c) => ({ ...c, label: c.label })),
    columnShade: {},
    extraTables: [],
    file: { label: 'Leave-Report', scope: slug(names.section ? `${names.wing ?? names.scopeLabel}-${names.section}` : (names.wing ?? names.scopeLabel)), period: `${p.from}_to_${p.to}` },
  };
}
