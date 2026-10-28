# TANIWAVE Backend

Backend API untuk dashboard TANIWAVE berbasis Express 5, Prisma ORM 7.10.1, PostgreSQL/Supabase, dan Supabase Auth.

## Prasyarat

- Node.js 20.19+ (Node.js 22 LTS direkomendasikan untuk Prisma ORM 7).
- Proyek Supabase dengan PostgreSQL dan Supabase Auth aktif.
- Akses ke URL database runtime dan, untuk menjalankan migration, URL database langsung.

## 1. Instal dependensi dan konfigurasi environment

```bash
cp .env.example .env
npm install
```

Isi `.env` dengan konfigurasi proyek lu:

- `SUPABASE_URL`: URL proyek Supabase.
- `SUPABASE_ANON_KEY`: publishable/anon key Supabase. Jangan gunakan `service_role` key.
- `DATABASE_URL`: koneksi PostgreSQL untuk API saat berjalan. URL pooler Supabase dapat digunakan.
- `DIRECT_URL`: koneksi langsung PostgreSQL untuk Prisma Migrate. Jika kosong, konfigurasi memakai `DATABASE_URL`.
- `FRONTEND_URL`: origin frontend Vite; beberapa origin dapat dipisahkan dengan koma.

Jangan commit `.env`.

## 2. Prisma dan migration

Prisma CLI dan Prisma Client telah diselaraskan ke versi stabil `7.10.1`. Proyek memakai driver adapter PostgreSQL dan mode ES Modules.

```bash
npm run prisma:validate
npm run prisma:generate
```

**Penting sebelum menerapkan migration:** ZIP awal tidak memiliki migration history. Dua migration sekarang disertakan:

- `20261018000000_initial`: baseline schema lama (`User`, `Farm`, `Crop`, `Expense`, `Harvest`, `Diagnosis`, `MarketplaceListing`).
- `20261022090000_dashboard_foundation`: menambahkan relasi usaha tani, autentikasi Supabase, pasar, pengamatan, progres akademi, dan sesi praktik.

Buat backup database dan uji di staging terlebih dahulu. Jika database Supabase **sudah memiliki tujuh tabel lama** yang sesuai schema awal (misalnya dibuat lewat `prisma db push`) dan belum memiliki migration history, jangan menjalankan initial migration tersebut terhadap tabel yang sudah ada. Setelah memeriksa tabel dan kolom lama, tandai baseline sebagai applied lalu jalankan migration tambahan:

```bash
npx prisma migrate status
# Jalankan hanya jika tabel inti sudah ada dan benar-benar cocok dengan migration initial:
npx prisma migrate resolve --applied 20261018000000_initial
npm run prisma:deploy
```

Jika database **benar-benar kosong**, jalankan `npm run prisma:deploy` untuk membuat schema awal dan kemudian menambahkan perubahan dashboard. Jangan gunakan perintah baseline-resolve pada database kosong. Untuk perubahan schema selanjutnya pada lingkungan development, buat migration baru dengan `npm run prisma:migrate -- --name <nama_migration>`.

