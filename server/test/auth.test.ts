import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PERMISSION_KEYS, zErrorBody, zSessionInfo, zSessionSummary } from '@nacta/shared';
import { COMMON_PASSWORDS, isCommonPassword } from '../src/modules/auth/common-passwords';
import { passwordProblem } from '../src/modules/auth/password';
import {
  adms,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  api,
  closeDb,
  config,
  insertUser,
  loginAs,
  pool,
  rawApi,
  resetDb,
  userClient,
  V1,
} from './helpers';

beforeEach(resetDb);
afterAll(closeDb);

const cookies = (res: { headers: Record<string, unknown> }) => (res.headers['set-cookie'] ?? []) as string[];
const sidCookie = (res: { headers: Record<string, unknown> }) => cookies(res).find((c) => c.startsWith('nacta_sid='));
const q = <T>(sql: string, params: unknown[] = []) => pool.query(sql, params).then((r) => r.rows as T[]);
const login = (email: string, password: string) => rawApi.post(`${V1}/auth/login`).send({ email, password });

const GOOD_PASSWORD = 'Violet-Harbor-Quartz-52!';

describe('seeding', () => {
  it('creates the Super Admin role and account once, with must_change_password', async () => {
    await pool.query('TRUNCATE sessions, user_roles, role_wings, role_permissions, roles, users RESTART IDENTITY CASCADE');
    const { seedAuth } = await import('../src/modules/auth/seed');
    await seedAuth();
    await seedAuth(); // idempotent
    const users = await q<{ email: string; name: string; must_change_password: boolean; password_hash: string }>(
      'SELECT email, name, must_change_password, password_hash FROM users',
    );
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: ADMIN_EMAIL, name: 'Test Admin', must_change_password: true });
    expect(users[0]!.password_hash).toMatch(/^\$argon2id\$/);
    expect(users[0]!.password_hash).not.toContain(config.seedAdminPassword ?? 'x');
    const roles = await q<{ name: string; is_system: boolean; all_wings: boolean }>('SELECT name, is_system, all_wings FROM roles');
    expect(roles).toEqual([{ name: 'Super Admin', is_system: true, all_wings: true }]);
    expect(await q('SELECT 1 FROM user_roles')).toHaveLength(1);
  });

  it('does not recreate the account once someone holds the role, even if renamed', async () => {
    await pool.query(`UPDATE users SET email = 'renamed@test.nacta'`);
    const { seedAuth } = await import('../src/modules/auth/seed');
    await seedAuth();
    expect((await q('SELECT 1 FROM users')).length).toBe(1);
  });
});

