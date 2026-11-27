import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = new Date(value);
  return Number.isFinite(+time) && time.toISOString().slice(0, 10) === value;
}

export function checkPlanShifts(kind, input, records) {
  const { sourceRef, sourceRevision, generatedAt, rows } = input ?? {};
  if (!['inbound', 'outbound'].includes(kind) ||
      ![sourceRef, sourceRevision].every(value => typeof value === 'string' && value.trim()) ||
      typeof generatedAt !== 'string' || !generatedAt.endsWith('Z') || !Number.isFinite(Date.parse(generatedAt)) ||
      !Array.isArray(rows)) {
    throw new Error('Ekspor pilihan shift memerlukan sourceRef, sourceRevision, generatedAt snapshot dan rows.');
  }
  const positions = new Set();
  const counts = new Map();
  for (const row of rows) {
    if (!Number.isSafeInteger(row?.rowNumber) || row.rowNumber < 2 || positions.has(row.rowNumber) ||
        !Array.isArray(row.values)) throw new Error('Nomor baris sumber harus unik dan memuat daftar values.');
    positions.add(row.rowNumber);
    const id = row.values[0];
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const byId = new Map(records.map(row => [row.id, row]));
  const sourceRows = [...rows].sort((a, b) => a.rowNumber - b.rowNumber);
  const issues = [];
  for (const { rowNumber, values } of sourceRows) {
    const [id, dc, date, shift, , , confirmed, unloadingDate, , , stock, transit] = values;
    const record = byId.get(id);
    const empty = value => value == null || value === '';
    const invalidOverride = value => !empty(value) &&
      (!['number', 'string'].includes(typeof value) || !String(value).trim() ||
        !Number.isFinite(Number(value)) || Number(value) < 0);
    let reason;
    if (values.length > (kind === 'inbound' ? 12 : 6) || typeof id !== 'string' || !id.trim() ||
        typeof dc !== 'string' || !dc.trim() || !validDate(date) ||
        (!empty(shift) && !(dc === 'MAKASSAR' ? ['1', '2'] : ['1']).includes(String(shift)))) reason = 'invalid_row';
    else if (kind === 'inbound' && ((!empty(confirmed) && !['true', 'false'].includes(String(confirmed).toLowerCase())) ||
      (!empty(unloadingDate) && !validDate(unloadingDate)) ||
      invalidOverride(stock) || invalidOverride(transit))) reason = 'invalid_inbound_values';
    else if (counts.get(id) > 1) reason = 'duplicate_id';
    else if (!record) reason = 'missing_snapshot_record';
    else if (record.dc !== dc || record.date !== date) reason = 'snapshot_scope_mismatch';
    if (reason) issues.push({ rowNumber, reason });
  }
  return { total: sourceRows.length, reconciled: sourceRows.length - issues.length, issues };
}

export async function reconcilePlanShifts(client, kind, input, apply = false) {
  // Validate the envelope before sending its timestamp to PostgreSQL.
  checkPlanShifts(kind, input, []);
  const source = input.sourceRef.trim();
  const { generatedAt } = input;
  const { rows: [snapshot] } = await client.query(`
    SELECT payload->'records' AS records FROM daily_activity.plan_snapshots
    WHERE source_ref = $1 AND kind = $2 AND generated_at = $3
  `, [source, kind, generatedAt]);
  if (!snapshot) throw new Error('Generasi snapshot yang dirujuk belum diimpor.');
  const report = checkPlanShifts(kind, input, snapshot.records);
  if (!apply) return report;
  const revision = input.sourceRevision.trim();
  const sourceRows = [...input.rows].sort((a, b) => a.rowNumber - b.rowNumber);
  const digest = createHash('sha256')
    .update(JSON.stringify([source, kind, new Date(generatedAt).toISOString(), revision,
      sourceRows.map(({ rowNumber, values }) => [rowNumber, values])])).digest('hex');
  const result = await client.query(`
    INSERT INTO daily_activity.plan_shift_imports
      (digest, source_ref, kind, generated_at, source_revision, source_rows, report)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
    ON CONFLICT (digest) DO NOTHING
  `, [digest, source, kind, generatedAt, revision, JSON.stringify(sourceRows), JSON.stringify(report)]);
  return { ...report, alreadyImported: !result.rowCount };
}

async function main() {
  const [mode, kind, filename, ...extra] = process.argv.slice(2);
  if (!['--check', '--apply'].includes(mode) || !filename || extra.length) {
    throw new Error('Gunakan --check atau --apply, lalu inbound atau outbound dan path JSON.');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL untuk database latihan wajib diisi.');
  const input = JSON.parse(await readFile(filename, 'utf8'));
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const report = await reconcilePlanShifts(client, kind, input, mode === '--apply');
    console.log(JSON.stringify(report));
    if (report.issues.length) process.exitCode = 2;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Impor pilihan shift gagal (${error.code ?? error.message}).`);
    process.exitCode = 1;
  });
}
