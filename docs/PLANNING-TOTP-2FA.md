# Planning: TOTP / 2FA Support

> Dokumen ini berisi rencana implementasi lengkap, terstruktur, dan detail untuk fitur TOTP / 2FA Support di SecurePass Manager.

---

## Overview Fitur

TOTP (Time-based One-Time Password) / 2FA Support memungkinkan pengguna menyimpan dan memunculkan kode autentikasi dua faktor langsung di dalam SecurePass Manager. Fitur ini menjadikan aplikasi sebagai alternatif yang kompetitif terhadap Google Authenticator, KeePassXC, atau Bitwarden, tanpa memerlukan aplikasi tambahan.

Fitur ini harus mengikuti RFC 6238 (TOTP) dan RFC 4226 (HOTP), mengenkripsi secret di database, serta menampilkan kode OTP yang mudah di-copy dan memiliki timer countdown.

**Tujuan Utama**:

1. Menyimpan secret OTP yang dienkripsi dalam item tersendiri, tanpa memerlukan aplikasi authenticator eksternal.
2. Menghasilkan kode OTP 6 digit (atau 8 digit sesuai konfigurasi) secara real-time berdasarkan waktu sistem.
3. Mendukung QR code scanning dan parsing untuk memudahkan import dari layanan lain.
4. Menyediakan widget OTP reusable di UI Main App yang stabil, responsif, dan accessible.

**Prinsip Keamanan**:

- OTP `secret` harus disimpan terenkripsi di database menggunakan key vault aktif, sama seperti password.
- Secret hanya boleh didekripsi sementara saat menghitung kode OTP; tidak boleh dipersist sebagai plain text.
- QR code display harus dubooked (blur / mask) agar tidak terlihat secara tidak sengaja (screen sharing).
- Jangan simpan kode OTP yang sudah di-generate di database atau local storage.
- Konfirmasi eksplisit sebelum menampilkan secret atau QR code saat edit item.

---

## 1. Task: Database Schema dan Item Model

- [ ] Task 1 Complete

### Sub-Task 1.1: Tambahkan Kolom OTP ke Tabel Items

- [x] Tambahkan kolom `otp_secret` (encrypted blob / base64 text) pada tabel `items`.
- [x] Tambahkan kolom `otp_period` (integer, default 30 detik) untuk interval refresh kode.
- [x] Tambahkan kolom `otp_digits` (integer, default 6, enum [6, 8]) untuk jumlah digit kode.
- [x] Tambahkan kolom `otp_algorithm` (string, default `SHA1`, enum [`SHA1`, `SHA256`, `SHA512`]) untuk algoritma HMAC.
- [x] Pastikan kolom OTP hanya terakses via repository layer, bukan query raw secara langsung.

### Sub-Task 1.2: Update Model Types dan Validasi

- [x] Update interface `Item` di shared types agar menyertakan field opsional `otp: TotpConfig | null`.
- [x] Definisikan interface `TotpConfig` dengan `secret`, `period`, `digits`, `algorithm`.
- [x] Validasi bahwa `secret` adalah string base32 yang valid sebelum disimpan.
- [x] Pastikan migration menambahkan kolom OTP tanpa merusak item yang sudah ada.
- [x] Update schema Zod atau validator lain untuk mendeteksi dan menolak secret kosong atau tidak valid.

### Sub-Task 1.3: Perbarui Repository CRUD

- [x] Update `ItemRepository.create()` agar menerima dan menyimpan OTP config.
- [x] Update `ItemRepository.update()` agar bisa mengoverwrite atau menghapus OTP config.
- [x] Update `ItemRepository.getById()` agar termasuk kolom OTP (decrypted) hanya jika diperlukan.
- [x] Pastikan soft delete tetap mempertahankan OTP config hingga permanent delete.

---

## 2. Task: TOTP Core Engine (RFC 6238)

- [ ] Task 2 Complete

