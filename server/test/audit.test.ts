import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuditEntry } from '@nacta/shared';
import { flushAudit, redact, resetAuditGates, diff } from '../src/modules/audit/service';
import { resetLoginRateLimit } from '../src/modules/auth/rateLimit';
import {
  adms,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  api,
  closeDb,
  createDevice,
  insertUser,
  loginAs,
  pool,
  rawApi,
  resetDb,
  userClient,
  V1,
} from './helpers';

const TEMP = 'Violet-Harbor-Quartz-52!';
const NEW_TEMP = 'Amber-Canyon-Lotus-83#';

/** audit_logs is append-only (even TRUNCATE is blocked), so tests read only the rows written since their start. */
let baseline = 0;
beforeEach(async () => {
  await resetDb();
  await flushAudit();
  resetAuditGates();
  const { rows } = await pool.query<{ m: string }>('SELECT COALESCE(max(id), 0) AS m FROM audit_logs');
  baseline = Number(rows[0]?.m ?? 0);
});
afterAll(closeDb);

interface Row {
  id: string;
  user_id: number | null;
  user_email: string | null;
  user_name: string | null;
  session_id: string | null;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  action: string;
  category: string;
  outcome: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  summary: string;
  changes: { field: string; before: unknown; after: unknown }[] | null;
  metadata: Record<string, unknown> | null;
}

async function rows(action?: string): Promise<Row[]> {
  await flushAudit();
  const { rows: r } = await pool.query<Row>(
    `SELECT * FROM audit_logs WHERE id > $1 ${action ? 'AND action = $2' : ''} ORDER BY id`,
    action ? [baseline, action] : [baseline],
  );
  return r;
}
async function one(action: string): Promise<Row> {
  const r = await rows(action);
  expect(r, `entries for ${action}`).toHaveLength(1);
  return r[0] as Row;
}

const mkDept = async (name: string) => (await api.post(`${V1}/wings`).send({ name })).body as { id: number; name: string };
const mkEmp = async (body: Record<string, unknown>) => {
  const res = await api.post(`${V1}/employees`).send(body);
  expect(res.status).toBe(201);
  return res.body as { id: number };
};
const mkRole = async (body: Record<string, unknown> = {}) => {
  const res = await api.post(`${V1}/roles`).send({ name: 'Auditors', permissions: ['audit.view'], allWings: true, wingIds: [], ...body });
  expect(res.status).toBe(201);
  return res.body as { id: number };
};

