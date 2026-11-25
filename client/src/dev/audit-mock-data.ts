/**
 * DEV-ONLY in-memory audit trail for the mock API (see auth-mock.ts). About 300 varied entries across every
 * category, deterministic so screens look the same on every reload. Never imported by production code.
 */
import { AUDIT_ACTIONS, PERMISSION_KEYS } from '@nacta/shared';
import type { AuditAction, AuditChange, AuditEntityType, AuditEntry, AuditOutcome } from '@nacta/shared';

export const MOCK_EMPLOYEES = [
  { id: 273, empCode: '777', name: 'Arslan Alam Khan', departmentId: 1, departmentName: 'Operations Wing', designation: 'Deputy Director' },
  { id: 274, empCode: '778', name: 'Mehwish Siddiqui', departmentId: 2, departmentName: 'Intelligence Wing', designation: 'Analyst' },
  { id: 275, empCode: '1021', name: 'Tariq Mahmood', departmentId: 4, departmentName: 'Administration Wing', designation: 'Office Superintendent' },
  { id: 276, empCode: '1022', name: 'Nimra Aslam', departmentId: 3, departmentName: 'Policy & Research Wing', designation: 'Research Officer' },
  { id: 277, empCode: '1044', name: 'Kamran Yousaf', departmentId: 5, departmentName: 'Finance Wing', designation: 'Accounts Officer' },
  { id: 278, empCode: '1051', name: 'Saima Rehman', departmentId: 1, departmentName: 'Operations Wing', designation: 'Section Officer' },
  { id: 279, empCode: '1108', name: 'Faisal Qureshi', departmentId: 2, departmentName: 'Intelligence Wing', designation: 'Senior Analyst' },
  { id: 280, empCode: '1130', name: 'Ayesha Bukhari', departmentId: 4, departmentName: 'Administration Wing', designation: 'Personal Assistant' },
] as const;

export const MOCK_DEVICES = [
  { id: 1, name: 'Attendance Basement', serialNumber: 'CKQ7230100451', location: 'Basement lobby', ipAddress: '192.168.10.21', status: 'online' as const },
  { id: 2, name: 'Main Gate Terminal', serialNumber: 'CKQ7230100452', location: 'Main gate', ipAddress: '192.168.10.22', status: 'online' as const },
  { id: 3, name: 'Admin Block Entrance', serialNumber: 'CKQ7230100457', location: 'Admin block, ground floor', ipAddress: '192.168.10.27', status: 'offline' as const },
];