### Sub-Task 2.1: Integrasi Library TOTP

- [x] Pilih dan integrasikan library `otpauth` atau `speakeasy` di main process.
- [x] Buat wrapper module `src/main/services/totpService.ts` untuk generate dan validasi kode.
- [x] Fungsi `generateTOTP(secret: string, config: TotpConfig): string` mengembalikan kode aktif.
- [x] Fungsi `getRemainingSeconds(config: TotpConfig): number` mengembalikan detik tersisa sebelum refresh.
- [x] Fungsi `getNextTOTP(secret: string, config: TotpConfig): { code: string; nextInSeconds: number }` untuk UI polling.

### Sub-Task 2.2: Base32 Secret Parser dan Sanitasi

- [x] Normalisasi input secret (strip spasi, uppercase, tolak karakter non tropical base32).
- [x] Handle padding (`=`) yang hilang secara otomatis saat decode.
- [x] Tampilkan error user-friendly jika secret tidak valid atau tidak bisa diparse.
- [x] Jangan log secret ke log file atau console dalam bentuk apapun.

### Sub-Task 2.3: Handling OTP Fields Variabel

- [x] Dukung `period` custom (default 30, bisa 60 untuk beberapa layanan).
- [x] Dukung `digits` selain 6 (misalnya Steam yang menggunakan 5 digit alphanumeric, jika scope). Saat ini prioritaskan 6-8 digit numerik.
- [x] Dukung `algorithm` SHA1, SHA256, SHA512 sesuai RFC 6238.
- [x] Simpan default values saat user tidak memberikan konfigurasi khusus.

---

## 3. Task: UI Widget dan OTP Flow

- [ ] Task 3 Complete

### Sub-Task 3.1: OTP Section di Item Detail dan Form

- [x] Tambahkan section "Authenticator (OTP)" di form add/edit item.
- [x] Input field untuk `secret` (masked, toggle visibility).
- [x] Dropdown/algoritma selector untuk `period`, `digits`, `algorithm`.
- [x] Tombol "Generate QR Code" yang menampilkan QR code dari secret (hanya jika secret valid).
- [x] Tombol "Remove OTP" untuk menghapus config dari item.

### Sub-Task 3.2: OTP Widget Display

- [x] Buat komponen `OtpWidget` yang menampilkan kode aktif dengan font monospace besar.
- [x] Timer countdown berbentuk progress bar atau ring (circular countdown) di sebelah kode.
- [x] Kode bisa di-copy ke clipboard dengan single click atau tombol Copy.
- [x] Auto-refresh kode saat periode berakhir tanpa reload manual.
- [x] Tampilkan pesan error graceful jika secret korrupt atau tidak bisa digenerate.

### Sub-Task 3.3: UI Item List dan Overview

- [x] Tampilkan indikator ikon OTP (badge / shield icon) di item list jika item memiliki OTP config.
- [x] Klik pada badge OTP langsung menyalin kode ke clipboard (opsional, dengan tooltip).
- [x] Di view detail, OTP widget harus visible setelah user mengklik "Reveal OTP" untuk mencegah accidental exposure.

### Sub-Task 3.4: Accessibility dan Keyboard Navigation

- [x] Kode OTP diumumkan dengan `aria-live="polite"` jika berubah.
- [x] Timer countdown mengumumkan waktu tersisa saat kurang dari 5 detik.
- [x] Tombol Copy OTP memiliki `aria-label` jelas.
- [x] Pastikan semua kontrol OTP bisa diakses dengan keyboard (Tab, Enter, Space).

---

## 4. Task: QR Code Support (Scan dan Generate)

- [ ] Task 4 Complete

### Sub-Task 4.1: Generate QR Code dari Secret

