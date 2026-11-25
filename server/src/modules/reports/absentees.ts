import type { AttendanceDay } from '@nacta/shared';
import { filtersText, fmtDate, fmtRange, isExpected, loadDays, lookupNames, pct, slug, weekdayName } from './common';
import type { ReportContext, ReportData, ReportParams, Row } from './types';

const short = (date: string): string => fmtDate(date).slice(0, 6);

/** Unexplained absences only: never leave, holiday, weekend, pending or inactive days. */
export async function buildAbsentees(p: ReportParams, ctx: ReportContext): Promise<ReportData> {
  const [names, all] = await Promise.all([
    lookupNames(p, ctx.scope),
    loadDays(ctx, { wingId: p.wingId, sectionId: p.sectionId }, { from: p.from, to: p.to }),
  ]);
  const absent = all
    .filter((d) => d.status === 'absent')
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
  const expected = all.filter(isExpected).length;

  const rows: Row[] = absent.map((d) => ({
    employeeId: d.employeeId,
    hasPhoto: d.hasPhoto,
    date: d.date,
    weekday: weekdayName(d.date),
    code: d.empCode,
    name: d.name,
    wing: d.wingName,
    section: d.sectionName,
    designation: d.designation,
  }));

  const per = new Map<number, { d: AttendanceDay; dates: string[]; expected: number }>();
  for (const d of all) {
    if (!isExpected(d)) continue;
    const e = per.get(d.employeeId) ?? { d, dates: [], expected: 0 };
    e.expected += 1;
    if (d.status === 'absent') e.dates.push(d.date);
    per.set(d.employeeId, e);
  }
  const summaryRows: Row[] = [...per.values()]
    .filter((e) => e.dates.length > 0)
    .sort((a, b) => b.dates.length - a.dates.length || a.d.name.localeCompare(b.d.name))
    .map((e) => ({
      employeeId: e.d.employeeId,
      hasPhoto: e.d.hasPhoto,
      code: e.d.empCode,
      name: e.d.name,
      wing: e.d.wingName,
      days: e.dates.length,
      dates: e.dates.map(short).join(', '),
      rate: pct(e.dates.length, e.expected),
    }));

  const scopeText = names.section ? `${names.wing ?? names.scopeLabel} · ${names.section}` : (names.wing ?? names.scopeLabel);
  const rate = pct(absent.length, expected);
  return {
    type: 'absentees',
    title: 'Absentees Report',
    subtitle: `${fmtRange(p.from, p.to)} · ${scopeText}`,
    filters: filtersText(p, names),
    columns: [
      { key: 'date', label: 'Date', kind: 'date' },
      { key: 'weekday', label: 'Day', kind: 'text' },
      { key: 'code', label: 'Code', kind: 'mono' },
      { key: 'name', label: 'Name', kind: 'text' },
      { key: 'wing', label: 'Wing', kind: 'text' },
      { key: 'section', label: 'Section', kind: 'text' },
      { key: 'designation', label: 'Designation', kind: 'text' },
    ],
    rows,
    total: rows.length,
    totals: null,
    highlights: [
      { label: 'Absent days', value: String(absent.length) },
      { label: 'Employees affected', value: String(summaryRows.length) },
      { label: 'Absence rate', value: rate === null ? '–' : `${rate}%` },
    ],
    legend: [],
    columnShade: {},
    extraTables: [
      {
        id: 'by_employee',
        title: 'Absences per employee',
        columns: [
          { key: 'code', label: 'Code', kind: 'mono' },
          { key: 'name', label: 'Name', kind: 'text' },
          { key: 'wing', label: 'Wing', kind: 'text' },
          { key: 'days', label: 'Days absent', kind: 'number' },
          { key: 'rate', label: '% of working days', kind: 'percent' },
          { key: 'dates', label: 'Dates', kind: 'text' },
        ],
        rows: summaryRows,
        totals: summaryRows.length ? { name: 'Total', days: absent.length } : null,
      },
    ],
    file: { label: 'Absentees', scope: slug(names.section ? `${names.wing ?? names.scopeLabel}-${names.section}` : (names.wing ?? names.scopeLabel)), period: `${p.from}_to_${p.to}` },
  };
}
