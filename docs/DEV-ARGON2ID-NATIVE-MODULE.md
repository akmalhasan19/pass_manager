# Developer Documentation: Argon2id Native Module

> Referensi teknis untuk developer yang bekerja dengan modul native Argon2id
> di SecurePass Manager. Dokumen ini menjelaskan pilihan library, pipeline
> build, verifikasi checksum, perilaku fallback, dan troubleshooting umum
> yang harus dipahami sebelum menyentuh kode KDF (Key Derivation Function).

---

## 1. Mengapa Argon2id

Argon2id (pemenang Password Hashing Competition 2015) adalah standar
modern yang direkomendasikan oleh OWASP dan NIST untuk password hashing.
Argon2id tahan terhadap:

- **GPU-based attacks** — memory-hard sehingga GPU/ASIC menjadi mahal.
- **Side-channel attacks** — kombinasi data-independent (Argon2i) dan
  data-dependent (Argon2d) pass.
- **Trade-off tuning** — parameter `memoryCost`, `timeCost`, dan
  `parallelism` bisa disetel sesuai target hardware.

PBKDF2-SHA512 (600,000 iterasi) masih aman untuk saat ini, tapi Argon2id
memberikan ketahanan yang lebih baik terhadap hardware khusus.

---

## 2. Arsitektur Engine

Engine Argon2id di SecurePass Manager memiliki tiga lapis fallback:

```
┌────────────────────────────────────────────┐
│           Argon2idEngine (KDF)              │
├────────────────────────────────────────────┤
│ 1. Native module (argon2)                  │  ← preferred
│    - node-gyp prebuilt binary               │
│    - SHA-256 checksum verified at load     │
├────────────────────────────────────────────┤
│ 2. WASM module (hash-wasm)                 │  ← fallback #1
│    - Pure JS, no native dependency         │
│    - Lebih lambat dari native               │
├────────────────────────────────────────────┤
│ 3. PBKDF2 (Node crypto)                    │  ← fallback #2
│    - Standar lama, masih aman              │
│    - Hanya aktif jika native + WASM gagal  │
└────────────────────────────────────────────┘
```

Urutan dipilih di `src/main/crypto/argon2id.ts`:

1. **`initArgon2idEngine()`** mencoba load native module `argon2`.
   Sebelum load, SHA-256 checksum biner diverifikasi terhadap nilai
   yang di-embed di `src/main/crypto/argon2-checksums.json`.
2. Jika native gagal (checksum mismatch, missing binary, compile
   error), engine mencoba `hash-wasm` (WASM).
3. Jika WASM juga gagal, `engineStatus` menjadi `unavailable` dan
   `Argon2idEngine.deriveKey()` otomatis fallback ke PBKDF2 dengan
   iterasi 600,000.

Engine di-inisialisasi sekali (singleton) lewat
`initArgon2idEngine()`. Hasil inisialisasi dicek via
`isArgon2idAvailable()` sebelum derivasi.

---

## 3. Library yang Digunakan

### 3.1 `argon2` (Primary)

- **Versi**: `^0.44.0` (lihat `package.json`).
- **Bindings**: Native via `node-gyp`. Binary prebuilt didistribusikan
  via `node_modules/argon2/prebuilds/`.
- **API yang dipakai**: `argon2.hash(password, options)` dengan
  `type: 2` (Argon2id), `raw: true` untuk output buffer 32-byte.
- **Lokasi binary**: `node_modules/argon2/prebuilds/<platform>-<arch>/`.

### 3.2 `hash-wasm` (Fallback)

- **Versi**: `^4.12.0`.
- **Bindings**: WASM (no native dependency). Loaded via dynamic
  `await import('hash-wasm')`.
- **API yang dipakai**: `hashWasm.argon2id({...})` dengan opsi yang
  identik dengan native (parallelism, iterations, memorySize, hashLength).
- **Trade-off**: ~5-10× lebih lambat dari native. Tapi cukup untuk
  satu kali unlock (bukan throughput-bound).

### 3.3 `crypto.pbkdf2Sync` (Final Fallback)

- **API**: Node built-in `crypto.pbkdf2Sync`.
- **Parameter**: 600,000 iterasi, SHA-512, 32-byte output.
- **Kapan aktif**: hanya jika `engineStatus === 'unavailable'`.

---

## 4. Build Pipeline

