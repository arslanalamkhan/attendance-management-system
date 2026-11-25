/**
 * DEV-ONLY API mock for the auth, roles, users and permissions endpoints, so the screens can be
 * built and reviewed before the server has them. Enabled with `VITE_AUTH_MOCK=1` in development;
 * main.tsx imports this module behind `import.meta.env.DEV`, so it is never part of a production bundle.
 *
 * Switch persona in the browser address bar, e.g. http://localhost:5174/?mock=limited
 *   ?mock=admin       signed in as Super Admin (default)
 *   ?mock=limited     signed in as a user with a narrow role (dashboard, employees, attendance, devices view)
 *   ?mock=mustchange  signed in but must change the temporary password
 *   ?mock=signedout   no session (login page)
 *   ?mockIdleMin=1    idle timeout of 1 minute (to see the "signed out in ..." dialog after 30 s)
 * Login page: locked@x / disabled@x / rate@x trigger those errors; limited@x and change@x choose a persona;
 * the password "wrong" gives INVALID_CREDENTIALS.
 */
import { API_BASE, PERMISSION_KEYS, zNewPassword, zRoleInput, zUserCreateInput, zUserUpdateInput } from '@nacta/shared';
import { AUDIT_ACTIONS } from '@nacta/shared';
import type { AppUser, AuditEntry, CurrentUser, Device, Overview, Permission, Role, SessionInfo, SessionSummary } from '@nacta/shared';
import { MOCK_DEVICES, buildMockAudit, type AuditDraft } from './audit-mock-data';
import { createEmployeeRoutes, installPhotoMock } from './employees-mock';
import { createRulesRoutes } from './rules-mock';
import { createReportsRoutes } from './reports-mock';

type Persona = 'admin' | 'limited' | 'mustchange';
interface MockState {
  persona: Persona;
  signedIn: boolean;
}

const STORE_KEY = 'nacta-auth-mock';
const CSRF = 'mock-csrf-token';
const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();

// ----------------------------------------------------------------------------- data

let roles: Omit<Role, 'userCount'>[] = [
  { id: 1, name: 'Super Admin', description: null, isSystem: true, permissions: [...PERMISSION_KEYS], allWings: true, wingIds: [], createdAt: iso(20000), updatedAt: iso(20000) },
  {
    id: 2,
    name: 'HR Officer',
    description: 'Maintains the employee directory and pushes people to terminals.',
    isSystem: false,
    permissions: ['dashboard.view', 'employees.view', 'employees.manage', 'employees.push', 'employees.biometrics', 'employees.import', 'wings.manage', 'attendance.view'],
    allWings: true,
    wingIds: [],
    createdAt: iso(5000),
    updatedAt: iso(5000),
  },
  {
    id: 3,
    name: 'Wing Coordinator',
    description: 'Sees attendance for their own wings and exports it.',
    isSystem: false,
    permissions: ['dashboard.view', 'employees.view', 'attendance.view', 'attendance.export'],
    allWings: false,
    wingIds: [1, 2],
    createdAt: iso(4000),
    updatedAt: iso(4000),
  },
  {
    id: 4,
    name: 'Terminal Technician',
    description: 'Looks after the attendance terminals.',
    isSystem: false,
    permissions: ['devices.view', 'devices.manage', 'devices.command', 'devices.users', 'diagnostics.view'],
    allWings: true,
    wingIds: [],
    createdAt: iso(3000),
    updatedAt: iso(3000),
  },
  { id: 5, name: 'Auditor', description: null, isSystem: false, permissions: ['audit.view', 'attendance.view'], allWings: true, wingIds: [], createdAt: iso(2000), updatedAt: iso(2000) },
];

