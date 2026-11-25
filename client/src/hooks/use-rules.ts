import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LeaveType, TimingProfile } from '@nacta/shared';
import { getTimingSetupStatus, listAssignments, listHolidays, listLeaveTypes, listTimings } from '../lib/endpoints/rules';
import { qk } from '../lib/query-keys';
import { useAuth } from '../lib/auth';

/** Leave types, active and inactive. Colours always come from here. */
export function useLeaveTypes(enabled = true) {
  return useQuery({ queryKey: qk.leaveTypes.all, queryFn: ({ signal }) => listLeaveTypes(signal), staleTime: 60_000, enabled });
}

/** Active leave types by id, for colouring. */
export function useLeaveTypeMap() {
  const q = useLeaveTypes();
  const map = useMemo(() => new Map<number, LeaveType>((q.data ?? []).map((t) => [t.id, t])), [q.data]);
  return { ...q, map };
}

export function useHolidays(year?: number, enabled = true) {
  return useQuery({
    queryKey: qk.holidays.year(year ?? 'all'),
    queryFn: ({ signal }) => listHolidays(year ? { year } : undefined, signal),
    staleTime: 60_000,
    enabled,
  });
}

export function useTimings(enabled = true) {
  return useQuery({ queryKey: qk.timings.list(), queryFn: ({ signal }) => listTimings(signal), staleTime: 30_000, enabled });
}

export function useDefaultTiming(enabled = true): TimingProfile | undefined {
  const q = useTimings(enabled);
  return q.data?.find((t) => t.isDefault);
}

export function useAssignments(enabled = true) {
  return useQuery({ queryKey: qk.timings.assignments(), queryFn: ({ signal }) => listAssignments(signal), staleTime: 30_000, enabled });
}

/** Whether a user has saved the office timings yet. Fails soft (undefined) while the server lacks the endpoint. */
export function useTimingSetup() {
  const { canAny } = useAuth();
  const enabled = canAny('attendance.view', 'timings.manage');
  const q = useQuery({ queryKey: qk.timings.setup(), queryFn: ({ signal }) => getTimingSetupStatus(signal), staleTime: 60_000, enabled, retry: false });
  return { configured: q.data?.configured, isLoading: q.isPending && enabled };
}