describe('login', () => {
  it('signs in, sets a hardened cookie and returns SessionInfo', async () => {
    const res = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(res.status).toBe(200);
    const info = zSessionInfo.parse(res.body);
    expect(info.user).toMatchObject({
      email: ADMIN_EMAIL,
      isSuperAdmin: true,
      mustChangePassword: false,
      wingScope: 'all',
      roles: [{ id: expect.any(Number), name: 'Super Admin' }],
    });
    expect(info.user.permissions).toEqual(PERMISSION_KEYS);
    expect(info.idleTimeoutMinutes).toBe(30);
    expect(info.csrfToken.length).toBeGreaterThanOrEqual(32);
    expect(Date.parse(info.expiresAt)).toBeGreaterThan(Date.now() + 11 * 3600_000);
    expect(Date.parse(info.expiresAt)).toBeLessThanOrEqual(Date.now() + 12 * 3600_000 + 5000);

    const c = sidCookie(res)!;
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Strict/i);
    expect(c).toMatch(/Path=\//);
    expect(c).not.toMatch(/Secure/i);

    // Only the sha256 of the token is stored.
    const token = decodeURIComponent(c.split(';')[0]!.split('=')[1]!);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await q<{ id: string; csrf_token: string }>(
      'SELECT id, csrf_token FROM sessions WHERE id = $1',
      [createHash('sha256').update(token).digest('hex')],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.csrf_token).toBe(info.csrfToken);
    expect(await q('SELECT 1 FROM sessions WHERE id = $1', [token])).toHaveLength(0);
  });

  it('adds the Secure attribute when COOKIE_SECURE=true', async () => {
    config.cookieSecure = true;
    try {
      const res = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
      expect(sidCookie(res)).toMatch(/Secure/i);
    } finally {
      config.cookieSecure = false;
    }
  });

  it('matches the email case-insensitively and rotates previous/last login', async () => {
    const first = await login(ADMIN_EMAIL.toUpperCase(), ADMIN_PASSWORD);
    expect(first.status).toBe(200);
    // resetDb already signed in once, so there is a previous sign-in; make it unambiguous.
    await pool.query(`UPDATE users SET last_login_at = '2026-01-01T10:00:00Z', last_login_ip = '10.0.0.9', previous_login_at = NULL, previous_login_ip = NULL`);
    const second = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const user = zSessionInfo.parse(second.body).user;
    expect(user.previousLoginAt).toBe('2026-01-01T10:00:00.000Z');
    expect(user.previousLoginIp).toBe('10.0.0.9');
    const [row] = await q<{ last_login_at: Date; last_login_ip: string; previous_login_at: Date }>(
      'SELECT last_login_at, last_login_ip, previous_login_at FROM users',
    );
    expect(row!.previous_login_at.toISOString()).toBe('2026-01-01T10:00:00.000Z');
    expect(row!.last_login_at.getTime()).toBeGreaterThan(Date.now() - 10_000);
    expect(row!.last_login_ip).toBeTruthy();
  });

  it('answers a wrong password and an unknown email identically with 401 INVALID_CREDENTIALS', async () => {
    const wrong = await login(ADMIN_EMAIL, 'definitely-wrong');
    const unknown = await login('nobody@test.nacta', 'definitely-wrong');
    for (const r of [wrong, unknown]) {
      expect(r.status).toBe(401);
      expect(zErrorBody.parse(r.body).error.code).toBe('INVALID_CREDENTIALS');
      expect(sidCookie(r)).toBeUndefined();
    }
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
    expect(wrong.body.error.details).toBeUndefined();
  });

  it('validates the body', async () => {
    const res = await rawApi.post(`${V1}/auth/login`).send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toHaveProperty('email');
    expect(res.body.error.details).toHaveProperty('password');
  });

  it('locks the account for 15 minutes after 5 consecutive failures (423 with lockedUntil)', async () => {
    for (let i = 1; i <= 4; i++) {
      expect((await login(ADMIN_EMAIL, 'wrong-password')).status).toBe(401);
    }
    const fifth = await login(ADMIN_EMAIL, 'wrong-password');
    expect(fifth.status).toBe(423);
    expect(fifth.body.error.code).toBe('ACCOUNT_LOCKED');
    const until = Date.parse(fifth.body.error.details.lockedUntil);
    expect(until).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(until).toBeLessThanOrEqual(Date.now() + 15 * 60_000 + 5000);

    // Even the right password is refused while locked, and the lock is not extended.
    const correct = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(correct.status).toBe(423);
    expect(Date.parse(correct.body.error.details.lockedUntil)).toBe(until);

    // Lock expires -> sign-in works and clears the counters.
    await pool.query(`UPDATE users SET locked_until = now() - interval '1 second'`);
    expect((await login(ADMIN_EMAIL, ADMIN_PASSWORD)).status).toBe(200);
    const [u] = await q<{ failed_attempts: number; locked_until: Date | null }>('SELECT failed_attempts, locked_until FROM users');
    expect(u).toEqual({ failed_attempts: 0, locked_until: null });
  });

  it('a successful sign-in resets the failure counter', async () => {
    for (let i = 0; i < 4; i++) await login(ADMIN_EMAIL, 'wrong-password');
    expect((await login(ADMIN_EMAIL, ADMIN_PASSWORD)).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await login(ADMIN_EMAIL, 'wrong-password')).status).toBe(401);
    expect((await login(ADMIN_EMAIL, ADMIN_PASSWORD)).status).toBe(200);
  });

  it('does not lock accounts that do not exist and never reveals existence', async () => {
    for (let i = 0; i < 7; i++) expect((await login('ghost@test.nacta', 'wrong-password')).status).toBe(401);
  });

  it('rate-limits 20 attempts per 15 minutes per IP with 429 RATE_LIMITED', async () => {
    // Attempts count even when the body is invalid, which keeps this test fast.
    for (let i = 0; i < 20; i++) expect((await rawApi.post(`${V1}/auth/login`).send({})).status).toBe(400);
    const limited = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('refuses a disabled account with 403 ACCOUNT_DISABLED, but only after a correct password', async () => {
    const u = await insertUser({ status: 'disabled' });
    const wrong = await login(u.email, 'wrong-password');
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    const right = await login(u.email, u.password);
    expect(right.status).toBe(403);
    expect(right.body.error.code).toBe('ACCOUNT_DISABLED');
    expect(sidCookie(right)).toBeUndefined();
  });
});

describe('sessions, cookies and CSRF', () => {
  it('GET /auth/me returns SessionInfo; without a cookie it is 401 UNAUTHENTICATED', async () => {
    const me = await api.get(`${V1}/auth/me`);
    expect(me.status).toBe(200);
    expect(zSessionInfo.parse(me.body).user.email).toBe(ADMIN_EMAIL);
    expect(me.body.csrfToken).toBe(api.client.csrfToken);

    const anon = await rawApi.get(`${V1}/auth/me`);
    expect(anon.status).toBe(401);
    expect(zErrorBody.parse(anon.body).error.code).toBe('UNAUTHENTICATED');
  });

  it('an unknown or malformed cookie is 401 and gets cleared', async () => {
    const res = await rawApi.get(`${V1}/auth/me`).set('Cookie', 'nacta_sid=' + 'x'.repeat(43));
    expect(res.status).toBe(401);
    expect(sidCookie(res)).toMatch(/nacta_sid=;/);
  });

  it('logout revokes the session and clears the cookie', async () => {
    const out = await api.post(`${V1}/auth/logout`);
    expect(out.status).toBe(204);
    expect(sidCookie(out)).toMatch(/nacta_sid=;/);
    const after = await api.get(`${V1}/auth/me`);
    expect(after.status).toBe(401);
    expect(await q('SELECT 1 FROM sessions WHERE revoked_at IS NOT NULL')).toHaveLength(1);
  });

  it('idle timeout: 401 after SESSION_IDLE_MINUTES without activity, and the cookie is cleared', async () => {
    await pool.query(`UPDATE sessions SET last_seen_at = now() - interval '31 minutes'`);
    const res = await api.get(`${V1}/auth/me`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(sidCookie(res)).toMatch(/nacta_sid=;/);
  });

  it('activity refreshes last_seen_at at most once a minute', async () => {
    await pool.query(`UPDATE sessions SET last_seen_at = now() - interval '29 minutes'`);
    expect((await api.get(`${V1}/auth/me`)).status).toBe(200);
    const [fresh] = await q<{ age: number }>(`SELECT extract(epoch from now() - last_seen_at)::float AS age FROM sessions`);
    expect(fresh!.age).toBeLessThan(5);

    await pool.query(`UPDATE sessions SET last_seen_at = now() - interval '10 seconds'`);
    expect((await api.get(`${V1}/auth/me`)).status).toBe(200);
    const [kept] = await q<{ age: number }>(`SELECT extract(epoch from now() - last_seen_at)::float AS age FROM sessions`);
    expect(kept!.age).toBeGreaterThan(8);
  });

  it('background refresh (X-Background-Refresh: 1) does not reset the idle clock, but still 401s when idle-expired', async () => {
    await pool.query(`UPDATE sessions SET last_seen_at = now() - interval '29 minutes'`);
    const ok = await api.get(`${V1}/auth/me`).set('X-Background-Refresh', '1');
    expect(ok.status).toBe(200);
    const [age] = await q<{ age: number }>(`SELECT extract(epoch from now() - last_seen_at)::float AS age FROM sessions`);
    expect(age!.age).toBeGreaterThan(29 * 60 - 5); // not refreshed
    // a normal request does refresh it
    expect((await api.get(`${V1}/auth/me`)).status).toBe(200);
    const [fresh] = await q<{ age: number }>(`SELECT extract(epoch from now() - last_seen_at)::float AS age FROM sessions`);
    expect(fresh!.age).toBeLessThan(5);
    // idle-expired: still rejected
    await pool.query(`UPDATE sessions SET last_seen_at = now() - interval '31 minutes'`);
    expect((await api.get(`${V1}/auth/me`).set('X-Background-Refresh', '1')).status).toBe(401);
  });

  it('absolute lifetime: 401 once expires_at has passed, however active', async () => {
    await pool.query(`UPDATE sessions SET expires_at = now() - interval '1 second', last_seen_at = now()`);
    const res = await api.get(`${V1}/auth/me`);
    expect(res.status).toBe(401);
    expect(sidCookie(res)).toMatch(/nacta_sid=;/);
  });

  it('a revoked session is 401, and so is a session of a disabled user', async () => {
    await pool.query(`UPDATE sessions SET revoked_at = now()`);
    expect((await api.get(`${V1}/auth/me`)).status).toBe(401);

    const u = await userClient({ permissions: ['devices.view'] });
    expect((await u.get(`${V1}/devices`)).status).toBe(200);
    await pool.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [u.id]);
    expect((await u.get(`${V1}/devices`)).status).toBe(401);
  });

  it('CSRF: every mutating request needs a matching X-CSRF-Token (login excepted); GET does not', async () => {
    const c = api.client;
    for (const [method, url] of [
      ['post', `${V1}/devices`],
      ['put', `${V1}/devices/1`],
      ['delete', `${V1}/devices/1`],
      ['patch', `${V1}/devices/1`],
      ['post', `${V1}/auth/logout`],
      ['post', `${V1}/roles`],
    ] as const) {
      const missing = await c.noCsrf(method, url).send({});
      expect([method, url, missing.status, missing.body.error?.code]).toEqual([method, url, 403, 'CSRF_INVALID']);
      const wrong = await c.badCsrf(method, url).send({});
      expect([method, url, wrong.status, wrong.body.error?.code]).toEqual([method, url, 403, 'CSRF_INVALID']);
    }
    expect((await c.get(`${V1}/devices`)).status).toBe(200);
    // the session survived all of that
    expect((await c.post(`${V1}/devices`).send({ name: 'D', serialNumber: 'CSRF1' })).status).toBe(201);
    // login itself needs no token
    expect((await login(ADMIN_EMAIL, ADMIN_PASSWORD)).status).toBe(200);
  });

  it('unauthenticated mutations are 401, not 403', async () => {
    const res = await rawApi.post(`${V1}/devices`).send({ name: 'D', serialNumber: 'X1' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('lists own sessions, revokes one, revokes all others', async () => {
    const a = api.client;
    const b = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    const c = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

    const list = await a.get(`${V1}/auth/sessions`);
    expect(list.status).toBe(200);
    const sessions = zSessionSummary.array().parse(list.body);
    expect(sessions).toHaveLength(3);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);

    const mine = sessions.find((s) => s.current)!;
    const other = sessions.find((s) => !s.current)!;
    expect((await a.delete(`${V1}/auth/sessions/${other.id}`)).status).toBe(204);
    expect((await a.delete(`${V1}/auth/sessions/${other.id}`)).status).toBe(404); // already revoked
    expect((await a.delete(`${V1}/auth/sessions/${'0'.repeat(64)}`)).status).toBe(404);
    expect((await a.delete(`${V1}/auth/sessions/not-an-id`)).status).toBe(404);

    // another user's session cannot be revoked through this endpoint
    const stranger = await userClient({});
    const [theirs] = await q<{ id: string }>('SELECT id FROM sessions WHERE user_id = $1', [stranger.id]);
    expect((await a.delete(`${V1}/auth/sessions/${theirs!.id}`)).status).toBe(404);
    expect((await stranger.get(`${V1}/auth/me`)).status).toBe(200);

    const rev = await a.post(`${V1}/auth/sessions/revoke-others`);
    expect(rev.status).toBe(200);
    expect(rev.body.revoked).toBe(1); // one of b/c was already revoked above
    expect((await a.get(`${V1}/auth/me`)).status).toBe(200);
    expect((await b.get(`${V1}/auth/me`)).status + (await c.get(`${V1}/auth/me`)).status).toBe(802);
    expect(zSessionSummary.array().parse((await a.get(`${V1}/auth/sessions`)).body).map((s) => s.id)).toEqual([mine.id]);
  });
});

describe('forced password change', () => {
  async function pendingAdmin() {
    await pool.query(`UPDATE users SET must_change_password = true WHERE lower(email) = $1`, [ADMIN_EMAIL]);
    return loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
  }

  it('blocks every API route except me, change-password and logout with 403 PASSWORD_CHANGE_REQUIRED', async () => {
    const c = await pendingAdmin();
    const me = await c.get(`${V1}/auth/me`);
    expect(me.status).toBe(200);
    expect(zSessionInfo.parse(me.body).user.mustChangePassword).toBe(true);

    const blocked: [string, string][] = [
      ['get', `${V1}/overview`],
      ['get', `${V1}/devices`],
      ['post', `${V1}/devices`],
      ['get', `${V1}/employees`],
      ['get', `${V1}/attendance`],
      ['get', `${V1}/wings`],
      ['get', `${V1}/adms-log`],
      ['get', `${V1}/users`],
      ['get', `${V1}/roles`],
      ['get', `${V1}/permissions`],
      ['get', `${V1}/auth/sessions`],
      ['post', `${V1}/auth/sessions/revoke-others`],
    ];
    for (const [method, url] of blocked) {
      const res = await (c as unknown as Record<string, (u: string) => Promise<{ status: number; body: { error?: { code: string } } }>>)[method]!(url);
      expect([method, url, res.status, res.body.error?.code]).toEqual([method, url, 403, 'PASSWORD_CHANGE_REQUIRED']);
    }
    // health stays public
    expect((await c.get(`${V1}/health`)).status).toBe(200);
    expect((await c.post(`${V1}/auth/logout`)).status).toBe(204);
  });

  it('change-password checks the current password and the policy', async () => {
    const c = await pendingAdmin();
    const send = (body: Record<string, unknown>) => c.post(`${V1}/auth/change-password`).send(body);

    const wrongCurrent = await send({ currentPassword: 'nope-nope', newPassword: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD });
    expect(wrongCurrent.status).toBe(400);
    expect(wrongCurrent.body.error.details).toEqual({ currentPassword: 'Current password is incorrect' });

    const mismatch = await send({ currentPassword: ADMIN_PASSWORD, newPassword: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD + 'x' });
    expect(mismatch.body.error.details).toEqual({ confirmPassword: 'Passwords do not match' });

    const same = await send({ currentPassword: ADMIN_PASSWORD, newPassword: ADMIN_PASSWORD, confirmPassword: ADMIN_PASSWORD });
    expect(same.body.error.details).toHaveProperty('newPassword');

    const short = await send({ currentPassword: ADMIN_PASSWORD, newPassword: 'Ab1!', confirmPassword: 'Ab1!' });
    expect(short.body.error.details.newPassword).toMatch(/At least 12/);

    const noSymbol = await send({ currentPassword: ADMIN_PASSWORD, newPassword: 'Violet1Harbor2Quartz3', confirmPassword: 'Violet1Harbor2Quartz3' });
    expect(noSymbol.body.error.details.newPassword).toMatch(/symbol/);

    // Still pending after all the rejections.
    expect(zSessionInfo.parse((await c.get(`${V1}/auth/me`)).body).user.mustChangePassword).toBe(true);
  });

  it('rejects common passwords and passwords containing the email name', async () => {
    const c = await pendingAdmin();
    const send = (pw: string) =>
      c.post(`${V1}/auth/change-password`).send({ currentPassword: ADMIN_PASSWORD, newPassword: pw, confirmPassword: pw });

    for (const pw of ['Password123!', 'P@ssw0rd1234!', 'Welcome2026!!', 'Qwerty123456!', 'Iloveyou12345!']) {
      const res = await send(pw);
      expect([pw, res.status, res.body.error.details.newPassword]).toEqual([pw, 400, expect.stringMatching(/too common/)]);
    }
    // the e-mail local part is "admin" (admin@test.nacta), whatever the case
    for (const pw of ['Admin-Violet-Quartz-52!', 'xx-ADMIN-Violet-Quartz-52!', 'Violet-Quartz-aDmIn!52']) {
      const res = await send(pw);
      expect([pw, res.status, res.body.error.details.newPassword]).toEqual([pw, 400, expect.stringMatching(/email name/)]);
    }
  });

  it('applies the new password, clears the flag, revokes other sessions and returns SessionInfo', async () => {
    const c = await pendingAdmin();
    const other = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);

    const res = await c.post(`${V1}/auth/change-password`).send({
      currentPassword: ADMIN_PASSWORD,
      newPassword: GOOD_PASSWORD,
      confirmPassword: GOOD_PASSWORD,
    });
    expect(res.status).toBe(200);
    const info = zSessionInfo.parse(res.body);
    expect(info.user.mustChangePassword).toBe(false);
    expect(info.csrfToken).toBe(c.csrfToken);

    expect((await c.get(`${V1}/devices`)).status).toBe(200); // gate lifted for the current session
    expect((await other.get(`${V1}/auth/me`)).status).toBe(401); // others signed out
    const [u] = await q<{ must_change_password: boolean; password_changed_at: Date | null }>(
      'SELECT must_change_password, password_changed_at FROM users WHERE lower(email) = $1',
      [ADMIN_EMAIL],
    );
    expect(u!.must_change_password).toBe(false);
    expect(u!.password_changed_at).not.toBeNull();

    expect((await login(ADMIN_EMAIL, ADMIN_PASSWORD)).status).toBe(401);
    expect((await login(ADMIN_EMAIL, GOOD_PASSWORD)).status).toBe(200);
  });

  it('change-password needs a session and a CSRF token', async () => {
    const body = { currentPassword: ADMIN_PASSWORD, newPassword: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD };
    expect((await rawApi.post(`${V1}/auth/change-password`).send(body)).status).toBe(401);
    const noToken = await api.client.noCsrf('post', `${V1}/auth/change-password`).send(body);
    expect([noToken.status, noToken.body.error.code]).toEqual([403, 'CSRF_INVALID']);
  });
});

describe('password policy helpers', () => {
  it('bundles about a thousand common passwords and catches trivial variants', () => {
    expect(COMMON_PASSWORDS.size).toBeGreaterThanOrEqual(1000);
    for (const pw of ['password', 'Password1', 'P@ssw0rd', 'Summer2026!', 'qwerty123456', 'aaaaaaaaaaaa', 'abcabcabcabc', 'Nacta@1234']) {
      expect(isCommonPassword(pw), pw).toBe(true);
    }
    for (const pw of [GOOD_PASSWORD, 'Correct-Horse-Battery-9', 'tr0ub4dor&3xylophone']) {
      expect(isCommonPassword(pw), pw).toBe(false);
    }
  });

  it('passwordProblem applies shape, email-name and common-list rules', () => {
    expect(passwordProblem(GOOD_PASSWORD, 'someone@nacta.gov.pk')).toBeNull();
    expect(passwordProblem('short', 'a@b.pk')).toMatch(/At least 12/);
    expect(passwordProblem('Violet-Harbor-ahmed-52!', 'Ahmed@nacta.gov.pk')).toMatch(/email name/);
    expect(passwordProblem('Password123!', 'x@nacta.gov.pk')).toMatch(/too common/);
    // very short local parts do not block everything
    expect(passwordProblem(GOOD_PASSWORD, 'a@nacta.gov.pk')).toBeNull();
  });
});

describe('ADMS is not authenticated', () => {
  it('devices work with no cookie and no CSRF token', async () => {
    const hs = await adms.get('/iclock/cdata?SN=NOAUTH001&options=all');
    expect(hs.status).toBe(200);
    expect(hs.text).toContain('GET OPTION FROM: NOAUTH001');
    const up = await adms.post('/iclock/cdata?SN=NOAUTH001&table=ATTLOG&Stamp=1').send('5\t2026-03-01 08:00:00\t0\t1\n');
    expect(up.status).toBe(200);
    expect(up.text).toBe('OK: 1');
    expect(await adms.get('/iclock/getrequest?SN=NOAUTH001').then((r) => r.status)).toBe(200);
    expect((await q('SELECT 1 FROM attendance_logs WHERE pin = $1', ['5'])).length).toBe(1);
    // the same data is behind the login on the API side
    expect((await rawApi.get(`${V1}/attendance`)).status).toBe(401);
  });
});

describe('health', () => {
  it('is public, but only signed-in callers see the server IP addresses', async () => {
    const anon = await rawApi.get(`${V1}/health`);
    expect(anon.status).toBe(200);
    expect(anon.body.serverIps).toEqual([]);
    expect(anon.body).toMatchObject({ ok: true, db: true });

    const authed = await api.get(`${V1}/health`);
    const { serverIps } = await import('../src/lib/sys');
    expect(authed.body.serverIps).toEqual(serverIps());
  });

  it('a dead cookie does not break the public health endpoint', async () => {
    const res = await rawApi.get(`${V1}/health`).set('Cookie', 'nacta_sid=' + 'y'.repeat(43));
    expect(res.status).toBe(200);
    expect(res.body.serverIps).toEqual([]);
  });
});
