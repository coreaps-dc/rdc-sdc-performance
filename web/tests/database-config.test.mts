import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireDatabaseUrl } from '../lib/database-config.ts';

test('menerima URL PostgreSQL yang lengkap', () => {
  const url = 'postgresql://daily_activity:sample@localhost:55432/daily_activity';
  assert.equal(requireDatabaseUrl(url), url);
});

test('menolak konfigurasi kosong, protokol salah, dan URL tanpa database', () => {
  for (const value of [undefined, '', 'bukan-url', 'https://localhost/data', 'postgresql://localhost']) {
    assert.throws(() => requireDatabaseUrl(value), /DATABASE_URL/);
  }
});
