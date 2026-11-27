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

## Build Cloudflare Workers

Workers Builds menggunakan root web dan cabang produksi main. Jalankan npm run build:workers untuk memeriksa bundel Workers. Perintah tersebut menjalankan pemeriksaan Next.js, lint dan tipe sebelum membuat bundel. npm run preview:workers membuat Preview Cloudflare, sedangkan npm run deploy:workers menerbitkan ke Production. Gunakan integrasi GitHub untuk menjalankan keduanya dari cabang yang sesuai.

Simpan DATABASE_URL sebagai secret Cloudflare saat PostgreSQL tersedia. Preview dan Production memakai konfigurasi terpisah. Fondasi dapat dibangun tanpa kredensial dan endpoint kesehatan menampilkan 503 sampai database dikonfigurasi.

Preview dilindungi oleh HTTP Basic Auth di Worker. Isi secret PREVIEW_ACCESS_TOKEN pada konfigurasi Previews Base sebelum membuat Preview baru. Gunakan username preview dan nilai secret untuk masuk. Tanpa secret, Preview menolak akses dengan HTTP 401. Production tidak memakai gerbang Preview.
