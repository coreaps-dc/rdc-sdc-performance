import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const string = (value) => value == null ? '' : String(value).trim();
const optional = (value) => string(value) || null;
const kinds = new Set(['BASE', 'ADDITION', 'REVISION', 'OUTBOUND_PLAN', 'OUTBOUND_ACTUAL']);

function numeric(value, field) {
  const input = optional(value);
  if (input === null) return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(input) || !Number.isFinite(Number(input))) {
    throw new Error(`${field} bukan angka`);
  }
  return input;
}

export function prepareImport(input) {
  if (!input || typeof input !== 'object' || !string(input.sourceRef) ||
      !string(input.sourceRevision) || !Array.isArray(input.rows)) {
    throw new Error('Isi sourceRef, sourceRevision dan rows pada berkas impor.');
  }
  const source = string(input.sourceRef);
  const revision = string(input.sourceRevision);
  const seen = new Set();
  const rows = input.rows.map(({ rowNumber, values }) => {
    if (!Number.isInteger(rowNumber) || rowNumber < 2 || rowNumber > 2147483647 || seen.has(rowNumber) || !Array.isArray(values)) {
      throw new Error('Nomor baris sumber harus unik, minimal 2, dengan values berupa daftar kolom.');
    }
    seen.add(rowNumber);
    const row = { rowNumber, values, digest: sha(values) };
    try {
      if (values.length > 15) throw new Error('Data Input hanya menerima kolom A–O');
      const [date, dcValue, shiftValue, deptValue, activityValue, demand, unit, old, who, timestamp, resource, eventType, reason, id, buValue] = values;
      const day = string(date);
      const dc = string(dcValue).toUpperCase();
      const shift = string(shiftValue);
      const department = string(deptValue).toUpperCase();
      const activity = string(activityValue);
      const bu = string(buValue).toUpperCase() || 'HCI';
      const type = string(eventType).toUpperCase() || 'BASE';
      const time = optional(timestamp);
      const dateValue = new Date(`${day}T00:00:00.000Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(+dateValue) || dateValue.toISOString().slice(0, 10) !== day) throw new Error('Tanggal bisnis tidak valid');
      if (![dc, shift, department, activity].every(Boolean)) throw new Error('DC, shift, departemen dan aktivitas wajib diisi');
      if (!['HCI', 'AHI'].includes(bu)) throw new Error('BU tidak dikenali');
      if (!kinds.has(type)) throw new Error('Tipe event tidak dikenali');
      if (time && (!/T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(time) || Number.isNaN(Date.parse(time)))) throw new Error('Waktu wajib berupa ISO 8601 dengan zona waktu');
      row.event = [day, dc, bu, shift, department, activity, numeric(demand, 'Demand'), string(unit), numeric(old, 'Resource lama'), optional(who), time, numeric(resource, 'Resource'), type, optional(reason), optional(id)];
    } catch (error) {
      row.rejection = error.message;
    }
    return row;
  }).sort((a, b) => a.rowNumber - b.rowNumber);
  return { source, revision, digest: sha([source, revision, rows.map(({ rowNumber, values }) => [rowNumber, values])]), rows };
}

export async function importDataInput(client, batch) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [batch.source]);
    const previous = await client.query('SELECT accepted, rejected FROM daily_activity.import_batches WHERE digest = $1', [batch.digest]);
    if (previous.rowCount) {
      const { rows: rejectedRows } = await client.query(
        'SELECT row_number AS "rowNumber", rejection FROM daily_activity.import_rows WHERE batch_digest = $1 AND rejection IS NOT NULL ORDER BY row_number',
        [batch.digest],
      );
      await client.query('COMMIT');
      return { ...previous.rows[0], alreadyImported: true, rejectedRows };
    }
    const existing = await client.query('SELECT source_row, row_digest FROM daily_activity.demand_events WHERE source_ref = $1 AND source_row = ANY($2::integer[])', [batch.source, batch.rows.map(r => r.rowNumber)]);
    const byPosition = new Map(existing.rows.map(r => [r.source_row, r.row_digest]));
    const rows = batch.rows.map(row => byPosition.has(row.rowNumber) && byPosition.get(row.rowNumber) !== row.digest
      ? { ...row, rejection: 'Posisi sumber sudah diimpor dengan isi berbeda' } : row);
    const rejected = rows.filter(row => row.rejection).length;
    const accepted = rows.length - rejected;
    await client.query('INSERT INTO daily_activity.import_batches (digest, source_ref, source_revision, accepted, rejected) VALUES ($1, $2, $3, $4, $5)', [batch.digest, batch.source, batch.revision, accepted, rejected]);
    for (const row of rows) {
      await client.query('INSERT INTO daily_activity.import_rows (batch_digest, row_number, payload, rejection) VALUES ($1, $2, $3, $4)', [batch.digest, row.rowNumber, JSON.stringify(row.values), row.rejection ?? null]);
      if (!row.rejection && !byPosition.has(row.rowNumber)) {
        await client.query(`INSERT INTO daily_activity.demand_events (
          source_ref, source_row, first_batch_digest, row_digest, business_date, dc, bu, shift,
          department, activity, demand, unit, legacy_resource, operator_label, occurred_at,
          resource, event_type, reason, legacy_event_id
        ) VALUES (${Array.from({ length: 19 }, (_, i) => `$${i + 1}`).join(', ')})`,
        [batch.source, row.rowNumber, batch.digest, row.digest, ...row.event]);
      }
    }
    await client.query('COMMIT');
    return { accepted, rejected, alreadyImported: false, rejectedRows: rows.filter(r => r.rejection).map(({ rowNumber, rejection }) => ({ rowNumber, rejection })) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const [mode, filename, ...extra] = process.argv.slice(2);
  if (!['--check', '--apply'].includes(mode) || !filename || extra.length) {
    throw new Error('Gunakan --check atau --apply diikuti path berkas JSON.');
  }
  const batch = prepareImport(JSON.parse(await readFile(filename, 'utf8')));
  if (mode === '--check') {
    const rejectedRows = batch.rows.filter(r => r.rejection).map(({ rowNumber, rejection }) => ({ rowNumber, rejection }));
    console.log(JSON.stringify({ accepted: batch.rows.length - rejectedRows.length, rejected: rejectedRows.length, rejectedRows }, null, 2));
    if (rejectedRows.length) process.exitCode = 2;
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL untuk database impor wajib diisi.');
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const result = await importDataInput(client, batch);
    console.log(JSON.stringify(result, null, 2));
    if (result.rejected) process.exitCode = 2;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Impor gagal (${error.code ?? error.message}).`);
    process.exitCode = 1;
  });
}
