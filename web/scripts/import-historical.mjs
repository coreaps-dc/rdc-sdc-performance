import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

const statuses = new Set(['PENDING', 'APPLYING', 'APPROVED', 'REJECTED']);
const text = value => String(value ?? '').trim();
const isoDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
const decimal = value => /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value));

export function prepareHistorical(kind, input) {
  if (!['summary', 'productivity-queue'].includes(kind) || typeof input?.sourceRef !== 'string' ||
      !input.sourceRef.trim() || typeof input.sourceRevision !== 'string' || !input.sourceRevision.trim() ||
      !Array.isArray(input.rows)) throw new Error('Ekspor memerlukan sourceRef, sourceRevision dan rows.');
  const source = input.sourceRef.trim();
  const revision = input.sourceRevision.trim();
  const positions = new Set();
  const seen = new Set();
  const issues = [];
  const records = [];
  for (const row of input.rows) {
    if (!Number.isInteger(row?.rowNumber) || row.rowNumber < 2 || row.rowNumber > 2147483647 ||
        positions.has(row.rowNumber) || !Array.isArray(row.values)) throw new Error('Nomor dan nilai baris sumber tidak valid.');
    const { rowNumber, values } = row;
    positions.add(rowNumber);
    let key;
    let payload;
    try {
      if (kind === 'summary') {
        const [day, dc, shift, json, writtenAt, legacyKey] = values;
        let data;
        try {
          if (typeof json !== 'string') throw new Error();
          data = JSON.parse(json);
        } catch { throw new Error('invalid_summary_json'); }
        const bu = data?.bu || 'HCI';
        if (values.length > 6 || !isoDate(text(day)) || !text(dc) || !text(shift) ||
            !['HCI', 'AHI'].includes(bu) || !Array.isArray(data?.activities)) throw new Error('invalid_summary');
        key = [text(day), text(dc).toUpperCase(), bu, text(shift)];
        payload = { summaryJson: json, writtenAt: writtenAt ?? null, legacyKey: legacyKey ?? null };
      } else {
        const [id, dc, activity, previous, proposed, requesterId, requestedBy, requestedAt, status, decidedBy, decidedAt] = values;
        if (values.length > 11 || ![id, dc, activity, requesterId, requestedAt].every(value => text(value)) ||
            (text(previous) && !decimal(text(previous))) || !decimal(text(proposed)) ||
            !statuses.has(status)) throw new Error('invalid_productivity_request');
        key = [text(id)];
        payload = { dc, activity, previous: text(previous) || null, proposed: text(proposed),
          requesterId: text(requesterId), requestedBy, requestedAt, status, decidedBy, decidedAt };
      }
      const encodedKey = JSON.stringify(key);
      if (seen.has(encodedKey)) throw new Error('duplicate_record_key');
      seen.add(encodedKey);
      records.push({ rowNumber, key, payload });
    } catch (error) {
      issues.push({ rowNumber, reason: error.message });
    }
  }
  const rows = [...input.rows].sort((a, b) => a.rowNumber - b.rowNumber);
  const digest = createHash('sha256').update(JSON.stringify([kind, source, revision, rows])).digest('hex');
  return { kind, source, revision, rows, digest, records, issues };
}

export async function applyHistorical(client, batch) {
  if (batch.issues.length) throw new Error('Tinjau baris bermasalah sebelum mengimpor arsip.');
  await client.query('BEGIN');
  try {
    const inserted = await client.query(`
      INSERT INTO daily_activity.historical_imports (digest, kind, source_ref, source_revision, source_rows)
      VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (kind, source_ref, source_revision) DO NOTHING
    `, [batch.digest, batch.kind, batch.source, batch.revision, JSON.stringify(batch.rows)]);
    if (inserted.rowCount) {
      for (const record of batch.records) {
        await client.query(`
          INSERT INTO daily_activity.historical_records (batch_digest, source_row, record_key, payload)
          VALUES ($1, $2, $3::jsonb, $4::jsonb)
        `, [batch.digest, record.rowNumber, JSON.stringify(record.key), JSON.stringify(record.payload)]);
      }
    } else {
      const existing = await client.query('SELECT 1 FROM daily_activity.historical_imports WHERE digest = $1', [batch.digest]);
      if (!existing.rowCount) throw new Error('Revisi arsip yang sama sudah tersimpan dengan isi berbeda.');
    }
    await client.query('COMMIT');
    return { alreadyImported: !inserted.rowCount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const [mode, kind, filename, ...extra] = process.argv.slice(2);
  if (!['--check', '--apply'].includes(mode) || !filename || extra.length) {
    throw new Error('Gunakan --check atau --apply, lalu summary atau productivity-queue dan path JSON.');
  }
  const batch = prepareHistorical(kind, JSON.parse(await readFile(filename, 'utf8')));
  const report = { total: batch.rows.length, accepted: batch.records.length, issues: batch.issues };
  if (mode === '--check' || batch.issues.length) {
    console.log(JSON.stringify(report));
    if (batch.issues.length) process.exitCode = 2;
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL untuk database latihan wajib diisi.');
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    console.log(JSON.stringify({ ...report, ...await applyHistorical(client, batch) }));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Impor arsip gagal (${error.code ?? error.message}).`);
    process.exitCode = 1;
  });
}
