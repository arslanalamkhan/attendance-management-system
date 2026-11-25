import pg from 'pg';
import { config } from '../config';
import { logger } from '../lib/logger';

export const pool = new pg.Pool({ connectionString: config.databaseUrl });
pool.on('error', (err) => logger.error({ err }, '[pg] idle client error'));

/** Run `fn` inside BEGIN/COMMIT on one connection; rolls back and rethrows on error. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Anything that can run a query: the pool or a transaction client. */
export type Queryable = Pick<pg.Pool, 'query'>;
