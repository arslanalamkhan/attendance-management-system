import type { ReportColumn } from '@nacta/shared';
import { notFound, outOfScope } from '../../lib/errors';
import { getDaysFor, listEmployeeIds } from '../attendance/days';
import {
  addToTally,
  dayNote,
  emptyTally,
  fmtRange,
  hoursOf,
  legendLabel,
  legendOf,
  leaveTypeMap,
  pct,
  round1,
  showCorrected,
  slug,
  statusCellOf,
  weekdayName,
} from './common';
import type { ReportContext, ReportData, ReportParams } from './types';

/** One employee, every day of the range, with totals. */
export async function buildTimeCard(p: ReportParams, ctx: ReportContext): Promise<ReportData> {
  const employeeId = p.employeeId as number;
  const visible = await listEmployeeIds(ctx.scope, { employeeIds: [employeeId] });
  if (!visible.length) {
    if (ctx.scope !== 'all' && (await listEmployeeIds('all', { employeeIds: [employeeId] })).length) throw outOfScope('Employee');
    throw notFound('Employee');
  }
  const [types, days] = await Promise.all([leaveTypeMap(), getDaysFor(visible, p.from, p.to)]);
  const first = days[0];
  if (!first) throw notFound('Employee');

  const withCorrected = showCorrected(ctx);
  const columns: ReportColumn[] = [
    { key: 'date', label: 'Date', kind: 'date' },
    { key: 'weekday', label: 'Day', kind: 'text' },
    { key: 'status', label: 'Status', kind: 'status' },
    { key: 'in', label: 'In', kind: 'time', align: 'center' },
    { key: 'out', label: 'Out', kind: 'time', align: 'center' },
    { key: 'worked', label: 'Worked (h:mm)', kind: 'hours' },
    { key: 'late', label: 'Late (min)', kind: 'minutes' },
    { key: 'early', label: 'Early (min)', kind: 'minutes' },
    { key: 'note', label: 'Leave / holiday / remark', kind: 'text' },
  ];
  if (withCorrected) columns.push({ key: 'corrected', label: 'Corrected', kind: 'text', align: 'center' });

  const t = emptyTally();
  let lateMin = 0;
  let earlyMin = 0;
  const rows = days.map((d) => {
    addToTally(t, d, types);
    lateMin += d.lateMinutes;
    earlyMin += d.earlyMinutes;
    return {
      employeeId: d.employeeId,
      hasPhoto: d.hasPhoto,
      date: d.date,
      weekday: weekdayName(d.date),
      status: statusCellOf(d),
      in: d.firstIn,
      out: d.lastOut,
      worked: d.workedMinutes > 0 ? hoursOf(d.workedMinutes) : null,
      late: d.lateMinutes > 0 ? d.lateMinutes : null,
      early: d.earlyMinutes > 0 ? d.earlyMinutes : null,
      note: dayNote(d) || null,
      ...(withCorrected ? { corrected: d.corrected ? 'Yes' : '' } : {}),
    };
  });
  const rate = pct(t.attended, t.expected);
  const who = [first.empCode, first.name, first.wingName, first.designation].filter(Boolean).join(' · ');

  return {
    type: 'time_card',
    title: 'Individual Time Card',
    subtitle: `${who} · ${fmtRange(p.from, p.to)}`,
    filters: `Employee: ${first.empCode} ${first.name}   |   Wing: ${first.wingName ?? 'No wing'}${first.sectionName ? `   |   Section: ${first.sectionName}` : ''}`,
    columns,
    rows,
    total: rows.length,
    totals: { date: 'Total', worked: hoursOf(t.worked), late: lateMin, early: earlyMin },
    highlights: [
      { label: 'Days present', value: String(t.present) },
      { label: 'Days late', value: String(t.late) },
      { label: 'Days absent', value: String(t.absent) },
      { label: 'Days on leave', value: String(t.leave) },
      { label: 'Hours worked', value: `${round1(t.worked / 60)} h` },
      { label: 'Attendance rate', value: rate === null ? '–' : `${rate}%` },
    ],
    legend: legendOf(rows.map((r) => r.status)).map((c) => ({ ...c, label: legendLabel(c) })),
    columnShade: {},
    extraTables: [],
    file: { label: 'Time-Card', scope: slug(`${first.empCode}-${first.name}`), period: `${p.from}_to_${p.to}` },
  };
}
