import pg from 'pg';
import { config } from '../config';

/** Create the database named in DATABASE_URL if it does not exist yet. */
export async function createDatabaseIfMissing(databaseUrl: string): Promise<'created' | 'exists'> {
  const url = new URL(databaseUrl);
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!dbName) throw new Error('DATABASE_URL has no database name');
  url.pathname = '/postgres';

  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rowCount) return 'exists';
    await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    return 'created';
  } finally {
    await client.end();
  }
}

if (process.argv[1] && /createDb\.[cm]?[jt]s$/.test(process.argv[1])) {
  createDatabaseIfMissing(config.databaseUrl)
    .then((r) => {
      const name = decodeURIComponent(new URL(config.databaseUrl).pathname.replace(/^\//, ''));
      console.log(r === 'exists' ? `database "${name}" already exists` : `database "${name}" created`);
    })
    .catch((err: Error) => {
      console.error(err.message);
      process.exit(1);
    });
}
