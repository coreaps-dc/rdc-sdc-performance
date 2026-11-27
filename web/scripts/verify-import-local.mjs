import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { importDataInput, prepareImport } from './import-data-input.mjs';
import { importPlanSnapshot, preparePlanSnapshot } from './import-plan-snapshot.mjs';
import { reconcilePlanShifts } from './import-plan-shifts.mjs';

const directory = await mkdtemp(join(tmpdir(), 'rdc-stage04-'));
const connection = {
  host: '127.0.0.1', port: Number(process.env.IMPORT_TEST_PORT ?? 55439), user: 'rdc_test',
  password: randomBytes(24).toString('hex'), connectionTimeoutMillis: 5000,
};
const postgres = new EmbeddedPostgres({
  databaseDir: join(directory, 'cluster'), port: connection.port, user: connection.user,
  password: connection.password, persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-h', '127.0.0.1'],
});
const primary = new pg.Client({ ...connection, database: 'postgres' });
const restored = new pg.Client({ ...connection, database: 'stage04_restore' });
const fixture = (rowNumber, demand, bu = '', type = 'BASE') => ({
  rowNumber,
  values: ['2026-10-31', 'makassar', '2', 'storing', 'Move Ke Rak', demand, 'CBM', '',
    'tester', '2026-10-31T23:50:00+07:00', '', type, '', 'group-id', bu],
});
const batch = (sourceRevision, rows) => prepareImport({ sourceRef: 'synthetic:data-input', sourceRevision, rows });
const sql = await readFile(new URL('../db/migrations/001-import-journal.sql', import.meta.url), 'utf8');
const totals = `SELECT business_date::text AS day, dc, bu, shift, activity, unit,
                       sum(demand)::text AS total, count(*)::int AS rows, count(demand)::int AS entered
                FROM daily_activity.demand_events
                GROUP BY business_date, dc, bu, shift, activity, unit ORDER BY business_date, dc, bu, shift, activity, unit`;