describe('authentication events', () => {
  it('records sign-in, failed sign-ins (known and unknown email), lock, logout', async () => {
    const u = await insertUser({ email: 'jane@test.nacta', name: 'Jane Doe' });
    const c = await loginAs(u.email, u.password);
    const login = await rows('auth.login');
    expect(login).toHaveLength(1);
    expect(login[0]).toMatchObject({ user_id: u.id, user_email: 'jane@test.nacta', user_name: 'Jane Doe', outcome: 'success', category: 'auth' });
    expect(login[0]?.session_id).toMatch(/^[0-9a-f]{64}$/);
    expect(login[0]?.request_id).toBeTruthy();
    expect(login[0]?.summary).toBe('Signed in as Jane Doe (jane@test.nacta)');

    const unknown = await rawApi.post(`${V1}/auth/login`).send({ email: 'nobody@test.nacta', password: 'whatever-Pw-1!' });
    expect(unknown.status).toBe(401);
    const bad = await rawApi.post(`${V1}/auth/login`).send({ email: 'jane@test.nacta', password: 'wrong-Pw-1234!' });
    expect(bad.status).toBe(401);
    const failed = await rows('auth.login_failed');
    expect(failed).toHaveLength(2);
    expect(failed[0]).toMatchObject({ user_id: null, user_email: null, outcome: 'failure', metadata: { email: 'nobody@test.nacta', reason: 'unknown_email' } });
    expect(failed[1]).toMatchObject({ user_id: u.id, outcome: 'failure', metadata: { email: 'jane@test.nacta', reason: 'bad_password' } });
    expect(JSON.stringify(failed)).not.toContain('wrong-Pw-1234');

    expect((await c.post(`${V1}/auth/logout`)).status).toBe(204);
    const out = await one('auth.logout');
    expect(out).toMatchObject({ user_id: u.id, session_id: login[0]?.session_id });
  });

  it('records auth.locked on the attempt that locks the account', async () => {
    const u = await insertUser({ email: 'lock@test.nacta' });
    for (let i = 0; i < 5; i++) {
      resetLoginRateLimit();
      await rawApi.post(`${V1}/auth/login`).send({ email: u.email, password: 'wrong-Pw-1234!' });
    }
    const locked = await one('auth.locked');
    expect(locked).toMatchObject({ user_id: u.id, entity_type: 'user', entity_id: String(u.id) });
    expect(locked.summary).toContain('lock@test.nacta');
    expect(await rows('auth.login_failed')).toHaveLength(5);
  });

  it('records password change and session revocation (own and others)', async () => {
    const u = await insertUser({ email: 'pw@test.nacta', name: 'Pat W' });
    const c1 = await loginAs(u.email, u.password);
    const c2 = await loginAs(u.email, u.password);
    const sessions = (await c1.get(`${V1}/auth/sessions`)).body as { id: string; current: boolean }[];
    const other = sessions.find((s) => !s.current);
    expect(other).toBeDefined();
    expect((await c1.delete(`${V1}/auth/sessions/${other?.id}`)).status).toBe(204);
    const own = await one('auth.session_revoked');
    expect(own).toMatchObject({ user_id: u.id, metadata: { scope: 'one', current: false } });
    expect(JSON.stringify(own)).not.toContain(other?.id ?? 'x'.repeat(64));

    await loginAs(u.email, u.password);
    const rev = await c1.post(`${V1}/auth/sessions/revoke-others`);
    expect(rev.body).toMatchObject({ revoked: expect.any(Number) });
    const all = await rows('auth.session_revoked');
    expect(all).toHaveLength(2);
    expect(all[1]?.metadata).toMatchObject({ scope: 'others', revoked: rev.body.revoked });

    const changed = await c1.post(`${V1}/auth/change-password`).send({ currentPassword: u.password, newPassword: NEW_TEMP, confirmPassword: NEW_TEMP });
    expect(changed.status).toBe(200);
    const pw = await one('auth.password_changed');
    expect(pw).toMatchObject({ user_id: u.id, category: 'security' });
    expect(JSON.stringify(pw)).not.toContain(NEW_TEMP);
    expect(JSON.stringify(pw)).not.toContain(u.password);
    void c2;
  });
});