type MockUser = Omit<AppUser, 'roles'> & { roleIds: number[] };
let users: MockUser[] = [
  { id: 1, email: 'admin@nacta.gov.pk', name: 'Super Admin', status: 'active', isSuperAdmin: true, roleIds: [1], mustChangePassword: false, lockedUntil: null, lastLoginAt: iso(3), lastLoginIp: '192.168.1.10', activeSessions: 3, createdAt: iso(20000), updatedAt: iso(3) },
  { id: 2, email: 'hira.malik@nacta.gov.pk', name: 'Hira Malik', status: 'active', isSuperAdmin: false, roleIds: [2], mustChangePassword: false, lockedUntil: null, lastLoginAt: iso(95), lastLoginIp: '192.168.1.42', activeSessions: 1, createdAt: iso(6000), updatedAt: iso(95) },
  { id: 3, email: 'bilal.ahmed@nacta.gov.pk', name: 'Bilal Ahmed', status: 'active', isSuperAdmin: false, roleIds: [3], mustChangePassword: false, lockedUntil: new Date(Date.now() + 12 * 60_000).toISOString(), lastLoginAt: iso(1500), lastLoginIp: '192.168.1.77', activeSessions: 0, createdAt: iso(5000), updatedAt: iso(30) },
  { id: 4, email: 'sana.iqbal@nacta.gov.pk', name: 'Sana Iqbal', status: 'disabled', isSuperAdmin: false, roleIds: [2, 3], mustChangePassword: false, lockedUntil: null, lastLoginAt: iso(20000), lastLoginIp: '192.168.1.15', activeSessions: 0, createdAt: iso(9000), updatedAt: iso(900) },
  { id: 5, email: 'omar.farooq@nacta.gov.pk', name: 'Omar Farooq', status: 'active', isSuperAdmin: false, roleIds: [4], mustChangePassword: true, lockedUntil: null, lastLoginAt: null, lastLoginIp: null, activeSessions: 0, createdAt: iso(60), updatedAt: iso(60) },
  { id: 6, email: 'zainab.raza@nacta.gov.pk', name: 'Zainab Raza', status: 'active', isSuperAdmin: false, roleIds: [5], mustChangePassword: false, lockedUntil: null, lastLoginAt: iso(400), lastLoginIp: '10.0.4.23', activeSessions: 2, createdAt: iso(3000), updatedAt: iso(400) },
  { id: 7, email: 'limited@nacta.gov.pk', name: 'Hamza Tariq', status: 'active', isSuperAdmin: false, roleIds: [3], mustChangePassword: false, lockedUntil: null, lastLoginAt: iso(10), lastLoginIp: '192.168.1.60', activeSessions: 1, createdAt: iso(2500), updatedAt: iso(10) },
];
let nextUserId = 100;
let nextRoleId = 100;

