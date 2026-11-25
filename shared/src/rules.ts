import { z } from 'zod';
import { zDate, zIsoDateTime, zOptionalText, zPageQuery } from './common';

// =====================================================================================
// Phase F: attendance rules — office timings, holidays, leave, corrections, daily status.
// All dates are calendar dates in device-local (Pakistan) time; times are "HH:mm" 24h.
// =====================================================================================

export const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm (24-hour)');

/** 0 = Sunday ... 6 = Saturday (JavaScript getDay()). */
export const WEEKDAYS = [
  { day: 0, short: 'Sun', name: 'Sunday' },
  { day: 1, short: 'Mon', name: 'Monday' },
  { day: 2, short: 'Tue', name: 'Tuesday' },
  { day: 3, short: 'Wed', name: 'Wednesday' },
  { day: 4, short: 'Thu', name: 'Thursday' },
  { day: 5, short: 'Fri', name: 'Friday' },
  { day: 6, short: 'Sat', name: 'Saturday' },
] as const;

// ---------- Office timings ----------
/** One weekday's hours; null in `days` = day off (weekend). */
export const zDayHours = z
  .object({ start: zTime, end: zTime })
  .refine((h) => h.start < h.end, { message: 'End must be after start', path: ['end'] });

export const zTimingProfileInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  /** Index 0..6 = Sunday..Saturday. */
  days: z.array(zDayHours.nullable()).length(7),
  /** Arriving later than start + this is "late". */
  graceLateMinutes: z.number().int().min(0).max(240).default(15),
  /** Leaving earlier than end - this is "early leave". */
  graceEarlyMinutes: z.number().int().min(0).max(240).default(15),
  /** Worked less than this (but some) = half day. */
  halfDayBelowMinutes: z.number().int().min(0).max(1440).default(240),
});
export type TimingProfileInput = z.input<typeof zTimingProfileInput>;

/**
 * Timing rules are versioned and apply FORWARDS: each change starts on `effectiveFrom` (default today, never in the
 * past except during first-time setup), and earlier days keep the version that was in force then.
 */
export const zTimingVersion = z.object({
  effectiveFrom: z.string(),
  days: z.array(z.object({ start: z.string(), end: z.string() }).nullable()),
  graceLateMinutes: z.number().int(),
  graceEarlyMinutes: z.number().int(),
  halfDayBelowMinutes: z.number().int(),
  createdBy: z.string().nullable(),
  createdAt: zIsoDateTime,
});
export type TimingVersion = z.infer<typeof zTimingVersion>;

/** PUT /timings/:id body: the profile fields plus the date the change applies from. */
export const zTimingProfileUpdate = zTimingProfileInput.and(z.object({ effectiveFrom: zDate.optional() }));
export type TimingProfileUpdate = z.input<typeof zTimingProfileUpdate>;

/** GET /timings/setup-status -> whether a user has saved the default office timings at least once. */
export const zTimingSetupStatus = z.object({ configured: z.boolean() });

export const zTimingProfile = z.object({
  id: z.number().int(),
  name: z.string(),
  /** Versions newest first; the top-level rule fields are the version in force today. */
  versions: z.array(zTimingVersion),
  days: z.array(z.object({ start: z.string(), end: z.string() }).nullable()),
  graceLateMinutes: z.number().int(),
  graceEarlyMinutes: z.number().int(),
  halfDayBelowMinutes: z.number().int(),
  /** The organisation default (exactly one). */
  isDefault: z.boolean(),
  assignmentCount: z.number().int(),
  createdAt: zIsoDateTime,
  updatedAt: zIsoDateTime,
});
export type TimingProfile = z.infer<typeof zTimingProfile>;

/**
 * Which profile applies to whom and when. Resolution for an employee on a date, most specific first:
 * employee assignment > wing assignment > organisation-wide assignment > the default profile.
 * Within a level, a dated assignment (e.g. Ramadan) beats an open-ended one; ties -> latest effectiveFrom.
 */
