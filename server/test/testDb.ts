import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEST_DB_NAME = 'attendance_test';

/**
 * Connection URL of the throwaway test database: same server/credentials as DATABASE_URL in server/.env,
 * but always the `attendance_test` database. Refuses anything not ending in `_test`, so the real
 * `attendance` database can never be targeted by the test suite.
 */
export function testDatabaseUrl(): string {
  const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
  const parsed = fs.existsSync(envFile) ? dotenv.parse(fs.readFileSync(envFile)) : {};
  const base = process.env.TEST_DATABASE_URL ?? parsed.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/attendance';
  const url = new URL(base);
  if (!process.env.TEST_DATABASE_URL) url.pathname = `/${TEST_DB_NAME}`;
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!name.endsWith('_test')) throw new Error(`Refusing to run tests against database "${name}": name must end with _test`);
  return url.toString();
}
