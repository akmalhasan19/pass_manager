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

**Status**: Belum dimplementasikan  
**Tag**: `Security Feature`, `Feature Parity`, `Modern Standard`

**Deskripsi**: Menyimpan dan memunculkan kode Time-based One-Time Password (TOTP) di dalam aplikasi, mirip Google Authenticator atau KeePassXC.

**Apa yang perlu dikerjakan**:
- Menyimpan `secret` (base32 encoded) di dalam item baru.
- Field baru untuk `otpSecret`, `otpPeriod`, `otpDigits `di tabel items.
- UI widget untuk menampilkan timer countdown dan kode OTP.
- Implementasi perhitungan TOTP (RFC 6238) menggunakan library `otpauth` atau `speakeasy`.
- Dukungan QR code scanning/generation (untuk mengimport dari layanan lain).

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

**Status**: Perlu migrasi background  
**Tag**: `Technical Debt`, `Security`, `Future Proof`

**Deskripsi**: Migrasi algoritma Key Derivation Function (KDF) dari PBKDF2 ke Argon2id.

**Apa yang perlu dikerjakan**:
- Implementasi Argon2id via Node native module.
- Deteksi format vault lama saat unlock.
- Auto-re-encrypt vault menggunakan KDF baru setelah pengguna memasukkan password.
- Code path fallback untuk user yang tidak bisa menginstall native module.

**Kenapa penting**: Argon2id adalah standar modern yang lebih tahan terhadap serangan GPU/ASIC.

---

## Ringkasan Prioritas dalam Satu Kalimat

> Mulai dari **Import/Export** agar aplikasi usable (Rank 1), perbaiki potential bug validation (Rank 2), tutup hole keamanan memory (Rank 3), lalu tambahkan fitur organisasi multi-vault (Rank 4) dan TOTP (Rank 5) agar kompetitif. Integrasi Browser (Rank 6) dan migrasi Argon2 (Rank 7) bisa menunggu maturitas berikutnya.
