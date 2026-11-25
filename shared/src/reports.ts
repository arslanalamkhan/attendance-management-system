import { z } from 'zod';
import { zDate, zIsoDateTime } from './common';

// =====================================================================================
// Phase G: dashboard, reports and exports.
// Every report is wing-scoped like the rest of the API. Viewing needs attendance.view; downloading needs
// attendance.export and is audited as attendance.export (type, filters, format, row count).
// The "corrected" marker is NEVER shown to anyone but the Super Admin (Phase F decision) - on screen or in files.
// Leave is always shown with its type, e.g. "On leave | CL Casual".
// =====================================================================================

export const REPORT_TYPES = {
  daily: {
    label: 'Daily attendance',
    description: 'Every employee on one date: status, in/out, worked hours, late/early, leave.',
    params: ['date', 'wingId', 'sectionId', 'status'] as const,
  },
  monthly_register: {
    label: 'Monthly attendance register',
    description: 'Employees x days of a month with status codes (P, L, A, leave codes ...) and monthly totals.',
    params: ['month', 'wingId', 'sectionId'] as const,
  },
  late_comers: {
    label: 'Late comers',
    description: 'Late arrivals in a period with minutes late, plus a per-employee summary.',
    params: ['from', 'to', 'wingId', 'sectionId', 'minLateMinutes'] as const,
  },
  absentees: {
    label: 'Absentees',
    description: 'Unexplained absences (no punch, no leave) in a period.',
    params: ['from', 'to', 'wingId', 'sectionId'] as const,
  },
  wing_summary: {
    label: 'Wing summary',
    description: 'Per wing: headcount, present, late, on leave, absent and attendance / punctuality rates.',
    params: ['from', 'to'] as const,
  },
  time_card: {
    label: 'Individual time card',
    description: 'One employee, day by day: in/out, worked hours, status, leave, with totals.',
    params: ['employeeId', 'from', 'to'] as const,
  },
  leave: {
    label: 'Leave report',
    description: 'Leave taken in a period by type, with working days, per employee.',
    params: ['from', 'to', 'wingId', 'sectionId', 'leaveTypeId'] as const,
  },
  punch_log: {
    label: 'Device punch log',
    description: 'Raw punches from the terminals with time, method and device.',
    params: ['from', 'to', 'wingId', 'deviceId', 'employeeId'] as const,
  },
} as const;
export type ReportType = keyof typeof REPORT_TYPES;
export const REPORT_TYPE_KEYS = Object.keys(REPORT_TYPES) as ReportType[];
export const zReportType = z.enum(REPORT_TYPE_KEYS as [ReportType, ...ReportType[]]);

/** Union of all report parameters; each report uses the subset in REPORT_TYPES[type].params. */
export const zReportParams = z
  .object({
    date: zDate.optional(),
    /** "YYYY-MM" */
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM').optional(),
    from: zDate.optional(),
    to: zDate.optional(),
    wingId: z.coerce.number().int().positive().optional(),
    sectionId: z.coerce.number().int().positive().optional(),
    employeeId: z.coerce.number().int().positive().optional(),
    deviceId: z.coerce.number().int().positive().optional(),
    leaveTypeId: z.coerce.number().int().positive().optional(),
    status: z.string().optional(),
    minLateMinutes: z.coerce.number().int().min(0).max(600).optional(),
    /** On-screen paging only; exports always contain every row. */
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(100),
  })
  .refine((p) => !p.from || !p.to || p.to >= p.from, { path: ['to'], message: 'Must be on or after the start date' });
export type ReportParams = z.input<typeof zReportParams>;

/** Column value kinds, so the screen, Excel and PDF render consistently. */
export const REPORT_COLUMN_KINDS = ['text', 'mono', 'number', 'date', 'time', 'minutes', 'hours', 'percent', 'status', 'day_code'] as const;
export const zReportColumn = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(REPORT_COLUMN_KINDS),
  /** Optional grouping header (e.g. the weekday row above day numbers in the register). */
  group: z.string().optional(),
  align: z.enum(['left', 'right', 'center']).optional(),
});
export type ReportColumn = z.infer<typeof zReportColumn>;