describe('employees, wings, devices', () => {
  it('employee create/update/delete with a real diff', async () => {
    const ops = await mkDept('Operations');
    const adm = await mkDept('Admin');
    expect((await rows('wing.create')).map((r) => r.summary)).toEqual(['Created wing Operations', 'Created wing Admin']);
    const emp = await mkEmp({ empCode: '777', name: 'Arslan Alam Khan', wingId: ops.id });
    const created = await one('employee.create');
    expect(created).toMatchObject({ entity_type: 'employee', entity_id: String(emp.id), entity_label: '777 · Arslan Alam Khan', category: 'create' });
    expect(created.summary).toBe('Added employee 777 · Arslan Alam Khan to Operations');

    const upd = await api.put(`${V1}/employees/${emp.id}`).send({ wingId: adm.id, devicePassword: 'secret-4242', phone: '0300' });
    expect(upd.status).toBe(200);
    const e = await one('employee.update');
    expect(e.summary).toMatch(/^Edited employee 777 · Arslan Alam Khan: wing Operations -> Admin/);
    expect(e.changes).toEqual(
      expect.arrayContaining([
        { field: 'wing', before: 'Operations', after: 'Admin' },
        { field: 'phone', before: null, after: '0300' },
        { field: 'device password', before: '[redacted]', after: '[redacted]' },
      ]),
    );
    expect(JSON.stringify(e)).not.toContain('secret-4242');
    expect(e.changes?.some((c) => c.field === 'name')).toBe(false);

    expect((await api.delete(`${V1}/employees/${emp.id}`)).status).toBe(204);
    const del = await one('employee.delete');
    expect(del.summary).toBe('Deleted employee 777 · Arslan Alam Khan (Admin)');
    expect(del.category).toBe('delete');
  });

  it('wing rename and delete', async () => {
    const d = await mkDept('Ops');
    await api.put(`${V1}/wings/${d.id}`).send({ name: 'Operations' });
    const u = await one('wing.update');
    expect(u.summary).toBe('Renamed wing Ops -> Operations');
    expect(u.changes).toEqual([{ field: 'name', before: 'Ops', after: 'Operations' }]);
    await api.delete(`${V1}/wings/${d.id}`);
    expect((await one('wing.delete')).summary).toBe('Deleted wing Operations');
  });

  it('devices: create/update/delete/command and device users', async () => {
    const dev = await createDevice('AUD0001', 'Basement');
    expect((await one('device.create')).summary).toBe('Added device Basement (serial AUD0001)');
    await api.put(`${V1}/devices/${dev.id}`).send({ location: 'Gate 2', name: 'Basement Gate' });
    const upd = await one('device.update');
    expect(upd.changes).toEqual(expect.arrayContaining([{ field: 'name', before: 'Basement', after: 'Basement Gate' }, { field: 'location', before: null, after: 'Gate 2' }]));
    expect(upd.summary).toMatch(/^Edited device Basement Gate: /);

    expect((await api.post(`${V1}/devices/${dev.id}/commands`).send({ type: 'reboot' })).status).toBe(201);
    const cmd = await one('device.command');
    expect(cmd).toMatchObject({ category: 'device', entity_type: 'device', entity_id: String(dev.id) });
    expect(cmd.metadata).toMatchObject({ commandType: 'reboot', deviceName: 'Basement Gate' });

    await api.post(`${V1}/devices/${dev.id}/users/fetch`);
    expect((await one('device_users.fetch')).metadata).toMatchObject({ queued: 3 });

    await pool.query(`INSERT INTO device_users (device_id, pin, name) VALUES ($1, '5', 'Five'), ($1, '6', 'Six'), ($1, 'abc', 'Bad')`, [dev.id]);
    await api.post(`${V1}/devices/${dev.id}/users/import`).send({});
    const imp = await one('device_users.import');
    expect(imp.category).toBe('create');
    expect(imp.metadata).toMatchObject({ created: 2, updated: 0, skipped: 1 });
    expect(imp.summary).toBe('Imported device users from Basement Gate as employees: 2 created, 0 updated, 1 skipped');

    await api.delete(`${V1}/devices/${dev.id}/users/5`);
    expect((await one('device_users.remove')).metadata).toMatchObject({ pin: '5' });

    const emp = await mkEmp({ empCode: '9', name: 'Nine' });
    void emp;
    await api.post(`${V1}/employees/push`).send({ employeeIds: 'all', deviceIds: [dev.id] });
    const push = await one('employee.push');
    expect(push.category).toBe('device');
    expect(push.metadata).toMatchObject({ employees: 3, devices: [{ id: dev.id, name: 'Basement Gate' }] });
    expect(push.summary).toMatch(/^Sent 3 employees to 1 device \(Basement Gate\): \d+ commands queued$/);

    await api.delete(`${V1}/devices/${dev.id}`);
    expect((await one('device.delete')).summary).toBe('Deleted device Basement Gate (serial AUD0001)');
  });
});

