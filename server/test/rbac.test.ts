import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PERMISSION_KEYS, zAttendanceRecord, zEmployee, zOverview, zPage, type Permission } from '@nacta/shared';
import { adms, api, closeDb, createDevice, dbDate, insertUser, loginAs, pool, rawApi, resetDb, userClient, V1 } from './helpers';

beforeEach(resetDb);
afterAll(closeDb);

type Method = 'get' | 'post' | 'put' | 'delete';
interface Route {
  method: Method;
  path: string;
  /** Permissions of which any one is enough. */
  any: Permission[];
  body?: unknown;
}

const ROUTES: Route[] = [
  { method: 'get', path: '/overview', any: ['dashboard.view'] },

  { method: 'get', path: '/devices', any: ['devices.view', 'attendance.view', 'employees.push', 'reports.punch_log'] },
  { method: 'post', path: '/devices', any: ['devices.manage'], body: { name: 'D', serialNumber: 'RB1' } },
  { method: 'get', path: '/devices/1', any: ['devices.view'] },
  { method: 'put', path: '/devices/1', any: ['devices.manage'], body: {} },
  { method: 'delete', path: '/devices/1', any: ['devices.manage'] },
  { method: 'get', path: '/devices/1/commands', any: ['devices.view'] },
  { method: 'post', path: '/devices/1/commands', any: ['devices.command'], body: { type: 'info' } },
  { method: 'get', path: '/devices/1/users', any: ['devices.view'] },
  { method: 'post', path: '/devices/1/users/fetch', any: ['devices.users'] },
  { method: 'delete', path: '/devices/1/users/5', any: ['devices.users'] },

  { method: 'get', path: '/wings', any: ['employees.view', 'attendance.view', 'wings.manage', 'roles.manage', 'reports.daily', 'reports.monthly_register', 'reports.late_comers', 'reports.absentees', 'reports.wing_summary', 'reports.time_card', 'reports.leave', 'reports.punch_log', 'reports.attendance_export'] },
  { method: 'post', path: '/wings', any: ['wings.manage'], body: { name: 'W' } },
  { method: 'put', path: '/wings/1', any: ['wings.manage'], body: { name: 'W2' } },
  { method: 'delete', path: '/wings/1', any: ['wings.manage'] },
  { method: 'post', path: '/wings/1/sections', any: ['wings.manage'], body: { name: 'S' } },
  { method: 'put', path: '/sections/1', any: ['wings.manage'], body: { name: 'S2' } },
  { method: 'delete', path: '/sections/1', any: ['wings.manage'] },
  { method: 'get', path: '/employees/export.xlsx', any: ['employees.import'] },

  { method: 'get', path: '/employees', any: ['employees.view', 'reports.time_card', 'reports.punch_log', 'reports.attendance_export'] },
  // each report opens with its own permission only
  { method: 'get', path: '/reports/daily', any: ['reports.daily'] },
  { method: 'get', path: '/reports/attendance_export', any: ['reports.attendance_export'] },
  { method: 'post', path: '/employees', any: ['employees.manage'], body: { empCode: '1', name: 'E' } },
  { method: 'post', path: '/employees/push', any: ['employees.push'], body: { employeeIds: 'all' } },
  { method: 'get', path: '/employees/1', any: ['employees.view'] },
  { method: 'put', path: '/employees/1', any: ['employees.manage'], body: {} },
  // Reserved for the Super Admin account: no permission grants it (any: [] => every role user gets 403).
  { method: 'delete', path: '/employees/1', any: [] },

  { method: 'get', path: '/attendance', any: ['attendance.view'] },
  { method: 'get', path: '/adms-log', any: ['diagnostics.view'] },

  { method: 'get', path: '/users', any: ['users.manage'] },
  { method: 'post', path: '/users', any: ['users.manage'], body: {} },
  { method: 'get', path: '/users/1', any: ['users.manage'] },
  { method: 'put', path: '/users/1', any: ['users.manage'], body: {} },
  { method: 'delete', path: '/users/1', any: ['users.manage'] },
  { method: 'post', path: '/users/1/reset-password', any: ['users.manage'], body: {} },
  { method: 'post', path: '/users/1/revoke-sessions', any: ['users.manage'] },
  { method: 'post', path: '/users/1/unlock', any: ['users.manage'] },

  { method: 'get', path: '/roles', any: ['roles.manage', 'users.manage'] },
  { method: 'post', path: '/roles', any: ['roles.manage'], body: {} },
  { method: 'put', path: '/roles/1', any: ['roles.manage'], body: {} },
  { method: 'delete', path: '/roles/1', any: ['roles.manage'] },
  { method: 'get', path: '/permissions', any: ['roles.manage', 'users.manage'] },
];

