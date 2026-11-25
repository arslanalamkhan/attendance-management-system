import { pool } from './pool';
import { runMigrations } from './migrator';

runMigrations(pool)
  .then(() => pool.end())
  .catch(async (err: Error) => {
    console.error(err.message);
    await pool.end().catch(() => {});
    process.exit(1);
  });