let sessions: SessionSummary[] = [
  { id: 's-current', current: true, ip: '192.168.1.10', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', createdAt: iso(40), lastSeenAt: iso(0), expiresAt: iso(-600) },
  { id: 's-edge', current: false, ip: '192.168.1.24', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0', createdAt: iso(600), lastSeenAt: iso(25), expiresAt: iso(-100) },
  { id: 's-phone', current: false, ip: '39.51.88.140', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', createdAt: iso(2000), lastSeenAt: iso(300), expiresAt: iso(-60) },
];

// ----------------------------------------------------------------------------- audit trail
let audit: AuditEntry[] = buildMockAudit(300);
let nextAuditId = audit.length + 1;

/** Append an entry attributed to whoever is signed in (mirrors what the real server records). */
function record(d: AuditDraft) {
  const entry: AuditEntry = {
    id: nextAuditId++,
    at: new Date().toISOString(),
    category: AUDIT_ACTIONS[d.action].category,
    outcome: d.outcome ?? 'success',
    entityType: d.entityType ?? null,
    entityId: d.entityId ?? null,
    entityLabel: d.entityLabel ?? null,
    changes: d.changes ?? null,
    metadata: d.metadata ?? null,
    ip: '192.168.1.10',
    userAgent: navigator.userAgent,
    requestId: `req_${Math.random().toString(16).slice(2, 14)}`,
    userId: d.userId,
    userName: d.userName,
    userEmail: d.userEmail,
    action: d.action,
    summary: d.summary,
  };
  audit = [entry, ...audit];
}

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function filterAudit(query: URLSearchParams): AuditEntry[] {
  const q = query.get('q')?.toLowerCase();
  const userId = Number(query.get('userId')) || null;
  const action = query.get('action');
  const category = query.get('category');
  const outcome = query.get('outcome');
  const entityType = query.get('entityType');
  const entityId = query.get('entityId');
  const from = query.get('from');
  const to = query.get('to');
  return audit.filter((e) => {
    if (userId && e.userId !== userId) return false;
    if (action && e.action !== action) return false;
    if (category && e.category !== category) return false;
    if (outcome && e.outcome !== outcome) return false;
    if (entityType && e.entityType !== entityType) return false;
    if (entityId && e.entityId !== entityId) return false;
    if (from || to) {
      const k = dayKey(e.at);
      if (from && k < from) return false;
      if (to && k > to) return false;
    }
    if (q) {
      const hay = `${e.summary} ${e.userName ?? ''} ${e.userEmail ?? ''} ${e.entityLabel ?? ''} ${e.ip ?? ''} ${AUDIT_ACTIONS[e.action].label} ${e.action}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

// ----------------------------------------------------------------------------- state
function readState(): MockState {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as MockState;
  } catch {
    /* ignore */
  }
  return { persona: 'admin', signedIn: true };
}
let state: MockState = readState();
function writeState() {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

const idleMinutes = Math.max(1, Math.round(Number(new URLSearchParams(location.search).get('mockIdleMin')) || 30));

let permOverride: Permission[] | null = null;
function currentUser(): CurrentUser {
  const limited = state.persona === 'limited';
  const base = users.find((u) => u.id === (limited ? 7 : 1))!;
  const role = limited ? roles.find((r) => r.id === 3)! : roles.find((r) => r.id === 1)!;
  return {
    id: base.id,
    email: base.email,
    name: base.name,
    isSuperAdmin: !limited,
    mustChangePassword: state.persona === 'mustchange',
    permissions: permOverride ?? (limited ? ['dashboard.view', 'employees.view', 'attendance.view', 'devices.view'] : [...PERMISSION_KEYS]),
    wingScope: limited ? role.wingIds : 'all',
    roles: [{ id: role.id, name: role.name }],
    previousLoginAt: iso(1100),
    previousLoginIp: '192.168.1.10',
  };
}

function sessionInfo(): SessionInfo {
  return {
    user: currentUser(),
    csrfToken: CSRF,
    expiresAt: new Date(Date.now() + 11 * 3600_000).toISOString(),
    idleTimeoutMinutes: idleMinutes,
  };
}

const withUserCount = (r: Omit<Role, 'userCount'>): Role => ({ ...r, userCount: users.filter((u) => u.roleIds.includes(r.id)).length });
const toAppUser = (u: MockUser): AppUser => {
  const { roleIds, ...rest } = u;
  return { ...rest, roles: roleIds.map((id) => ({ id, name: roles.find((r) => r.id === id)?.name ?? '?' })) };
};

// ----------------------------------------------------------------------------- http helpers
const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'x-request-id': 'mock-req' } });
const err = (status: number, code: string, message: string, details?: unknown) => json(status, { error: { code, message, details } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function applyUrlPersona() {
  const mock = new URLSearchParams(location.search).get('mock');
  if (!mock) return;
  if (mock === 'signedout') state = { persona: 'admin', signedIn: false };
  else if (mock === 'admin' || mock === 'limited' || mock === 'mustchange') state = { persona: mock, signedIn: true };
  writeState();
  // drop the param so reloads and redirects do not re-apply it
  const url = new URL(location.href);
  url.searchParams.delete('mock');
  history.replaceState(null, '', url);
}

type Handler = (ctx: { method: string; query: URLSearchParams; body: any; params: string[] }) => Response | Promise<Response>;

function validationFromZod(error: { issues: { path: (string | number)[]; message: string }[] }) {
  const details: Record<string, string> = {};
  for (const i of error.issues) details[String(i.path[0] ?? 'form')] ??= i.message;
  return err(400, 'VALIDATION_ERROR', 'Some values are invalid', details);
}

const routes: [RegExp, Handler][] = [
  // ---- auth
  [/^\/auth\/me$/, ({ method }) => {
    if (method !== 'GET') return err(405, 'HTTP_ERROR', 'Method not allowed');
    return state.signedIn ? json(200, sessionInfo()) : err(401, 'UNAUTHENTICATED', 'Not signed in');
  }],
  [/^\/auth\/login$/, ({ body }) => {
    const email = String(body?.email ?? '').toLowerCase();
    const password = String(body?.password ?? '');
    if (email.startsWith('locked')) return err(423, 'ACCOUNT_LOCKED', 'Account locked', { lockedUntil: new Date(Date.now() + 13 * 60_000).toISOString() });
    if (email.startsWith('disabled')) return err(403, 'ACCOUNT_DISABLED', 'Account disabled');
    if (email.startsWith('rate')) return err(429, 'RATE_LIMITED', 'Too many attempts');
    if (password === 'wrong') return err(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    state = { persona: email.startsWith('limited') ? 'limited' : email.startsWith('change') ? 'mustchange' : 'admin', signedIn: true };
    writeState();
    return json(200, sessionInfo());
  }],
  [/^\/auth\/logout$/, () => {
    state = { ...state, signedIn: false };
    writeState();
    return json(204, undefined);
  }],
  [/^\/auth\/change-password$/, ({ body }) => {
    if (body?.currentPassword === 'wrong') return err(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
    const ok = zNewPassword.safeParse(body?.newPassword);
    if (!ok.success) return err(400, 'VALIDATION_ERROR', 'Invalid password', { newPassword: ok.error.issues[0]?.message });
    state = { ...state, persona: state.persona === 'mustchange' ? 'admin' : state.persona };
    writeState();
    return json(200, sessionInfo());
  }],
  [/^\/auth\/sessions$/, () => json(200, sessions)],
  [/^\/auth\/sessions\/revoke-others$/, () => {
    const n = sessions.filter((s) => !s.current).length;
    sessions = sessions.filter((s) => s.current);
    return json(200, { revoked: n });
  }],
  [/^\/auth\/sessions\/([^/]+)$/, ({ params }) => {
    sessions = sessions.filter((s) => s.id !== params[0]);
    return json(204, undefined);
  }],

  // ---- audit
  [/^\/audit\/summary$/, ({ query }) => {
    const rows = filterAudit(new URLSearchParams({ from: query.get('from') ?? '', to: query.get('to') ?? '' }));
    return json(200, {
      total: rows.length,
      signIns: rows.filter((e) => e.action === 'auth.login' && e.outcome === 'success').length,
      failedSignIns: rows.filter((e) => e.action === 'auth.login_failed').length,
      changes: rows.filter((e) => ['create', 'update', 'delete'].includes(e.category)).length,
      exports: rows.filter((e) => e.category === 'export').length,
      denied: rows.filter((e) => e.outcome === 'denied').length,
      activeUsers: new Set(rows.filter((e) => e.userId !== null).map((e) => e.userId)).size,
    });
  }],
  [/^\/audit\/export$/, ({ query }) => {
    const rows = filterAudit(query);
    const csv = ['id,time,user,email,action,outcome,subject,summary,ip,request_id']
      .concat(rows.map((e) => [e.id, e.at, e.userName, e.userEmail, e.action, e.outcome, e.entityLabel, e.summary, e.ip, e.requestId].map(csvCell).join(',')))
      .join('\r\n');
    const u = currentUser();
    record({ userId: u.id, userName: u.name, userEmail: u.email, action: 'audit.export', entityType: 'export', entityLabel: 'Audit log export', summary: `Exported ${rows.length} audit entries (CSV)`, metadata: { format: 'csv', rows: rows.length, filters: Object.fromEntries(query) } });
    return new Response(csv, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"` } });
  }],
  [/^\/audit\/views$/, ({ body }) => {
    const u = currentUser();
    const path = String(body?.path ?? '');
    const last = audit.find((e) => e.action === 'view.page' && e.userId === u.id && e.metadata?.path === path);
    if (!last || Date.now() - new Date(last.at).getTime() > 60_000) {
      record({
        userId: u.id,
        userName: u.name,
        userEmail: u.email,
        action: 'view.page',
        entityType: body?.entityType ?? 'page',
        entityId: body?.entityId ?? path,
        entityLabel: body?.entityLabel ?? body?.title ?? path,
        summary: `Viewed ${body?.entityLabel ? `${String(body?.title ?? 'page').toLowerCase()} ${body.entityLabel}` : (body?.title ?? path)}`,
        metadata: { path, title: body?.title, ...(body?.query ? { query: body.query } : {}) },
      });
    }
    return json(204, undefined);
  }],
  [/^\/audit\/(\d+)$/, ({ params }) => {
    const e = audit.find((x) => x.id === Number(params[0]));
    return e ? json(200, e) : err(404, 'NOT_FOUND', 'Audit entry not found');
  }],
  [/^\/audit$/, ({ query }) => {
    const rows = filterAudit(query).sort((a, b) => (query.get('order') === 'asc' ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at)));
    const page = Number(query.get('page')) || 1;
    const pageSize = Number(query.get('pageSize')) || 50;
    return json(200, { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize });
  }],

  // ---- minimal stand-ins so the dashboard, employee profile and device pages render under the mock
  [/^\/overview$/, () => {
    const today = dayKey(new Date().toISOString());
    const overview: Overview = {
      devices: { total: MOCK_DEVICES.length, online: MOCK_DEVICES.filter((d) => d.status === 'online').length },
      employees: { total: 429, active: 411 },
      today: { date: today, punches: 812, present: 337 },
      dailyPresence: Array.from({ length: 14 }, (_, i) => {
        const d = new Date(Date.now() - (13 - i) * 86_400_000);
        return { date: dayKey(d.toISOString()), present: 300 + ((i * 37) % 60) };
      }),
    };
    return json(200, overview);
  }],
  [/^\/devices$/, () => json(200, MOCK_DEVICES.map(mockDevice))],
  [/^\/devices\/(\d+)$/, ({ params }) => {
    const d = MOCK_DEVICES.find((x) => x.id === Number(params[0]));
    return d ? json(200, mockDevice(d)) : err(404, 'NOT_FOUND', 'Device not found');
  }],

  // ---- catalogue / lookups
  [/^\/permissions$/, () => json(200, PERMISSION_KEYS)],

  // ---- roles
  [/^\/roles$/, ({ method, body }) => {
    if (method === 'GET') return json(200, roles.map(withUserCount));
    const p = zRoleInput.safeParse(body);
    if (!p.success) return validationFromZod(p.error);
    if (!p.data.allWings && p.data.wingIds.length === 0) return err(400, 'VALIDATION_ERROR', 'Choose wings', { wingIds: 'Choose at least one wing' });
    if (roles.some((r) => r.name.toLowerCase() === p.data.name.toLowerCase())) return err(409, 'DUPLICATE_ROLE', 'A role with this name already exists');
    const role = { id: nextRoleId++, isSystem: false, ...p.data, createdAt: iso(0), updatedAt: iso(0) };
    roles = [...roles, role];
    const who = currentUser();
    record({ userId: who.id, userName: who.name, userEmail: who.email, action: 'role.create', entityType: 'role', entityId: String(role.id), entityLabel: role.name, summary: `Created role “${role.name}”`, changes: [{ field: 'permissions', before: [], after: role.permissions }] });
    return json(201, withUserCount(role));
  }],
  [/^\/roles\/(\d+)$/, ({ method, body, params }) => {
    const id = Number(params[0]);
    const role = roles.find((r) => r.id === id);
    if (!role) return err(404, 'NOT_FOUND', 'Role not found');
    if (role.isSystem) return err(403, 'PROTECTED_ROLE', 'The Super Admin role cannot be changed');
    if (method === 'DELETE') {
      if (users.some((u) => u.roleIds.includes(id))) return err(409, 'CONFLICT', 'Users are assigned to this role');
      roles = roles.filter((r) => r.id !== id);
      return json(204, undefined);
    }
    const p = zRoleInput.safeParse(body);
    if (!p.success) return validationFromZod(p.error);
    if (roles.some((r) => r.id !== id && r.name.toLowerCase() === p.data.name.toLowerCase())) return err(409, 'DUPLICATE_ROLE', 'A role with this name already exists');
    const updated = { ...role, ...p.data, updatedAt: iso(0) };
    roles = roles.map((r) => (r.id === id ? updated : r));
    const who = currentUser();
    const changes: { field: string; before: unknown; after: unknown }[] = [];
    if (role.name !== updated.name) changes.push({ field: 'name', before: role.name, after: updated.name });
    if ((role.description ?? '') !== (updated.description ?? '')) changes.push({ field: 'description', before: role.description, after: updated.description });
    if (JSON.stringify([...role.permissions].sort()) !== JSON.stringify([...updated.permissions].sort())) changes.push({ field: 'permissions', before: role.permissions, after: updated.permissions });
    if (role.allWings !== updated.allWings) changes.push({ field: 'allWings', before: role.allWings, after: updated.allWings });
    record({ userId: who.id, userName: who.name, userEmail: who.email, action: 'role.update', entityType: 'role', entityId: String(id), entityLabel: updated.name, summary: `Edited role “${updated.name}”${changes.length ? '' : ' (no changes)'}`, changes });
    return json(200, withUserCount(updated));
  }],

  // ---- users
  [/^\/users$/, ({ method, query, body }) => {
    if (method === 'POST') {
      const p = zUserCreateInput.safeParse(body);
      if (!p.success) return validationFromZod(p.error);
      if (users.some((u) => u.email === p.data.email)) return err(409, 'DUPLICATE_EMAIL', 'A user with this email already exists');
      const u: MockUser = { id: nextUserId++, email: p.data.email, name: p.data.name, status: 'active', isSuperAdmin: false, roleIds: p.data.roleIds, mustChangePassword: true, lockedUntil: null, lastLoginAt: null, lastLoginIp: null, activeSessions: 0, createdAt: iso(0), updatedAt: iso(0) };
      users = [...users, u];
      return json(201, toAppUser(u));
    }
    let list = [...users];
    const q = query.get('q')?.toLowerCase();
    if (q) list = list.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    const status = query.get('status');
    if (status) list = list.filter((u) => u.status === status);
    const roleId = Number(query.get('roleId'));
    if (roleId) list = list.filter((u) => u.roleIds.includes(roleId));
    const sort = (query.get('sort') ?? 'name') as 'name' | 'email' | 'lastLoginAt' | 'createdAt';
    const dir = query.get('order') === 'desc' ? -1 : 1;
    list.sort((a, b) => String(a[sort] ?? '').localeCompare(String(b[sort] ?? '')) * dir);
    const page = Number(query.get('page')) || 1;
    const pageSize = Number(query.get('pageSize')) || 50;
    return json(200, { items: list.slice((page - 1) * pageSize, page * pageSize).map(toAppUser), total: list.length, page, pageSize });
  }],
  [/^\/users\/(\d+)\/(reset-password|revoke-sessions|unlock)$/, ({ params, body }) => {
    const id = Number(params[0]);
    const u = users.find((x) => x.id === id);
    if (!u) return err(404, 'NOT_FOUND', 'User not found');
    if (params[1] === 'reset-password') {
      if (u.isSuperAdmin) return err(403, 'PROTECTED_ACCOUNT', 'Protected account');
      const ok = zNewPassword.safeParse(body?.temporaryPassword);
      if (!ok.success) return err(400, 'VALIDATION_ERROR', 'Invalid password', { temporaryPassword: ok.error.issues[0]?.message });
      users = users.map((x) => (x.id === id ? { ...x, mustChangePassword: true, activeSessions: 0, lockedUntil: null } : x));
      return json(204, undefined);
    }
    if (params[1] === 'revoke-sessions') {
      const n = u.activeSessions;
      users = users.map((x) => (x.id === id ? { ...x, activeSessions: 0 } : x));
      return json(200, { revoked: n });
    }
    users = users.map((x) => (x.id === id ? { ...x, lockedUntil: null } : x));
    return json(200, toAppUser(users.find((x) => x.id === id)!));
  }],
  [/^\/users\/(\d+)$/, ({ method, body, params }) => {
    const id = Number(params[0]);
    const u = users.find((x) => x.id === id);
    if (!u) return err(404, 'NOT_FOUND', 'User not found');
    if (method === 'GET') return json(200, toAppUser(u));
    if (u.isSuperAdmin && method === 'DELETE') return err(403, 'PROTECTED_ACCOUNT', 'The Super Admin account cannot be deleted');
    if (method === 'DELETE') {
      users = users.filter((x) => x.id !== id);
      return json(204, undefined);
    }
    const p = zUserUpdateInput.safeParse(body);
    if (!p.success) return validationFromZod(p.error);
    if (u.isSuperAdmin && (p.data.roleIds || p.data.status)) return err(403, 'PROTECTED_ACCOUNT', 'Only the name of the Super Admin account can change');
    const next: MockUser = { ...u, name: p.data.name ?? u.name, roleIds: p.data.roleIds ?? u.roleIds, status: p.data.status ?? u.status, updatedAt: iso(0) };
    if (p.data.status === 'disabled') next.activeSessions = 0;
    users = users.map((x) => (x.id === id ? next : x));
    return json(200, toAppUser(next));
  }],
];

