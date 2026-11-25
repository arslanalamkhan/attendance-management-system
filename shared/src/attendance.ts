import { z } from 'zod';
import { zDate, zIsoDateTime, zLocalDateTime, zPageQuery } from './common';

/** ZKTeco punch state codes. */
export const PunchStatusLabel: Record<number, string> = {
  0: 'Check-in',
  1: 'Check-out',
  2: 'Break-out',
  3: 'Break-in',
  4: 'Overtime-in',
  5: 'Overtime-out',
};

/** ZKTeco verification method codes. */
export const VerifyTypeLabel: Record<number, string> = {
  0: 'Password',
  1: 'Fingerprint',
  2: 'Card',
  3: 'Password',
  4: 'Card',
  15: 'Face',
  25: 'Palm',
};

export const zAttendanceRecord = z.object({
  id: z.number().int(),
  deviceId: z.number().int(),
  deviceName: z.string(),
  pin: z.string(),
  employeeId: z.number().int().nullable(),
  employeeName: z.string().nullable(),
  wingName: z.string().nullable(),
  sectionName: z.string().nullable(),
  /** Device-local time "YYYY-MM-DD HH:mm:ss". */
  punchTime: zLocalDateTime,
  status: z.number().int().nullable(),
  verifyType: z.number().int().nullable(),
  workCode: z.string().nullable(),
  receivedAt: zIsoDateTime,
});
export type AttendanceRecord = z.infer<typeof zAttendanceRecord>;

/**
 * GET /attendance -> Page<AttendanceRecord>. Default sort punchTime desc.
 * `from`/`to` are inclusive calendar dates in device-local time.
 */
export const zAttendanceQuery = zPageQuery.extend({
  deviceId: z.coerce.number().int().positive().optional(),
  employeeId: z.coerce.number().int().positive().optional(),
  wingId: z.coerce.number().int().positive().optional(),
  sectionId: z.coerce.number().int().positive().optional(),
  pin: z.string().trim().optional(),
  q: z.string().trim().optional(),
  from: zDate.optional(),
  to: zDate.optional(),
});
export type AttendanceQuery = z.input<typeof zAttendanceQuery>;
