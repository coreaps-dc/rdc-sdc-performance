'use server';

import { createHash, timingSafeEqual } from 'node:crypto';
import { databasePool } from '../../lib/database';

export type MasterState = {
  message: string;
  failed: boolean;
  rows?: { site: string; activity: string | null; rate: string | null; unit: string | null }[];
};

export async function saveMaster(_: MasterState, form: FormData): Promise<MasterState> {
  const text = (key: string) => String(form.get(key) ?? '').trim();
  const secret = process.env.MASTER_SETTINGS_KEY;
  const hash = (value: string) => createHash('sha256').update(value).digest();
  if (!secret || secret.length < 24 || !timingSafeEqual(hash(secret), hash(text('key')))) {
    return { message: 'Akses Master Setting ditolak.', failed: true };
  }
  const mode = text('mode');
  const activity = text('activity');
  const site = text('site').toUpperCase();
  const department = text('department').toUpperCase();
  const unit = text('unit').toUpperCase();
  const rate = text('rate');
  if (!['load', 'site', 'activity', 'default'].includes(mode) ||
      (mode === 'site' && (!site || site.length > 100)) ||
      (mode === 'activity' && ![department, unit].every(v => v && v.length <= 100)) ||
      (['activity', 'default'].includes(mode) &&
        (!activity || activity.length > 100 || (rate !== '' && !/^\d{1,12}(?:\.\d{1,6})?$/.test(rate))))) {
    return { message: 'Periksa nama site, aktivitas, departemen, satuan dan nilai produktivitas.', failed: true };
  }
  if (mode === 'default' && activity === 'Check & Pack') {
    return { message: 'Standar Check & Pack tetap 50 CASE ID per MPP per jam.', failed: true };
  }
  try {
    const pool = databasePool();
    let message = 'Master dimuat.';
    if (mode === 'site') {
      const result = await pool.query(
        'INSERT INTO daily_activity.master_sites (code) VALUES ($1) ON CONFLICT DO NOTHING', [site],
      );
      message = result.rowCount ? `Site ${site} dan produktivitasnya tersimpan.` : `Site ${site} sudah terdaftar.`;
    }
    if (mode === 'activity') {
      const result = await pool.query(`
        INSERT INTO daily_activity.master_activities (name, department, unit, default_rate)
        VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING
      `, [activity, department, unit, rate || null]);
      message = result.rowCount ? `Aktivitas ${activity} tersimpan.` : `Aktivitas ${activity} sudah terdaftar.`;
    }
    if (mode === 'default') {
      const result = await pool.query(
        'UPDATE daily_activity.master_activities SET default_rate = $2 WHERE name = $1', [activity, rate || null],
      );
      if (!result.rowCount) return { message: 'Aktivitas belum terdaftar.', failed: true };
      message = `Standar ${activity} untuk site baru tersimpan.`;
    }
    const { rows } = await pool.query<NonNullable<MasterState['rows']>[number]>(`
      SELECT s.code AS site, a.name AS activity, p.rate::text, a.unit
      FROM daily_activity.master_sites s
      LEFT JOIN daily_activity.site_productivity p ON p.site = s.code
      LEFT JOIN daily_activity.master_activities a ON a.name = p.activity
      ORDER BY s.code, a.department, a.name
    `);
    return { message, failed: false, rows };
  } catch {
    return { message: 'Master gagal diproses. Periksa koneksi dan skema database.', failed: true };
  }
}