function mockDevice(d: (typeof MOCK_DEVICES)[number]): Device {
  return {
    id: d.id,
    name: d.name,
    serialNumber: d.serialNumber,
    location: d.location,
    ipAddress: d.ipAddress,
    isActive: true,
    status: d.status,
    lastSeenAt: d.status === 'online' ? iso(1) : iso(240),
    deviceName: 'SenseFace 4',
    firmwareVersion: 'Ver 8.0.4.7',
    platform: 'ZMM220_TFT',
    pushVersion: '2.4.1',
    userCount: 214,
    fpCount: 388,
    faceCount: 201,
    attCount: 18420,
    autoRegistered: false,
    createdAt: iso(30000),
    updatedAt: iso(500),
  };
}

const MOCKED = /^\/(auth|permissions|roles|users|wings|sections|audit|overview|dashboard|reports|employees|attendance|devices|leaves|leave-types|holidays|timings|timing-assignments)(\/|$)/;

let employeeRoutes: ReturnType<typeof createEmployeeRoutes> | null = null;
let rulesRoutes: ReturnType<typeof createRulesRoutes> | null = null;
let reportsRoutes: ReturnType<typeof createReportsRoutes> | null = null;
/** Phase D routes (wings, employees, attendance) first, so they win over any generic stand-in above. */
function allRoutes() {
  employeeRoutes ??= createEmployeeRoutes({
    can: (p) => currentUser().permissions.includes(p),
    record: (d) => {
      const u = currentUser();
      record({ userId: u.id, userName: u.name, userEmail: u.email, ...d });
    },
  });
  rulesRoutes ??= createRulesRoutes({ can: (p) => currentUser().permissions.includes(p) });
  reportsRoutes ??= createReportsRoutes({ can: (p) => currentUser().permissions.includes(p) });
  return [...reportsRoutes, ...rulesRoutes, ...employeeRoutes, ...routes];
}

