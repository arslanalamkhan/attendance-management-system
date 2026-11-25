import { DAY_STATUSES, REPORT_TYPES } from '@nacta/shared';
import type { ExportFormat, ReportParams, ReportType } from '@nacta/shared';
import { addDaysYmd, addMonthsYmd, endOfMonthYmd, isYmd, startOfMonthYmd, todayYmd } from './dates';

export type ReportParamKey = (typeof REPORT_TYPES)[ReportType]['params'][number];

/** "2026-11" for a "YYYY-MM-DD" date. */
export const monthOf = (ymd: string): string => ymd.slice(0, 7);
export const isMonth = (s: string | null | undefined): s is string => Boolean(s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s));
export const monthStart = (month: string): string => `${month}-01`;

export interface ReportPeriod {
  from: string;
  to: string;
}

export type PeriodPreset = 'this_month' | 'last_month' | 'last_7' | 'custom';

export const PERIOD_PRESETS: { key: Exclude<PeriodPreset, 'custom'>; label: string }[] = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'last_7', label: 'Last 7 days' },
];

export function periodForPreset(preset: Exclude<PeriodPreset, 'custom'>, today: string = todayYmd()): ReportPeriod {
  switch (preset) {
    case 'this_month':
      return { from: startOfMonthYmd(today), to: today };
    case 'last_month': {
      const first = addMonthsYmd(today, -1);
      return { from: first, to: endOfMonthYmd(first) };
    }
    case 'last_7':
      return { from: addDaysYmd(today, -6), to: today };
  }
}

export function presetOfPeriod(p: ReportPeriod, today: string = todayYmd()): PeriodPreset {
  for (const x of PERIOD_PRESETS) {
    const r = periodForPreset(x.key, today);
    if (r.from === p.from && r.to === p.to) return x.key;
  }
  return 'custom';
}

/** The parameters a report uses, in the order the bar shows them. */
export const paramsOf = (type: ReportType): readonly ReportParamKey[] => REPORT_TYPES[type].params;

/** What the URL carries (plus defaults for the period/date/month so a report opens with something sensible). */
export function readReportParams(type: ReportType, sp: URLSearchParams, today: string = todayYmd()): ReportParams {
  const keys = paramsOf(type);
  const has = (k: ReportParamKey) => keys.includes(k);
  const num = (name: string) => {
    const n = Number(sp.get(name));
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  const out: ReportParams = {};
  if (has('date')) out.date = isYmd(sp.get('date') ?? undefined) ? (sp.get('date') as string) : today;
  if (has('month')) out.month = isMonth(sp.get('month')) ? (sp.get('month') as string) : monthOf(today);
  if (has('from') || has('to')) {
    const def = periodForPreset('this_month', today);
    const from = isYmd(sp.get('from') ?? undefined) ? (sp.get('from') as string) : def.from;
    let to = isYmd(sp.get('to') ?? undefined) ? (sp.get('to') as string) : def.to;
    if (to < from) to = from;
    out.from = from;
    out.to = to;
  }
  if (has('wingId')) out.wingId = num('wingId');
  if (has('sectionId') && out.wingId) out.sectionId = num('sectionId');
  if (has('employeeId')) out.employeeId = num('employeeId');
  if (has('deviceId')) out.deviceId = num('deviceId');
  if (has('leaveTypeId')) out.leaveTypeId = num('leaveTypeId');
  if (has('status')) {
    const s = sp.get('status');
    if (s && (DAY_STATUSES as readonly string[]).includes(s)) out.status = s;
  }
  if (has('minLateMinutes')) {
    const n = Number.parseInt(sp.get('minLateMinutes') ?? '', 10);
    if (Number.isFinite(n) && n > 0) out.minLateMinutes = Math.min(600, n);
  }
  return out;
}

/** Required inputs that have no sensible default. */
export function missingParams(type: ReportType, params: ReportParams): { key: ReportParamKey; message: string }[] {
  const out: { key: ReportParamKey; message: string }[] = [];
  if (type === 'time_card' && !params.employeeId) out.push({ key: 'employeeId', message: 'Choose an employee to see their time card.' });
  return out;
}

/** Which parameters must be filled for the report to run (shown with an asterisk in the bar). */
export const isRequiredParam = (type: ReportType, key: ReportParamKey): boolean => type === 'time_card' && key === 'employeeId';

const labelSlug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Fallback name when the server sends no Content-Disposition (the real name is NACTA-<Report>-<scope>-<period>). */
export function exportFileName(type: ReportType, params: ReportParams, format: ExportFormat): string {
  const period = params.month ?? params.date ?? (params.from && params.to ? `${params.from}_to_${params.to}` : todayYmd());
  return `NACTA-${labelSlug(REPORT_TYPES[type].label)}-${period}.${format}`;
}
