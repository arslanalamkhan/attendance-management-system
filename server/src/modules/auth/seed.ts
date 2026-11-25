import { config } from '../../config';
import { pool, withTransaction } from '../../db/pool';
import { logger } from '../../lib/logger';
import { hashPassword } from './password';

export const SUPER_ADMIN_ROLE = 'Super Admin';
const log = logger.child({ component: 'auth-seed' });

/**
 * Idempotent. Ensures the built-in "Super Admin" role exists and, when nobody holds it, creates the account
 * from SEED_ADMIN_* with must_change_password = true. The seed password bypasses the password policy (the policy
 * applies to every later password) and is never logged.
 */
export async function seedAuth(): Promise<void> {
  await pool.query(
    `INSERT INTO roles (name, description, is_system, all_wings)
     SELECT $1, 'Built-in role with every permission', true, true
     WHERE NOT EXISTS (SELECT 1 FROM roles WHERE is_system)
     ON CONFLICT DO NOTHING`,
    [SUPER_ADMIN_ROLE],
  );
  const role = await pool.query<{ id: number; holders: string }>(
    `SELECT r.id, (SELECT count(*) FROM user_roles ur WHERE ur.role_id = r.id) AS holders
     FROM roles r WHERE r.is_system LIMIT 1`,
  );
  const sys = role.rows[0];
  if (!sys) {
    log.error(`Could not create the "${SUPER_ADMIN_ROLE}" role (a role with that name may already exist)`);
    return;
  }
  if (Number(sys.holders) > 0) return;

  if (!config.seedAdminPassword) {
    log.warn('No Super Admin exists and SEED_ADMIN_PASSWORD is not set; no account was created');
    return;
  }
  const email = config.seedAdminEmail.toLowerCase();
  const hashed = await hashPassword(config.seedAdminPassword);
  const created = await withTransaction(async (client) => {
    const ins = await client.query<{ id: number }>(
      `INSERT INTO users (email, name, password_hash, must_change_password)
       VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING RETURNING id`,
      [email, config.seedAdminName, hashed],
    );
    const id = ins.rows[0]?.id;
    if (id === undefined) return false;
    await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [id, sys.id]);
    return true;
  });
  if (created) log.info(`Created the Super Admin account ${email}; the password must be changed at first sign-in`);
  else log.warn(`No Super Admin exists but ${email} is already a normal user; use "npm run admin:reset-password" to recover`);
}
