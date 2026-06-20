# SecurePass Manager — Development Roadmap

> Dokumen ini berisi daftar prioritas fitur dan perbaikan yang perlu dikerjakan selanjutnya untuk SecurePass Manager, diurutkan berdasarkan urgensi dan dampak terhadap pengguna.

---

## Rank 1: Import / Export Data (Prioritas Tertinggi)

**Status**: Belum dimplementasikan  
**Tag**: `MVP`, `User Adoption`, `Data Portability`

**Deskripsi**: Fitur untuk mengimpor data dari password manager lain dan mengekspor data ke format penyimpanan eksternal. Tanpa fitur ini, pengguna sulit migrasi ke SecurePass Manager, sehingga aplikasi tidak benar-benar usable sebagai pengganti password manager yang sudah ada.

**Kenapa penting**:
- Pengguna baru akan mencoba migrasi dari KeePass, 1Password, Bitwarden, atau LastPass.
- Backup manual dengan ekspor ke file eksternal adalah kebutuhan dasar untuk aplikasi manajemen password.
- Tanpa kemampuan *keluar* (export), pengguna merasa terjebak dan enggan mengadopsi.

**Tipe bentuk**:
- Import dari KeePass XML / CSV / JSON
- Import dari Bitwarden JSON / CSV
- Import dari 1Password CSV
- Export ke JSON terenkripsi (format milik SecurePass Manager, bisa diimport kembali)
- Export ke CSV biasa (dengan peringatan keamanan yang kuat)
- Export ke JSON plain text (untuk migrasi ke aplikasi lain)

**Risiko**: Rendah. Implementasi bersifat translasi data antar format. Risiko utama adalah XSS / injection jika input tidak disanitasi dengan benar.

---

## Rank 2: Form Validation & Edge Cases

**Status**: Implementasi parsial  
**Tag**: `Bug Prevention`, `Stability`, `UX`

**Deskripsi**: Memperketat validasi di seluruh form input untuk mencegah bug dan kehilangan data.

**Apa yang perlu dikerjakan**:
- Pembatasan panjang maksimum pada nama folder dan item.
- Sanitasi input untuk mencegah XSS payload saat ditampilkan di UI.
- Blok karakter khusus atau escape karakter yang bisa menyebabkan SQL injection.
- Cek duplikat pada nama folder/item di level database.
- XSS prevention di Rich Text Editor (DOMPurify) sebelum simpan ke DB.

**Kenapa penting**: Mencegah bug yang bisa membuat pengguna frustrasi atau bahkan merusak database.

---

## Rank 3: Security Audit (Memory Wipe)

**Status**: Perlu verifikasi lebih lanjut  
**Tag**: `Security`, `Zero-Knowledge Integrity`

**Deskripsi**: Memastikan bahwa kunci dekripsi benar-benar dihapus dari memor saat aplikasi lock atau di-close.

**Apa yang perlu dikerjakan**:
- Audit bahwa `Buffer` dan `ArrayBuffer `berisi kunci di-overwrite sebelum di-dispose.
- Verifikasi GC tidak mempertahankan referensi kunci dalam bentuk string.
- Implementasi secure clear pada variabel sensitif di `main` process.
- Penambahan periode keamanan dari proses debug kemungkinan besar tampilan kunci di dev tools.

**Kenapa penting**: Core value prop proyek ini adalah zero-knowledge. Jika kunci bisa *leak* di memory, reputasi habis.

---

## Rank 4: Multi-Vault Support

**Status**: Selesai dimplementasikan  
**Tag**: `Feature`, `Organization`, `Low Effort / High Impact`

**Deskripsi**: Kemampuan membuat dan mengganti-ganti antar beberapa vault terpisah (misalnya: Personal vs Kerja).

**Apa yang perlu dikerjakan**:
- UI untuk memilih/switch vault dalam Lock Screen atau Main App.
- Struktur penyimpanan file database yang mendukung multi-file (misalnya `vault-personal.db`, `vault-work.db`).
- Penyalinan metadata auth terpisah atau shared antar vault.
- Mungkin perlu perubahan state management (Zustand stores).

**Kenapa penting**: Fitur ini memungkinkan pengguna membagi lingkup kehidupan digital tanpa perlu buka-tutup aplikasi.

---

## Rank 5: TOTP / 2FA Support

**Status**: Selesai dimplementasikan  
**Tag**: `Security Feature`, `Feature Parity`, `Modern Standard`

**Deskripsi**: Menyimpan dan memunculkan kode Time-based One-Time Password (TOTP) di dalam aplikasi, mirip Google Authenticator atau KeePassXC.