export const ASSIGNMENT_SCOPES = ['all', 'wing', 'employee'] as const;
export const zAssignmentScope = z.enum(ASSIGNMENT_SCOPES);

export const zTimingAssignmentInput = z
  .object({
    profileId: z.number().int().positive(),
    scope: zAssignmentScope,
    /** Wing id or employee id; omitted for "all". */
    scopeId: z.number().int().positive().optional(),
    effectiveFrom: zDate,
    /** Inclusive; omit for open-ended. */
    effectiveTo: zDate.optional(),
    /** e.g. "Ramadan 2027". */
    label: zOptionalText(60),
  })
  .refine((a) => a.scope === 'all' || a.scopeId !== undefined, { path: ['scopeId'], message: 'Choose a wing or employee' })
  .refine((a) => !a.effectiveTo || a.effectiveTo >= a.effectiveFrom, { path: ['effectiveTo'], message: 'Must be on or after the start date' });
export type TimingAssignmentInput = z.input<typeof zTimingAssignmentInput>;

export const zTimingAssignment = z.object({
  id: z.number().int(),
  profileId: z.number().int(),
  profileName: z.string(),
  scope: zAssignmentScope,
  scopeId: z.number().int().nullable(),
  scopeLabel: z.string(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  label: z.string().nullable(),
});
export type TimingAssignment = z.infer<typeof zTimingAssignment>;

// ---------- Holidays ----------
export const HOLIDAY_KINDS = ['holiday', 'working_day'] as const;
/** holiday = office closed; working_day = a normally-off day that is worked (e.g. a Saturday make-up day). */
export const zHolidayKind = z.enum(HOLIDAY_KINDS);

export const zHolidayInput = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(100),
    from: zDate,
    /** Inclusive; same as from for a single day. */
    to: zDate,
    kind: zHolidayKind.default('holiday'),
    /** Empty = all wings. */
    wingIds: z.array(z.number().int().positive()).default([]),
  })
  .refine((h) => h.to >= h.from, { path: ['to'], message: 'Must be on or after the start date' });
export type HolidayInput = z.input<typeof zHolidayInput>;

export const zHoliday = z.object({
  id: z.number().int(),
  name: z.string(),
  from: z.string(),
  to: z.string(),
  kind: zHolidayKind,
  wingIds: z.array(z.number().int()),
  wingNames: z.array(z.string()),
  createdAt: zIsoDateTime,
});
export type Holiday = z.infer<typeof zHoliday>;

// ---------- Leave ----------
export const zLeaveTypeInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  /** Short code shown in registers, e.g. "CL". Unique. */
  code: z.string().trim().toUpperCase().min(1).max(6).regex(/^[A-Z0-9]+$/, 'Letters and digits only'),
  /** Hex colour for calendars, e.g. "#2563EB". */
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a hex colour like #2563EB'),
  /** Official duty / tour counts as present in summaries. */
  countsAsPresent: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type LeaveTypeInput = z.input<typeof zLeaveTypeInput>;

export const zLeaveType = z.object({
  id: z.number().int(),
  name: z.string(),
  code: z.string(),
  color: z.string(),
  countsAsPresent: z.boolean(),
  isActive: z.boolean(),
  usageCount: z.number().int(),
});
export type LeaveType = z.infer<typeof zLeaveType>;

/** full day, or half day (first/second half of the office hours). */
export const LEAVE_PARTS = ['full', 'first_half', 'second_half'] as const;
export const zLeavePart = z.enum(LEAVE_PARTS);
export const LEAVE_PART_LABEL: Record<(typeof LEAVE_PARTS)[number], string> = {
  full: 'Full day',
  first_half: 'First half',
  second_half: 'Second half',
};

/**
 * POST /leaves. One day: from = to. Range: inclusive. Several employees at once (e.g. a whole team on duty).
 * Half-day parts are only allowed for a single day. Weekends and holidays inside the range are skipped when
 * counting days but the record keeps the range as entered. 409 LEAVE_OVERLAP if any employee already has leave
 * on any of those days (details: [{ employeeId, name, dates }]); `replaceOverlapping: true` trims/replaces them.
 */
