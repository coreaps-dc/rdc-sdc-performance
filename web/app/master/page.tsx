'use client';

import { useActionState, useState } from 'react';
import { saveMaster, type MasterState } from './actions';

const initial: MasterState = { message: '', failed: false };

export default function MasterPage() {
  const [mode, setMode] = useState('load');
  const [state, action, pending] = useActionState(saveMaster, initial);

  return (
    <main className="master">
      <section aria-labelledby="master-title">
        <h1 id="master-title">Master Setting</h1>
        <p>Site baru langsung mendapat produktivitas dari master aktivitas. Jam kerja diatur terpisah.</p>
        <form action={action}>
          <label>Kunci admin database latihan<input name="key" type="password" autoComplete="current-password" required /></label>
          <label>Pengaturan
            <select name="mode" value={mode} onChange={event => setMode(event.target.value)}>
              <option value="load">Lihat master</option>
              <option value="site">Tambah site</option>
              <option value="activity">Tambah aktivitas</option>
              <option value="default">Ubah standar untuk site baru</option>
            </select>
          </label>
          {mode === 'site' && <label>Kode site<input name="site" maxLength={100} required /></label>}
          {mode === 'activity' && <>
            <label>Aktivitas<input name="activity" maxLength={100} required /></label>
            <label>Departemen<input name="department" maxLength={100} required /></label>
            <label>Satuan<input name="unit" maxLength={100} required /></label>
            <label>Prod/MPP/Jam awal<input name="rate" type="number" min="0" step="0.000001" /></label>
          </>}
          {mode === 'default' && <>
            <label>Nama aktivitas<input name="activity" maxLength={100} required /></label>
            <label>Prod/MPP/Jam awal<input name="rate" type="number" min="0" step="0.000001" /></label>
          </>}
          <button disabled={pending}>{pending ? 'Memproses…' : mode === 'load' ? 'Muat master' : 'Simpan data'}</button>
        </form>
        {state.message && <p role={state.failed ? 'alert' : 'status'}>{state.message}</p>}
        {state.rows?.length === 0 && <p>Belum ada site.</p>}
        {!!state.rows?.length && <div className="master-table" role="region" aria-label="Produktivitas per site" tabIndex={0}>
          <table>
            <thead><tr><th scope="col">Site</th><th scope="col">Aktivitas</th><th scope="col">Prod/MPP/Jam</th><th scope="col">Satuan</th></tr></thead>
            <tbody>{state.rows.map(row => <tr key={JSON.stringify([row.site, row.activity])}>
              <td>{row.site}</td><td>{row.activity ?? '—'}</td><td>{row.rate ?? '—'}</td><td>{row.unit ?? '—'}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section>
    </main>
  );
}