- [x] Gunakan library seperti `qrcode` (Node.js / renderer) untuk generate gambar QR dari URL otpauth.
- [x] Format URL: `otpauth://totp/{label}?secret={secret}&issuer={issuer}&algorithm={algo}&digits={digits}&period={period}`.
- [x] Tampilkan QR code di dialog/modal dengan opsi download sebagai PNG atau SVG.
- [x] Blur / mask QR code secara default; reveal hanya setelah user menyetujui (privacy mode).

### Sub-Task 4.2: Scan QR Code (Import)

- [x] Jika aplikasi Electron mengakses webcam atau user paste gambar QR, decode menggunakan `jsQR` atau `zxing`.
- [x] Parse URL `otpauth://` atau `otpauth-migration://` jika ada.
- [x] Ekstrak parameter `secret`, `issuer`, `algorithm`, `digits`, `period` dari URL tersebut.
- [x] Isi form OTP secara otomatis setelah decode berhasil.
- [x] Handle error jadi jika library tidak mengenali gambar atau URL bukan format TOTP.

### Sub-Task 4.3: Manual Entry Fallback

- [x] Jika scan gagal atau QR tidak tersedia, user bisa input secret dan parameter secara manual.
- [x] User harus memasukkan `secret` minimal (wajib), sisanya optional dengan default.
- [x] Validasi secret manual harus sama ketatnya dengan secret yang didapat dari scan.

---

## 5. Task: Keamanan dan Integrasi Auth Flow

## 5. Task: Keamanan dan Integrasi Auth Flow

- [ ] Task 5 Complete

### Sub-Task 5.1: Enkripsi Secret di Database

- [x] Pastikan `otp_secret` dienkripsi dengan master key vault yang sama seperti password.
- [x] Gunakan aes-256-gcm atau yang setara, tidak simpan plain text meski dalam debug mode.
- [x] Backup/export OTP config harus mengekspor secret terenkripsi terpisah atau secara eksplisit dicabut/sebagai opsional.

### Sub-Task 5.2: Memory Safety

- [x] Secret OTP harus disimpan di memory hanya selama proses generate kode.
- [x] Setelah kode digenerate, zero-out variabel secret dari memory atau biarkan GC cleanup jika di dalam scope process.
- [x] Hindari caching secret di Zustand atau state management renderer.

### Sub-Task 5.3: Screen Privacy

- [x] OTP code harus bisa disembunyikan / blurred via global privacy toggle (jika fitur privacy sudah ada).
- [x] QR code harus selalu dimulai dalam keadaan blur / mask.
- [x] Tambahkan warning copy-paste: "Kode ini sensitif, jangan bagikan ke siapapun."

---

## 6. Task: Offline, Sync dan Performance

- [ ] Task 6 Complete

### Sub-Task 6.1: Offline-First Behavior

- [x] OTP calculation harus berjalan sepenuhnya offline tanpa network request ke server.
- [x] Clock drift tidak diperlukan dalam MVP, tetapi dokumentasikan bahwa sync waktu OS adalah prerequisite.
- [x] Jika devais offline dan waktu sistem tidak tersync, kode OTP mungkin tidak valid; tampilkan warning clock drift lembut saja di MVP.

### Sub-Task 6.2: Performance Timer

- [x] Gunakan `setInterval` yang efisien, bersihkan saat komponen unmount.
- [x] Agregasi timer di global jika banyak item memiliki OTP agar tidak ada ribuan setInterval independen.
- [x] Gunakan `requestAnimationFrame` atau `setTimeout` recursive yang seimbang untuk countdown UI agar tidak blocking.

---

## 7. Task: Testing & Quality Assurance

- [x] Task 7 Complete

### Sub-Task 7.1: Unit Tests TOTP Service

- [x] Test generate OTP dengan secret dan parameter standar (RFC 6238 test vectors).
- [x] Test berbagai algoritma (SHA1, SHA256, SHA512).
- [x] Test validasi secret base32 yang currupted atau mengandung karakter ilegal.
- [x] Test determinisme: waktu yang sama menghasilkan kode yang sama.

### Sub-Task 7.2: Component Tests OTP Widget

