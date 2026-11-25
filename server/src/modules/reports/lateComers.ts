import type { AttendanceDay } from '@nacta/shared';
import { filtersText, fmtRange, leaveTypeMap, loadDays, lookupNames, round1, slug } from './common';
import type { ReportContext, ReportData, ReportParams, Row } from './types';

/**
 * Every late arrival in the period (rows) plus a per-employee summary (a second table: its own sheet in Excel, its own
 * section in the PDF, `extraTables` in the JSON).
 */
export async function buildLateComers(p: ReportParams, ctx: ReportContext): Promise<ReportData> {
  const [names, , all] = await Promise.all([
    lookupNames(p, ctx.scope),
    leaveTypeMap(),
    loadDays(ctx, { wingId: p.wingId, sectionId: p.sectionId }, { from: p.from, to: p.to }),
  ]);
  const min = Math.max(1, p.minLateMinutes);
  const late = all
    .filter((d) => d.lateMinutes >= min)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.lateMinutes - a.lateMinutes || a.name.localeCompare(b.name)));

  const rows: Row[] = late.map((d) => ({
    employeeId: d.employeeId,
    hasPhoto: d.hasPhoto,
    date: d.date,
    code: d.empCode,
    name: d.name,
    wing: d.wingName,
    section: d.sectionName,
    start: d.timing?.start ?? null,
    in: d.firstIn,
    late: d.lateMinutes,
  }));

  const per = new Map<number, { d: AttendanceDay; n: number; total: number; max: number }>();
  for (const d of late) {
    const e = per.get(d.employeeId) ?? { d, n: 0, total: 0, max: 0 };
    e.n += 1;
    e.total += d.lateMinutes;
    e.max = Math.max(e.max, d.lateMinutes);
    per.set(d.employeeId, e);
  }
  const summaryRows: Row[] = [...per.values()]
    .sort((a, b) => b.n - a.n || b.total / b.n - a.total / a.n || a.d.name.localeCompare(b.d.name))
    .map((e) => ({
      employeeId: e.d.employeeId,
      hasPhoto: e.d.hasPhoto,
      code: e.d.empCode,
      name: e.d.name,
      wing: e.d.wingName,
      lateDays: e.n,
      total: e.total,
      avg: Math.round(e.total / e.n),
      max: e.max,
    }));
  const totalMinutes = late.reduce((s, d) => s + d.lateMinutes, 0);
  const avg = late.length ? round1(totalMinutes / late.length) : 0;
  const longest = late.reduce((m, d) => Math.max(m, d.lateMinutes), 0);

  const scopeText = names.section ? `${names.wing ?? names.scopeLabel} · ${names.section}` : (names.wing ?? names.scopeLabel);
  return {
    type: 'late_comers',
    title: 'Late Comers Report',
    subtitle: `${fmtRange(p.from, p.to)} · ${scopeText}`,
    filters: filtersText(p, names),
    columns: [
      { key: 'date', label: 'Date', kind: 'date' },
      { key: 'code', label: 'Code', kind: 'mono' },
      { key: 'name', label: 'Name', kind: 'text' },
      { key: 'wing', label: 'Wing', kind: 'text' },
      { key: 'section', label: 'Section', kind: 'text' },
      { key: 'start', label: 'Office start', kind: 'time', align: 'center' },
      { key: 'in', label: 'Arrived', kind: 'time', align: 'center' },
      { key: 'late', label: 'Minutes late', kind: 'minutes' },
    ],
    rows,
    total: rows.length,
    totals: null,
    highlights: [
      { label: 'Late days', value: String(late.length) },
      { label: 'Employees', value: String(per.size) },
      { label: 'Average minutes late', value: late.length ? String(avg) : '–' },
      { label: 'Longest delay', value: late.length ? `${longest} min` : '–' },
      // the five who were late most often (the full per-employee table is the second sheet / section)
      ...summaryRows.slice(0, 5).map((r) => ({ label: String(r.name), value: `${r.lateDays} ${r.lateDays === 1 ? 'day' : 'days'}, avg ${r.avg} min` })),
    ],
    legend: [],
    columnShade: {},
    extraTables: [
      {
        id: 'by_employee',
        title: 'Summary by employee',
        columns: [
          { key: 'code', label: 'Code', kind: 'mono' },
          { key: 'name', label: 'Name', kind: 'text' },
          { key: 'wing', label: 'Wing', kind: 'text' },
          { key: 'lateDays', label: 'Late days', kind: 'number' },
          { key: 'total', label: 'Total minutes late', kind: 'minutes' },
          { key: 'avg', label: 'Average (min)', kind: 'minutes' },
          { key: 'max', label: 'Longest (min)', kind: 'minutes' },
        ],
        rows: summaryRows,
        totals: summaryRows.length ? { name: 'Total', lateDays: late.length, total: totalMinutes, avg: Math.round(avg) } : null,
      },
    ],
    file: { label: 'Late-Comers', scope: slug(names.section ? `${names.wing ?? names.scopeLabel}-${names.section}` : (names.wing ?? names.scopeLabel)), period: `${p.from}_to_${p.to}` },
  };
}
