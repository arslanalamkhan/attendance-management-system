import type { AttendanceDay, ReportColumn, StatusCell } from '@nacta/shared';
import {
  addToTally,
  dayCodeCell,
  emptyTally,
  filtersText,
  isAttended,
  isExpected,
  legendLabel,
  legendOf,
  leaveTypeMap,
  loadDays,
  lookupNames,
  monthLabel,
  pct,
  slug,
  weekdayShort,
} from './common';
import type { ReportContext, ReportData, ReportParams, Row } from './types';

/** Employees x days of a month with status codes and per-employee / per-day totals. */
export async function buildMonthlyRegister(p: ReportParams, ctx: ReportContext): Promise<ReportData> {
  const [names, types, days] = await Promise.all([
    lookupNames(p, ctx.scope),
    leaveTypeMap(),
    loadDays(ctx, { wingId: p.wingId, sectionId: p.sectionId }, { from: p.from, to: p.to }),
  ]);

  // Group per employee (loadDays is ordered wing, name, date).
  const byEmp = new Map<number, AttendanceDay[]>();
  for (const d of days) {
    const arr = byEmp.get(d.employeeId);
    if (arr) arr.push(d);
    else byEmp.set(d.employeeId, [d]);
  }
  // People who were not in service at any point of the month are left out.
  const people = [...byEmp.values()].filter((list) => list.some((d) => d.status !== 'inactive'));
  const dates = [...new Set(days.map((d) => d.date))].sort();
  const dayKey = (date: string) => `d${date.slice(8, 10)}`;

  const showWing = p.wingId === undefined;
  const columns: ReportColumn[] = [
    { key: 'code', label: 'Code', kind: 'mono' },
    { key: 'name', label: 'Name', kind: 'text' },
    ...(showWing ? ([{ key: 'wing', label: 'Wing', kind: 'text' }] as ReportColumn[]) : []),
    ...dates.map((date): ReportColumn => ({ key: dayKey(date), label: date.slice(8, 10), kind: 'day_code', group: weekdayShort(date), align: 'center' })),
    { key: 'tP', label: 'P', kind: 'number' },
    { key: 'tL', label: 'L', kind: 'number' },
    { key: 'tHM', label: 'H/M', kind: 'number' },
    { key: 'tA', label: 'A', kind: 'number' },
    { key: 'tLeave', label: 'Leave', kind: 'number' },
    { key: 'tWorking', label: 'Working days', kind: 'number' },
    { key: 'tPct', label: 'Att. %', kind: 'percent' },
  ];

  const used: (StatusCell | null)[] = [];
  const grand = emptyTally();
  const perDayAttended = new Map<string, number>();
  const perDayExpected = new Map<string, number>();
  const shadeCount = new Map<string, { active: number; weekend: number; holiday: number }>();

  const rows: Row[] = people.map((list) => {
    const first = list[0] as AttendanceDay;
    const t = emptyTally();
    const row: Row = { employeeId: first.employeeId, hasPhoto: first.hasPhoto, code: first.empCode, name: first.name };
    if (showWing) row.wing = first.wingName;
    for (const d of list) {
      const cell = dayCodeCell(d);
      row[dayKey(d.date)] = cell;
      used.push(cell);
      addToTally(t, d, types);
      addToTally(grand, d, types);
      if (d.status !== 'inactive') {
        const s = shadeCount.get(d.date) ?? { active: 0, weekend: 0, holiday: 0 };
        s.active += 1;
        if (d.status === 'weekend') s.weekend += 1;
        if (d.status === 'holiday') s.holiday += 1;
        shadeCount.set(d.date, s);
        // per-day count: everyone who attended (on time, late, half day, official duty)
        perDayAttended.set(d.date, (perDayAttended.get(d.date) ?? 0) + (isAttended(d, types) ? 1 : 0));
        perDayExpected.set(d.date, (perDayExpected.get(d.date) ?? 0) + (isExpected(d) ? 1 : 0));
      }
    }
    row.tP = t.present;
    row.tL = t.late;
    row.tHM = t.halfDay + t.missing;
    row.tA = t.absent;
    row.tLeave = t.leave;
    row.tWorking = t.expected;
    row.tPct = pct(t.attended, t.expected);
    return row;
  });

  const columnShade: Record<string, 'weekend' | 'holiday'> = {};
  for (const date of dates) {
    const s = shadeCount.get(date);
    if (!s || s.active === 0) continue;
    if (s.weekend === s.active) columnShade[dayKey(date)] = 'weekend';
    else if (s.holiday === s.active) columnShade[dayKey(date)] = 'holiday';
  }

  const totals: Row = { name: 'Attended (count)' };
  for (const date of dates) totals[dayKey(date)] = (perDayExpected.get(date) ?? 0) > 0 ? (perDayAttended.get(date) ?? 0) : null;
  totals.tP = grand.present;
  totals.tL = grand.late;
  totals.tHM = grand.halfDay + grand.missing;
  totals.tA = grand.absent;
  totals.tLeave = grand.leave;
  totals.tWorking = grand.expected;
  totals.tPct = pct(grand.attended, grand.expected);

  const rate = pct(grand.attended, grand.expected);
  const scopeText = names.section ? `${names.wing ?? names.scopeLabel} · ${names.section}` : (names.wing ?? names.scopeLabel);
  return {
    type: 'monthly_register',
    title: 'Monthly Attendance Register',
    subtitle: `${monthLabel(p.month)} · ${scopeText}`,
    filters: filtersText(p, names),
    columns,
    rows,
    total: rows.length,
    totals: rows.length ? totals : null,
    highlights: [
      { label: 'Employees', value: String(rows.length) },
      { label: 'Attendance rate', value: rate === null ? '–' : `${rate}%` },
      { label: 'Late days', value: String(grand.late) },
      { label: 'Absent days', value: String(grand.absent) },
      { label: 'Leave days', value: String(grand.leave) },
    ],
    legend: legendOf(used).map((c) => ({ ...c, label: legendLabel(c) })),
    columnShade,
    extraTables: [],
    file: { label: 'Monthly-Register', scope: slug(names.section ? `${names.wing ?? names.scopeLabel}-${names.section}` : (names.wing ?? names.scopeLabel)), period: p.month },
  };
}
