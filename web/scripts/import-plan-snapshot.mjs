import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

export function preparePlanSnapshot(kind, input) {
  if (!['inbound', 'outbound'].includes(kind) ||
      typeof input?.sourceRef !== 'string' || !input.sourceRef.trim() ||
      typeof input.sourceRevision !== 'string' || !input.sourceRevision.trim() ||
      !Array.isArray(input.rows) || !input.rows.length) {
    throw new Error('Ekspor wajib memuat sourceRef, sourceRevision dan potongan snapshot di rows.');
  }
  const rows = [...input.rows];
  if (rows.some(row => !Number.isSafeInteger(row?.rowNumber) || row.rowNumber < 2 ||
      !Array.isArray(row.values) || row.values.length !== 4)) {
    throw new Error('Setiap potongan harus memuat rowNumber asli dan values A–D.');
  }
  rows.sort((a, b) => a.rowNumber - b.rowNumber);
  const [, , generatedAt] = rows[0].values;
  if (typeof generatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(generatedAt) ||
      !Number.isFinite(Date.parse(generatedAt))) {
    throw new Error('Waktu generasi snapshot harus berupa timestamp UTC ISO 8601.');
  }
  if (rows.some(({ rowNumber, values: [chunk, body, generation, count] }, index) =>
    rowNumber !== rows[0].rowNumber + index || Number(chunk) !== index + 1 ||
    Number(count) !== rows.length || generation !== generatedAt || typeof body !== 'string')) {
    throw new Error('Potongan snapshot tidak lengkap atau berasal dari generasi berbeda.');
  }
  const json = rows.map(row => row.values[1]).join('');
  let payload;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new Error('JSON gabungan snapshot rusak.');
  }
  const sourceValid = kind === 'inbound' ? payload?.source === 'Sheet1' :
    typeof payload?.source === 'string' && /^\d{4}$/.test(payload.source);
  if (!sourceValid || payload.schemaVersion !== 1 || payload.generatedAt !== generatedAt ||
      !Array.isArray(payload.records) || !payload.warnings || typeof payload.warnings !== 'object' ||
      Array.isArray(payload.warnings)) {
    throw new Error('Versi, sumber atau isi snapshot tidak sesuai.');
  }
  const ids = new Set();
  for (const record of payload.records) {
    if (typeof record?.id !== 'string' || !record.id.trim() || ids.has(record.id)) {
      throw new Error('Snapshot memuat identitas pengiriman kosong atau berulang.');
    }
    ids.add(record.id);
  }
  const digest = createHash('sha256').update(json).digest('hex');
  return { sourceRef: input.sourceRef.trim(), revision: input.sourceRevision.trim(),
    kind, generatedAt, rows, json, digest, count: ids.size };
}

export async function importPlanSnapshot(client, snapshot) {
  const { sourceRef, revision, kind, generatedAt, rows, json, digest } = snapshot;
  const inserted = await client.query(`
    INSERT INTO daily_activity.plan_snapshots
      (source_ref, kind, generated_at, source_revision, digest, source_rows, payload)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
    ON CONFLICT (source_ref, kind, generated_at) DO NOTHING
  `, [sourceRef, kind, generatedAt, revision, digest, JSON.stringify(rows), json]);
  if (inserted.rowCount) return { alreadyImported: false };
  const { rows: [existing] } = await client.query(`
    SELECT digest FROM daily_activity.plan_snapshots
    WHERE source_ref = $1 AND kind = $2 AND generated_at = $3
  `, [sourceRef, kind, generatedAt]);
  if (existing?.digest !== digest) throw new Error('Generasi snapshot sudah tersimpan dengan isi berbeda.');
  return { alreadyImported: true };
}

async function main() {
  const [mode, kind, filename, ...extra] = process.argv.slice(2);
  if (!['--check', '--apply'].includes(mode) || !filename || extra.length) {
    throw new Error('Gunakan --check atau --apply, diikuti inbound atau outbound dan path JSON.');
  }
  const snapshot = preparePlanSnapshot(kind, JSON.parse(await readFile(filename, 'utf8')));
  const report = { kind, generatedAt: snapshot.generatedAt, records: snapshot.count };
  if (mode === '--check') {
    console.log(JSON.stringify(report));
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL untuk database impor wajib diisi.');
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    console.log(JSON.stringify({ ...report, ...await importPlanSnapshot(client, snapshot) }));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Impor snapshot gagal (${error.code ?? error.message}).`);
    process.exitCode = 1;
  });
}
