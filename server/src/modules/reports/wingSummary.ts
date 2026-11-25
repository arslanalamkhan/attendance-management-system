import {
  addToTally,
  emptyTally,
  filtersText,
  fmtRange,
  leaveText,
  leaveTypeMap,
  loadDays,
  lookupNames,
  pct,
  slug,
  type Tally,
} from './common';
import type { ReportContext, ReportData, ReportParams, Row } from './types';

const NO_WING = 'No wing';

const toRow = (label: string, headcount: number, t: Tally): Row => ({
  wing: label,
  headcount,
  expected: t.expected,
  present: t.present,
  late: t.late,
  halfDay: t.halfDay,
  missing: t.missing,
  onLeave: t.leave,
  leaveTypes: leaveText(t.leaveByCode) || null,
  absent: t.absent,
  attendance: pct(t.attended, t.expected),
  punctuality: pct(t.present, t.present + t.late),
});

/** Per wing (plus "No wing") over a period. */
export async function buildWingSummary(p: ReportParams, ctx: ReportContext): Promise<ReportData> {
  const [names, types, days] = await Promise.all([
    lookupNames(p, ctx.scope),
    leaveTypeMap(),
    loadDays(ctx, {}, { from: p.from, to: p.to }),
  ]);
  const groups = new Map<string, { t: Tally; people: Set<number> }>();
  const grand = emptyTally();
  const everyone = new Set<number>();
  for (const d of days) {
    if (d.status === 'inactive') continue;
    const key = d.wingName ?? NO_WING;
    const g = groups.get(key) ?? { t: emptyTally(), people: new Set<number>() };
    addToTally(g.t, d, types);
    addToTally(grand, d, types);
    g.people.add(d.employeeId);
    everyone.add(d.employeeId);
    groups.set(key, g);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => (a === NO_WING ? 1 : b === NO_WING ? -1 : a.localeCompare(b)));
  const rows = ordered.map(([label, g]) => toRow(label, g.people.size, g.t));
  const totals = toRow('Total', everyone.size, grand);
  const att = pct(grand.attended, grand.expected);
  const pun = pct(grand.present, grand.present + grand.late);

  return {
    type: 'wing_summary',
    title: 'Wing Summary Report',
    subtitle: `${fmtRange(p.from, p.to)} · ${names.scopeLabel}`,
    filters: filtersText({ ...p, wingId: undefined, sectionId: undefined }, { ...names, wing: null }),
    columns: [
      { key: 'wing', label: 'Wing', kind: 'text' },
      { key: 'headcount', label: 'Headcount', kind: 'number' },
      { key: 'expected', label: 'Employee-days expected', kind: 'number' },
      { key: 'present', label: 'Present', kind: 'number' },
      { key: 'late', label: 'Late', kind: 'number' },
      { key: 'halfDay', label: 'Half day', kind: 'number' },
      { key: 'missing', label: 'Missing punch', kind: 'number' },
      { key: 'onLeave', label: 'On leave', kind: 'number' },
      { key: 'leaveTypes', label: 'Leave by type', kind: 'text' },
      { key: 'absent', label: 'Absent', kind: 'number' },
      { key: 'attendance', label: 'Attendance %', kind: 'percent' },
      { key: 'punctuality', label: 'Punctuality %', kind: 'percent' },
    ],
    rows,
    total: rows.length,
    totals: rows.length ? totals : null,
    highlights: [
      { label: 'Wings', value: String(rows.filter((r) => r.wing !== NO_WING).length) },
      { label: 'Employees', value: String(everyone.size) },
      { label: 'Attendance rate', value: att === null ? '–' : `${att}%` },
      { label: 'Punctuality rate', value: pun === null ? '–' : `${pun}%` },
      { label: 'Absent days', value: String(grand.absent) },
    ],
    legend: [],
    columnShade: {},
    extraTables: [],
    file: { label: 'Wing-Summary', scope: slug(names.scopeLabel), period: `${p.from}_to_${p.to}` },
  };
}

