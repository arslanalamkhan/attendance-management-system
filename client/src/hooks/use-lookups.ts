import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Section, Wing } from '@nacta/shared';
import { listWings } from '../lib/endpoints/wings';
import { listDevices } from '../lib/endpoints/devices';
import { listRoles } from '../lib/endpoints/roles';
import { qk } from '../lib/query-keys';

/** Wings with their sections. Small list, cached for a minute. */
export function useWings() {
  return useQuery({
    queryKey: qk.wings.list(),
    queryFn: ({ signal }) => listWings(signal),
    staleTime: 60_000,
  });
}

/** Sections of one wing (empty when no wing is chosen), derived from the wings list. */
export function useSectionsOf(wingId: number | null | undefined): Section[] {
  const wings = useWings();
  return useMemo(() => (wingId ? (wings.data?.find((w: Wing) => w.id === wingId)?.sections ?? []) : []), [wings.data, wingId]);
}

export function useDevices() {
  return useQuery({
    queryKey: qk.devices.list(),
    queryFn: ({ signal }) => listDevices(signal),
    staleTime: 30_000,
  });
}

/** Roles (the Super Admin builds them). Needed by the user forms and filters. */
export function useRoles(enabled = true) {
  return useQuery({
    queryKey: qk.roles.list(),
    queryFn: ({ signal }) => listRoles(signal),
    staleTime: 30_000,
    enabled,
  });
}
