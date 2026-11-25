import type { ReportColumn } from '@nacta/shared';
import { DAY_STATUS_LABEL } from '@nacta/shared';
import { notFound, outOfScope } from '../../lib/errors';
import { listEmployeeIds } from '../attendance/days';
import { dayNote, filtersText, fmtRange, loadDays, lookupNames, showCorrected, slug, weekdayName } from './common';
import type { ReportContext, ReportData, ReportParams, Row } from './types';

/**
 * Export attendance: for every employee and every day of the period, the first In and the last Out.
 * Times come from the computed attendance day, so punches added through corrections are included (the
 * "corrected" marker itself is shown to the Super Admin only). Filters: date range, wing / section, or one person.
 */
export async function buildAttendanceExport(p: ReportParams, ctx: ReportContext): Promise<ReportData> {
  if (p.employeeId !== undefined) {
    const visible = await listEmployeeIds(ctx.scope, { employeeIds: [p.employeeId] });
    if (!visible.length) {
      if (ctx.scope !== 'all' && (await listEmployeeIds('all', { employeeIds: [p.employeeId] })).length) throw outOfScope('Employee');
      throw notFound('Employee');
    }
  }
  const [names, all] = await Promise.all([
    lookupNames(p, ctx.scope),
    loadDays(
      ctx,
      p.employeeId !== undefined ? { employeeIds: [p.employeeId] } : { wingId: p.wingId, sectionId: p.sectionId },
      { from: p.from, to: p.to },
    ),
  ]);

  // Grouped by person (wing, name, code), each person's days in date order. Days before joining / after leaving are left out.
  const days = all
    .filter((d) => d.status !== 'inactive')
    .sort(
      (a, b) =>
        (a.wingName ?? '￿').localeCompare(b.wingName ?? '￿') ||
        a.name.localeCompare(b.name) ||
        a.empCode.localeCompare(b.empCode, undefined, { numeric: true }) ||
        (a.date < b.date ? -1 : a.date > b.date ? 1 : 0),
    );

  const withCorrected = showCorrected(ctx);
  const columns: ReportColumn[] = [
    { key: 'code', label: 'Code', kind: 'mono' },
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'designation', label: 'Designation', kind: 'text' },
    { key: 'wing', label: 'Wing', kind: 'text' },
    { key: 'date', label: 'Date', kind: 'date' },
    { key: 'weekday', label: 'Day', kind: 'text' },
    { key: 'in', label: 'First In', kind: 'time', align: 'center' },
    { key: 'out', label: 'Last Out', kind: 'time', align: 'center' },
    { key: 'remark', label: 'Remark', kind: 'text' },
  ];
  if (withCorrected) columns.push({ key: 'corrected', label: 'Corrected', kind: 'text', align: 'center' });

  let withIn = 0;
  let withBoth = 0;
  const people = new Set<number>();
  const rows: Row[] = days.map((d) => {
    people.add(d.employeeId);
    if (d.firstIn) withIn += 1;
    if (d.firstIn && d.lastOut) withBoth += 1;
    // Explain an empty or one-sided day; a normal day with both times needs no remark.
    const remark = !d.firstIn
      ? dayNote(d) || DAY_STATUS_LABEL[d.status]
      : !d.lastOut
        ? d.status === 'pending' || d.status === 'present' || d.status === 'late'
          ? 'No out punch yet'
          : 'Missing out punch'
        : d.leave
          ? dayNote(d)
          : '';
    return {
      employeeId: d.employeeId,
      hasPhoto: d.hasPhoto,
      code: d.empCode,
      name: d.name,
      designation: d.designation,
      wing: d.wingName,
      date: d.date,
      weekday: weekdayName(d.date),
      in: d.firstIn,
      out: d.lastOut,
      remark: remark || null,
      ...(withCorrected ? { corrected: d.corrected ? 'Yes' : '' } : {}),
    };
  });

  const first = days[0];
  const who = p.employeeId !== undefined && first ? `${first.empCode} ${first.name}` : null;
  const scopeText = who ?? (names.section ? `${names.wing ?? names.scopeLabel} · ${names.section}` : (names.wing ?? names.scopeLabel));
  return {
    type: 'attendance_export',
    title: 'Attendance Export',
    subtitle: `${fmtRange(p.from, p.to)} · ${scopeText}`,
    filters: filtersText(p, names),
    columns,
    rows,
    total: rows.length,
    totals: null,
    highlights: [
      { label: 'Employees', value: String(people.size) },
      { label: 'Days with an In punch', value: String(withIn) },
      { label: 'Days with In and Out', value: String(withBoth) },
    ],
    legend: [],
    columnShade: {},
    extraTables: [],
    file: { label: 'Attendance-Export', scope: slug(who ?? names.wing ?? names.scopeLabel), period: `${p.from}_to_${p.to}` },
  };
}