### 4.1 Postinstall (Development Install)

`scripts/postinstall.js` menjalankan:

1. **Cek dependency** (sql.js tersedia).
2. **Copy sql.js WASM** ke `public/sql-wasm.wasm`.
3. **Rebuild native module untuk Electron** via `@electron/rebuild`:
   ```bash
   npx electron-rebuild --only argon2
   ```
   Step ini sangat penting: binary prebuilt di `node_modules/argon2`
   dibuat untuk Node.js, BUKAN untuk Electron. Tanpa rebuild, app
   akan crash saat load `require('argon2')`.

   Rebuild di-skip ketika:
   - `ELECTRON_REBUILD_SKIP=1` (CI non-Electron, headless dev).
   - Binary Electron (`node_modules/electron/dist/electron.exe`) tidak
     ada (misal: dev container tanpa Electron).
4. **Generate checksum** argon2:
   ```bash
   node scripts/generate-argon2-checksums.js
   ```
   Output: `src/main/crypto/argon2-checksums.json`. File ini
   **harus di-commit** ke repo agar runtime dapat memverifikasi
   binary native yang di-load.

### 4.2 Build Produksi (npm run dist)

`scripts/generate-argon2-checksums.js` di-run **lagi** sebelum
TypeScript compile, untuk memastikan checksum cocok dengan binary
yang akan di-bundle oleh electron-builder. Hal ini menjamin:

- Developer A: rebuild → checksum baru di-generate → commit.
- CI: build → verifikasi checksum terhadap binary di-bundle.

### 4.3 Mengapa Checksum Embedded

Checksum disimpan di source code (bukan didownload dari server)
karena:

- Zero network dependency saat startup.
- Verifikasi deterministik (tidak ada race condition dengan server).
- Tampering pada binary lokal (misal: MITM update mechanism) akan
  terdeteksi sebelum binary di-load.

**Trade-off**: setiap kali binary native berubah (misal: `argon2`
naik versi), checksum harus di-regenerate. Lihat section 8
(Troubleshooting) untuk prosedur update.

---

## 5. Cara Kerja Checksum Verification

`argon2id.ts` mengimplementasikan `verifyNativeChecksum()`:

1. **Detect platform & arch** dari `process.platform` dan
   `process.arch`. Pemetaan:
   - `darwin-x64` → `argon2.glibc.node`
   - `darwin-arm64` → `argon2.armv8.glibc.node`
   - `linux-x64` → `argon2.glibc.node` atau `argon2.musl.node`
   - `linux-arm64` → `argon2.armv8.glibc.node` atau `argon2.armv8.musl.node`
   - `win32-x64` → `argon2.glibc.node`
2. **Lookup expected hash** di `argon2-checksums.json` dengan key
   `prebuilds/<platform>-<arch>/<filename>`.
3. **Read & hash binary** dengan SHA-256. Bandingkan dengan expected.
4. **Return result**:
   - `valid: true` → lanjut load native.
   - `valid: false` → log warning, skip native, coba WASM.

Catatan: nama file `*.glibc.node` hanya convention. Binary yang
digunakan adalah `argon2` (Argon2id reference C implementation)
yang di-build untuk platform target. Nama "glibc" historis dan
sekarang menandakan build default (non-musl).

---

## 6. Parameter Argon2id

Parameter default didefinisikan di
`src/main/crypto/argon2id.ts`:

```typescript
export const DEFAULT_ARGON2ID_PARAMS: Argon2idParams = {
  algorithm: 'argon2id',
  memoryCost: 65536,  // 64 MB
  timeCost: 3,        // 3 iterations
  parallelism: 4,     // 4 lanes
};
```

**Catatan performa** (di laptop developer 2-core / 8 GB RAM):

- Native: ~150-200 ms per derivasi.
- WASM: ~1500-2000 ms per derivasi.
- PBKDF2 fallback: ~500 ms per derivasi (600,000 iterasi SHA-512).

Argon2id **harus lebih cepat dari PBKDF2 600k** di hardware modern
karena memory-hard parallelism mengimbangi jumlah iterasi.

---

## 7. Perilaku Fallback dalam Detail

### 7.1 Engine Status

`engineStatus` di `argon2id.ts` adalah variabel module-level:

```typescript
type Argon2idEngineStatus =
  | { status: 'native' }
  | { status: 'wasm' }
  | { status: 'unavailable'; error: string };
```

