import request from 'supertest';
import type { Permission } from '@nacta/shared';
import { createAdmsApp, createApiApp } from '../src/app';
import { config } from '../src/config';
import { pool } from '../src/db/pool';
import { hashPassword } from '../src/modules/auth/password';
import { resetLoginRateLimit } from '../src/modules/auth/rateLimit';
import { seedAuth } from '../src/modules/auth/seed';
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATIONS_DIR } from '../src/db/migrator';
import { setClock } from '../src/lib/dates';

export { pool, config };

if (!/_test$/.test(new URL(config.databaseUrl).pathname.replace(/^\//, ''))) {
  throw new Error('Tests must run against a *_test database');
}

const app = createApiApp();
/** Anonymous API client: no cookie, no CSRF token. */
export const rawApi = request(app);
export const adms = request(createAdmsApp());
export const V1 = '/api/v1';

export const ADMIN_EMAIL = config.seedAdminEmail;
export const ADMIN_PASSWORD = 'Admin-Test-Pw-2026!';
export const USER_PASSWORD = 'Staff-Test-Pw-2026!';

const MUTATING = ['post', 'put', 'patch', 'delete'] as const;

/** A signed-in client: keeps the session cookie and adds X-CSRF-Token to every mutating request. */
export class Client {
  constructor(
    private readonly agent: ReturnType<typeof request.agent>,
    public readonly csrfToken: string,
    public readonly email: string,
  ) {}
  get = (url: string) => this.agent.get(url);
  post = (url: string) => this.agent.post(url).set('X-CSRF-Token', this.csrfToken);
  put = (url: string) => this.agent.put(url).set('X-CSRF-Token', this.csrfToken);
  patch = (url: string) => this.agent.patch(url).set('X-CSRF-Token', this.csrfToken);
  delete = (url: string) => this.agent.delete(url).set('X-CSRF-Token', this.csrfToken);
  /** Same session, but no CSRF header (to test the CSRF guard). */
  noCsrf = (method: (typeof MUTATING)[number], url: string) => this.agent[method](url);
  /** Same session cookie, wrong CSRF token. */
  badCsrf = (method: (typeof MUTATING)[number], url: string) => this.agent[method](url).set('X-CSRF-Token', 'not-the-token');
}

/** Sign in through the API. Throws unless it succeeds. */
export async function loginAs(email: string, password: string): Promise<Client> {
  resetLoginRateLimit(); // helper sign-ins must not eat into the per-IP budget the rate-limit test checks
  const agent = request.agent(app);
  const res = await agent.post(`${V1}/auth/login`).send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return new Client(agent, (res.body as { csrfToken: string }).csrfToken, email);
}

let current: Client | null = null;
const cur = (): Client => {
  if (!current) throw new Error('No signed-in admin: call resetDb() in beforeEach');
  return current;
};

/** The seeded Super Admin, signed in. Replaced by resetDb() before every test. */
export const api = {
  get: (url: string) => cur().get(url),
  post: (url: string) => cur().post(url),
  put: (url: string) => cur().put(url),
  patch: (url: string) => cur().patch(url),
  delete: (url: string) => cur().delete(url),
  get client(): Client {
    return cur();
  },
};

let adminHash: Promise<string> | null = null;

/** The seed block of migration 008 (default timing profile and leave types), re-applied after every truncate. */
let seedSql: string | null = null;
function rulesSeedSql(): string {
  if (!seedSql) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '008_attendance_rules.sql'), 'utf8');
    seedSql = sql.slice(sql.indexOf('-- SEED-BEGIN'), sql.indexOf('-- SEED-END'));
  }
  return seedSql;
}

/** Empty every table (identities restart at 1), seed the Super Admin and sign it in as `api`. */
export async function resetDb(): Promise<void> {
  await pool.query(
    `TRUNCATE adms_requests, attendance_logs, device_commands, device_users, biometric_templates, biometric_tombstones, user_photos,
              employees, wings, sections, devices, sessions, user_roles, role_wings, role_permissions, roles, users,
              holidays, holiday_wings, timing_assignments, timing_profile_versions, timing_profiles, leaves, leave_types,
              attendance_corrections, attendance_days, attendance_dirty
       RESTART IDENTITY CASCADE`,
  );
  setClock(null);
  await pool.query(rulesSeedSql());
  await seedAuth();
  adminHash ??= hashPassword(ADMIN_PASSWORD);
  // The seeded account must change its password at first sign-in; tests that are not about that skip it.
  await pool.query(`UPDATE users SET password_hash = $1, must_change_password = false WHERE lower(email) = $2`, [
    await adminHash,
    ADMIN_EMAIL,
  ]);
  current = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
  resetLoginRateLimit(); // every test starts with a clean login budget
}

export async function closeDb(): Promise<void> {
  await pool.end();
}

export interface TestUserOptions {
  email?: string;
  name?: string;
  permissions?: Permission[];
  /** 'all' (default) or the wing ids the role is limited to. */
  wings?: 'all' | number[];
  password?: string;
  mustChangePassword?: boolean;
  status?: 'active' | 'disabled';
  roleName?: string;
}

let seq = 0;

/** Insert a user holding a fresh role directly in the database (no sign-in). */
export async function insertUser(opts: TestUserOptions = {}): Promise<{ id: number; email: string; password: string; roleId: number }> {
  seq += 1;
  const email = opts.email ?? `user${seq}@test.nacta`;
  const password = opts.password ?? USER_PASSWORD;
  const wings = opts.wings ?? 'all';
  const role = await pool.query<{ id: number }>(
    `INSERT INTO roles (name, all_wings) VALUES ($1, $2) RETURNING id`,
    [opts.roleName ?? `Role ${seq}`, wings === 'all'],
  );
  const roleId = (role.rows[0] as { id: number }).id;
  const perms = opts.permissions ?? [];
  if (perms.length) {
    await pool.query(`INSERT INTO role_permissions (role_id, permission) SELECT $1, unnest($2::text[])`, [roleId, perms]);
  }
  if (wings !== 'all' && wings.length) {
    await pool.query(`INSERT INTO role_wings (role_id, wing_id) SELECT $1, unnest($2::int[])`, [roleId, wings]);
  }
  const user = await pool.query<{ id: number }>(
    `INSERT INTO users (email, name, password_hash, status, must_change_password) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [email, opts.name ?? `User ${seq}`, await hashPassword(password), opts.status ?? 'active', opts.mustChangePassword ?? false],
  );
  const id = (user.rows[0] as { id: number }).id;
  await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [id, roleId]);
  return { id, email, password, roleId };
}

/** insertUser + sign in. */
export async function userClient(opts: TestUserOptions = {}): Promise<Client & { id: number; password: string }> {
  const u = await insertUser(opts);
  const c = await loginAs(u.email, u.password);
  return Object.assign(c, { id: u.id, password: u.password });
}

export async function createDevice(sn = 'TEST0001', name = 'Test device'): Promise<{ id: number; serialNumber: string }> {
  const res = await api.post(`${V1}/devices`).send({ name, serialNumber: sn });
  if (res.status !== 201) throw new Error(`createDevice failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: number; serialNumber: string };
}

export const CRLF = '\r\n';

/** device-local date, N days from the DB's current_date, as YYYY-MM-DD */
export async function dbDate(offsetDays = 0): Promise<string> {
  const { rows } = await pool.query<{ d: string }>(`SELECT to_char(current_date + $1::int, 'YYYY-MM-DD') AS d`, [offsetDays]);
  return (rows[0] as { d: string }).d;
}
