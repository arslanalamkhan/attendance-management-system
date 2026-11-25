import pg from 'pg';
import { createDatabaseIfMissing } from '../src/db/createDb';
import { runMigrations } from '../src/db/migrator';
import { testDatabaseUrl } from './testDb';

/** Creates `attendance_test` if needed, wipes it and applies every migration from scratch. */
export default async function setup(): Promise<void> {
  const url = testDatabaseUrl(); // throws unless the database name ends with _test
  await createDatabaseIfMissing(url);
  const pool = new pg.Pool({ connectionString: url });
  try {
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await runMigrations(pool, () => {});
  } finally {
    await pool.end();
  }
}