`isArgon2idAvailable()` mengembalikan `true` kecuali `status ===
'unavailable'`.

### 7.2 Saat Unlock

Di `unlockVault()` (authHandlers.ts):

1. Baca metadata vault.
2. Tentukan `kdfParams`:
   - Jika `kdfVersion >= 1` dan `kdfParams` ada → pakai itu.
   - Jika `kdfAlgorithm === 'argon2id'` → derive dari `kdfMemory`,
     `kdfParallelism`, `timeCost = 3`.
   - Jika `kdfAlgorithm === 'pbkdf2'` (atau tidak ada) → derive dari
     `kdfIterations`.
3. Panggil `deriveMasterKey(masterPassword, salt, kdfParams)`.
4. Engine internal memilih native → WASM → PBKDF2 sesuai availability.

### 7.3 Saat Migration

Di `AUTH_MIGRATE_KDF` handler:

1. Cek `isArgon2idAvailable()`. Jika `false`, langsung return
   `success: false, error: 'ARGON2ID_UNAVAILABLE', fallbackToPbkdf2: true`.
2. Jika tersedia, derive key baru dengan `Argon2idEngine`.
3. Re-encrypt seluruh vault dengan key baru.
4. Tulis metadata baru dengan `kdfAlgorithm: 'argon2id'`.

**Penting**: jika engine fallback ke PBKDF2 saat migration, key baru
yang ditulis ke metadata adalah PBKDF2-derived (bukan Argon2id).
Tapi `kdfAlgorithm` di metadata tetap di-set ke `'argon2id'`. Ini
adalah inkonsistensi yang perlu dimonitor. Untuk amannya,
migration gagal jika `isArgon2idAvailable() === false`.

### 7.4 Logging

Engine log ke `logger` (lihat `src/shared/logger.ts`):

- `[INFO] Argon2id native module checksum verified` (dev only).
- `[INFO] Argon2id native module checksum verified` (debug only).
- `[ERROR] Argon2id native module checksum mismatch - possible
  corruption or tampering` (jika mismatch).
- `[WARN] Skipping argon2id native module due to checksum failure`.

Logger otomatis me-redact field bernama `password`, `key`, `salt`,
`hash`, `ciphertext`, `secret`. Jadi meskipun `cause` di-include,
tidak ada material kriptografis yang bocor ke log.

---

## 8. Troubleshooting

### 8.1 "Cannot find module 'argon2'" saat runtime

**Gejala**: App crash dengan error module not found di main process.

**Penyebab**: Native module tidak di-rebuild untuk Electron.

**Solusi**:
```bash
npm install
# postinstall akan otomatis menjalankan electron-rebuild
# Jika postinstall di-skip:
ELECTRON_REBUILD_SKIP=0 npx electron-rebuild --only argon2
```

### 8.2 "Argon2id native module checksum mismatch"

**Gejala**: Log menampilkan error checksum, app fallback ke WASM/PBKDF2.

**Penyebab**:
- Binary di-bundle adalah versi yang berbeda dari yang di-checksum.
- Binary rusak (disk corruption, incomplete download).
- File `argon2-checksums.json` di-edit manual.

**Solusi**:
```bash
# Re-generate checksum dari binary yang ada:
node scripts/generate-argon2-checksums.js

# Commit file yang baru:
git add src/main/crypto/argon2-checksums.json
git commit -m "chore: regenerate argon2 checksums"
```

### 8.3 Build gagal di Linux ARM64 (Raspberry Pi, dll.)

**Gejala**: `electron-rebuild` gagal compile argon2 dari source.

**Penyebab**: ARM64 Linux butuh toolchain lengkap (gcc, make, python).

**Solusi**:
```bash
sudo apt install build-essential python3
npm install
```

Jika masih gagal, app akan otomatis fallback ke WASM.

### 8.4 Performance Sangat Lambat di Windows 7/8

**Gejala**: Unlock butuh >5 detik di Windows versi lama.

**Penyebab**: Windows 7/8 tidak punya `BCryptGenRandom` yang
diperlukan oleh `argon2`. Engine fallback ke OpenSSL yang lebih
lambat.

**Solusi**: Update ke Windows 10+ (argon2 sudah di-bundle dengan
binary yang dioptimasi).

### 8.5 "argon2.glibc.node" tidak ditemukan di Linux Alpine

