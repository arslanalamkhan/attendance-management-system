import { Building2, CalendarDays, CalendarOff, Clock3, Fingerprint, IdCard, Table2, UserX, type LucideIcon } from 'lucide-react';
import type { ReportType } from '@nacta/shared';
import type { ReportParamKey } from '../../lib/report-ui';

export const REPORT_ICON: Record<ReportType, LucideIcon> = {
  daily: CalendarDays,
  monthly_register: Table2,
  late_comers: Clock3,
  absentees: UserX,
  wing_summary: Building2,
  time_card: IdCard,
  leave: CalendarOff,
  punch_log: Fingerprint,
};

/** Short names of the inputs a report needs, for the gallery cards. */
export const PARAM_NAME: Record<ReportParamKey, string> = {
  date: 'Date',
  month: 'Month',
  from: 'Period',
  to: 'Period',
  wingId: 'Wing',
  sectionId: 'Section',
  employeeId: 'Employee',
  deviceId: 'Device',
  leaveTypeId: 'Leave type',
  status: 'Status',
  minLateMinutes: 'Min. minutes late',
};

/** The names shown on a gallery card: from/to collapse into one "Period". */
export function paramNames(keys: readonly ReportParamKey[]): string[] {
  const out: string[] = [];
  for (const k of keys) {
    const n = PARAM_NAME[k];
    if (!out.includes(n)) out.push(n);
  }
  return out;
}