await postgres.initialise();
await postgres.start();
try {
  await primary.connect();
  await primary.query(sql);
  await primary.query(sql);

  const planSql = await readFile(new URL('../db/migrations/002-plan-snapshots.sql', import.meta.url), 'utf8');
  await primary.query(planSql);
  await primary.query(planSql);
  const shiftSql = await readFile(new URL('../db/migrations/003-plan-shifts.sql', import.meta.url), 'utf8');
  await primary.query(shiftSql);
  await primary.query(shiftSql);
  const planExport = (kind, records, generatedAt = '2026-11-27T00:00:00.000Z') => {
    const json = JSON.stringify({
      schemaVersion: 1, source: kind === 'inbound' ? 'Sheet1' : '2026', generatedAt, records, warnings: {},
    });
    return { sourceRef: 'synthetic:plans', sourceRevision: 'r1', rows: [
      { rowNumber: 2, values: [1, json.slice(0, 40), generatedAt, 2] },
      { rowNumber: 3, values: [2, json.slice(40), generatedAt, 2] },
    ] };
  };
  for (const kind of ['inbound', 'outbound']) {
    const records = [{ id: 'sample-1', dc: 'MAKASSAR', date: '2026-11-27', cbm: 0 }];
    const input = planExport(kind, records);
    const missing = { ...input, rows: input.rows.slice(0, 1) };
    assert.throws(() => preparePlanSnapshot(kind, missing), /tidak lengkap/);
    const mixed = structuredClone(input);
    mixed.rows[1].values[2] = '2026-11-28T00:00:00.000Z';
    assert.throws(() => preparePlanSnapshot(kind, mixed), /generasi berbeda/);
    const malformed = structuredClone(input);
    malformed.rows[1].values[1] = '{';
    assert.throws(() => preparePlanSnapshot(kind, malformed), /JSON gabungan/);
    assert.throws(() => preparePlanSnapshot(kind, planExport(kind, [...records, ...records])), /identitas pengiriman/);
    const snapshot = preparePlanSnapshot(kind, input);
    assert.deepEqual(await importPlanSnapshot(primary, snapshot), { alreadyImported: false });
    assert.deepEqual(await importPlanSnapshot(primary, snapshot), { alreadyImported: true });
    await assert.rejects(importPlanSnapshot(primary, preparePlanSnapshot(kind, planExport(kind, []))), /isi berbeda/);
    const { rows: saved } = await primary.query(
      'SELECT source_rows, payload FROM daily_activity.plan_snapshots WHERE kind = $1', [kind],
    );
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].source_rows, input.rows);
    assert.deepEqual(saved[0].payload.records, records);
    const shifts = {
      sourceRef: snapshot.sourceRef, sourceRevision: 'shift-r1', generatedAt: snapshot.generatedAt,
      rows: [
        { rowNumber: 2, values: ['sample-1', 'MAKASSAR', '2026-11-27', '2', 'tester', '',
          ...(kind === 'inbound' ? [true, '2026-11-28', 'tester', '', 0, ''] : [])] },
        { rowNumber: 3, values: ['old-record', 'MAKASSAR', '2026-11-26', '1'] },
      ],
    };
    const expected = { total: 2, reconciled: 1, issues: [{ rowNumber: 3, reason: 'missing_snapshot_record' }] };
    assert.deepEqual(await reconcilePlanShifts(primary, kind, shifts), expected);
    assert.deepEqual(await reconcilePlanShifts(primary, kind, shifts, true), { ...expected, alreadyImported: false });
    assert.deepEqual(await reconcilePlanShifts(primary, kind, shifts, true), { ...expected, alreadyImported: true });
    const wrongScope = structuredClone(shifts);
    wrongScope.rows[0].values[2] = '2026-11-26';
    assert.equal((await reconcilePlanShifts(primary, kind, wrongScope)).issues[0].reason, 'snapshot_scope_mismatch');
    const { rows: staged } = await primary.query(
      'SELECT source_rows, report FROM daily_activity.plan_shift_imports WHERE kind = $1', [kind],
    );
    assert.deepEqual(staged, [{ source_rows: shifts.rows, report: expected }]);
  }
  console.log('Snapshot Inbound dan Outbound lulus uji generasi, pengulangan dan konflik.');

  const first = batch('r1', [fixture(2, 0), fixture(3, '', 'AHI'), fixture(4, 15, 'AHI'),
    fixture(5, -5, 'AHI', 'REVISION'), fixture(6, 'invalid')]);
  const result = await importDataInput(primary, first);
  assert.equal(result.accepted, 4);
  assert.equal(result.rejected, 1);
  assert.deepEqual(await importDataInput(primary, first), { ...result, alreadyImported: true });

  const conflict = await importDataInput(primary, batch('r2', [fixture(2, 99), fixture(4, 15, 'AHI')]));
  assert.equal(conflict.rejected, 1);
  assert.equal(conflict.accepted, 1);
  const groups = (await primary.query(totals)).rows;
  const scope = { day: '2026-10-31', dc: 'MAKASSAR', shift: '2', activity: 'Move Ke Rak', unit: 'CBM' };
  assert.deepEqual(groups, [{ ...scope, bu: 'AHI', total: '10', rows: 3, entered: 2 },
    { ...scope, bu: 'HCI', total: '0', rows: 1, entered: 1 }]);

  await primary.query('ALTER TABLE daily_activity.demand_events ADD CONSTRAINT simulated_failure CHECK (source_row <> 10)');
  const interrupted = batch('r3', [fixture(9, 3), fixture(10, 4)]);
  await assert.rejects(importDataInput(primary, interrupted), { code: '23514' });
  assert.equal((await primary.query('SELECT count(*)::int AS n FROM daily_activity.import_batches WHERE digest=$1', [interrupted.digest])).rows[0].n, 0);
  assert.equal((await primary.query('SELECT count(*)::int AS n FROM daily_activity.demand_events WHERE source_row=9')).rows[0].n, 0);
  await primary.query('ALTER TABLE daily_activity.demand_events DROP CONSTRAINT simulated_failure');
  assert.equal((await importDataInput(primary, interrupted)).accepted, 2);

  const snapshot = (await primary.query(`SELECT b.source_ref AS "sourceRef", b.source_revision AS "sourceRevision",
    b.digest, jsonb_agg(jsonb_build_object('rowNumber', r.row_number, 'values', r.payload) ORDER BY r.row_number) AS rows
    FROM daily_activity.import_batches b JOIN daily_activity.import_rows r ON r.batch_digest=b.digest
    GROUP BY b.digest ORDER BY b.batch_sequence`)).rows;
  const archive = join(directory, 'journal.json');
  await writeFile(archive, JSON.stringify(snapshot), { flag: 'wx' });
  await primary.query('CREATE DATABASE stage04_restore');
  await restored.connect();
  await restored.query(sql);
  for (const record of JSON.parse(await readFile(archive, 'utf8'))) {
    const replay = prepareImport(record);
    assert.equal(replay.digest, record.digest);
    await importDataInput(restored, replay);
  }
  const expectedAfterRetry = [groups[0], { ...scope, bu: 'HCI', total: '7', rows: 3, entered: 3 }];
  assert.deepEqual((await primary.query(totals)).rows, expectedAfterRetry);
  assert.deepEqual((await restored.query(totals)).rows, expectedAfterRetry);
  for (const table of ['import_batches', 'import_rows', 'demand_events']) {
    const order = { import_batches: 'batch_sequence', import_rows: 'batch_digest, row_number', demand_events: 'source_ref, source_row' };
    const query = `SELECT to_jsonb(t) - 'imported_at' - 'batch_sequence' AS record
                   FROM daily_activity.${table} t ORDER BY ${order[table]}`;
    assert.deepEqual((await restored.query(query)).rows, (await primary.query(query)).rows, table);
  }
  console.log(JSON.stringify({ groups, firstResult: result, recoveredGroups: (await restored.query(totals)).rows }));
  if (process.argv.includes('--benchmark')) {
    const count = 3717;
    const sample = prepareImport({
      sourceRef: 'synthetic:benchmark', sourceRevision: 'r1',
      rows: Array.from({ length: count }, (_, index) => fixture(index + 2, index % 17, index % 2 ? 'AHI' : 'HCI')),
    });
    const start = performance.now();
    const load = await importDataInput(primary, sample);
    const milliseconds = Math.round(performance.now() - start);
    assert.equal(load.accepted, count);
    assert.equal(load.rejected, 0);
    const storage = await primary.query("SELECT sum(pg_total_relation_size(c.oid))::text AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='daily_activity' AND c.relkind='r'");
    console.log(JSON.stringify({ benchmark: count, milliseconds, schemaBytes: storage.rows[0].bytes }));
  }
} finally {
  await restored.end();
  await primary.end();
  await postgres.stop();
}
