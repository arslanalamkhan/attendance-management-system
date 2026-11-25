import { endpoints, zAttendanceRecord, zPage } from '@nacta/shared';
import type { AttendanceQuery, AttendanceRecord, Page } from '@nacta/shared';
import { api } from '../api';

/** GET /attendance -> Page<AttendanceRecord> (default sort punchTime desc) */
export const listAttendance = (query?: AttendanceQuery, signal?: AbortSignal) =>
  api.get<Page<AttendanceRecord>>(endpoints.attendance(), { query, signal, schema: zPage(zAttendanceRecord) });
