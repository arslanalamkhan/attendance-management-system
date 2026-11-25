/**
 * Reset a user's password from the command line (use it when the Super Admin is locked out).
 *
 *   npm run admin:reset-password -- admin@example.org
 *
 * The new password is read from the ADMIN_NEW_PASSWORD environment variable, or prompted for (hidden input).
 * The account gets must_change_password = true, is unlocked and re-enabled, and every session is revoked.
 * Like the first-start seed, this temporary password bypasses the password policy; the policy applies when the
 * user is forced to choose a new one at next sign-in.
 */
import { stdin, stdout } from 'node:process';
import { pool } from '../db/pool';
import { hashPassword } from '../modules/auth/password';

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) {
      reject(new Error('No terminal available. Set the ADMIN_NEW_PASSWORD environment variable instead.'));
      return;
    }
    stdout.write(question);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          reject(new Error('Cancelled'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  if (!email) {
    console.error('Usage: npm run admin:reset-password -- <email>');
    process.exitCode = 2;
    return;
  }
  const exists = await pool.query<{ id: number }>('SELECT id FROM users WHERE lower(email) = $1', [email]);
  const user = exists.rows[0];
  if (!user) {
    console.error(`No user with the email ${email}.`);
    process.exitCode = 1;
    return;
  }

  let password = process.env.ADMIN_NEW_PASSWORD ?? '';
  if (!password) {
    password = await promptHidden('New temporary password: ');
    const again = await promptHidden('Repeat the password: ');
    if (password !== again) {
      console.error('The passwords do not match.');
      process.exitCode = 1;
      return;
    }
  }
  if (password.length < 8 || password.length > 128) {
    console.error('The password must be 8 to 128 characters.');
    process.exitCode = 1;
    return;
  }

  const hashed = await hashPassword(password);
  await pool.query(
    `UPDATE users SET password_hash = $2, must_change_password = true, password_changed_at = now(),
                      failed_attempts = 0, locked_until = NULL, status = 'active'
     WHERE id = $1`,
    [user.id, hashed],
  );
  await pool.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [user.id]);
  console.log(`Password reset for ${email}. They must choose a new password at next sign-in; all sessions were signed out.`);
}

main()
  .catch((err: Error) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
