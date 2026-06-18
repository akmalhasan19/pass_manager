# Developer Notes: `otpauth://` URI Parsing & Strategy

> Dokumentasi teknis untuk developer yang bekerja dengan fitur TOTP/2FA, khususnya
> parsing URI `otpauth://` dan integrasi QR code scanning.

---

## 1. `otpauth://` URI Format (RFC 6238 / RFC 4226)

### 1.1 Format Dasar

```
otpauth://TYPE/LABEL?PARAMETERS
```

- **TYPE**: `totp` (time-based) atau `hotp` (counter-based, didukung secara minimal).
- **LABEL**: Terdiri dari `issuer:account` yang dipisahkan oleh `:`. Contoh: `GitHub:user@example.com`.
- **PARAMETERS**: Query string yang berisi konfigurasi OTP.

### 1.2 Parameter yang Didukung

| Parameter    | Wajib?     | Default     | Contoh         | Keterangan                                      |
|-------------|------------|-------------|----------------|-------------------------------------------------|
| `secret`    | ✅ Ya      | —           | `JBSWY3DPEHPK3PXP` | Secret key dalam encoding Base32 (RFC 4648)     |
| `issuer`    | ❌ Tidak   | Dari label  | `GitHub`       | Nama layanan/issuer                             |
| `algorithm` | ❌ Tidak   | `SHA1`      | `SHA256`       | Algoritma HMAC (`SHA1`, `SHA256`, `SHA512`)     |
| `digits`    | ❌ Tidak   | `6`         | `8`            | Jumlah digit kode (`6` atau `8`)                |
| `period`    | ❌ Tidak   | `30`        | `60`           | Interval refresh dalam detik (`30` atau `60`)   |
| `counter`   | ❌ Tidak   | —           | `1`            | Hanya untuk HOTP, tidak digunakan di TOTP       |

### 1.3 Contoh URI Lengkap

```
otpauth://totp/GitHub:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA1&digits=6&period=30
```

---

## 2. Strategi Parsing di SecurePass Manager

### 2.1 Arsitektur Parsing

Parsing dilakukan dalam dua lapisan:

```
QR Image (data URL / file)
        │
        ▼
  [jsQR] — Decode QR → string teks
        │
        ▼
  [parseOtpauthUri()] — Parse string → ParsedOtpauth
        │
        ▼
  [parsedToTotpConfig()] — Konversi → TotpConfig
        │
        ▼
  [sanitizeTotpConfig()] — Validasi & normalisasi
        │
        ▼
  TotpConfig siap pakai
```

### 2.2 File Terkait

| File | Peran |
|------|-------|
| `src/renderer/utils/parseOtpauthUri.ts` | Parser URI `otpauth://`, decoder QR image, interface `ParsedOtpauth` |
| `src/shared/validation.ts` | Validasi & sanitasi Base32 secret (`normalizeBase32Secret`, `sanitizeTotpConfig`) |
| `src/shared/constants.ts` | Default values & valid sets (`OTP_DEFAULTS`, `OTP_VALID_PERIODS`, dll) |
| `src/main/services/totpService.ts` | Generate kode TOTP via library `otpauth` |
| `src/renderer/components/otp/QrScannerModal.tsx` | UI modal untuk scan QR & input manual |
| `src/shared/types.ts` | Type `TotpConfig` |

### 2.3 Alur Parse `parseOtpauthUri()`

```
Input: "otpauth://totp/GitHub:user@example.com?secret=JBSWY3...&issuer=GitHub"

1. Validasi protokol → harus "otpauth:"
2. Validasi tipe host → "totp" atau "hotp"
3. Ekstrak path → decode URI, split ":" → label & account
4. Parse query params:
   - secret → wajib ada
   - issuer → fallback ke label
   - algorithm → uppercase, default "SHA1"
   - digits → parseInt, default 6
   - period → parseInt, default 30
   - counter → parseInt (HOTP)
5. Return ParsedOtpauth
```

### 2.4 Normalisasi Secret (Base32)

Semua secret melewati `normalizeBase32Secret()` sebelum digunakan:

```
1. Hapus whitespace (\s)
2. Hapus separator umum (-, _, :, ., spasi)
3. Uppercase (A-Z, 2-7)
4. Hapus padding eksisting (=)
5. Tambah padding yang benar (kelipatan 8)
```

> **Catatan**: Non-base32 characters tidak difilter — hanya dideteksi & ditolak
> oleh `sanitizeBase32Secret()` untuk mencegah data korup.

### 2.5 Validasi Berlapis

```
Manual Entry / QR Scan / Paste URI
        │
        ▼
  [sanitizeTotpConfig()] - Satu entry point untuk semua input
        │
        ├── sanitizeBase32Secret() → validasi & normalisasi secret
        │   ├── Minimal 16 karakter setelah normalisasi
        │   └── Hanya karakter Base32 yang valid
        │
        └── validateTotpConfig() → validasi parameter lain
            ├── period: integer positif (30/60)
            ├── digits: 6 atau 8
            └── algorithm: SHA1/SHA256/SHA512
```