/**
 * Cell values: plain JSON (string | number | null). For kind 'status' and 'day_code' the value is an object
 * { code, label, color? } where color is a hex (leave types use their own colour; statuses use the app palette).
 */
export const zStatusCell = z.object({ code: z.string(), label: z.string(), color: z.string().optional() });
export type StatusCell = z.infer<typeof zStatusCell>;

/** GET /reports/:type -> ReportResult (paged rows for the screen). */
export const zReportResult = z.object({
  type: zReportType,
  title: z.string(),
  /** e.g. "Operations Wing | 1-30 Nov 2026". */
  subtitle: z.string(),
  columns: z.array(zReportColumn),
  rows: z.array(z.record(z.unknown())),
  /** Optional totals row keyed like rows. */
  totals: z.record(z.unknown()).nullable(),
  /** Headline figures shown above the table, e.g. [{label:'Attendance rate', value:'91.2%'}]. */
  highlights: z.array(z.object({ label: z.string(), value: z.string() })),
  /** Legend for day/status codes used in this report. */
  legend: z.array(zStatusCell),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  generatedAt: zIsoDateTime,
});
export type ReportResult = z.infer<typeof zReportResult>;

/**
 * GET /reports/:type/export?format=xlsx|pdf&<params> -> file download (attendance.export).
 * xlsx: branded workbook (NACTA logo + title + filters + "Generated by <name> on <date>" header rows, frozen header,
 *       autofilter, status cells coloured, totals row, print setup A4 landscape, page numbers in footer).
 * pdf : A4 landscape, NACTA header with logo, table with repeating header row, colour legend, page "x of y",
 *       generated-by footer. Monthly register in PDF uses compact day columns.
 * File name: NACTA-<Report-Label>-<scope>-<period>.xlsx|pdf. Audited as attendance.export.
 */
export const EXPORT_FORMATS = ['xlsx', 'pdf'] as const;
export const zExportFormat = z.enum(EXPORT_FORMATS);
export type ExportFormat = z.infer<typeof zExportFormat>;

// ---------- Dashboard ----------
export const zDashboard = z.object({
  date: z.string(),
  /** Today's employees per DayStatus (keys are DayStatus values). */
  today: z.record(z.string(), z.number().int()),
  /** Employees counted today (in scope, active). */
  headcount: z.number().int(),
  byWing: z.array(
    z.object({
      wingId: z.number().int().nullable(),
      wingName: z.string(),
      headcount: z.number().int(),
      present: z.number().int(),
      late: z.number().int(),
      onLeave: z.number().int(),
      absent: z.number().int(),
      pending: z.number().int(),
    }),
  ),
  /** Last 30 days, oldest first. Rates are percentages 0-100. */
  trend: z.array(
    z.object({
      date: z.string(),
      workingDay: z.boolean(),
      present: z.number().int(),
      late: z.number().int(),
      absent: z.number().int(),
      onLeave: z.number().int(),
      attendanceRate: z.number(),
      punctualityRate: z.number(),
    }),
  ),
  /** Most late days in the last 30 days (top 8). */
  topLate: z.array(
    z.object({
      employeeId: z.number().int(),
      empCode: z.string(),
      name: z.string(),
      wingName: z.string().nullable(),
      hasPhoto: z.boolean(),
      lateDays: z.number().int(),
      avgLateMinutes: z.number().int(),
    }),
  ),
  /** Latest 15 punches today (in scope). */
  liveFeed: z.array(
    z.object({
      id: z.number().int(),
      employeeId: z.number().int().nullable(),
      name: z.string().nullable(),
      empCode: z.string(),
      hasPhoto: z.boolean(),
      wingName: z.string().nullable(),
      time: z.string(),
      verifyType: z.number().int().nullable(),
      deviceName: z.string(),
    }),
  ),
  devices: z.array(z.object({ id: z.number().int(), name: z.string(), status: z.string(), lastSeenAt: zIsoDateTime.nullable() })),
  /** People on leave today (top 10) with their leave type. */
  onLeaveToday: z.array(
    z.object({ employeeId: z.number().int(), name: z.string(), empCode: z.string(), hasPhoto: z.boolean(), typeName: z.string(), code: z.string(), color: z.string() }),
  ),
});
export type Dashboard = z.infer<typeof zDashboard>;