export const zLeaveInput = z
  .object({
    employeeIds: z.array(z.number().int().positive()).min(1, 'Choose at least one employee').max(1000),
    leaveTypeId: z.number().int().positive(),
    from: zDate,
    to: zDate,
    part: zLeavePart.default('full'),
    reason: zOptionalText(300),
    replaceOverlapping: z.boolean().default(false),
  })
  .refine((l) => l.to >= l.from, { path: ['to'], message: 'Must be on or after the start date' })
  .refine((l) => l.part === 'full' || l.from === l.to, { path: ['part'], message: 'Half days are for a single date' });
export type LeaveInput = z.input<typeof zLeaveInput>;

/** PUT /leaves/:id (single employee record). */
export const zLeaveUpdate = z
  .object({
    leaveTypeId: z.number().int().positive(),
    from: zDate,
    to: zDate,
    part: zLeavePart,
    reason: zOptionalText(300),
  })
  .refine((l) => l.to >= l.from, { path: ['to'], message: 'Must be on or after the start date' })
  .refine((l) => l.part === 'full' || l.from === l.to, { path: ['part'], message: 'Half days are for a single date' });
export type LeaveUpdate = z.input<typeof zLeaveUpdate>;

export const zLeave = z.object({
  id: z.number().int(),
  employeeId: z.number().int(),
  empCode: z.string(),
  employeeName: z.string(),
  wingName: z.string().nullable(),
  leaveTypeId: z.number().int(),
  leaveTypeName: z.string(),
  leaveTypeCode: z.string(),
  leaveTypeColor: z.string(),
  from: z.string(),
  to: z.string(),
  part: zLeavePart,
  /** Working days in the range (excludes weekends/holidays per the employee's timings). Half day = 0.5. */
  workingDays: z.number(),
  reason: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: zIsoDateTime,
});
export type Leave = z.infer<typeof zLeave>;

/** GET /leaves -> Page<Leave>. Returns leaves that overlap [from, to]. Sort keys: from, employee, type. */
export const zLeaveQuery = zPageQuery.extend({
  employeeId: z.coerce.number().int().positive().optional(),
  wingId: z.coerce.number().int().positive().optional(),
  leaveTypeId: z.coerce.number().int().positive().optional(),
  from: zDate.optional(),
  to: zDate.optional(),
  q: z.string().trim().optional(),
});
export type LeaveQuery = z.input<typeof zLeaveQuery>;

// ---------- Corrections ----------
/**
 * POST /attendance/corrections. Original punches are never edited.
 * add_punch: a manual punch at `time` on `date` (e.g. forgot to punch out).
 * set_status: override the computed status for that day (e.g. official meeting outside office).
 */
export const zCorrectionInput = z
  .object({
    employeeId: z.number().int().positive(),
    date: zDate,
    type: z.enum(['add_punch', 'set_status']),
    time: zTime.optional(),
    status: z.enum(['present', 'absent', 'half_day']).optional(),
    reason: z.string().trim().min(3, 'Give a reason').max(300),
  })
  .refine((c) => c.type !== 'add_punch' || !!c.time, { path: ['time'], message: 'Time is required' })
  .refine((c) => c.type !== 'set_status' || !!c.status, { path: ['status'], message: 'Choose a status' });
export type CorrectionInput = z.input<typeof zCorrectionInput>;

export const zCorrection = z.object({
  id: z.number().int(),
  employeeId: z.number().int(),
  date: z.string(),
  type: z.enum(['add_punch', 'set_status']),
  time: z.string().nullable(),
  status: z.string().nullable(),
  reason: z.string(),
  createdBy: z.string().nullable(),
  createdAt: zIsoDateTime,
});
export type Correction = z.infer<typeof zCorrection>;