---

## 3. QR Code Scanning Strategy

### 3.1 Library

- **jsQR** — Library pure-JS untuk decode QR code dari pixel data canvas.
- Import dinamis agar bundle size tetap kecil.
- Tidak memerlukan akses webcam di MVP; hanya upload file atau paste gambar.

### 3.2 Input Methods

| Method | Implementasi | Catatan |
|--------|-------------|---------|
| File Upload | `<input type="file" accept="image/*">` | Drag & drop juga didukung |
| Paste Clipboard | Event listener `paste` | Support paste dari screenshot |
| Paste URI Text | Deteksi text `otpauth://` di clipboard | Bypass QR decode jika langsung URI |

### 3.3 Error Handling

Semua error dikembalikan sebagai string key untuk i18n:

| Key | Penyebab |
|-----|----------|
| `qrScan.errorCanvasContext` | Canvas 2D context tidak tersedia |
| `qrScan.errorReadImage` | Gagal membaca pixel data (CORS?) |
| `qrScan.errorNoQrCode` | Tidak ada QR code di gambar |
| `qrScan.errorInvalidOtpUri` | QR berisi teks non-otpauth |
| `qrScan.errorLoadImage` | Gambar gagal di-load |

---

## 4. Keamanan & Best Practices

### 4.1 Secret Handling

- **Jangan log secret** ke console, file, atau crash report.
- Setelah generate kode OTP, secret hanya ada di memory selama scope function.
- Secret dienkripsi di database menggunakan AES-256-GCM via master key vault.
- Jangan cache secret di Zustand store atau state management renderer.

### 4.2 QR Code Display

- QR code selalu dimulai dalam keadaan **blur / mask**.
- User harus klik "Reveal" untuk menampilkan QR.
- Tampilkan peringatan: "Kode ini sensitif, jangan bagikan ke siapapun."

### 4.3 Clock Drift

- TOTP bergantung pada akurasi waktu sistem.
- Deteksi clock drift dilakukan setiap `CLOCK_DRIFT_CHECK_INTERVAL_MS` (lihat `src/shared/clockDrift.ts`).
- Warning lembut jika drift melebihi setengah periode TOTP.
- Reset tracker saat vault di-lock atau switch vault.

---

## 5. TOTP Code Generation

Menggunakan library **otpauth** di main process melalui `totpService.ts`:

```typescript
// Contoh penggunaan
import { generateTOTP, getRemainingSeconds } from '../main/services/totpService';

const secret = 'JBSWY3DPEHPK3PXP';
const config = { secret, period: 30, digits: 6, algorithm: 'SHA1' };

const code = generateTOTP(secret, config);           // "123456"
const remaining = getRemainingSeconds(config);        // 15 (detik)
const { code, nextInSeconds } = getNextTOTP(secret, config);
```

### 5.1 Test Vectors (RFC 6238)

| Secret (Base32) | Time (sec) | Algorithm | Digits | Expected Code |
|----------------|------------|-----------|--------|---------------|
| `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ` | 0 | SHA1 | 8 | `94287082` |
| `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ` | 1111111109 | SHA256 | 8 | `46119246` |
| `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ` | 1111111111 | SHA512 | 8 | `90693936` |

> Secret di atas adalah `12345678901234567890` dalam Base32 encoding. Lib
> `otpauth` secara internal menggunakan epoch UNIX untuk perhitungan; kita
> tidak perlu mengirim timestamp secara eksplisit.

---

## 6. Migration & Backward Compatibility

- Kolom OTP di tabel `items` bersifat **nullable** dengan default `NULL`.
- Aplikasi tetap berfungsi normal tanpa fitur OTP; widget tidak di-render jika tidak ada config.
- Database lama tanpa kolom OTP tetap bisa dibuka — migrasi menambahkan kolom.
- Tidak ada data OTP yang hilang saat soft delete; permanent delete akan menghapus seluruh item termasuk OTP config.

---

## 7. Referensi

- [RFC 6238 — TOTP: Time-Based One-Time Password Algorithm](https://datatracker.ietf.org/doc/html/rfc6238)
- [RFC 4226 — HOTP: An HMAC-Based One-Time Password Algorithm](https://datatracker.ietf.org/doc/html/rfc4226)
- [RFC 4648 — The Base16, Base32, and Base64 Data Encodings](https://datatracker.ietf.org/doc/html/rfc4648)
- [otpauth Library (npm)](https://www.npmjs.com/package/otpauth)
- [jsQR Library (npm)](https://www.npmjs.com/package/jsqr)
- Source: `src/renderer/utils/parseOtpauthUri.ts`
- Source: `src/shared/validation.ts`
- Source: `src/main/services/totpService.ts`