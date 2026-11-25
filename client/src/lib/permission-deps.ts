import type { Permission } from '@nacta/shared';

/**
 * Soft dependencies between permissions: holding the key on the left is rarely useful without the
 * ones on the right (e.g. you cannot edit employees you cannot see). The role editor SUGGESTS the
 * missing ones with a one-click add; it never toggles anything by itself.
 */
export const PERMISSION_REQUIRES: Partial<Record<Permission, Permission[]>> = {
  'employees.manage': ['employees.view'],
  'employees.push': ['employees.view', 'devices.view'],
  'employees.biometrics': ['employees.view'],
  'employees.import': ['employees.view', 'employees.manage'],
  'wings.manage': ['employees.view'],
  'attendance.correct': ['attendance.view'],
  'leave.manage': ['attendance.view', 'employees.view'],
  'holidays.manage': ['attendance.view'],
  'timings.manage': ['attendance.view'],
  'devices.manage': ['devices.view'],
  'devices.command': ['devices.view'],
  'devices.users': ['devices.view', 'employees.view'],
};

/** Dependencies of `key` that are not in `selected`. */
export function missingDependencies(key: Permission, selected: ReadonlySet<Permission>): Permission[] {
  return (PERMISSION_REQUIRES[key] ?? []).filter((d) => !selected.has(d));
}

