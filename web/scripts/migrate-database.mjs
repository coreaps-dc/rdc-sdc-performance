import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

const directory = new URL('../db/migrations/', import.meta.url);

export async function applyDatabaseMigrations(client) {
  const files = (await readdir(directory)).filter(name => /^\d{3}-[a-z0-9-]+\.sql$/.test(name)).sort();
  if (new Set(files.map(name => name.slice(0, 3))).size !== files.length) throw new Error('Versi migrasi ganda.');
  await client.query('SELECT pg_advisory_lock(404, 2)');
  try {
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS daily_activity;
      CREATE TABLE IF NOT EXISTS daily_activity.schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    const { rows } = await client.query('SELECT name, checksum FROM daily_activity.schema_migrations');
    const applied = new Map(rows.map(row => [row.name, row.checksum]));
    if (rows.some(row => !files.includes(row.name))) throw new Error('Database memiliki migrasi yang tidak tersedia di checkout ini.');
    const results = [];
    for (const name of files) {
      const sql = (await readFile(new URL(name, directory), 'utf8')).replace(/\r\n/g, '\n').trim();
      const body = sql.match(/^BEGIN;\s+([\s\S]+)\s+COMMIT;$/)?.[1];
      if (!body) throw new Error(`Batas transaksi tidak valid pada ${name}.`);
      const checksum = createHash('sha256').update(sql).digest('hex');
      if (applied.has(name)) {
        if (applied.get(name) !== checksum) throw new Error(`Checksum migrasi ${name} tidak cocok.`);
        results.push({ name, status: 'existing' });
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(body);
        await client.query('INSERT INTO daily_activity.schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
        await client.query('COMMIT');
        results.push({ name, status: 'applied' });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return results;
  } finally {
    await client.query('SELECT pg_advisory_unlock(404, 2)');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const run = async () => {
    if (process.argv.length !== 3 || process.argv[2] !== '--apply' || !process.env.DATABASE_URL) {
      throw new Error('Atur DATABASE_URL untuk lingkungan yang dituju dan jalankan dengan --apply.');
    }
    const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
    try {
      await client.connect();
      console.log(JSON.stringify(await applyDatabaseMigrations(client)));
    } finally {
      await client.end();
    }
  };
  run().catch(error => {
    console.error(`Migrasi schema gagal (${error.code ?? error.message}).`);
    process.exitCode = 1;
  });
}
