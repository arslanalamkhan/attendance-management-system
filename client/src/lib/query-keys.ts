import type {
  AdmsLogQuery,
  AuditQuery,
  AttendanceQuery,
  CommandListQuery,
  DeviceUserListQuery,
  EmployeeListQuery,
  UserListQuery,
} from '@nacta/shared';

/**
 * Query-key factory. All keys start with "v1" (the API version) so they can never collide with
 * the legacy pages' keys. Invalidate a whole area with e.g. `qk.employees.all`.
 */
export const qk = {
  all: ['v1'] as const,
  health: () => ['v1', 'health'] as const,
  overview: () => ['v1', 'overview'] as const,
  dashboard: () => ['v1', 'dashboard'] as const,
  dashboardToday: () => ['v1', 'dashboard', 'today'] as const,
  reports: {
    all: ['v1', 'reports'] as const,
    run: (type: string, q?: object) => ['v1', 'reports', type, q ?? {}] as const,
  },

  devices: {
    all: ['v1', 'devices'] as const,
    list: () => ['v1', 'devices', 'list'] as const,
    detail: (id: number) => ['v1', 'devices', 'detail', id] as const,
    commands: (id: number, q?: CommandListQuery) => ['v1', 'devices', id, 'commands', q ?? {}] as const,
    users: (id: number, q?: DeviceUserListQuery) => ['v1', 'devices', id, 'users', q ?? {}] as const,
  },

  wings: {
    all: ['v1', 'wings'] as const,
    list: () => ['v1', 'wings', 'list'] as const,
  },

  employees: {
    all: ['v1', 'employees'] as const,
    list: (q?: EmployeeListQuery) => ['v1', 'employees', 'list', q ?? {}] as const,
    detail: (id: number) => ['v1', 'employees', 'detail', id] as const,
    biometrics: (id: number) => ['v1', 'employees', 'biometrics', id] as const,
  },

  attendance: {
    all: ['v1', 'attendance'] as const,
    list: (q?: AttendanceQuery) => ['v1', 'attendance', 'list', q ?? {}] as const,
  },

  daily: {
    all: ['v1', 'daily'] as const,
    list: (q?: object) => ['v1', 'daily', 'list', q ?? {}] as const,
    summary: (q?: object) => ['v1', 'daily', 'summary', q ?? {}] as const,
    days: (employeeId: number, from: string, to: string) => ['v1', 'daily', 'days', employeeId, from, to] as const,
    corrections: (employeeId: number, from: string, to: string) => ['v1', 'daily', 'corrections', employeeId, from, to] as const,
  },

  leaves: {
    all: ['v1', 'leaves'] as const,
    list: (q?: object) => ['v1', 'leaves', 'list', q ?? {}] as const,
  },
  leaveTypes: { all: ['v1', 'leave-types'] as const },
  holidays: {
    all: ['v1', 'holidays'] as const,
    year: (y: number | 'all') => ['v1', 'holidays', y] as const,
  },
  timings: {
    all: ['v1', 'timings'] as const,
    list: () => ['v1', 'timings', 'list'] as const,
    setup: () => ['v1', 'timings', 'setup-status'] as const,
    assignments: () => ['v1', 'timings', 'assignments'] as const,
  },

  auth: {
    all: ['v1', 'auth'] as const,
    sessions: () => ['v1', 'auth', 'sessions'] as const,
  },

  roles: {
    all: ['v1', 'roles'] as const,
    list: () => ['v1', 'roles', 'list'] as const,
  },

  users: {
    all: ['v1', 'users'] as const,
    list: (q?: UserListQuery) => ['v1', 'users', 'list', q ?? {}] as const,
  },

  audit: {
    all: ['v1', 'audit'] as const,
    list: (q?: AuditQuery) => ['v1', 'audit', 'list', q ?? {}] as const,
    feed: (q?: AuditQuery) => ['v1', 'audit', 'feed', q ?? {}] as const,
    entry: (id: number) => ['v1', 'audit', 'entry', id] as const,
    summary: (range: { from?: string; to?: string }) => ['v1', 'audit', 'summary', range] as const,
  },

  admsLog: {
    all: ['v1', 'adms-log'] as const,
    list: (q?: AdmsLogQuery) => ['v1', 'adms-log', 'list', q ?? {}] as const,
  },
} as const;

