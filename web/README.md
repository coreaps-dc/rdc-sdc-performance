# RDC SDC Performance · Pengembangan lokal

Gunakan Node.js **24.19.0** dan npm **11.17.0**. Jalankan perintah dari folder `web`. Dependensi aplikasi dikunci di `package-lock.json`. Build dan deploy nantinya memakai Node.js 24 juga.

## Jalankan dari salinan proyek baru

1. Jalankan `npm ci`.
2. Di terminal pertama, jalankan `npm run db:local`. Tunggu tulisan `PostgreSQL lokal siap`. Perintah ini menjalankan PostgreSQL khusus pengembangan di `127.0.0.1:55432` dan membuat `.env.local` dengan kata sandi acak pada penggunaan pertama. Biarkan berkas dan folder `.local-postgres/` bersama agar kredensial cocok dengan data lokal.
3. Di terminal kedua, jalankan `npm run dev` dan buka `http://127.0.0.1:3000`. Pilih **Periksa koneksi database**. HTTP `200` dengan `{"status":"ok"}` menandakan koneksi berhasil. Jika database mati atau konfigurasi kurang, endpoint menampilkan HTTP `503` dengan `{"status":"unavailable"}`. Tekan Ctrl+C di masing-masing terminal untuk berhenti.

Jika sudah memiliki PostgreSQL untuk pengembangan, buat database lokal terpisah, salin `.env.example` ke `.env.local` dan isi `DATABASE_URL`. Dalam alur ini, jalankan server PostgreSQL yang dimiliki sendiri dan lanjut langsung ke `npm run dev`. Simpan pengaturan dan data lokal di luar commit Git.

## Pemeriksaan sebelum push

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Build menjalankan lint dan pemeriksaan tipe. Pengembangan dan build menggunakan Webpack agar dapat berjalan di Windows saat pembuatan junction dibatasi. Tes fungsi konfigurasi dapat dijalankan tanpa database. Build tidak bergantung pada ketersediaan PostgreSQL. Saat aplikasi berjalan, pemeriksaan koneksi menggunakan `SELECT 1` tanpa mengubah data atau struktur tabel. PostgreSQL terkelola untuk Preview dan Production akan dikonfigurasi terpisah.

## Latihan impor Data Input

Gunakan database PostgreSQL uji yang terpisah dan data sintetis. Simpan ekspor dan laporan yang berisi data operasional di penyimpanan terbatas. Satu berkas JSON berisi `sourceRef` (identitas sumber yang stabil), `sourceRevision` (versi ekspor) dan `rows`. Setiap entri `rows` memuat `rowNumber` asli dari spreadsheet dan `values` sesuai kolom A–O. Gunakan tanggal bisnis `YYYY-MM-DD`, waktu ISO 8601 dengan zona waktu dan string untuk angka yang memerlukan presisi lebih tinggi daripada angka JavaScript. Pertahankan urutan serta posisi baris asli pada ekspor ulang.

```powershell
node scripts/import-data-input.mjs --check <path-json>
node scripts/verify-import-local.mjs --benchmark
```

`--check` memeriksa format tanpa tersambung ke database. Untuk latihan penerapan, tetapkan `DATABASE_URL` untuk database uji, jalankan `db/migrations/001-import-journal.sql` dengan klien PostgreSQL, lalu jalankan `node scripts/import-data-input.mjs --apply <path-json>`. Kode keluar 2 menandakan ada baris tertolak. Pada mode `--apply`, baris valid dan catatan penolakan tersimpan dalam satu transaksi. Jalankan ulang berkas yang sama jika transaksi terputus. Posisi yang sudah terimpor dengan isi berbeda dicatat sebagai konflik untuk ditinjau.

Verifikasi lokal menjalankan PostgreSQL sementara, menguji impor ulang dan rollback, serta membandingkan total setelah pemulihan jurnal ke database kedua. Jika port lokal `55439` sedang dipakai, pilih port kosong dengan variabel `IMPORT_TEST_PORT`. Tahap 04 masih mencakup latihan cadangan PostgreSQL, sumber selain Data Input, rekonsiliasi sampel operasional dan pengujian koneksi Preview.

## Latihan impor snapshot Plan

Ekspor tab `Plan_Inbound_JSON` atau `Plan_Outbound_JSON` dalam format JSON yang sama seperti Data Input, dengan `values` berisi empat kolom asli (nomor potongan, teks JSON, waktu generasi UTC, jumlah potongan). Gunakan `sourceRef` stabil untuk spreadsheet sumber.

```powershell
node scripts/import-plan-snapshot.mjs --check inbound <path-json>
node scripts/import-plan-snapshot.mjs --check outbound <path-json>
```

Untuk menyimpan snapshot di database latihan, jalankan `db/migrations/002-plan-snapshots.sql` di luar build, tetapkan `DATABASE_URL` untuk database tersebut, lalu ganti `--check` dengan `--apply`. Potongan lengkap tersimpan bersama JSON gabungan. Pengulangan generasi dengan isi sama tidak menulis ulang. Generasi yang sama dengan isi berbeda ditolak.

Setelah snapshot tersimpan, jalankan `db/migrations/003-plan-shifts.sql` dan periksa pilihan shift dengan `node scripts/import-plan-shifts.mjs --check inbound <path-json>` atau ganti jenis dengan `outbound`. Ekspor pilihan shift memakai `sourceRef` snapshot, `sourceRevision` ekspor shift, `generatedAt` snapshot, serta baris asli A–L (Inbound) atau A–F (Outbound) dengan tanggal bisnis ISO. Mode `--check` membaca snapshot dari database latihan. Mode `--apply` mengarsipkan baris dan laporan secara idempoten. Kode keluar 2 menandakan ada baris yang perlu ditinjau, termasuk pilihan dari pengiriman yang sudah keluar dari snapshot. Penerbitan pilihan ke aplikasi masih terbuka.

## Build Cloudflare Workers

Workers Builds menggunakan root web dan cabang produksi main. Jalankan npm run build:workers untuk memeriksa bundel Workers. Perintah tersebut menjalankan pemeriksaan Next.js, lint dan tipe sebelum membuat bundel. npm run preview:workers membuat Preview Cloudflare, sedangkan npm run deploy:workers menerbitkan ke Production. Gunakan integrasi GitHub untuk menjalankan keduanya dari cabang yang sesuai.

Simpan DATABASE_URL sebagai secret Cloudflare saat PostgreSQL tersedia. Preview dan Production memakai konfigurasi terpisah. Fondasi dapat dibangun tanpa kredensial dan endpoint kesehatan menampilkan 503 sampai database dikonfigurasi.

Preview dilindungi oleh HTTP Basic Auth di Worker. Isi secret PREVIEW_ACCESS_TOKEN pada konfigurasi Previews Base sebelum membuat Preview baru. Gunakan username preview dan nilai secret untuk masuk. Tanpa secret, Preview menolak akses dengan HTTP 401. Production tidak memakai gerbang Preview.
