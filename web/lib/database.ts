import 'server-only';
import { Pool } from 'pg';
import { requireDatabaseUrl } from './database-config';

let pool: Pool | undefined;

export function databasePool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: requireDatabaseUrl(process.env.DATABASE_URL),
      max: 3,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
      query_timeout: 2000,
    });
    pool.on('error', () => console.warn('Koneksi PostgreSQL yang sedang idle terputus.'));
  }
  return pool;
}

export async function checkDatabase(): Promise<void> {
  await databasePool().query('SELECT 1');
}
