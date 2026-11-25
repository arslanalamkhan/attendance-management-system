import { REPORT_TYPES, type ReportResult, type ReportType } from '@nacta/shared';
import { validationError } from '../../lib/errors';
import { buildAbsentees } from './absentees';
import { buildAttendanceExport } from './attendanceExport';
import { MAX_REPORT_ROWS, resolveParams, slug } from './common';
import { buildDaily } from './daily';
import { buildLateComers } from './lateComers';
import { buildLeave } from './leave';
import { buildMonthlyRegister } from './monthlyRegister';
import { buildPunchLog } from './punchLog';
import { buildTimeCard } from './timeCard';
import type { ReportContext, ReportData, ReportParams } from './types';
import { buildWingSummary } from './wingSummary';

export { resolveParams } from './common';
export type { ReportContext, ReportData, ReportParams } from './types';

/** Build a report. `paged` = the on-screen page only; false = every row (exports). */
export async function buildReport(type: ReportType, p: ReportParams, ctx: ReportContext, paged: boolean): Promise<ReportData> {
  let data: ReportData;
  switch (type) {
    case 'daily': data = await buildDaily(p, ctx); break;
    case 'monthly_register': data = await buildMonthlyRegister(p, ctx); break;
    case 'late_comers': data = await buildLateComers(p, ctx); break;
    case 'absentees': data = await buildAbsentees(p, ctx); break;
    case 'wing_summary': data = await buildWingSummary(p, ctx); break;
    case 'time_card': data = await buildTimeCard(p, ctx); break;
    case 'leave': data = await buildLeave(p, ctx); break;
    case 'punch_log': data = await buildPunchLog(p, ctx, paged); break;
    case 'attendance_export': data = await buildAttendanceExport(p, ctx); break;
  }
  if (data.total > MAX_REPORT_ROWS) {
    throw validationError('This report is too large', { to: `${data.total.toLocaleString('en-US')} rows; narrow the filters (at most ${MAX_REPORT_ROWS.toLocaleString('en-US')})` });
  }
  if (paged && type !== 'punch_log') {
    const start = (p.page - 1) * p.pageSize;
    data = { ...data, rows: data.rows.slice(start, start + p.pageSize) };
  }
  return data;
}

/** The JSON the screen gets (ReportResult plus `extraTables`, which the shared contract does not list). */
export function toResult(type: ReportType, p: ReportParams, d: ReportData, now = new Date()): ReportResult & { extraTables: ReportData['extraTables'] } {
  return {
    type,
    title: d.title,
    subtitle: d.subtitle,
    columns: d.columns,
    rows: d.rows,
    totals: d.totals,
    highlights: d.highlights,
    legend: d.legend,
    total: d.total,
    page: p.page,
    pageSize: p.pageSize,
    generatedAt: now.toISOString(),
    extraTables: d.extraTables,
  };
}

/** NACTA-Monthly-Register-Operations-2026-11.xlsx (ASCII only). */
export function exportFileName(d: ReportData, format: 'xlsx' | 'pdf'): string {
  return `NACTA-${slug(d.file.label)}-${slug(d.file.scope)}-${d.file.period.replace(/[^0-9A-Za-z_-]/g, '-')}.${format}`;
}

export const isReportType = (s: string): s is ReportType => Object.hasOwn(REPORT_TYPES, s);