const call = (c: { get: (u: string) => any; post: (u: string) => any; put: (u: string) => any; delete: (u: string) => any }, r: Route) => {
  const req = c[r.method](`${V1}${r.path}`);
  return r.body === undefined ? req : req.send(r.body);
};

describe('every API route is guarded', () => {
  it('is 401 UNAUTHENTICATED without a session, for every method', async () => {
    for (const r of ROUTES) {
      const res = await call(rawApi, r);
      expect([r.method, r.path, res.status, res.body.error?.code]).toEqual([r.method, r.path, 401, 'UNAUTHENTICATED']);
    }
  });

  it('is 403 FORBIDDEN for a signed-in user with no permissions', async () => {
    const nobody = await userClient({});
    for (const r of ROUTES) {
      const res = await call(nobody, r);
      expect([r.method, r.path, res.status, res.body.error?.code]).toEqual([r.method, r.path, 403, 'FORBIDDEN']);
    }
  });

  it('a user holding one other permission is still refused', async () => {
    // every permission opens only its own routes: check each key against the routes that do not list it
    for (const key of PERMISSION_KEYS) {
      const u = await userClient({ permissions: [key] });
      for (const r of ROUTES.filter((x) => !x.any.includes(key))) {
        const res = await call(u, r);
        expect([key, r.method, r.path, res.status]).toEqual([key, r.method, r.path, 403]);
      }
    }
  }, 120_000);

  it('the matching permission gets past the guard (any-of semantics)', async () => {
    for (const r of ROUTES) {
      for (const key of r.any) {
        const u = await userClient({ permissions: [key] });
        const res = await call(u, r);
        // Other refusals (PROTECTED_ACCOUNT on user 1, PROTECTED_ROLE on the system role, ...) still prove the guard let it through.
        const code = res.body.error?.code;
        expect([key, r.method, r.path, code === 'FORBIDDEN' || code === 'UNAUTHENTICATED']).toEqual([key, r.method, r.path, false]);
      }
    }
  }, 120_000);

  it('Super Admin implicitly holds every permission', async () => {
    const me = await api.get(`${V1}/auth/me`);
    expect(me.body.user.permissions).toEqual(PERMISSION_KEYS);
    for (const r of ROUTES.filter((x) => x.method === 'get')) {
      const res = await call(api, r);
      expect([r.path, res.status === 403 || res.status === 401]).toEqual([r.path, false]);
    }
  });

  it('keeps unknown API paths a plain 404', async () => {
    expect((await rawApi.get(`${V1}/nope`)).status).toBe(404);
    expect((await api.get(`${V1}/nope`)).status).toBe(404);
  });
});