- [x] Test render kode awal dan transisi saat timer refresh.
- [x] Test tombol Copy mengirim kode ke clipboard tanpa error.
- [x] Test error state saat secret invalid atau kosong.
- [x] Test keyboard accessibility (Tab, Enter, Space pada tombol Copy).

### Sub-Task 7.3: Integration Tests End-to-End

- [x] Test flow add item dengan OTP field, simpan, lalu buka detail dan generate kode.
- [x] Test import dari QR code image masuk ke item dengan field OTP yang benar.
- [x] Test export/import vault mempertahankan OTP config tanpa corrupt secret.
- [x] Test switch vault tidak menyebabkan OTP widget crash atau timer zombie.

### Sub-Task 7.4: Security Regression Tests

- [x] Test secret OTP tidak muncul di DevTools atau React DevTools inspect state.
- [x] Test secret OTP tidak disimpan ke localStorage atau sessionStorage.
- [x] Test QR code tidak dirender sebagai plain text atau base64 tanpa masking di DOM.

---

## 8. Task: Rollout dan Backward Compatibility

- [x] Task 8 Complete

### Sub-Task 8.1: Database Migration

- [x] Tambahkan migrasi untuk kolom `otp_secret`, `otp_period`, `otp_digits`, `otp_algorithm`.
- [x] Default semua existing items sebagai NULL (tidak punya OTP).
- [x] Pastikan database lama tanpa kolom OTP tetap bisa dibuka setelah update aplikasi.

### Sub-Task 8.2: UX Fallback

- [x] Aplikasi harus tetap berfungsi normal jika user memilih tidak menggunakan fitur OTP.
- [x] Tampilkan onboarding OTP di update pertama sebagai informasi fitur baru.
- [x] Dokumentasikan bahwa fitur ini optional dan tidak mempengaruhi performa app jika tidak digunakan.

### Sub-Task 8.3: Documentation Internal

- [x] Update `PLANNING-ROADMAP.md` status jika fitur selesai.
- [x] Tambahkan developer notes tentang format `otpauth://` URL dan parsing strategy.
- [x] Update manual QA checklist untuk uji OTP generation, copy, dan QR scan.

---

## Summary Checklist Implementasi

- [x] Sub-Task 1.1: Tambahkan Kolom OTP ke Tabel Items
- [x] Sub-Task 1.2: Update Model Types dan Validasi
- [x] Sub-Task 1.3: Perbarui Repository CRUD
- [x] Sub-Task 2.1: Integrasi Library TOTP
- [x] Sub-Task 2.2: Base32 Secret Parser dan Sanitasi
- [x] Sub-Task 2.3: Handling OTP Fields Variabel
- [x] Sub-Task 3.1: OTP Section di Item Detail dan Form
- [x] Sub-Task 3.2: OTP Widget Display
- [x] Sub-Task 3.3: UI Item List dan Overview
- [x] Sub-Task 3.4: Accessibility dan Keyboard Navigation
- [x] Sub-Task 4.1: Generate QR Code dari Secret
- [x] Sub-Task 4.2: Scan QR Code (Import)
- [x] Sub-Task 4.3: Manual Entry Fallback
- [x] Sub-Task 5.1: Enkripsi Secret di Database
- [x] Sub-Task 5.2: Memory Safety
- [x] Sub-Task 5.3: Screen Privacy
- [x] Sub-Task 6.1: Offline-First Behavior
- [x] Sub-Task 6.2: Performance Timer
- [x] Sub-Task 7.1: Unit Tests TOTP Service
- [x] Sub-Task 7.2: Component Tests OTP Widget
- [x] Sub-Task 7.3: Integration Tests End-to-End
- [x] Sub-Task 7.4: Security Regression Tests
- [x] Sub-Task 8.1: Database Migration
- [x] Sub-Task 8.2: UX Fallback
- [x] Sub-Task 8.3: Documentation Internal