describe('users and roles', () => {
  it('user lifecycle uses role names, never passwords', async () => {
    const r1 = await mkRole({ name: 'Clerks' });
    const r2 = await mkRole({ name: 'Managers' });
    const created = await api.post(`${V1}/users`).send({ email: 'sam@test.nacta', name: 'Sam', roleIds: [r1.id], temporaryPassword: TEMP });
    expect(created.status).toBe(201);
    const uid = created.body.id as number;
    const c = await one('user.create');
    expect(c.summary).toContain('Sam (sam@test.nacta) with role Clerks');
    expect(JSON.stringify(c)).not.toContain(TEMP);

    await api.put(`${V1}/users/${uid}`).send({ roleIds: [r2.id], status: 'disabled' });
    const u = await one('user.update');
    expect(u.changes).toEqual(
      expect.arrayContaining([
        { field: 'status', before: 'active', after: 'disabled' },
        { field: 'roles', before: ['Clerks'], after: ['Managers'] },
      ]),
    );
    expect(u.summary).toMatch(/roles Clerks -> Managers/);
    expect(JSON.stringify(u.changes)).not.toMatch(/\d/); // role names, not ids

    await api.post(`${V1}/users/${uid}/reset-password`).send({ temporaryPassword: NEW_TEMP });
    const rp = await one('user.reset_password');
    expect(rp.category).toBe('security');
    expect(JSON.stringify(rp)).not.toContain(NEW_TEMP);

    await api.post(`${V1}/users/${uid}/unlock`);
    expect((await one('user.unlock')).entity_id).toBe(String(uid));
    await api.post(`${V1}/users/${uid}/revoke-sessions`);
    expect((await one('user.revoke_sessions')).metadata).toMatchObject({ revoked: 0 });
    await api.delete(`${V1}/users/${uid}`);
    expect((await one('user.delete')).summary).toBe('Deleted user Sam (sam@test.nacta)');
    // The snapshot keeps the actor readable even though the user row is gone.
    expect((await one('user.delete')).user_email).toBe(ADMIN_EMAIL);
  });

  it('role create/update/delete show permissions and wing scope in readable form', async () => {
    const ops = await mkDept('Operations');
    const role = await mkRole({ name: 'Viewers', permissions: ['attendance.view', 'employees.view'] });
    expect((await one('role.create')).summary).toBe('Created role Viewers (2 permissions; All wings)');
    const res = await api.put(`${V1}/roles/${role.id}`).send({ name: 'Viewers', permissions: ['attendance.view', 'devices.view'], allWings: false, wingIds: [ops.id] });
    expect(res.status).toBe(200);
    const u = await one('role.update');
    expect(u.changes).toEqual([
      { field: 'permissions added', before: null, after: ['View devices'] },
      { field: 'permissions removed', before: ['View employees'], after: null },
      { field: 'wing scope', before: 'All wings', after: 'Operations' },
    ]);
    expect(u.summary).toBe('Edited role Viewers: added View devices; removed View employees; wings All wings -> Operations');
    await api.delete(`${V1}/roles/${role.id}`);
    expect((await one('role.delete')).summary).toBe('Deleted role Viewers');
  });
});

describe('redaction and diff helpers', () => {
  it('redacts sensitive keys everywhere, including nested metadata and hashes', () => {
    const out = redact({
      password: 'a',
      temporaryPassword: 'b',
      devicePassword: 'c',
      csrfToken: 'd',
      nested: { password_hash: 'x', list: [{ Password: 'z' }], ok: 'fine' },
      hash: '$argon2id$v=19$m=1,t=1,p=1$abc',
    });
    expect(out).toEqual({
      password: '[redacted]',
      temporaryPassword: '[redacted]',
      devicePassword: '[redacted]',
      csrfToken: '[redacted]',
      nested: { password_hash: '[redacted]', list: [{ Password: '[redacted]' }], ok: 'fine' },
      hash: '[redacted]',
    });
  });

  it('diff reports changed fields only, with labels', () => {
    expect(diff({ a: 1, b: 'x', c: null }, { a: 1, b: 'y', c: undefined, d: 2 }, ['a', 'b', 'c', 'd'], { b: 'bee' })).toEqual([
      { field: 'bee', before: 'x', after: 'y' },
      { field: 'd', before: null, after: 2 },
    ]);
    expect(diff({ devicePassword: 'p' }, { devicePassword: 'q' }, ['devicePassword'])).toEqual([
      { field: 'devicePassword', before: '[redacted]', after: '[redacted]' },
    ]);
  });
});