describe('multi-permission rules', () => {
  it('device-user import needs devices.users AND employees.manage (and all-wings scope)', async () => {
    const dev = await createDevice('IMP1');
    await adms.post('/iclock/cdata?SN=IMP1&table=OPERLOG').send('USER PIN=7\tName=Seven\tPri=0\n');
    const url = `${V1}/devices/${dev.id}/users/import`;

    expect((await (await userClient({ permissions: ['devices.users'] })).post(url).send({})).status).toBe(403);
    expect((await (await userClient({ permissions: ['employees.manage'] })).post(url).send({})).status).toBe(403);
    const both = await userClient({ permissions: ['devices.users', 'employees.manage'] });
    const ok = await both.post(url).send({});
    expect([ok.status, ok.body]).toEqual([200, { created: 1, updated: 0, skipped: 0 }]);

    // a wing-limited caller may not import (it would create and rewrite employees outside their wings)
    const dep = await api.post(`${V1}/wings`).send({ name: 'A' });
    const limited = await userClient({ permissions: ['devices.users', 'employees.manage'], wings: [dep.body.id] });
    expect((await limited.post(url).send({ overwrite: true })).status).toBe(403);
  });

  it('deleting an employee is reserved for the Super Admin: no role or permission set can do it', async () => {
    await createDevice('DEL1');
    const e1 = await api.post(`${V1}/employees`).send({ empCode: '1', name: 'A' });
    const e2 = await api.post(`${V1}/employees`).send({ empCode: '2', name: 'B' });

    // a user holding EVERY permission, all wings, is still refused
    const everything = await userClient({ permissions: [...PERMISSION_KEYS] });
    for (const url of [`${V1}/employees/${e1.body.id}`, `${V1}/employees/${e1.body.id}?removeFromDevices=true`]) {
      const res = await everything.delete(url);
      expect([res.status, res.body.error.code]).toEqual([403, 'FORBIDDEN']);
      expect(res.body.error.message).toMatch(/Only the Super Admin can delete employees/);
    }
    expect((await q1(`SELECT 1 FROM employees WHERE id = ${e1.body.id}`)).length).toBe(1);
    // the attempt is in the audit log
    const denied = await q1(`SELECT summary, metadata FROM audit_logs WHERE action = 'access.denied' ORDER BY id DESC LIMIT 1`);
    expect(denied[0].summary).toMatch(/reserved for the Super Admin/);

    // the Super Admin can, with or without removal from devices
    expect((await api.delete(`${V1}/employees/${e1.body.id}`)).status).toBe(204);
    expect((await api.delete(`${V1}/employees/${e2.body.id}?removeFromDevices=true`)).status).toBe(204);
    expect((await q1(`SELECT 1 FROM employees WHERE id IN (${e1.body.id}, ${e2.body.id})`)).length).toBe(0);
  });

  it('the wing list is readable with any of employees.view, attendance.view, wings.manage, roles.manage', async () => {
    for (const p of ['employees.view', 'attendance.view', 'wings.manage', 'roles.manage'] as Permission[]) {
      expect((await (await userClient({ permissions: [p] })).get(`${V1}/wings`)).status).toBe(200);
    }
    expect((await (await userClient({ permissions: ['devices.view'] })).get(`${V1}/wings`)).status).toBe(403);
  });
});

const q1 = (sql: string) => pool.query(sql).then((r) => r.rows);

