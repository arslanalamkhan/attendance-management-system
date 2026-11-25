import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PERMISSIONS, PERMISSION_KEYS, zAppUser, zErrorBody, zPage, zRole } from '@nacta/shared';
import { ADMIN_EMAIL, api, closeDb, insertUser, loginAs, pool, rawApi, resetDb, userClient, V1 } from './helpers';

beforeEach(resetDb);
afterAll(closeDb);

const TEMP = 'Violet-Harbor-Quartz-52!';
const q = <T>(sql: string, params: unknown[] = []) => pool.query(sql, params).then((r) => r.rows as T[]);

async function mkRole(over: Record<string, unknown> = {}) {
  const res = await api.post(`${V1}/roles`).send({ name: 'Clerks', permissions: ['employees.view'], ...over });
  if (res.status !== 201) throw new Error(`mkRole: ${res.status} ${JSON.stringify(res.body)}`);
  return zRole.parse(res.body);
}
async function mkUser(over: Record<string, unknown> = {}) {
  const role = over.roleIds ? null : await mkRole({ name: `Role ${Math.random().toString(36).slice(2)}` });
  const res = await api
    .post(`${V1}/users`)
    .send({ email: `u${Math.random().toString(36).slice(2, 8)}@test.nacta`, name: 'Some User', roleIds: [role?.id], temporaryPassword: TEMP, ...over });
  if (res.status !== 201) throw new Error(`mkUser: ${res.status} ${JSON.stringify(res.body)}`);
  return zAppUser.parse(res.body);
}
const adminId = async () => (await q<{ id: number }>(`SELECT id FROM users WHERE lower(email) = $1`, [ADMIN_EMAIL]))[0]!.id;