**Gejala**: `Error: Cannot find module` saat load argon2.

**Penyebab**: Alpine Linux pakai musl, bukan glibc. Binary default
`argon2.glibc.node` tidak kompatibel.

**Solusi**:
- Pakai binary `argon2.musl.node` (otomatis terdeteksi jika
  `ldd --version` menunjukkan musl).
- Atau install binary glibc compatibility layer.

### 8.6 Test Gagal dengan "Argon2id not available"

**Gejala**: Test yang expect native Argon2id skip atau fallback.

**Penyebab**: Test environment tidak punya binary native (misal:
Linux container tanpa `--platform linux/amd64`).

**Solusi**:
- Untuk test: pakai fallback params. Engine otomatis pakai PBKDF2.
- Untuk production build: pastikan `argon2-checksums.json` punya
  entry untuk platform target.

### 8.7 "GLIBC_2.X' not found" di Linux Lama

**Gejala**: App crash saat load native module.

**Penyebab**: Binary prebuilt butuh glibc versi yang lebih baru
dari yang tersedia di sistem (CentOS 7, Ubuntu 16.04, dll.).

**Solusi**:
- Update OS ke versi LTS terbaru.
- Atau rebuild native module dari source di environment target:
  ```bash
  npm rebuild argon2 --build-from-source
  ```

---

## 9. Platform Support Matrix

| Platform       | Status         | Catatan                                   |
| -------------- | -------------- | ----------------------------------------- |
| Windows x64    | ✅ Tested       | prebuilt binary tersedia                  |
| macOS x64      | ✅ Tested       | prebuilt binary tersedia                  |
| macOS arm64    | ✅ Tested       | Apple Silicon, prebuilt binary            |
| Linux x64 glibc| ✅ Tested       | distribusi mainstream (Ubuntu, Fedora)   |
| Linux x64 musl | ✅ Tested       | Alpine Linux                              |
| Linux arm64    | ⚠️ Partial      | perlu toolchain atau rebuild              |
| Linux armv7    | ⚠️ Partial      | perlu toolchain atau rebuild              |
| Windows arm64  | ⚠️ Partial      | belum ditest secara resmi                 |
| FreeBSD        | ⚠️ Partial      | belum ditest secara resmi                 |

---

## 10. Konvensi Code

### 10.1 Naming

- File: `argon2id.ts` (lowercase).
- Class: `Argon2idEngine`.
- Types: `Argon2idParams`, `Argon2idEngineStatus`.
- Constants: `DEFAULT_ARGON2ID_PARAMS` (UPPER_SNAKE).

### 10.2 Logging

Selalu log melalui `logger` (bukan `console.log`). Ini menjamin
redaction otomatis untuk field sensitif.

### 10.3 Error Handling

Engine functions **tidak throw** saat fallback. Mereka return
boolean atau update `engineStatus`. Caller (misal:
`Argon2idEngine.deriveKey`) yang memutuskan fallback strategy.

### 10.4 Testing

- Unit tests di `tests/unit/crypto/kdfEngine.test.ts` dan
  `tests/unit/security/kdfSecurity.test.ts`.
- Integration tests di `tests/integration/kdfMigration.test.ts` dan
  `tests/integration/kdfMigrationFailureRecovery.test.ts`.
- Performance tests di `tests/performance/kdfMigrationPerformance.test.ts`.

---

## 11. Referensi

- **Argon2 spec**: <https://github.com/P-H-C/phc-winner-argon2>
- **OWASP Password Storage Cheat Sheet**:
  <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>
- **NIST SP 800-63B**: Digital Identity Guidelines
- **argon2 npm**: <https://www.npmjs.com/package/argon2>
- **hash-wasm**: <https://www.npmjs.com/package/hash-wasm>
- **electron-rebuild**: <https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules>

---

## 12. Security Audit Log

| Tanggal    | Auditor | Temuan                                  | Status        |
| ---------- | ------- | --------------------------------------- | ------------- |
| 2026-06-20 | Internal | Tidak ada material kunci di log output | Closed        |
| 2026-06-20 | Internal | Checksum mismatch terdeteksi & logged  | Closed        |
| 2026-06-20 | Internal | Fallback ke PBKDF2 diverified         | Closed        |

Untuk pelaporan vulnerability, lihat [docs/SECURITY.md](SECURITY.md).