describe('wing scoping', () => {
  async function seed() {
    const a = (await api.post(`${V1}/wings`).send({ name: 'Wing A' })).body.id as number;
    const b = (await api.post(`${V1}/wings`).send({ name: 'Wing B' })).body.id as number;
    const dev = await createDevice('SC1', 'Gate');
    const mk = async (empCode: string, name: string, wingId: number | null) =>
      (await api.post(`${V1}/employees`).send({ empCode, name, wingId })).body.id as number;
    const e1 = await mk('1', 'Ana (A)', a);
    const e2 = await mk('2', 'Ben (A)', a);
    const e3 = await mk('3', 'Cy (B)', b);
    const e4 = await mk('4', 'Di (none)', null);
    const today = await dbDate(0);
    const punch = (pin: string, t: string) =>
      pool.query(`INSERT INTO attendance_logs (device_id, pin, punch_time, status, verify_type) VALUES ($1, $2, $3::timestamp, 0, 15)`, [dev.id, pin, t]);
    await punch('1', `${today} 08:00:00`);
    await punch('2', '2026-03-10 08:00:00');
    await punch('3', `${today} 09:00:00`);
    await punch('4', `${today} 10:00:00`);
    await punch('99', `${today} 11:00:00`); // no employee at all
    return { a, b, dev, e1, e2, e3, e4 };
  }
  const WING_PERMS: Permission[] = ['employees.view', 'employees.manage', 'employees.push', 'attendance.view', 'dashboard.view', 'wings.manage', 'devices.view'];

  it('exposes the scope on /auth/me: a list of wings, or "all"', async () => {
    const { a, b } = await seed();
    const one = await userClient({ permissions: ['employees.view'], wings: [a] });
    expect((await one.get(`${V1}/auth/me`)).body.user.wingScope).toEqual([a]);

    // two roles on one user: union of wings
    const two = await insertUser({ permissions: ['employees.view'], wings: [a] });
    const second = await pool.query<{ id: number }>(`INSERT INTO roles (name, all_wings) VALUES ('Second', false) RETURNING id`);
    await pool.query('INSERT INTO role_wings (role_id, wing_id) VALUES ($1, $2)', [second.rows[0]!.id, b]);
    await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [two.id, second.rows[0]!.id]);
    const c2 = await loginAs(two.email, two.password);
    expect([...(await c2.get(`${V1}/auth/me`)).body.user.wingScope].sort()).toEqual([a, b].sort());

    // any all-wings role wins
    const third = await pool.query<{ id: number }>(`INSERT INTO roles (name, all_wings) VALUES ('Third', true) RETURNING id`);
    await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [two.id, third.rows[0]!.id]);
    expect((await c2.get(`${V1}/auth/me`)).body.user.wingScope).toBe('all');
    expect((await api.get(`${V1}/auth/me`)).body.user.wingScope).toBe('all');
  });

  it('employee list and detail only show the wing; others are 404', async () => {
    const { a, b, e1, e2, e3, e4 } = await seed();
    const u = await userClient({ permissions: WING_PERMS, wings: [a] });

    const list = zPage(zEmployee).parse((await u.get(`${V1}/employees`)).body);
    expect(list.items.map((e) => e.empCode)).toEqual(['1', '2']);
    expect(list.total).toBe(2);
    expect((await u.get(`${V1}/employees?wingId=${b}`)).body.total).toBe(0);
    expect((await u.get(`${V1}/employees?q=Cy`)).body.total).toBe(0);
    expect((await u.get(`${V1}/employees?isActive=true&pageSize=1`)).body).toMatchObject({ total: 2, pageSize: 1 });

    expect((await u.get(`${V1}/employees/${e1}`)).status).toBe(200);
    expect((await u.get(`${V1}/employees/${e2}`)).status).toBe(200);
    for (const out of [e3, e4]) {
      const res = await u.get(`${V1}/employees/${out}`);
      expect([out, res.status, res.body.error.code]).toEqual([out, 404, 'NOT_FOUND']);
    }
    // Super Admin sees everyone, including people without a wing
    expect((await api.get(`${V1}/employees`)).body.total).toBe(4);
  });

  it('update, delete and wing changes outside the scope are refused', async () => {
    const { a, b, e1, e2, e3, e4 } = await seed();
    const u = await userClient({ permissions: WING_PERMS, wings: [a] });

    expect((await u.put(`${V1}/employees/${e3}`).send({ name: 'Hacked' })).status).toBe(404);
    expect((await u.put(`${V1}/employees/${e4}`).send({ name: 'Hacked' })).status).toBe(404);
    // delete is Super-Admin-only, so a wing user is refused before scope is even considered
    expect((await u.delete(`${V1}/employees/${e3}`)).status).toBe(403);
    expect((await u.delete(`${V1}/employees/${e4}`)).status).toBe(403);
    expect((await q1(`SELECT name FROM employees WHERE id IN (${e3}, ${e4}) ORDER BY id`)).map((r) => r.name)).toEqual(['Cy (B)', 'Di (none)']);

    const ok = await u.put(`${V1}/employees/${e1}`).send({ name: 'Ana renamed' });
    expect([ok.status, ok.body.name]).toEqual([200, 'Ana renamed']);

    // may not move people out of, or create people outside, their wings
    const move = await u.put(`${V1}/employees/${e1}`).send({ wingId: b });
    expect([move.status, move.body.error.details]).toEqual([400, { wingId: expect.any(String) }]);
    expect((await u.put(`${V1}/employees/${e1}`).send({ wingId: null })).status).toBe(400);
    expect((await u.post(`${V1}/employees`).send({ empCode: '50', name: 'X', wingId: b })).status).toBe(400);
    expect((await u.post(`${V1}/employees`).send({ empCode: '51', name: 'X' })).status).toBe(400);
    const created = await u.post(`${V1}/employees`).send({ empCode: '52', name: 'Inside', wingId: a });
    expect([created.status, created.body.wingId]).toEqual([201, a]);

    expect((await u.delete(`${V1}/employees/${e2}`)).status).toBe(403); // even inside their own wing
    expect((await q1(`SELECT 1 FROM employees WHERE id = ${e2}`)).length).toBe(1);
  });

  it('attendance only includes punches of employees in the wing (unmatched or wingless punches: all-wings only)', async () => {
    const { a, b } = await seed();
    const u = await userClient({ permissions: WING_PERMS, wings: [a] });
    const res = await u.get(`${V1}/attendance`);
    const page = zPage(zAttendanceRecord).parse(res.body);
    expect(page.total).toBe(2);
    expect(page.items.map((r) => r.pin).sort()).toEqual(['1', '2']);
    expect(page.items.every((r) => r.wingName === 'Wing A')).toBe(true);

    for (const qs of [`wingId=${b}`, 'pin=3', 'pin=4', 'pin=99', 'q=Cy', 'q=99', 'employeeId=3']) {
      const r = await u.get(`${V1}/attendance?${qs}`);
      expect([qs, r.status, r.body.total]).toEqual([qs, 200, 0]);
    }
    expect((await u.get(`${V1}/attendance?pin=1`)).body.total).toBe(1);
    expect((await u.get(`${V1}/attendance?sort=pin&order=desc&pageSize=1`)).body).toMatchObject({ total: 2, pageSize: 1 });

    expect((await api.get(`${V1}/attendance`)).body.total).toBe(5);
    expect((await api.get(`${V1}/attendance?pin=99`)).body.total).toBe(1);
  });

  it('overview counts only the wing\'s employees and punches', async () => {
    const { a } = await seed();
    const u = await userClient({ permissions: WING_PERMS, wings: [a] });
    const mine = zOverview.parse((await u.get(`${V1}/overview`)).body);
    expect(mine.employees).toEqual({ total: 2, active: 2 });
    expect(mine.today).toMatchObject({ punches: 1, present: 1 });
    expect(mine.dailyPresence).toHaveLength(14);
    expect(mine.dailyPresence[13]).toMatchObject({ present: 1 });

    const all = zOverview.parse((await api.get(`${V1}/overview`)).body);
    expect(all.employees).toEqual({ total: 4, active: 4 });
    expect(all.today).toMatchObject({ punches: 4, present: 3 });
    expect(all.dailyPresence[13]).toMatchObject({ present: 3 });
  });

  it('wing list shows only the scoped wings; writes outside the scope are 404 and creating a wing is refused', async () => {
    const { a, b } = await seed();
    const u = await userClient({ permissions: WING_PERMS, wings: [a] });
    const list = await u.get(`${V1}/wings`);
    expect(list.body.map((d: { id: number }) => d.id)).toEqual([a]);
    expect((await api.get(`${V1}/wings`)).body).toHaveLength(2);

    expect((await u.put(`${V1}/wings/${b}`).send({ name: 'Mine now' })).status).toBe(404);
    expect((await u.delete(`${V1}/wings/${b}`)).status).toBe(404);
    expect((await u.post(`${V1}/wings`).send({ name: 'New wing' })).status).toBe(403);
    expect((await u.put(`${V1}/wings/${a}`).send({ name: 'Wing A+' })).status).toBe(200);
    expect((await q1(`SELECT name FROM wings WHERE id = ${b}`))[0]!.name).toBe('Wing B');
  });

  it('push (all or by id) only reaches employees in the wing', async () => {
    const { a, dev, e1, e3, e4 } = await seed();
    const u = await userClient({ permissions: WING_PERMS, wings: [a] });
    // two employees in wing A x one active device = 2 commands
    expect((await u.post(`${V1}/employees/push`).send({ employeeIds: 'all', deviceIds: [dev.id] })).body).toEqual({ queued: 2 });
    expect((await u.post(`${V1}/employees/push`).send({ employeeIds: [e3, e4] })).body).toEqual({ queued: 0 });
    expect((await u.post(`${V1}/employees/push`).send({ employeeIds: [e1, e3, e4] })).body).toEqual({ queued: 1 });
    const cmds = await q1(`SELECT command FROM device_commands ORDER BY id`);
    expect(cmds.every((c) => /PIN=(1|2)\b/.test(c.command))).toBe(true);
    expect((await api.post(`${V1}/employees/push`).send({ employeeIds: 'all' })).body).toEqual({ queued: 4 });
  });

  it('device-user listing is a device feature and is not wing-scoped', async () => {
    const { a, dev } = await seed();
    await adms.post('/iclock/cdata?SN=SC1&table=OPERLOG').send('USER PIN=3\tName=Cy\tPri=0\nUSER PIN=77\tName=Stranger\tPri=0\n');
    const u = await userClient({ permissions: ['devices.view'], wings: [a] });
    const res = await u.get(`${V1}/devices/${dev.id}/users`);
    expect(res.body.items.map((x: { pin: string }) => x.pin)).toEqual(['3', '77']);
  });

  it('a role whose wing was deleted sees nothing rather than everything', async () => {
    const { a } = await seed();
    const u = await userClient({ permissions: WING_PERMS, wings: [a] });
    expect((await u.get(`${V1}/employees`)).body.total).toBe(2);
    await api.delete(`${V1}/wings/${a}`);
    expect((await u.get(`${V1}/auth/me`)).body.user.wingScope).toEqual([]);
    expect((await u.get(`${V1}/employees`)).body.total).toBe(0);
    expect((await u.get(`${V1}/attendance`)).body.total).toBe(0);
    expect((await u.get(`${V1}/wings`)).body).toEqual([]);
  });
});
