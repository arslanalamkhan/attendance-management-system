import type { ReportColumn } from '@nacta/shared';
import {
  addToTally,
  dayNote,
  emptyTally,
  filtersText,
  fmtDate,
  hoursOf,
  legendLabel,
  legendOf,
  leaveTypeMap,
  loadDays,
  lookupNames,
  pct,
  showCorrected,
  slug,
  statusCellOf,
  weekdayName,
} from './common';
import type { ReportContext, ReportData, ReportParams } from './types';

/** Every employee on one date: status, in/out, worked hours, late/early, leave. */
export async function buildDaily(p: ReportParams, ctx: ReportContext): Promise<ReportData> {
  const [names, types, all] = await Promise.all([
    lookupNames(p, ctx.scope),
    leaveTypeMap(),
    loadDays(ctx, { wingId: p.wingId, sectionId: p.sectionId, q: p.q }, { from: p.date, to: p.date }),
  ]);
  const days = p.status ? all.filter((d) => d.status === p.status) : all;
  const tally = emptyTally();
  for (const d of all) addToTally(tally, d, types);

  const withCorrected = showCorrected(ctx);
  const columns: ReportColumn[] = [
    { key: 'code', label: 'Code', kind: 'mono' },
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'wing', label: 'Wing', kind: 'text' },
    { key: 'section', label: 'Section', kind: 'text' },
    { key: 'designation', label: 'Designation', kind: 'text' },
    { key: 'status', label: 'Status', kind: 'status' },
    { key: 'in', label: 'In', kind: 'time', align: 'center' },
    { key: 'out', label: 'Out', kind: 'time', align: 'center' },
    { key: 'worked', label: 'Worked (h:mm)', kind: 'hours' },
    { key: 'late', label: 'Late (min)', kind: 'minutes' },
    { key: 'early', label: 'Early (min)', kind: 'minutes' },
    { key: 'note', label: 'Leave / holiday / remark', kind: 'text' },
  ];
  if (withCorrected) columns.push({ key: 'corrected', label: 'Corrected', kind: 'text', align: 'center' });

  const rows = days.map((d) => {
    const cell = statusCellOf(d);
    return {
      employeeId: d.employeeId,
      hasPhoto: d.hasPhoto,
      code: d.empCode,
      name: d.name,
      wing: d.wingName,
      section: d.sectionName,
      designation: d.designation,
      status: cell,
      in: d.firstIn,
      out: d.lastOut,
      worked: d.workedMinutes > 0 ? hoursOf(d.workedMinutes) : null,
      late: d.lateMinutes > 0 ? d.lateMinutes : null,
      early: d.earlyMinutes > 0 ? d.earlyMinutes : null,
      note: dayNote(d) || null,
      ...(withCorrected ? { corrected: d.corrected ? 'Yes' : '' } : {}),
    };
  });

  const scopeText = names.section ? `${names.wing ?? names.scopeLabel} · ${names.section}` : (names.wing ?? names.scopeLabel);
  const highlights = [
    { label: 'Employees', value: String(all.filter((d) => d.status !== 'inactive').length) },
    { label: 'Present', value: String(tally.present) },
    { label: 'Late', value: String(tally.late) },
    { label: 'On leave', value: String(tally.leave) },
    { label: 'Absent', value: String(tally.absent) },
  ];
  if (tally.halfDay + tally.missing > 0) highlights.push({ label: 'Half day / missing punch', value: String(tally.halfDay + tally.missing) });
  const rate = pct(tally.attended, tally.expected);
  highlights.push({ label: 'Attendance rate', value: rate === null ? '–' : `${rate}%` });

  return {
    type: 'daily',
    title: 'Daily Attendance Report',
    subtitle: `${weekdayName(p.date)}, ${fmtDate(p.date)} · ${scopeText}`,
    filters: filtersText(p, names),
    columns,
    rows,
    total: rows.length,
    totals: null,
    highlights,
    legend: legendOf(rows.map((r) => r.status)).map((c) => ({ ...c, label: legendLabel(c) })),
    columnShade: {},
    extraTables: [],
    file: { label: 'Daily-Attendance', scope: slug(names.section ? `${names.wing ?? names.scopeLabel}-${names.section}` : (names.wing ?? names.scopeLabel)), period: p.date },
  };
}
