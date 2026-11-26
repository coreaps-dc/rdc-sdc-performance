import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';

const port = 55432;
const database = 'daily_activity';
const user = 'daily_activity';
const dataDir = resolve('.local-postgres');
const envFile = resolve('.env.local');

if (!existsSync(envFile)) {
  const password = randomBytes(24).toString('hex');
  const url = `postgresql://${user}:${password}@127.0.0.1:${port}/${database}`;
  await writeFile(envFile, `DATABASE_URL=${url}\n`, { flag: 'wx', mode: 0o600 });
}

const { DATABASE_URL: databaseUrl } = parseEnv(await readFile(envFile, 'utf8'));
const url = new URL(databaseUrl ?? 'postgresql://localhost');
if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' ||
    url.port !== String(port) || url.username !== user || url.pathname !== `/${database}` ||
    !/^[0-9a-f]{48}$/.test(url.password)) {
  throw new Error('Untuk PostgreSQL tertanam, jalankan dari folder web dengan .env.local hasil db:local.');
}

const postgres = new EmbeddedPostgres({
  databaseDir: dataDir,
  port,
  user,
  password: url.password,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-h', '127.0.0.1'],
});

if (!existsSync(resolve(dataDir, 'PG_VERSION'))) await postgres.initialise();
await postgres.start();
try {
  const client = new Client({
    host: '127.0.0.1', port, user, password: url.password,
    database: 'postgres', connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (!existing.rowCount) await client.query('CREATE DATABASE daily_activity');
  } finally {
    await client.end();
  }
  console.log(`PostgreSQL lokal siap di 127.0.0.1:${port}. Tekan Ctrl+C untuk berhenti.`);
  await new Promise((done) => {
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
} finally {
  await postgres.stop();
}