## 3. Jalankan server

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:5000/api/health
```

Route yang memerlukan autentikasi menerima header `Authorization: Bearer <supabase_access_token>`. Token diperiksa oleh Supabase Auth, lalu profil lokal ditautkan melalui `User.supabaseId`. ID pengguna tidak diterima dari request body untuk menentukan pemilik data.

## 4. API yang tersedia

### Dashboard

`GET /api/dashboard/summary`

Opsional: `GET /api/dashboard/summary?farmId=<farm-id>`.

Ringkasan meliputi profil, kebun aktif, siklus tanaman, biaya dan panen yang terhubung, prakiraan cuaca jika koordinat kebun tersedia, harga referensi, peluang yang cocok dengan listing aktif, progres Smart Academy, praktik yang sedang berjalan, serta Tani Pulse.

### Kebun dan pencatatan budidaya

- `GET /api/farms` — kebun milik pengguna.
- `POST /api/farms` — membuat kebun.
- `PATCH /api/farms/:farmId` — memperbarui data/lokasi kebun termasuk latitude dan longitude.
- `POST /api/farms/:farmId/crops` — menambahkan siklus tanaman.
- `POST /api/farms/:farmId/expenses` — mencatat biaya yang terhubung ke kebun dan opsional siklus tanaman.
- `POST /api/farms/:farmId/harvests` — mencatat hasil panen yang terhubung ke kebun dan opsional siklus tanaman.
- `POST /api/farms/:farmId/activities` — menyimpan catatan pengamatan/aktivitas kebun.

### Marketplace dan MarketWatch

- `GET /api/market/prices` — harga komoditas terbaru per komoditas/lokasi, perubahan dari snapshot sebelumnya, sumber, dan penanda demo.
- `GET /api/market/listings?commodity=Cabai` — listing aktif yang dapat dilihat pengguna terautentikasi.
- `POST /api/market/listings` — membuat listing sendiri; body memerlukan `title`, `commodity`, dan `quantity`; field `unit`, `price`, `quality`, `location`, `description` opsional.
- `PATCH /api/market/listings/:listingId` — memperbarui listing milik pengguna sendiri, termasuk status ACTIVE/CLOSED.
- `GET /api/market/demands` — permintaan terbuka dari pengguna lain.
- `POST /api/market/demands` — mencatat permintaan pembeli.
- `PATCH /api/market/demands/:demandId/status` — memperbarui status permintaan yang dibuat oleh pengguna sendiri.

Harga pasar dibaca dari `MarketPrice`; untuk memasukkan harga aktual, gunakan sumber yang terverifikasi atau proses administrasi tepercaya. Endpoint daftar dan permintaan tidak secara otomatis berarti pesanan sudah terjadi.

### Smart Academy

- `GET /api/academy/progress` — XP, level, progres dan misi selanjutnya.
- `POST /api/academy/missions/:missionId/complete` dengan body `{"decisionId":"inspect-drainage"}` — menyimpan penyelesaian misi.

XP dihitung backend menggunakan katalog keputusan pada `src/services/academy.service.js`. Cocokkan ID keputusan katalog ini dengan ID pilihan di frontend `missions.js` sebelum integrasi produksi. Misi yang sama hanya memberikan XP pada penyelesaian pertama; pengulangan hanya memperbarui skor terbaik/jumlah percobaan.

### Praktik

- `POST /api/practice-sessions` dengan body `{"practiceId":"polybag-basics","title":"Praktik menanam dengan polybag"}` untuk mulai/melanjutkan sesi.
- `PATCH /api/practice-sessions/:sessionId` dengan body `{"status":"COMPLETED"}` untuk menyelesaikan sesi, atau `{"status":"CANCELLED"}` untuk membatalkan.

## 5. Contoh membuat kebun

Dapatkan `access_token` dari session Supabase Auth frontend, lalu:

```bash
curl -X POST http://localhost:5000/api/farms \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -d '{
    "name": "Kebun Cabai",
    "location": "Bangsri, Jepara",
    "latitude": -6.53,
    "longitude": 110.75,
    "area": 250,
    "unit": "m2"
  }'
```

Koordinat di contoh hanya contoh input, bukan koordinat kebun pengguna. Masukkan koordinat kebun yang benar agar cuaca lokal bisa diminta.

## 6. Data cuaca dan pasar

Weather service menggunakan Open-Meteo dengan koordinat dari `Farm.latitude`/`Farm.longitude`. Jika koordinat tidak ada, API mengembalikan `weather.status = "LOCATION_REQUIRED"` dan tidak membuat data cuaca palsu. Jika provider tidak tersedia, `weather.status = "UNAVAILABLE"`.

Harga pasar dibaca dari model `MarketPrice`. Seed berikut menambah empat komoditas contoh beserta snapshot sebelumnya, semuanya ditandai `isDemo=true`:

```bash
npm run db:seed-demo
```

Jangan menganggap harga seed sebagai harga aktual. Hapus record `source = 'TANIWAVE-DEMO'` dan masukkan snapshot bersumber terverifikasi sebelum memakai data harga aktual.

Peluang pembeli baru dihitung jika ada permintaan `MarketDemand` dengan status OPEN yang cocok dengan listing aktif pengguna. API tidak mengarang permintaan jika data belum tersedia.

## 7. Integrasi frontend

Frontend perlu mengirim access token Supabase pada setiap route privat. Contoh:

```js
const { data: { session } } = await supabase.auth.getSession();
const response = await fetch(`${import.meta.env.VITE_API_URL}/api/dashboard/summary`, {
  headers: { Authorization: `Bearer ${session.access_token}` }
});
const payload = await response.json();
if (!response.ok || !payload.success) throw new Error(payload.error?.message || 'Gagal memuat dashboard');
const dashboard = payload.data;
```

`Dashboard.jsx` pada ZIP audit awal masih memakai array data demo lokal. Perubahan komponen React untuk memanggil endpoint dan memetakan loading/error/empty states belum dilakukan oleh paket backend ini.