// ---------- Daily status ----------
/**
 * present    : arrived on time and stayed (or day not over yet but arrived on time)
 * late       : first punch after start + grace
 * half_day   : worked less than halfDayBelowMinutes, or half-day leave without the other half worked
 * incomplete : only one punch on a finished day (missing in or out)
 * absent     : working day, no punch, no leave, day over
 * leave      : full-day leave (see `leave`)
 * holiday    : office holiday
 * weekend    : day off per timings
 * pending    : today/future working day with no punch yet (not counted as absent until the day ends)
 * inactive   : before join date, or employee disabled/left on that date
 * `earlyLeave` / `lateMinutes` etc. are flags alongside the main status.
 */
export const DAY_STATUSES = ['present', 'late', 'half_day', 'incomplete', 'absent', 'leave', 'holiday', 'weekend', 'pending', 'inactive'] as const;
export const zDayStatus = z.enum(DAY_STATUSES);
export type DayStatus = z.infer<typeof zDayStatus>;
export const DAY_STATUS_LABEL: Record<DayStatus, string> = {
  present: 'Present',
  late: 'Late',
  half_day: 'Half day',
  incomplete: 'Missing punch',
  absent: 'Absent',
  leave: 'On leave',
  holiday: 'Holiday',
  weekend: 'Weekend',
  pending: 'Not in yet',
  inactive: 'Inactive',
};
/** One-letter codes for monthly registers. */
export const DAY_STATUS_CODE: Record<DayStatus, string> = {
  present: 'P',
  late: 'L',
  half_day: 'H',
  incomplete: 'M',
  absent: 'A',
  leave: 'LV',
  holiday: 'HD',
  weekend: 'W',
  pending: '-',
  inactive: '',
};

export const zAttendanceDay = z.object({
  employeeId: z.number().int(),
  empCode: z.string(),
  name: z.string(),
  wingName: z.string().nullable(),
  sectionName: z.string().nullable(),
  designation: z.string().nullable(),
  hasPhoto: z.boolean(),
  date: z.string(),
  status: zDayStatus,
  earlyLeave: z.boolean(),
  lateMinutes: z.number().int(),
  earlyMinutes: z.number().int(),
  /** "HH:mm" device-local, null when none. */
  firstIn: z.string().nullable(),
  lastOut: z.string().nullable(),
  workedMinutes: z.number().int(),
  punchCount: z.number().int(),
  leave: z
    .object({ leaveId: z.number().int(), typeName: z.string(), code: z.string(), color: z.string(), part: zLeavePart })
    .nullable(),
  holiday: z.object({ name: z.string() }).nullable(),
  timing: z.object({ profileName: z.string(), start: z.string(), end: z.string() }).nullable(),
  /** True when a correction affected this day. */
  corrected: z.boolean(),
});
export type AttendanceDay = z.infer<typeof zAttendanceDay>;

/** GET /attendance/daily?date=YYYY-MM-DD -> Page<AttendanceDay> (every employee in scope, incl. absent). */
export const zDailyQuery = zPageQuery.extend({
  date: zDate,
  wingId: z.coerce.number().int().positive().optional(),
  sectionId: z.coerce.number().int().positive().optional(),
  status: zDayStatus.optional(),
  q: z.string().trim().optional(),
});
export type DailyQuery = z.input<typeof zDailyQuery>;

/** GET /attendance/days?employeeId&from&to -> AttendanceDay[] for one employee (max 400 days). */
export const zEmployeeDaysQuery = z.object({
  employeeId: z.coerce.number().int().positive(),
  from: zDate,
  to: zDate,
});

/** GET /attendance/day-summary?from&to&wingId -> counts per status over the range (employee-days). */
export const zDaySummary = z.object({
  from: z.string(),
  to: z.string(),
  employees: z.number().int(),
  counts: z.record(zDayStatus, z.number().int()),
  /** Present + late + half_day + leave types that count as present, over expected working employee-days. */
  attendanceRate: z.number(),
  punctualityRate: z.number(),
});
export type DaySummary = z.infer<typeof zDaySummary>;

/** POST /attendance/recompute {from, to} -> 202 { queuedDays }. Requires timings.manage. */
export const zRecomputeInput = z.object({ from: zDate, to: zDate });
