import { z } from 'zod';
import {
  endpoints,
  zAttendanceDay,
  zCorrection,
  zDaySummary,
  zHoliday,
  zLeave,
  zLeaveType,
  zPage,
  zTimingAssignment,
  zTimingProfile,
  zTimingSetupStatus,
} from '@nacta/shared';
import type {
  AttendanceDay,
  Correction,
  CorrectionInput,
  DailyQuery,
  DaySummary,
  Holiday,
  HolidayInput,
  Leave,
  LeaveInput,
  LeaveQuery,
  LeaveType,
  LeaveTypeInput,
  LeaveUpdate,
  Page,
  TimingAssignment,
  TimingAssignmentInput,
  TimingProfile,
  TimingProfileInput,
  TimingProfileUpdate,
} from '@nacta/shared';
import { api } from '../api';

// ---- daily attendance
export const listDaily = (query: DailyQuery, signal?: AbortSignal) =>
  api.get<Page<AttendanceDay>>(endpoints.attendanceDaily(), { query, signal, schema: zPage(zAttendanceDay) });

export const listEmployeeDays = (query: { employeeId: number; from: string; to: string }, signal?: AbortSignal) =>
  api.get<AttendanceDay[]>(endpoints.attendanceDays(), { query, signal, schema: z.array(zAttendanceDay) });

export const getDaySummary = (query: { from: string; to: string; wingId?: number }, signal?: AbortSignal) =>
  api.get<DaySummary>(endpoints.attendanceDaySummary(), { query, signal, schema: zDaySummary });

export const recomputeAttendance = (input: { from: string; to: string }) =>
  api.post<{ queuedDays: number }>(endpoints.attendanceRecompute(), input);

// ---- corrections
export const listCorrections = (query: { employeeId: number; from: string; to: string }, signal?: AbortSignal) =>
  api.get<Correction[]>(endpoints.attendanceCorrections(), { query, signal, schema: z.array(zCorrection) });
export const createCorrection = (input: CorrectionInput) => api.post<Correction>(endpoints.attendanceCorrections(), input, { schema: zCorrection });
export const deleteCorrection = (id: number) => api.delete<void>(endpoints.attendanceCorrection(id));

// ---- leave
export const listLeaves = (query: LeaveQuery, signal?: AbortSignal) => api.get<Page<Leave>>(endpoints.leaves(), { query, signal, schema: zPage(zLeave) });
export const createLeaves = (input: LeaveInput) => api.post<Leave[]>(endpoints.leaves(), input, { schema: z.array(zLeave) });
export const updateLeave = (id: number, input: LeaveUpdate) => api.put<Leave>(endpoints.leave(id), input, { schema: zLeave });
export const deleteLeave = (id: number) => api.delete<void>(endpoints.leave(id));

export const listLeaveTypes = (signal?: AbortSignal) => api.get<LeaveType[]>(endpoints.leaveTypes(), { signal, schema: z.array(zLeaveType) });
export const createLeaveType = (input: LeaveTypeInput) => api.post<LeaveType>(endpoints.leaveTypes(), input, { schema: zLeaveType });
export const updateLeaveType = (id: number, input: LeaveTypeInput) => api.put<LeaveType>(endpoints.leaveType(id), input, { schema: zLeaveType });

// ---- holidays
export const listHolidays = (query?: { year?: number }, signal?: AbortSignal) =>
  api.get<Holiday[]>(endpoints.holidays(), { query, signal, schema: z.array(zHoliday) });
export const createHoliday = (input: HolidayInput) => api.post<Holiday>(endpoints.holidays(), input, { schema: zHoliday });
export const updateHoliday = (id: number, input: HolidayInput) => api.put<Holiday>(endpoints.holiday(id), input, { schema: zHoliday });
export const deleteHoliday = (id: number) => api.delete<void>(endpoints.holiday(id));

// ---- timings
export const listTimings = (signal?: AbortSignal) => api.get<TimingProfile[]>(endpoints.timings(), { signal, schema: z.array(zTimingProfile) });
export const createTiming = (input: TimingProfileInput) => api.post<TimingProfile>(endpoints.timings(), input, { schema: zTimingProfile });
export const updateTiming = (id: number, input: TimingProfileUpdate) => api.put<TimingProfile>(endpoints.timing(id), input, { schema: zTimingProfile });
export const deleteTiming = (id: number) => api.delete<void>(endpoints.timing(id));
export const makeTimingDefault = (id: number) => api.post<TimingProfile>(`${endpoints.timing(id)}/default`);

/** GET /timings/setup-status -> { configured } (true once a user has saved the default profile). */
export const getTimingSetupStatus = (signal?: AbortSignal) =>
  api.get<{ configured: boolean }>('/timings/setup-status', { signal, schema: zTimingSetupStatus });

export const listAssignments = (signal?: AbortSignal) =>
  api.get<TimingAssignment[]>(endpoints.timingAssignments(), { signal, schema: z.array(zTimingAssignment) });
export const createAssignment = (input: TimingAssignmentInput) =>
  api.post<TimingAssignment>(endpoints.timingAssignments(), input, { schema: zTimingAssignment });
/** Only for assignments that have not started yet (server: 400 on effectiveFrom otherwise). */
export const deleteAssignment = (id: number) => api.delete<void>(endpoints.timingAssignment(id));
/**
 * End an assignment that has started, or move its end date (never earlier than yesterday), or make it
 * open-ended again (null). Days before the new end keep their timings.
 */
export const setAssignmentEnd = (id: number, effectiveTo: string | null) =>
  api.patch<TimingAssignment>(endpoints.timingAssignment(id), { effectiveTo }, { schema: zTimingAssignment });