export function installAuthMock() {
  installPhotoMock();
  applyUrlPersona();
  // Console hook to change permissions mid-session (demonstrates the automatic permission refresh).
  (window as unknown as { __nactaMock?: unknown }).__nactaMock = {
    /** Same user, different permissions (what a role change looks like to the client). Pass null to reset. */
    setPermissions: (p: Permission[] | null) => {
      permOverride = p;
    },
    setPersona: (p: Persona) => {
      state = { persona: p, signedIn: true };
      writeState();
    },
  };
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
    if (!url.pathname.startsWith(API_BASE)) return realFetch(input, init);
    const path = url.pathname.slice(API_BASE.length);
    // Anything the mock does not know answers 404 (never the live server, which would 401 and sign the mock persona out).
    if (!MOCKED.test(path)) {
      await sleep(120);
      return err(404, 'NOT_FOUND', 'Not mocked');
    }

    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    await sleep(180);

    // behave like the real server: everything except login/me/logout needs a session; mutations need the CSRF header
    const open = path === '/auth/login' || path === '/auth/me' || path === '/auth/logout';
    if (!open) {
      if (!state.signedIn) return err(401, 'UNAUTHENTICATED', 'Not signed in');
      if (state.persona === 'mustchange' && path !== '/auth/change-password') return err(403, 'PASSWORD_CHANGE_REQUIRED', 'You must change your password first');
      if (method !== 'GET' && headers.get('X-CSRF-Token') !== CSRF) return err(403, 'CSRF_INVALID', 'Missing or invalid CSRF token');
      // permission checks (mirrors the catalogue)
      const perms = new Set<Permission>(currentUser().permissions);
      if (/^\/audit/.test(path) && path !== '/audit/views' && !perms.has('audit.view')) return err(403, 'FORBIDDEN', 'You do not have permission');
      if (/^\/users/.test(path) && !perms.has('users.manage')) return err(403, 'FORBIDDEN', 'You do not have permission');
      if (/^\/roles/.test(path) && method !== 'GET' && !perms.has('roles.manage')) return err(403, 'FORBIDDEN', 'You do not have permission');
    }

    let body: unknown;
    if (init?.body instanceof FormData) {
      body = init.body;
    } else if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = undefined;
      }
    }
    for (const [re, handler] of allRoutes()) {
      const m = re.exec(path);
      if (m) return handler({ method, query: url.searchParams, body, params: m.slice(1) });
    }
    return err(404, 'NOT_FOUND', 'Not mocked');
  };
  console.info('[dev] Auth mock active. Persona:', state.persona, state.signedIn ? '(signed in)' : '(signed out)');
}