describe('GET /permissions', () => {
  it('returns the catalogue to roles.manage or users.manage only', async () => {
    const res = await api.get(`${V1}/permissions`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(PERMISSIONS);
    expect((await (await userClient({ permissions: ['users.manage'] })).get(`${V1}/permissions`)).status).toBe(200);
    expect((await (await userClient({ permissions: ['roles.manage'] })).get(`${V1}/permissions`)).status).toBe(200);
    expect((await (await userClient({ permissions: ['employees.view'] })).get(`${V1}/permissions`)).status).toBe(403);
  });
});

describe('roles', () => {
  it('lists the built-in Super Admin role first, with every permission', async () => {
    const res = await api.get(`${V1}/roles`);
    expect(res.status).toBe(200);
    const roles = zRole.array().parse(res.body);
    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({ name: 'Super Admin', isSystem: true, allWings: true, wingIds: [], userCount: 1 });
    expect(roles[0]!.permissions).toEqual(PERMISSION_KEYS);
  });

  it('creates from scratch, normalises, rejects duplicates case-insensitively (409 DUPLICATE_ROLE)', async () => {
    const dep = await api.post(`${V1}/wings`).send({ name: 'Wing A' });
    const res = await api.post(`${V1}/roles`).send({
      name: '  Wing A Clerks ',
      description: '  ',
      permissions: ['employees.view', 'attendance.view', 'employees.view'],
      allWings: false,
      wingIds: [dep.body.id, dep.body.id],
    });
    expect(res.status).toBe(201);
    const role = zRole.parse(res.body);
    expect(role).toMatchObject({
      name: 'Wing A Clerks',
      description: null,
      isSystem: false,
      allWings: false,
      wingIds: [dep.body.id],
      userCount: 0,
      permissions: ['employees.view', 'attendance.view'], // catalogue order, de-duplicated
    });

    for (const name of ['wing a clerks', 'WING A CLERKS', 'super admin']) {
      const dup = await api.post(`${V1}/roles`).send({ name, permissions: [] });
      expect([name, dup.status, dup.body.error.code]).toEqual([name, 409, 'DUPLICATE_ROLE']);
    }
    // defaults: all wings, no description
    const plain = zRole.parse((await api.post(`${V1}/roles`).send({ name: 'Plain', permissions: [] })).body);
    expect(plain).toMatchObject({ allWings: true, wingIds: [], description: null, permissions: [] });
  });

  it('validates input with field-keyed details', async () => {
    const bad = await api.post(`${V1}/roles`).send({ name: '', permissions: ['nope.nope'] });
    expect(bad.status).toBe(400);
    expect(Object.keys(zErrorBody.parse(bad.body).error.details as object).sort()).toEqual(['name', 'permissions']);

    const noWings = await api.post(`${V1}/roles`).send({ name: 'X', permissions: [], allWings: false, wingIds: [] });
    expect(noWings.status).toBe(400);
    expect(noWings.body.error.details).toHaveProperty('wingIds');

    const ghost = await api.post(`${V1}/roles`).send({ name: 'X', permissions: [], allWings: false, wingIds: [4242] });
    expect(ghost.status).toBe(400);
    expect(ghost.body.error.details).toEqual({ wingIds: 'One or more wings do not exist' });

    expect((await api.post(`${V1}/roles`).send({ permissions: [] })).body.error.details).toHaveProperty('name');
    expect((await api.post(`${V1}/roles`).send({ name: 'x'.repeat(61), permissions: [] })).status).toBe(400);
  });

  it('updates name, permissions and wings; 409 on a taken name; 404 when missing', async () => {
    const a = await mkRole({ name: 'Alpha' });
    const b = await mkRole({ name: 'Beta' });
    const dep = await api.post(`${V1}/wings`).send({ name: 'W' });

    const upd = await api
      .put(`${V1}/roles/${a.id}`)
      .send({ name: 'Alpha 2', description: 'desc', permissions: ['devices.view'], allWings: false, wingIds: [dep.body.id] });
    expect(upd.status).toBe(200);
    expect(zRole.parse(upd.body)).toMatchObject({ name: 'Alpha 2', description: 'desc', permissions: ['devices.view'], allWings: false, wingIds: [dep.body.id] });
    expect(Date.parse(upd.body.updatedAt)).toBeGreaterThanOrEqual(Date.parse(a.updatedAt));

    const back = await api.put(`${V1}/roles/${a.id}`).send({ name: 'Alpha 2', permissions: [], allWings: true });
    expect(zRole.parse(back.body)).toMatchObject({ allWings: true, wingIds: [], permissions: [] });
    expect(await q('SELECT 1 FROM role_wings WHERE role_id = $1', [a.id])).toHaveLength(0);

    expect((await api.put(`${V1}/roles/${a.id}`).send({ name: 'beta', permissions: [] })).status).toBe(409);
    expect((await api.put(`${V1}/roles/9999`).send({ name: 'Z', permissions: [] })).status).toBe(404);
    expect((await api.put(`${V1}/roles/abc`).send({ name: 'Z', permissions: [] })).status).toBe(404);
    expect(b.id).toBeGreaterThan(0);
  });

  it('changing a role takes effect for signed-in users immediately', async () => {
    const u = await userClient({ permissions: ['devices.view'] });
    const { roleId } = await insertUser({ permissions: [] }); // unrelated role
    expect(roleId).toBeGreaterThan(0);
    expect((await u.get(`${V1}/devices`)).status).toBe(200);
    const role = (await q<{ role_id: number }>('SELECT role_id FROM user_roles WHERE user_id = $1', [u.id]))[0]!;
    await api.put(`${V1}/roles/${role.role_id}`).send({ name: 'Renamed', permissions: ['employees.view'] });
    expect((await u.get(`${V1}/devices`)).status).toBe(403);
    expect((await u.get(`${V1}/employees`)).status).toBe(200);
    const me = await u.get(`${V1}/auth/me`);
    expect(me.body.user.permissions).toEqual(['employees.view']);
  });

  it('protects the system role: PROTECTED_ROLE on edit and delete', async () => {
    const sys = zRole.array().parse((await api.get(`${V1}/roles`)).body)[0]!;
    const put = await api.put(`${V1}/roles/${sys.id}`).send({ name: 'Hacked', permissions: [] });
    expect([put.status, put.body.error.code]).toEqual([403, 'PROTECTED_ROLE']);
    const del = await api.delete(`${V1}/roles/${sys.id}`);
    expect([del.status, del.body.error.code]).toEqual([403, 'PROTECTED_ROLE']);
    expect((await q('SELECT 1 FROM roles WHERE is_system'))).toHaveLength(1);
  });

  it('refuses to delete a role that has users (409 CONFLICT with the count), deletes an unused one', async () => {
    const role = await mkRole({ name: 'Busy' });
    await mkUser({ roleIds: [role.id] });
    await mkUser({ roleIds: [role.id] });
    const del = await api.delete(`${V1}/roles/${role.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('CONFLICT');
    expect(del.body.error.details).toEqual({ userCount: 2 });
    expect(del.body.error.message).toContain('2 users');

    const free = await mkRole({ name: 'Free' });
    expect((await api.delete(`${V1}/roles/${free.id}`)).status).toBe(204);
    expect((await api.delete(`${V1}/roles/${free.id}`)).status).toBe(404);
  });

  it('GET /roles is open to users.manage; writes need roles.manage', async () => {
    const um = await userClient({ permissions: ['users.manage'] });
    expect((await um.get(`${V1}/roles`)).status).toBe(200);
    expect((await um.post(`${V1}/roles`).send({ name: 'Nope', permissions: [] })).status).toBe(403);
    const rm = await userClient({ permissions: ['roles.manage'] });
    expect((await rm.post(`${V1}/roles`).send({ name: 'Fine', permissions: [] })).status).toBe(201);
    expect((await rm.get(`${V1}/users`)).status).toBe(403);
  });
});

describe('users', () => {
  it('creates a user with a temporary password that must be changed (201 AppUser)', async () => {
    const role = await mkRole({ name: 'Staff' });
    const res = await api.post(`${V1}/users`).send({ email: ' New.Person@Test.NACTA ', name: ' New Person ', roleIds: [role.id], temporaryPassword: TEMP });
    expect(res.status).toBe(201);
    const u = zAppUser.parse(res.body);
    expect(u).toMatchObject({
      email: 'new.person@test.nacta',
      name: 'New Person',
      status: 'active',
      isSuperAdmin: false,
      mustChangePassword: true,
      lockedUntil: null,
      lastLoginAt: null,
      activeSessions: 0,
      roles: [{ id: role.id, name: 'Staff' }],
    });
    const [row] = await q<{ created_by: number; password_hash: string }>('SELECT created_by, password_hash FROM users WHERE id = $1', [u.id]);
    expect(row!.created_by).toBe(await adminId());
    expect(row!.password_hash).toMatch(/^\$argon2id\$/);

    // can sign in, but is gated until the password is changed
    const c = await loginAs('new.person@test.nacta', TEMP);
    expect((await c.get(`${V1}/devices`)).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(zAppUser.parse((await api.get(`${V1}/users/${u.id}`)).body).activeSessions).toBe(1);
  });

  it('409 DUPLICATE_EMAIL (case-insensitive)', async () => {
    const role = await mkRole();
    await mkUser({ email: 'dup@test.nacta', roleIds: [role.id] });
    const dup = await api.post(`${V1}/users`).send({ email: 'DUP@test.nacta', name: 'X', roleIds: [role.id], temporaryPassword: TEMP });
    expect([dup.status, dup.body.error.code]).toEqual([409, 'DUPLICATE_EMAIL']);
    const admin = await api.post(`${V1}/users`).send({ email: ADMIN_EMAIL, name: 'X', roleIds: [role.id], temporaryPassword: TEMP });
    expect(admin.status).toBe(409);
  });

  it('validates fields, roles and the password policy', async () => {
    const role = await mkRole();
    const bad = await api.post(`${V1}/users`).send({ email: 'nope', name: '', roleIds: [], temporaryPassword: 'short' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.details).sort()).toEqual(['email', 'name', 'roleIds', 'temporaryPassword']);

    const send = (over: Record<string, unknown>) =>
      api.post(`${V1}/users`).send({ email: 'jane.doe@test.nacta', name: 'Jane', roleIds: [role.id], temporaryPassword: TEMP, ...over });
    const common = await send({ temporaryPassword: 'Password123!' });
    expect(common.body.error.details.temporaryPassword).toMatch(/too common/);
    const withEmail = await send({ temporaryPassword: 'Violet-Jane.Doe-Quartz-52!' });
    expect(withEmail.body.error.details.temporaryPassword).toMatch(/email name/);

    const ghostRole = await send({ roleIds: [9999] });
    expect(ghostRole.status).toBe(400);
    expect(ghostRole.body.error.details).toEqual({ roleIds: 'One or more roles do not exist' });
    expect((await send({ roleIds: [role.id, 9999] })).status).toBe(400);

    const sys = zRole.array().parse((await api.get(`${V1}/roles`)).body)[0]!;
    const super2 = await send({ roleIds: [sys.id] });
    expect([super2.status, super2.body.error.code]).toEqual([403, 'PROTECTED_ROLE']);
    expect(await q(`SELECT 1 FROM users WHERE email = 'jane.doe@test.nacta'`)).toHaveLength(0);
  });

  it('lists as a Page with search, status and role filters and sorting', async () => {
    const r1 = await mkRole({ name: 'R1' });
    const r2 = await mkRole({ name: 'R2' });
    const zed = await mkUser({ email: 'zed@test.nacta', name: 'Zed', roleIds: [r1.id] });
    const amy = await mkUser({ email: 'amy@test.nacta', name: 'Amy', roleIds: [r2.id] });
    await api.put(`${V1}/users/${amy.id}`).send({ status: 'disabled' });

    const res = await api.get(`${V1}/users`);
    const page = zPage(zAppUser).parse(res.body);
    expect(page).toMatchObject({ total: 3, page: 1, pageSize: 50 });
    expect(page.items.map((u) => u.name)).toEqual(['Amy', 'Test Admin', 'Zed']);
    expect(page.items.find((u) => u.email === ADMIN_EMAIL)).toMatchObject({ isSuperAdmin: true, roles: [{ name: 'Super Admin' }] });

    const names = async (qs: string) => (await api.get(`${V1}/users?${qs}`)).body.items.map((u: { name: string }) => u.name);
    expect(await names('q=ZE')).toEqual(['Zed']);
    expect(await names('q=amy@')).toEqual(['Amy']);
    expect(await names('status=disabled')).toEqual(['Amy']);
    expect(await names(`roleId=${r1.id}`)).toEqual(['Zed']);
    expect(await names('sort=email&order=desc')).toEqual(['Zed', 'Amy', 'Test Admin']);
    expect((await api.get(`${V1}/users?sort=email&order=asc`)).body.items.map((u: { email: string }) => u.email)).toEqual([
      'admin@test.nacta', 'amy@test.nacta', 'zed@test.nacta',
    ]);
    expect(await names('sort=createdAt&order=desc&pageSize=1&page=1')).toEqual(['Amy']);
    expect((await api.get(`${V1}/users?sort=lastLoginAt`)).status).toBe(200);
    expect((await api.get(`${V1}/users?sort=password_hash`)).status).toBe(400);
    expect((await api.get(`${V1}/users?status=maybe`)).status).toBe(400);
    expect(zed.id).toBeGreaterThan(0);
  });

  it('GET /users/:id: 404 for unknown or malformed ids', async () => {
    for (const id of ['9999', 'abc', '0']) expect((await api.get(`${V1}/users/${id}`)).status).toBe(404);
  });

  it('updates name, roles and status; disabling revokes sessions and blocks sign-in', async () => {
    const r1 = await mkRole({ name: 'R1' });
    const r2 = await mkRole({ name: 'R2' });
    const u = await insertUser({ permissions: ['devices.view'] });
    const target = zAppUser.parse((await api.get(`${V1}/users/${u.id}`)).body);
    const c = await loginAs(u.email, u.password);
    expect(zAppUser.parse((await api.get(`${V1}/users/${u.id}`)).body).activeSessions).toBe(1);

    const upd = await api.put(`${V1}/users/${u.id}`).send({ name: 'Renamed', roleIds: [r1.id, r2.id, r1.id] });
    expect(upd.status).toBe(200);
    expect(zAppUser.parse(upd.body)).toMatchObject({ name: 'Renamed', roles: [{ name: 'R1' }, { name: 'R2' }], status: 'active' });
    expect(target.roles).toHaveLength(1);
    expect((await api.put(`${V1}/users/${u.id}`).send({})).status).toBe(200);

    const dis = await api.put(`${V1}/users/${u.id}`).send({ status: 'disabled' });
    expect(zAppUser.parse(dis.body)).toMatchObject({ status: 'disabled', activeSessions: 0 });
    expect((await c.get(`${V1}/auth/me`)).status).toBe(401);
    const blocked = await rawApi.post(`${V1}/auth/login`).send({ email: u.email, password: u.password });
    expect([blocked.status, blocked.body.error.code]).toEqual([403, 'ACCOUNT_DISABLED']);

    expect(zAppUser.parse((await api.put(`${V1}/users/${u.id}`).send({ status: 'active' })).body).status).toBe('active');
    expect((await rawApi.post(`${V1}/auth/login`).send({ email: u.email, password: u.password })).status).toBe(200);

    expect((await api.put(`${V1}/users/${u.id}`).send({ name: '' })).status).toBe(400);
    expect((await api.put(`${V1}/users/${u.id}`).send({ roleIds: [] })).status).toBe(400);
    expect((await api.put(`${V1}/users/${u.id}`).send({ roleIds: [9999] })).body.error.details).toEqual({ roleIds: 'One or more roles do not exist' });
    expect((await api.put(`${V1}/users/${u.id}`).send({ status: 'gone' })).status).toBe(400);
    expect((await api.put(`${V1}/users/9999`).send({ name: 'x' })).status).toBe(404);
  });

  it('role changes are visible to the user on the next request', async () => {
    const u = await userClient({});
    expect((await u.get(`${V1}/employees`)).status).toBe(403);
    const role = await mkRole({ name: 'Viewer', permissions: ['employees.view'] });
    await api.put(`${V1}/users/${u.id}`).send({ roleIds: [role.id] });
    expect((await u.get(`${V1}/employees`)).status).toBe(200);
  });

  it('users cannot delete or disable themselves', async () => {
    const me = await userClient({ permissions: ['users.manage'] });
    const dis = await me.put(`${V1}/users/${me.id}`).send({ status: 'disabled' });
    expect([dis.status, dis.body.error.code]).toEqual([403, 'FORBIDDEN']);
    const del = await me.delete(`${V1}/users/${me.id}`);
    expect([del.status, del.body.error.code]).toEqual([403, 'FORBIDDEN']);
    expect((await me.get(`${V1}/auth/me`)).status).toBe(200);
    expect((await q('SELECT 1 FROM users WHERE id = $1', [me.id]))).toHaveLength(1);
  });

  it('deletes a user (204) and their sessions go with them', async () => {
    const u = await userClient({ permissions: ['devices.view'] });
    expect((await api.delete(`${V1}/users/${u.id}`)).status).toBe(204);
    expect((await u.get(`${V1}/auth/me`)).status).toBe(401);
    expect((await api.delete(`${V1}/users/${u.id}`)).status).toBe(404);
    expect(await q('SELECT 1 FROM sessions WHERE user_id = $1', [u.id])).toHaveLength(0);
  });

  it('reset-password sets a temporary password, forces a change and signs the user out everywhere', async () => {
    const u = await userClient({ permissions: ['devices.view'] });
    const other = await loginAs(u.email, u.password);
    const NEW_TEMP = 'Amber-Canyon-Lotus-83#';

    const res = await api.post(`${V1}/users/${u.id}/reset-password`).send({ temporaryPassword: NEW_TEMP });
    expect(res.status).toBe(204);
    expect((await u.get(`${V1}/auth/me`)).status).toBe(401);
    expect((await other.get(`${V1}/auth/me`)).status).toBe(401);
    expect((await rawApi.post(`${V1}/auth/login`).send({ email: u.email, password: u.password })).status).toBe(401);
    const c = await loginAs(u.email, NEW_TEMP);
    expect((await c.get(`${V1}/devices`)).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const weak = await api.post(`${V1}/users/${u.id}/reset-password`).send({ temporaryPassword: 'Password123!' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.details.temporaryPassword).toMatch(/too common/);
    expect((await api.post(`${V1}/users/${u.id}/reset-password`).send({})).status).toBe(400);
    expect((await api.post(`${V1}/users/9999/reset-password`).send({ temporaryPassword: NEW_TEMP })).status).toBe(404);
  });

  it('revoke-sessions signs the user out and reports how many sessions ended', async () => {
    const u = await userClient({});
    await loginAs(u.email, u.password);
    const res = await api.post(`${V1}/users/${u.id}/revoke-sessions`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ revoked: 2 });
    expect((await u.get(`${V1}/auth/me`)).status).toBe(401);
    expect((await api.post(`${V1}/users/${u.id}/revoke-sessions`)).body).toEqual({ revoked: 0 });
    expect(zAppUser.parse((await api.get(`${V1}/users/${u.id}`)).body).activeSessions).toBe(0);
  });

  it('unlock clears a lockout; activeSessions ignores expired sessions', async () => {
    const u = await insertUser({});
    for (let i = 0; i < 5; i++) await rawApi.post(`${V1}/auth/login`).send({ email: u.email, password: 'wrong-password' });
    const locked = zAppUser.parse((await api.get(`${V1}/users/${u.id}`)).body);
    expect(locked.lockedUntil).not.toBeNull();
    expect((await rawApi.post(`${V1}/auth/login`).send({ email: u.email, password: u.password })).status).toBe(423);

    const res = await api.post(`${V1}/users/${u.id}/unlock`);
    expect(res.status).toBe(200);
    expect(zAppUser.parse(res.body).lockedUntil).toBeNull();
    const c = await loginAs(u.email, u.password);

    expect(zAppUser.parse((await api.get(`${V1}/users/${u.id}`)).body).activeSessions).toBe(1);
    await pool.query(`UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [u.id]);
    expect(zAppUser.parse((await api.get(`${V1}/users/${u.id}`)).body).activeSessions).toBe(0);
    expect((await c.get(`${V1}/auth/me`)).status).toBe(401);
    expect((await api.post(`${V1}/users/9999/unlock`)).status).toBe(404);
  });

  it('requires users.manage on every user route', async () => {
    const u = await userClient({ permissions: ['roles.manage'] });
    expect((await u.get(`${V1}/users`)).status).toBe(403);
    expect((await u.post(`${V1}/users`).send({})).status).toBe(403);
  });
});

describe('the protected Super Admin account', () => {
  it('cannot be disabled, deleted, re-roled or unlocked; the name may change', async () => {
    const id = await adminId();
    const roleId = (await q<{ role_id: number }>('SELECT role_id FROM user_roles WHERE user_id = $1', [id]))[0]!.role_id;
    const other = await mkRole({ name: 'Other' });
    const code = (r: { status: number; body: { error?: { code: string } } }) => [r.status, r.body.error?.code];

    expect(code(await api.put(`${V1}/users/${id}`).send({ status: 'disabled' }))).toEqual([403, 'PROTECTED_ACCOUNT']);
    expect(code(await api.put(`${V1}/users/${id}`).send({ roleIds: [other.id] }))).toEqual([403, 'PROTECTED_ACCOUNT']);
    expect(code(await api.put(`${V1}/users/${id}`).send({ roleIds: [roleId, other.id] }))).toEqual([403, 'PROTECTED_ACCOUNT']);
    expect(code(await api.delete(`${V1}/users/${id}`))).toEqual([403, 'PROTECTED_ACCOUNT']);
    expect(code(await api.post(`${V1}/users/${id}/unlock`))).toEqual([403, 'PROTECTED_ACCOUNT']);

    // harmless / unchanged values are fine, so a form that resends everything still works
    const ok = await api.put(`${V1}/users/${id}`).send({ name: 'Chief Admin', status: 'active', roleIds: [roleId] });
    expect(ok.status).toBe(200);
    expect(zAppUser.parse(ok.body)).toMatchObject({ name: 'Chief Admin', isSuperAdmin: true, status: 'active' });
    expect((await api.get(`${V1}/auth/me`)).status).toBe(200);
  });

  it('other users, whatever their permissions, cannot reset its password, end its sessions or unlock it', async () => {
    const id = await adminId();
    const ops = await userClient({ permissions: ['users.manage', 'roles.manage'] });
    const code = (r: { status: number; body: { error?: { code: string } } }) => [r.status, r.body.error?.code];
    expect(code(await ops.post(`${V1}/users/${id}/reset-password`).send({ temporaryPassword: TEMP }))).toEqual([403, 'PROTECTED_ACCOUNT']);
    expect(code(await ops.post(`${V1}/users/${id}/revoke-sessions`))).toEqual([403, 'PROTECTED_ACCOUNT']);
    expect(code(await ops.post(`${V1}/users/${id}/unlock`))).toEqual([403, 'PROTECTED_ACCOUNT']);
    expect(code(await ops.put(`${V1}/users/${id}`).send({ status: 'disabled' }))).toEqual([403, 'PROTECTED_ACCOUNT']);
    expect(code(await ops.delete(`${V1}/users/${id}`))).toEqual([403, 'PROTECTED_ACCOUNT']);
    expect((await api.get(`${V1}/auth/me`)).status).toBe(200);
    expect((await rawApi.post(`${V1}/auth/login`).send({ email: ADMIN_EMAIL, password: 'whatever-wrong' })).status).toBe(401);
  });
});
