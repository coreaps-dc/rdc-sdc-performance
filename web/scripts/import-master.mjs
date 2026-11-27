import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

const defaultRates = new Map(Object.entries({
  Unloader: 16, Receiver: 16, Putaway: 24, 'Qc Inbound': 10,
  'Move Ke Rak': 10, Picking: 20, Sweeper: 62, Pressing: 9, 'Inquery location': 50,
  'Cycle Count WTW': 18, 'Cycle Count by Transaksi': 25, Repair: 1, 'Picking ADF': 193,
  Loading: 6, Konsolidasi: 8, 'Check & Pack': 50, 'QC Outbound': 25,
  'Picking Transit': 25, 'Unload Pickup Store': 16, 'MEMBERSIHKAN LORONG': 4, 'MEMBERSIHKAN TOILET': 1,
}));
const text = value => String(value ?? '').trim();
const upper = value => text(value).toUpperCase();

export function prepareMaster(input) {
  if (typeof input?.sourceRef !== 'string' || !input.sourceRef.trim() ||
      typeof input.sourceRevision !== 'string' || !input.sourceRevision.trim() || !Array.isArray(input.rows)) {
    throw new Error('Ekspor Master memerlukan sourceRef, sourceRevision dan rows.');
  }
  const positions = new Set();
  const sites = new Map();
  const activities = new Map();
  const rates = new Map();
  const hours = new Map();
  const issues = [];
  function add(map, key, value, rowNumber, reason) {
    if (map.has(key)) issues.push({ rowNumber, reason });
    else map.set(key, { value, rowNumber });
  }
  function number(value, rowNumber, reason, limit = Infinity) {
    const raw = text(value);
    if (!raw) return null;
    if (!/^\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(Number(raw)) ||
        (limit !== Infinity && (Number(raw) <= 0 || Number(raw) > limit))) {
      issues.push({ rowNumber, reason });
    }
    return raw;
  }
  for (const row of input.rows) {
    if (!Number.isSafeInteger(row?.rowNumber) || row.rowNumber < 2 || positions.has(row.rowNumber) ||
        !Array.isArray(row.values) || row.values.length > 35) throw new Error('Ekspor Master harus memuat nomor baris unik dan kolom A–AI.');
    const { rowNumber, values } = row;
    positions.add(rowNumber);
    const site = upper(values[0]);
    if (site) add(sites, site, site, rowNumber, 'duplicate_site');
    const activity = text(values[4]);
    const unit = upper(values[5]);
    const department = upper(values[6]);
    if (activity) {
      if (!unit || !department || (activity === 'Check & Pack' && (unit !== 'CASE ID' || department !== 'OUTBOUND'))) {
        issues.push({ rowNumber, reason: 'invalid_activity' });
      }
      add(activities, activity, { activity, unit, department, rate: defaultRates.get(activity) ?? null },
        rowNumber, 'duplicate_activity');
    }
    const rateSite = upper(values[20]);
    const rateActivity = text(values[23]);
    if (rateSite || rateActivity) {
      const rate = number(values[25], rowNumber, 'invalid_rate');
      add(rates, JSON.stringify([rateSite, rateActivity]),
        { site: rateSite, activity: rateActivity, rate: rateActivity === 'Check & Pack' ? '50' : rate },
        rowNumber, 'duplicate_site_activity');
    }
    const hoursSite = upper(values[32]);
    if (hoursSite) add(hours, hoursSite, number(values[33], rowNumber, 'invalid_work_hours', 24),
      rowNumber, 'duplicate_work_hours');
  }
  for (const { value, rowNumber } of rates.values()) {
    if (!sites.has(value.site) || (!activities.has(value.activity) && value.activity !== 'Check & Pack')) {
      issues.push({ rowNumber, reason: 'unresolved_site_activity' });
    }
  }
  for (const [site, { rowNumber }] of hours) {
    if (!sites.has(site)) issues.push({ rowNumber, reason: 'unresolved_site_hours' });
  }
  const rows = [...input.rows].sort((a, b) => a.rowNumber - b.rowNumber);
  const digest = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  return { source: input.sourceRef.trim(), revision: input.sourceRevision.trim(), rows, digest,
    sites: [...sites.keys()].map(site => ({ site, hours: hours.get(site)?.value ?? null })),
    activities: [...activities.values()].map(item => item.value), rates: [...rates.values()].map(item => item.value), issues };
}

export async function applyMaster(client, batch) {
  if (batch.issues.length) throw new Error('Selesaikan temuan sebelum memasukkan Master ke database.');
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(404, 1)');
    const { rows: [previous] } = await client.query('SELECT source_ref, digest FROM daily_activity.master_imports LIMIT 1');
    if (previous && (previous.source_ref !== batch.source || previous.digest !== batch.digest)) {
      throw new Error('Master awal sudah terimpor. Kelola perubahan melalui Master Setting.');
    }
    if (!previous) {
      const { rows: [status] } = await client.query(`
        SELECT EXISTS (SELECT 1 FROM daily_activity.master_sites)
          OR EXISTS (SELECT 1 FROM daily_activity.master_activities WHERE name <> 'Check & Pack') AS configured
      `);
      if (status.configured) throw new Error('Impor awal Master membutuhkan database latihan dengan katalog kosong.');
      for (const { activity, department, unit, rate } of batch.activities) {
        await client.query(`
          INSERT INTO daily_activity.master_activities (name, department, unit, default_rate)
          VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING
        `, [activity, department, unit, rate]);
      }
      for (const { site, hours } of batch.sites) {
        await client.query('INSERT INTO daily_activity.master_sites (code, work_hours) VALUES ($1, $2)', [site, hours]);
      }
      await client.query("UPDATE daily_activity.site_productivity SET rate = NULL WHERE activity <> 'Check & Pack'");
      for (const { site, activity, rate } of batch.rates) {
        await client.query('UPDATE daily_activity.site_productivity SET rate = $3 WHERE site = $1 AND activity = $2',
          [site, activity, rate]);
      }
      await client.query(`
        INSERT INTO daily_activity.master_imports (source_ref, source_revision, digest, source_rows)
        VALUES ($1, $2, $3, $4::jsonb)
      `, [batch.source, batch.revision, batch.digest, JSON.stringify(batch.rows)]);
    }
    await client.query('COMMIT');
    return { alreadyImported: Boolean(previous) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const [mode, filename, ...extra] = process.argv.slice(2);
  if (!['--check', '--apply'].includes(mode) || !filename || extra.length) {
    throw new Error('Gunakan --check atau --apply diikuti path JSON.');
  }
  const batch = prepareMaster(JSON.parse(await readFile(filename, 'utf8')));
  const report = { sites: batch.sites.length, activities: batch.activities.length, rates: batch.rates.length, issues: batch.issues };
  if (mode === '--check' || batch.issues.length) {
    console.log(JSON.stringify(report));
    if (batch.issues.length) process.exitCode = 2;
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL untuk database latihan wajib diisi.');
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    console.log(JSON.stringify({ ...report, ...await applyMaster(client, batch) }));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Impor Master gagal (${error.code ?? error.message}).`);
    process.exitCode = 1;
  });
}