const ACTORS = [
  { id: 1, name: 'Super Admin', email: 'admin@nacta.gov.pk', ip: '192.168.1.10', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
  { id: 2, name: 'Hira Malik', email: 'hira.malik@nacta.gov.pk', ip: '192.168.1.42', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0' },
  { id: 3, name: 'Bilal Ahmed', email: 'bilal.ahmed@nacta.gov.pk', ip: '192.168.1.77', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0' },
  { id: 5, name: 'Omar Farooq', email: 'omar.farooq@nacta.gov.pk', ip: '192.168.1.31', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15' },
  { id: 6, name: 'Zainab Raza', email: 'zainab.raza@nacta.gov.pk', ip: '10.0.4.23', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
  { id: 7, name: 'Hamza Tariq', email: 'limited@nacta.gov.pk', ip: '192.168.1.60', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
];

const ATTACKER_IPS = ['203.99.61.14', '39.51.88.140', '182.185.10.77', '119.160.71.5'];
const SCAN_UA = 'curl/8.4.0';

const PAGES: { path: string; title: string; perm?: string }[] = [
  { path: '/', title: 'Dashboard' },
  { path: '/employees', title: 'Employees' },
  { path: '/attendance', title: 'Attendance records' },
  { path: '/devices', title: 'Devices' },
  { path: '/diagnostics', title: 'Device log' },
  { path: '/admin/users', title: 'Users' },
  { path: '/admin/roles', title: 'Roles' },
  { path: '/admin/audit', title: 'Audit log' },
];

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Draft = Omit<AuditEntry, 'id' | 'at' | 'category' | 'requestId'> & { at: number };

export function buildMockAudit(count = 300): AuditEntry[] {
  const rnd = mulberry32(20261124);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join('');
  const now = Date.now();
  const drafts: Draft[] = [];

  /** Business-hours-weighted timestamp in the last `days` days. */
  const when = (days: number) => {
    const d = new Date(now - Math.floor(rnd() * days) * 86_400_000);
    d.setHours(7 + Math.floor(rnd() * rnd() * 13) + Math.floor(rnd() * 3), Math.floor(rnd() * 60), Math.floor(rnd() * 60), 0);
    if (d.getTime() > now) d.setTime(now - Math.floor(rnd() * 3_600_000));
    return d.getTime();
  };

  const base = (action: AuditAction, who: (typeof ACTORS)[number] | null, over: Partial<Draft> & { summary: string }): Draft => ({
    at: when(34),
    userId: who?.id ?? null,
    userEmail: who?.email ?? null,
    userName: who?.name ?? null,
    action,
    outcome: 'success',
    entityType: null,
    entityId: null,
    entityLabel: null,
    changes: null,
    metadata: null,
    ip: who?.ip ?? null,
    userAgent: who?.ua ?? null,
    ...over,
  });

  const emp = () => pick(MOCK_EMPLOYEES);
  const empLabel = (e: (typeof MOCK_EMPLOYEES)[number]) => `${e.empCode} · ${e.name}`;
  const admins = [ACTORS[0]!, ACTORS[1]!, ACTORS[2]!];

  const makers: (() => Draft)[] = [
    // ---- page views (the bulk)
    ...Array.from({ length: 14 }, () => () => {
      const who = pick(ACTORS);
      const page = pick(PAGES);
      return base('view.page', who, {
        summary: `Viewed ${page.title}`,
        entityType: 'page',
        entityId: page.path,
        entityLabel: page.title,
        metadata: { path: page.path, title: page.title, ...(page.path === '/attendance' ? { query: { from: '2026-11-17', to: '2026-11-23' } } : {}) },
      });
    }),
    ...Array.from({ length: 5 }, () => () => {
      const who = pick(ACTORS);
      const e = emp();
      return base('view.page', who, {
        summary: `Viewed employee profile ${empLabel(e)}`,
        entityType: 'employee',
        entityId: String(e.id),
        entityLabel: empLabel(e),
        metadata: { path: `/employees/${e.id}`, title: 'Employee profile' },
      });
    }),
    () => {
      const who = pick(ACTORS);
      const d = pick(MOCK_DEVICES);
      return base('view.page', who, { summary: `Viewed device ${d.name}`, entityType: 'device', entityId: String(d.id), entityLabel: d.name, metadata: { path: `/devices/${d.id}`, title: 'Device' } });
    },
    // ---- sign-in
    ...Array.from({ length: 5 }, () => () => {
      const who = pick(ACTORS);
      return base('auth.login', who, { summary: `Signed in from ${who.ip}`, entityType: 'user', entityId: String(who.id), entityLabel: `${who.name} · ${who.email}`, metadata: { method: 'password', sessionLifetimeHours: 12 } });
    }),
    ...Array.from({ length: 3 }, () => () => {
      const who = pick(ACTORS);
      return base('auth.logout', who, { summary: 'Signed out', entityType: 'user', entityId: String(who.id), entityLabel: `${who.name} · ${who.email}`, metadata: { reason: rnd() > 0.7 ? 'idle timeout' : 'user request' } });
    }),
    // failed sign-ins: unknown email (anonymous) or a known account
    ...Array.from({ length: 3 }, () => () => {
      const ip = pick(ATTACKER_IPS);
      const email = pick(['admin@nacta.gov.pk.com', 'administrator@nacta.gov.pk', 'test@nacta.gov.pk', 'root@nacta.gov.pk', 'a.khan@gmail.com']);
      return base('auth.login_failed', null, { outcome: 'failure', summary: `Sign-in failed for ${email}: no such account`, entityType: 'user', entityId: null, entityLabel: email, ip, userAgent: rnd() > 0.5 ? SCAN_UA : ACTORS[1]!.ua, metadata: { reason: 'unknown_account', attemptedEmail: email } });
    }),
    ...Array.from({ length: 3 }, () => () => {
      const who = pick(ACTORS.slice(1));
      const attempt = 1 + Math.floor(rnd() * 4);
      return base('auth.login_failed', who, { outcome: 'failure', summary: `Wrong password for ${who.email} (attempt ${attempt} of 5)`, entityType: 'user', entityId: String(who.id), entityLabel: `${who.name} · ${who.email}`, metadata: { reason: 'wrong_password', attempt, maxAttempts: 5 } });
    }),
    () => {
      const who = ACTORS[2]!;
      return base('auth.locked', who, { outcome: 'failure', summary: `${who.email} locked for 15 minutes after 5 failed sign-ins`, entityType: 'user', entityId: String(who.id), entityLabel: `${who.name} · ${who.email}`, metadata: { failedAttempts: 5, lockedMinutes: 15 } });
    },
    () => {
      const who = pick(ACTORS);
      return base('auth.password_changed', who, { summary: 'Changed own password', entityType: 'user', entityId: String(who.id), entityLabel: `${who.name} · ${who.email}`, changes: [{ field: 'password', before: '[redacted]', after: '[redacted]' }], metadata: { revokedOtherSessions: 2 } });
    },
    () => {
      const who = pick(ACTORS);
      return base('auth.session_revoked', who, { summary: 'Ended a session on Edge 130 (Windows)', entityType: 'session', entityId: 's-edge', entityLabel: 'Edge 130 on Windows', metadata: { sessionId: 's-edge', lastSeenIp: '192.168.1.24' } });
    },
    // ---- employees
    ...Array.from({ length: 3 }, () => () => {
      const who = pick(admins);
      const e = emp();
      return base('employee.update', who, {
        summary: `Edited ${empLabel(e)}: changed wing and designation`,
        entityType: 'employee',
        entityId: String(e.id),
        entityLabel: empLabel(e),
        changes: [
          { field: 'departmentName', before: 'Operations Wing', after: e.departmentName },
          { field: 'designation', before: 'Section Officer', after: e.designation },
          { field: 'phone', before: null, after: '+92 300 5551234' },
        ],
        metadata: { fieldsChanged: 3 },
      });
    }),
    () => {
      const who = pick(admins);
      const e = emp();
      return base('employee.update', who, { summary: `Edited ${empLabel(e)}: device password changed`, entityType: 'employee', entityId: String(e.id), entityLabel: empLabel(e), changes: [{ field: 'devicePassword', before: '[redacted]', after: '[redacted]' }, { field: 'isActive', before: false, after: true }] });
    },
    () => {
      const who = pick(admins);
      const e = emp();
      return base('employee.create', who, { summary: `Added employee ${empLabel(e)}`, entityType: 'employee', entityId: String(e.id), entityLabel: empLabel(e), changes: [{ field: 'empCode', before: null, after: e.empCode }, { field: 'name', before: null, after: e.name }, { field: 'departmentName', before: null, after: e.departmentName }], metadata: { source: 'manual' } });
    },
    () => {
      const who = pick(admins);
      return base('employee.delete', who, { summary: 'Deleted employee 1099 · Shahid Latif', entityType: 'employee', entityId: '299', entityLabel: '1099 · Shahid Latif', metadata: { removedFromDevices: true, devicesAffected: 3 } });
    },
    ...Array.from({ length: 2 }, () => () => {
      const who = pick(admins);
      const e = emp();
      return base('employee.push', who, { summary: `Sent ${empLabel(e)} to 3 devices`, entityType: 'employee', entityId: String(e.id), entityLabel: empLabel(e), metadata: { devices: ['Attendance Basement', 'Main Gate Terminal', 'Admin Block Entrance'], queued: 3 } });
    }),
    () => base('department.create', ACTORS[0]!, { summary: 'Created wing “Training Wing”', entityType: 'department', entityId: '6', entityLabel: 'Training Wing', changes: [{ field: 'name', before: null, after: 'Training Wing' }] }),
    () => base('department.update', ACTORS[1]!, { summary: 'Renamed wing “Admin” to “Administration Wing”', entityType: 'department', entityId: '4', entityLabel: 'Administration Wing', changes: [{ field: 'name', before: 'Admin', after: 'Administration Wing' }] }),
    () => base('department.delete', ACTORS[0]!, { summary: 'Deleted wing “Temporary Cell”', entityType: 'department', entityId: '9', entityLabel: 'Temporary Cell', metadata: { employeesMoved: 0 } }),
    // ---- devices
    () => {
      const d = pick(MOCK_DEVICES);
      return base('device.create', ACTORS[0]!, { summary: `Added device ${d.name}`, entityType: 'device', entityId: String(d.id), entityLabel: d.name, changes: [{ field: 'name', before: null, after: d.name }, { field: 'serialNumber', before: null, after: d.serialNumber }, { field: 'location', before: null, after: d.location }] });
    },
    ...Array.from({ length: 2 }, () => () => {
      const d = pick(MOCK_DEVICES);
      return base('device.update', pick(admins), { summary: `Edited device ${d.name}: moved to a new location`, entityType: 'device', entityId: String(d.id), entityLabel: d.name, changes: [{ field: 'location', before: 'Store room', after: d.location }, { field: 'isActive', before: false, after: true }] });
    }),
    () => base('device.delete', ACTORS[0]!, { summary: 'Deleted device Old Reception Unit', entityType: 'device', entityId: '9', entityLabel: 'Old Reception Unit', metadata: { serialNumber: 'CKQ7230100399' } }),
    ...Array.from({ length: 4 }, () => () => {
      const d = pick(MOCK_DEVICES);
      const cmd = pick(['reboot', 'info', 'check', 'syncTime']);
      return base('device.command', pick([ACTORS[0]!, ACTORS[3]!]), { summary: `Sent ${cmd} to ${d.name}`, entityType: 'device', entityId: String(d.id), entityLabel: d.name, outcome: cmd === 'reboot' && rnd() > 0.8 ? 'failure' : 'success', metadata: { command: cmd, commandId: 1000 + Math.floor(rnd() * 900) } });
    }),
    () => {
      const d = pick(MOCK_DEVICES);
      return base('device_users.fetch', ACTORS[3]!, { summary: `Requested users from ${d.name}`, entityType: 'device', entityId: String(d.id), entityLabel: d.name, metadata: { queued: true } });
    },
    () => {
      const d = pick(MOCK_DEVICES);
      return base('device_users.import', ACTORS[1]!, { summary: `Imported 12 device users from ${d.name} as employees`, entityType: 'device', entityId: String(d.id), entityLabel: d.name, metadata: { imported: 12, skipped: 3, departmentId: 4 } });
    },
    () => {
      const d = pick(MOCK_DEVICES);
      return base('device_users.remove', ACTORS[3]!, { summary: `Removed PIN 1099 from ${d.name}`, entityType: 'device', entityId: String(d.id), entityLabel: d.name, metadata: { pin: '1099' } });
    },
    // ---- administration
    () => base('user.create', ACTORS[0]!, { summary: 'Created user omar.farooq@nacta.gov.pk', entityType: 'user', entityId: '5', entityLabel: 'Omar Farooq · omar.farooq@nacta.gov.pk', changes: [{ field: 'name', before: null, after: 'Omar Farooq' }, { field: 'roles', before: [], after: ['Terminal Technician'] }, { field: 'password', before: null, after: '[redacted]' }], metadata: { mustChangePassword: true } }),
    ...Array.from({ length: 2 }, () => () =>
      base('user.update', ACTORS[0]!, { summary: 'Edited Hira Malik: changed roles', entityType: 'user', entityId: '2', entityLabel: 'Hira Malik · hira.malik@nacta.gov.pk', changes: [{ field: 'roles', before: ['HR Officer'], after: ['HR Officer', 'Wing Coordinator'] }] }),
    ),
    () => base('user.update', ACTORS[0]!, { summary: 'Disabled Sana Iqbal', entityType: 'user', entityId: '4', entityLabel: 'Sana Iqbal · sana.iqbal@nacta.gov.pk', changes: [{ field: 'status', before: 'active', after: 'disabled' }], metadata: { sessionsRevoked: 1 } }),
    () => base('user.delete', ACTORS[0]!, { summary: 'Deleted user old.clerk@nacta.gov.pk', entityType: 'user', entityId: '40', entityLabel: 'Old Clerk · old.clerk@nacta.gov.pk' }),
    ...Array.from({ length: 2 }, () => () => base('user.reset_password', ACTORS[0]!, { summary: 'Reset the password for Bilal Ahmed', entityType: 'user', entityId: '3', entityLabel: 'Bilal Ahmed · bilal.ahmed@nacta.gov.pk', changes: [{ field: 'password', before: '[redacted]', after: '[redacted]' }], metadata: { mustChangePassword: true, sessionsRevoked: 0 } })),
    () => base('user.unlock', ACTORS[0]!, { summary: 'Unlocked Bilal Ahmed', entityType: 'user', entityId: '3', entityLabel: 'Bilal Ahmed · bilal.ahmed@nacta.gov.pk', metadata: { lockedUntil: new Date(now - 3_600_000).toISOString() } }),
    () => base('user.revoke_sessions', ACTORS[0]!, { summary: 'Signed Zainab Raza out of 2 sessions', entityType: 'user', entityId: '6', entityLabel: 'Zainab Raza · zainab.raza@nacta.gov.pk', metadata: { revoked: 2 } }),
    () => base('role.create', ACTORS[0]!, { summary: 'Created role “Auditor”', entityType: 'role', entityId: '5', entityLabel: 'Auditor', changes: [{ field: 'name', before: null, after: 'Auditor' }, { field: 'permissions', before: [], after: ['audit.view', 'attendance.view'] }, { field: 'allWings', before: null, after: true }] }),
    ...Array.from({ length: 2 }, (_, i) => () =>
      base('role.update', ACTORS[0]!, {
        summary: i === 0 ? 'Edited role “Wing Coordinator”: 2 permissions added, 1 removed' : 'Edited role “Terminal Technician”: permissions and description',
        entityType: 'role',
        entityId: i === 0 ? '3' : '4',
        entityLabel: i === 0 ? 'Wing Coordinator' : 'Terminal Technician',
        changes:
          i === 0
            ? [
                { field: 'permissions', before: ['dashboard.view', 'employees.view', 'attendance.view', 'devices.view'], after: ['dashboard.view', 'employees.view', 'attendance.view', 'attendance.export', 'employees.export'] },
                { field: 'wingIds', before: [1], after: [1, 2] },
              ]
            : [
                { field: 'description', before: 'Looks after terminals.', after: 'Looks after the attendance terminals.' },
                { field: 'permissions', before: ['devices.view', 'devices.manage', 'devices.command'], after: ['devices.view', 'devices.manage', 'devices.command', 'devices.users', 'diagnostics.view'] },
              ],
        metadata: { usersAffected: i === 0 ? 2 : 1 },
      }),
    ),
    () => base('role.delete', ACTORS[0]!, { summary: 'Deleted role “Intern Viewer”', entityType: 'role', entityId: '8', entityLabel: 'Intern Viewer', changes: [{ field: 'permissions', before: ['dashboard.view', 'employees.view'], after: [] }] }),
    // ---- exports
    ...Array.from({ length: 3 }, () => () => {
      const who = pick([ACTORS[0]!, ACTORS[1]!, ACTORS[2]!]);
      const rows = 120 + Math.floor(rnd() * 2400);
      return base('attendance.export', who, { summary: `Exported ${rows.toLocaleString()} attendance rows (CSV)`, entityType: 'export', entityId: null, entityLabel: 'Attendance export', metadata: { format: 'csv', rows, filters: { from: '2026-11-01', to: '2026-11-23', departmentId: 1 } } });
    }),
    () => base('audit.export', ACTORS[4]!, { summary: 'Exported 214 audit entries (CSV)', entityType: 'export', entityId: null, entityLabel: 'Audit log export', metadata: { format: 'csv', rows: 214, filters: { from: '2026-11-10', to: '2026-11-17', category: 'security' } } }),
    // ---- denied and safety nets
    ...Array.from({ length: 5 }, () => () => {
      const who = pick([ACTORS[1]!, ACTORS[3]!, ACTORS[5]!, ACTORS[2]!]);
      const target = pick([
        { perm: 'users.manage', path: '/api/v1/users', label: 'Users' },
        { perm: 'roles.manage', path: '/api/v1/roles', label: 'Roles' },
        { perm: 'audit.view', path: '/api/v1/audit', label: 'Audit log' },
        { perm: 'settings.manage', path: '/api/v1/settings', label: 'Settings' },
      ]);
      return base('access.denied', who, { outcome: 'denied', summary: `Tried to open ${target.label} without the ${target.perm} permission`, entityType: 'page', entityId: target.path, entityLabel: target.label, metadata: { permission: target.perm, method: 'GET', path: target.path } });
    }),
    () => base('access.denied', null, { outcome: 'denied', summary: 'Request without a session blocked: POST /api/v1/employees', ip: pick(ATTACKER_IPS), userAgent: SCAN_UA, metadata: { reason: 'no_session', method: 'POST', path: '/api/v1/employees' } }),
    ...Array.from({ length: 2 }, () => () => base('api.write', pick(admins), { summary: 'Changed a setting via the API', metadata: { method: 'PUT', path: '/api/v1/settings', status: 200 } })),
  ];

  // Fill to `count` by cycling the makers (page views repeat most, as in real life).
  for (let i = 0; i < count; i++) {
    const maker = i < makers.length ? makers[i]! : makers[Math.floor(rnd() * makers.length)]!;
    drafts.push(maker());
  }
  // Make sure the last day has some security-relevant activity to look at.
  const recent = [
    base('auth.login_failed', null, { outcome: 'failure', at: now - 11 * 60_000, ip: ATTACKER_IPS[0]!, userAgent: SCAN_UA, entityType: 'user', entityLabel: 'admin@nacta.gov.pk.com', summary: 'Sign-in failed for admin@nacta.gov.pk.com: no such account', metadata: { reason: 'unknown_account' } }),
    base('access.denied', ACTORS[5]!, { outcome: 'denied', at: now - 38 * 60_000, entityType: 'page', entityId: '/api/v1/users', entityLabel: 'Users', summary: 'Tried to open Users without the users.manage permission', metadata: { permission: 'users.manage', method: 'GET', path: '/api/v1/users' } }),
    base('auth.locked', ACTORS[2]!, { outcome: 'failure', at: now - 95 * 60_000, entityType: 'user', entityId: '3', entityLabel: 'Bilal Ahmed · bilal.ahmed@nacta.gov.pk', summary: 'bilal.ahmed@nacta.gov.pk locked for 15 minutes after 5 failed sign-ins', metadata: { failedAttempts: 5, lockedMinutes: 15 } }),
    base('role.update', ACTORS[0]!, {
      at: now - 20 * 60_000,
      entityType: 'role',
      entityId: '2',
      entityLabel: 'HR Officer',
      summary: 'Edited role “HR Officer”: 3 permissions added, 1 removed',
      changes: [
        { field: 'permissions', before: ['dashboard.view', 'employees.view', 'employees.manage', 'attendance.view', 'departments.manage', 'employees.push'], after: ['dashboard.view', 'employees.view', 'employees.manage', 'attendance.view', 'departments.manage', 'attendance.export', 'devices.view', 'diagnostics.view'] },
        { field: 'description', before: null, after: 'Maintains the employee directory and pushes people to terminals.' },
      ],
      metadata: { usersAffected: 1 },
    }),
  ];
  drafts.push(...recent);

  void PERMISSION_KEYS;
  return drafts
    .sort((a, b) => a.at - b.at)
    .map((d, i): AuditEntry => {
      const { at, ...rest } = d;
      return { ...rest, id: i + 1, at: new Date(at).toISOString(), category: AUDIT_ACTIONS[d.action].category, requestId: `req_${hex(12)}` };
    });
}

export type AuditDraft = {
  userId: number | null;
  userName: string | null;
  userEmail: string | null;
  action: AuditAction;
  outcome?: AuditOutcome;
  entityType?: AuditEntityType | null;
  entityId?: string | null;
  entityLabel?: string | null;
  summary: string;
  changes?: AuditChange[] | null;
  metadata?: Record<string, unknown> | null;
};