describe('append-only enforcement', () => {
  it('UPDATE, DELETE and TRUNCATE fail at the database level', async () => {
    await api.post(`${V1}/wings`).send({ name: 'X' });
    await flushAudit();
    await expect(pool.query(`UPDATE audit_logs SET summary = 'tampered'`)).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM audit_logs`)).rejects.toThrow(/append-only/);
    await expect(pool.query(`TRUNCATE audit_logs`)).rejects.toThrow(/append-only/);
    await expect(pool.query(`TRUNCATE users CASCADE`)).resolves.toBeDefined(); // no FK: users can still be reset
    await expect(pool.query(`INSERT INTO audit_logs (action, category, outcome, summary) VALUES ('x','auth','bogus','s')`)).rejects.toThrow();
  });
});

describe('safety nets', () => {
  it('logs access.denied (rate limited per session and route) with route and permission', async () => {
    const c = await userClient({ permissions: ['employees.view'], name: 'Low User' });
    expect((await c.get(`${V1}/users`)).status).toBe(403);
    expect((await c.get(`${V1}/users`)).status).toBe(403);
    expect((await c.get(`${V1}/roles`)).status).toBe(403);
    const d = await rows('access.denied');
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ outcome: 'denied', category: 'security', user_name: 'Low User' });
    expect(d[0]?.metadata).toMatchObject({ route: 'GET /users', permission: 'users.manage' });
    expect(d[0]?.summary).toBe('Denied: GET /users needs "Manage users"');
  });

  it('logs wing-scope denials (404 outside scope, 403 on wing creation)', async () => {
    const mine = await mkDept('Mine');
    const other = await mkDept('Other');
    const emp = await mkEmp({ empCode: '50', name: 'Elsewhere', wingId: other.id });
    const c = await userClient({ permissions: ['employees.view', 'wings.manage'], wings: [mine.id] });
    const res = await c.get(`${V1}/employees/${emp.id}`);
    expect(res.status).toBe(404);
    expect((await c.post(`${V1}/wings`).send({ name: 'New' })).status).toBe(403);
    const d = await rows('access.denied');
    expect(d.map((x) => (x.metadata as { route: string }).route).sort()).toEqual(['GET /employees/:id', 'POST /wings']);
    expect((await c.get(`${V1}/employees/99999`)).status).toBe(404);
    expect(await rows('access.denied')).toHaveLength(2); // a genuinely missing id is not a denial
  });

  it('writes api.write for unaudited successful writes (method, path, status only)', async () => {
    const emp = await mkEmp({ empCode: '1', name: 'Same' });
    const res = await api.put(`${V1}/employees/${emp.id}`).send({ name: 'Same', phone: null });
    expect(res.status).toBe(200);
    const w = await one('api.write');
    expect(w.metadata).toEqual({ method: 'PUT', path: `/employees/${emp.id}`, status: 200 });
    expect(w.summary).toBe(`PUT /employees/${emp.id} -> 200`);
    expect(JSON.stringify(w)).not.toContain('phone');
    expect(await rows('employee.update')).toHaveLength(0);
    // failures and explicitly audited writes do not produce api.write
    await api.put(`${V1}/employees/99999`).send({ name: 'x' });
    await api.post(`${V1}/audit/views`).send({ path: '/x', title: 'X' });
    expect(await rows('api.write')).toHaveLength(1);
  });
});

describe('page views', () => {
  it('stores view.page, dedupes per session and path within a minute, returns 204', async () => {
    const body = { path: '/employees/273', title: 'Employee profile', entityType: 'employee', entityId: '273', entityLabel: '273 · Someone', query: { tab: 'activity' } };
    expect((await api.post(`${V1}/audit/views`).send(body)).status).toBe(204);
    expect((await api.post(`${V1}/audit/views`).send(body)).status).toBe(204);
    expect((await api.post(`${V1}/audit/views`).send({ path: '/devices', title: 'Devices' })).status).toBe(204);
    const v = await rows('view.page');
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ summary: 'Viewed Employee profile', entity_type: 'employee', entity_id: '273', entity_label: '273 · Someone', category: 'view' });
    expect(v[0]?.metadata).toEqual({ path: '/employees/273', query: { tab: 'activity' } });
    // another session views the same page: logged again
    const other = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    await other.post(`${V1}/audit/views`).send(body);
    expect(await rows('view.page')).toHaveLength(3);
  });

  it('is open to users without audit.view but needs CSRF, valid input and no pending password change', async () => {
    const c = await userClient({ permissions: [] });
    expect((await c.post(`${V1}/audit/views`).send({ path: '/', title: 'Home' })).status).toBe(204);
    expect((await c.noCsrf('post', `${V1}/audit/views`).send({ path: '/', title: 'Home' })).status).toBe(403);
    expect((await c.post(`${V1}/audit/views`).send({ title: 'no path' })).status).toBe(400);
    expect((await rawApi.post(`${V1}/audit/views`).send({ path: '/', title: 'x' })).status).toBe(401);
    const m = await insertUser({ mustChangePassword: true });
    const mc = await loginAs(m.email, m.password);
    expect((await mc.post(`${V1}/audit/views`).send({ path: '/', title: 'x' })).status).toBe(403);
  });
});

describe('reading the log', () => {
  it('requires audit.view', async () => {
    const c = await userClient({ permissions: ['employees.view'] });
    for (const url of ['/audit', '/audit/summary', '/audit/export', '/audit/1']) {
      expect((await c.get(`${V1}${url}`)).status, url).toBe(403);
    }
    const ok = await userClient({ permissions: ['audit.view'] });
    expect((await ok.get(`${V1}/audit`)).status).toBe(200);
  });

  it('filters, searches, paginates and returns entries by id', async () => {
    const tok = `t${Math.random().toString(36).slice(2, 8)}`;
    const dev = await createDevice('FLT0001', `Filter ${tok}`);
    await api.post(`${V1}/devices/${dev.id}/commands`).send({ type: 'info' });
    await mkDept(`Zebra ${tok}`);
    await flushAudit();
    const get = async (qs: string) => (await api.get(`${V1}/audit?${qs}`)).body as { items: AuditEntry[]; total: number; page: number; pageSize: number };
    const since = `from=2000-01-01&q=${tok}`;
    expect((await get(`${since}&action=device.command`)).items).toHaveLength(1);
    expect((await get(`${since}&category=create`)).items.map((i) => i.action).sort()).toEqual(['device.create', 'wing.create']);
    expect((await get(`from=2000-01-01&q=${encodeURIComponent(`Zebra ${tok}`)}`)).items.map((i) => i.action)).toEqual(['wing.create']);
    expect((await get(`${since}&entityType=device&entityId=${dev.id}`)).total).toBe(2);
    expect((await get(`from=2000-01-01&q=100%25`)).total).toBe(0); // LIKE wildcards are literal
    const asc = await get(`${since}&entityType=device&order=asc&pageSize=1`);
    expect(asc.items).toHaveLength(1);
    expect(asc.total).toBe(2);
    expect(asc.items[0]?.action).toBe('device.create');
    const desc = await get(`${since}&entityType=device&pageSize=1&page=2`);
    expect(desc.items[0]?.action).toBe('device.create');
    expect((await get(`${since}&outcome=denied`)).total).toBe(0);
    expect((await get(`to=2000-01-01`)).total).toBe(0);
    expect((await api.get(`${V1}/audit?action=nope`)).status).toBe(400);
    expect((await api.get(`${V1}/audit?sort=summary`)).status).toBe(400);

    const first = (await get(`${since}&action=device.command`)).items[0] as AuditEntry;
    const byId = await api.get(`${V1}/audit/${first.id}`);
    expect(byId.status).toBe(200);
    expect(byId.body).toEqual(first);
    expect(first).toMatchObject({ userEmail: ADMIN_EMAIL, entityType: 'device', outcome: 'success', category: 'device' });
    expect((await api.get(`${V1}/audit/99999999`)).status).toBe(404);
    expect((await api.get(`${V1}/audit/abc`)).status).toBe(404);
  });

  it('summary counts the period (default last 7 days)', async () => {
    const u = await insertUser({ email: 's@test.nacta' });
    await loginAs(u.email, u.password);
    await rawApi.post(`${V1}/auth/login`).send({ email: 'nobody@test.nacta', password: 'x-Wrong-pw-1!' });
    await api.post(`${V1}/audit/views`).send({ path: '/s', title: 'S' });
    const c = await userClient({ permissions: [] });
    await c.get(`${V1}/users`);
    await mkDept('Counted');
    await flushAudit();
    const base = (await api.get(`${V1}/audit/summary?from=2000-01-01&to=2000-01-02`)).body;
    expect(base).toEqual({ total: 0, signIns: 0, failedSignIns: 0, changes: 0, exports: 0, denied: 0, activeUsers: 0 });
    const s = (await api.get(`${V1}/audit/summary`)).body as Record<string, number>;
    // Rows from earlier tests stay in the table, so compare against this test's own rows.
    const mine = await rows();
    const count = (f: (r: Row) => boolean) => mine.filter(f).length;
    expect(count((r) => r.action === 'auth.login')).toBe(2);
    expect(s.total).toBeGreaterThanOrEqual(mine.length);
    expect(s.signIns).toBeGreaterThanOrEqual(2);
    expect(s.failedSignIns).toBeGreaterThanOrEqual(1);
    expect(s.changes).toBeGreaterThanOrEqual(1);
    expect(s.denied).toBeGreaterThanOrEqual(1);
    expect(s.activeUsers).toBeGreaterThanOrEqual(2);
    expect((await api.get(`${V1}/audit/summary?from=bad`)).status).toBe(400);
  });
});

describe('CSV export', () => {
  it('streams a UTF-8 BOM CSV with a header, honours filters and audits itself', async () => {
    const tok = `t${Math.random().toString(36).slice(2, 8)}`;
    await mkDept(`=Wing "x", ${tok}`);
    await mkEmp({ empCode: '12', name: `Ünïcode ${tok}` });
    await flushAudit();
    const res = await api
      .get(`${V1}/audit/export?from=2000-01-01&category=create&q=${tok}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (d: Buffer) => chunks.push(d));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="nacta-audit-\d{8}-\d{4}\.csv"$/);
    const buf = res.body as Buffer;
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = buf.toString('utf8').slice(1);
    const lines = text.trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      '"ID","Time (Asia/Karachi)","User","Email","Action","Category","Outcome","Entity type","Entity ID","Entity","Summary","Changes","IP","Request ID"',
    );
    expect(lines).toHaveLength(3); // header + department.create + employee.create (category=create)
    expect(text).toContain(`"'=Wing ""x"", ${tok}"`); // formula guard + quote escaping
    expect(text).toContain(`Ünïcode ${tok}`);
    expect(text).toContain('employee.create');

    const exp = await one('audit.export');
    expect(exp).toMatchObject({ category: 'export', entity_type: 'export', outcome: 'success' });
    expect(exp.metadata).toMatchObject({ rowCount: 2, filters: { from: '2000-01-01', category: 'create', q: tok }, truncated: false });
    expect(exp.entity_label).toMatch(/^nacta-audit-\d{8}-\d{4}\.csv$/);
    expect(exp.summary).toBe('Exported the audit log (2 rows)');
    // a second export now includes the first export entry (audit_logs is append-only and shared by all test files,
    // so other files' exports may be there too: look for this one by id)
    const again = await api.get(`${V1}/audit/export?from=2000-01-01&action=audit.export`).buffer(true);
    expect(again.text).toContain(`"${exp.id}","`);
  });
});