**Fitur yang sudah diimplementasikan**:
- Menyimpan `secret` (base32 encoded) terenkripsi di dalam item.
- Field `otp_secret`, `otp_period`, `otp_digits`, `otp_algorithm` di tabel items (nullable, default NULL).
- UI widget untuk menampilkan timer countdown dan kode OTP (`OtpWidget`).
- Implementasi perhitungan TOTP (RFC 6238) menggunakan library `otpauth`.
- Dukungan QR code scanning/generation (untuk mengimport dari layanan lain).
- Enkripsi secret OTP menggunakan master key vault yang sama seperti password.
- Timer global aggregator untuk performa optimal (`otpTimerService`).
- Onboarding banner untuk pengguna yang baru pertama kali menggunakan fitur ini.

**Catatan Performa & Opsional**:
- Fitur ini **bersifat opsional** dan **tidak mempengaruhi performa aplikasi** jika tidak digunakan.
- Kolom OTP di database bersifat nullable dengan default NULL — tidak ada overhead untuk item yang tidak memiliki OTP.
- Timer OTP hanya aktif jika ada minimal satu `OtpWidget` yang mounted — zero overhead saat tidak ada widget OTP yang ditampilkan.
- Tidak ada resource yang terbuang (tidak ada interval, timer, atau network request) saat fitur OTP tidak digunakan.

**Kenapa penting**: Menjadi password manager yang modern tanpa TOTP support sangat kurang menarik.

---

## Rank 6: Browser Extension & Global Autofill

**Status**: Perlu perencanaan awal (R&D)  
**Tag**: `Integration`, `Long Term`, `Competitive`

**Deskripsi**: Rencana integrasi dengan browser agar SecurePass Manager bisa melakukan autofill.

**Apa yang perlu dikerjakan**:
- Desain protokol komunikasi aman antara browser extension dan Electron app.
- Prototype WebSocket / Native Messaging / custom IPC.
- Global shortcut key untuk copy username / password ke clipboard tanpa membuka aplikasi penuh.
- Design UI Extension (pop-up).

**Kenapa penting**: Feature ini adalah pembeda utama yang membedakan password manager *amatir* dan *profesional*.

---

## Rank 7: Argon2id Migration

**Status**: Selesai dimplementasikan (2026-06-20)  
**Tag**: `Technical Debt`, `Security`, `Future Proof`

**Deskripsi**: Migrasi algoritma Key Derivation Function (KDF) dari PBKDF2 ke Argon2id.

**Yang sudah selesai**:
- Implementasi Argon2id via Node native module (`argon2` 0.44.0) dengan
  fallback ke `hash-wasm` (WASM) dan terakhir ke PBKDF2.
- Deteksi format vault lama (PBKDF2) saat unlock, dengan backward
  compatibility untuk vault tanpa field `kdfAlgorithm`.
- Auto re-encrypt vault di background setelah unlock menggunakan KDF
  baru. Migration berjalan atomik dengan backup file
  (`.pre-argon2id-backup`) dan rollback otomatis jika gagal.
- Checksum verification (SHA-256) untuk native module binary, untuk
  mencegah tampering atau binary corruption diam-diam.
- Manual recovery instructions untuk user jika migration gagal.
- Format metadata baru (`kdfAlgorithm`, `kdfParams`, `kdfVersion`).
- Set lengkap test: unit, integration, security, performance, dan
  failure recovery (62+ tests).

**Referensi**:
- Perencanaan lengkap: [docs/PLANNING-ARGON2ID-MIGRATION.md](PLANNING-ARGON2ID-MIGRATION.md)
- Developer notes (native module, build, troubleshooting):
  [docs/DEV-ARGON2ID-NATIVE-MODULE.md](DEV-ARGON2ID-NATIVE-MODULE.md)
- Metadata format spec:
  [docs/DEV-KDF-METADATA-FORMAT.md](DEV-KDF-METADATA-FORMAT.md)
- QA runbook (Windows / macOS / Linux):
  [docs/QA-ARGON2ID-CHECKLIST.md](QA-ARGON2ID-CHECKLIST.md)

---

## Ringkasan Prioritas dalam Satu Kalimat

> Mulai dari **Import/Export** agar aplikasi usable (Rank 1), perbaiki potential bug validation (Rank 2), tutup hole keamanan memory (Rank 3), lalu tambahkan fitur organisasi multi-vault (Rank 4) dan TOTP (Rank 5) agar kompetitif. Integrasi Browser (Rank 6) sudah punya fondasi protokol native messaging; tinggal integrasi UI. Migrasi Argon2id (Rank 7) sudah selesai dan semua vault di-migrasi secara otomatis setelah unlock berikutnya.