describe('client IP behind the dev proxy', () => {
  it('uses X-Forwarded-For from a loopback hop for audit, sessions and last_login_ip', async () => {
    const u = await insertUser({ email: 'lan@test.nacta' });
    resetLoginRateLimit();
    const res = await rawApi.post(`${V1}/auth/login`).set('X-Forwarded-For', '192.168.1.77').send({ email: u.email, password: u.password });
    expect(res.status).toBe(200);
    expect((await one('auth.login')).ip).toBe('192.168.1.77');
    const s = await pool.query<{ ip: string }>('SELECT ip FROM sessions WHERE user_id = $1', [u.id]);
    expect(s.rows[0]?.ip).toBe('192.168.1.77');
    const lu = await pool.query<{ last_login_ip: string }>('SELECT last_login_ip FROM users WHERE id = $1', [u.id]);
    expect(lu.rows[0]?.last_login_ip).toBe('192.168.1.77');
  });

  it('rate limits login per forwarded client, not per proxy', async () => {
    resetLoginRateLimit();
    let last = 0;
    for (let i = 0; i < 40; i++) {
      last = (await rawApi.post(`${V1}/auth/login`).set('X-Forwarded-For', '10.0.0.1').send({ email: 'x@test.nacta', password: 'p' })).status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
    const other = await rawApi.post(`${V1}/auth/login`).set('X-Forwarded-For', '10.0.0.2').send({ email: 'x@test.nacta', password: 'p' });
    expect(other.status).not.toBe(429);
    resetLoginRateLimit();
  });

  it('ADMS ignores X-Forwarded-For and records the socket address', async () => {
    const res = await adms.get('/iclock/cdata?SN=XFF0001&options=all').set('X-Forwarded-For', '10.9.9.9');
    expect(res.status).toBe(200);
    const { rows: r } = await pool.query<{ remote_ip: string }>('SELECT remote_ip FROM adms_requests WHERE serial_number = $1', ['XFF0001']);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]?.remote_ip).toMatch(/^(127\.0\.0\.1|::1)$/);
  });
});

