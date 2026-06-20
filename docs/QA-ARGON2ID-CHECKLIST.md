# QA Runbook: Argon2id Migration Testing

> Checklist ini harus dijalankan oleh QA engineer pada platform Windows,
> macOS, dan Linux sebelum setiap release yang menyentuh kode KDF
> (Key Derivation Function). Setiap bagian menjelaskan skenario,
> langkah, ekspektasi, dan perintah diagnostik yang spesifik untuk
> platform tersebut.

---

## Environment Information

| Field            | Value                                         |
| ---------------- | --------------------------------------------- |
| Tanggal Test     | ___________________                            |
| Tester           | ___________________                            |
| App Version      | ___________________                            |
| Commit SHA       | ___________________                            |
| Platform         | ☐ Windows ☐ macOS ☐ Linux                     |
| Architecture     | ☐ x64 ☐ arm64                                 |
| OS Version       | ___________________                            |
| Distro (Linux)   | ___________________                            |
| Build Type       | ☐ Development ☐ Staging ☐ Production          |
| Argon2id Status  | ☐ Native ☐ WASM ☐ PBKDF2 (fallback)          |
| Notes            | ___________________                            |

---

## 0. Pre-Flight: Verifikasi Build & Checksum

Sebelum menjalankan test skenario, pastikan environment dalam
kondisi baik.

### 0.1 Build Aplikasi

| #  | Perintah / Langkah                                              | Ekspektasi                                                       | ✓ |
| -- | --------------------------------------------------------------- | ---------------------------------------------------------------- | --- |
| 0.1.1 | `npm ci`                                                        | Exit 0, tidak ada error                                          | ☐ |
| 0.1.2 | `npm run build`                                                 | Build sukses, `dist/`, `dist-electron/` dihasilkan                 | ☐ |
| 0.1.3 | `cat src/main/crypto/argon2-checksums.json \| jq '.checksums \| keys \| length'` | Minimal 1 entry (semua platform yang di-support)        | ☐ |

### 0.2 Native Module Availability

| #  | Perintah / Langkah                                              | Ekspektasi                                                       | ✓ |
| -- | --------------------------------------------------------------- | ---------------------------------------------------------------- | --- |
| 0.2.1 | `ls node_modules/argon2/prebuilds/<platform>-<arch>/`          | File `argon2.*.node` ada (lihat [DEV-ARGON2ID-NATIVE-MODULE.md](DEV-ARGON2ID-NATIVE-MODULE.md) untuk nama per platform) | ☐ |
| 0.2.2 | `node -e "require('argon2')"` (dari root project)              | Exit 0, tidak ada error module not found                          | ☐ |

**Windows specific**:
```powershell
Test-Path node_modules\argon2\prebuilds\win32-x64\argon2.glibc.node
# Expected: True
```

**macOS specific**:
```bash
# Apple Silicon
ls node_modules/argon2/prebuilds/darwin-arm64/argon2.armv8.glibc.node
# Intel
ls node_modules/argon2/prebuilds/darwin-x64/argon2.glibc.node
```

**Linux specific**:
```bash
# Detect musl vs glibc
ldd --version 2>&1 | head -1
# glibc: ldd (Ubuntu GLIBC 2.31-...)
# musl: musl libc (e.g. Alpine)
ls node_modules/argon2/prebuilds/linux-x64/  # adjust for arch
```

### 0.3 Verifikasi Checksum

```bash
node scripts/generate-argon2-checksums.js
git diff src/main/crypto/argon2-checksums.json
# Expected: tidak ada perubahan (binary sudah di-checksum)
```

---

## 1. Test Suite Otomatis

Jalankan test suite penuh. Semua test harus pass.

| #  | Perintah                                                         | Ekspektasi                | ✓ |
| -- | ---------------------------------------------------------------- | ------------------------- | --- |
| 1.1 | `npm run typecheck`                                              | Exit 0                    | ☐ |
| 1.2 | `npm run lint`                                                   | 0 errors                  | ☐ |
| 1.3 | `npm run test` (jalankan di Node dengan `--expose-gc`)           | 400+ tests pass           | ☐ |
| 1.4 | `npm run test:all`                                               | typecheck + test + e2e   | ☐ |

**Filter test yang relevan dengan Argon2id**:
```bash
node --expose-gc ./node_modules/vitest/vitest.mjs run \
  tests/unit/crypto/kdfEngine.test.ts \
  tests/unit/security/kdfSecurity.test.ts \
  tests/integration/kdfMigration.test.ts \
  tests/integration/kdfMigrationFailureRecovery.test.ts \
  tests/integration/unlockDualPath.test.ts \
  tests/performance/kdfMigrationPerformance.test.ts
# Expected: 100+ tests pass
```

---

## 2. Skenario Unlock (Backward Compatibility)

Verifikasi vault lama (PBKDF2) dan vault baru (Argon2id) sama-sama
bisa di-unlock dengan benar.

### 2.1 Setup Test Vault

| #  | Skenario                                | Langkah                                                            | Ekspektasi                                                            | ✓ |
| -- | --------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- | --- |
| 2.1.1 | Buat vault legacy (PBKDF2)             | Setup screen → masukkan password → Create                          | Vault terbuat, langsung unlocked                                       | ☐ |
| 2.1.2 | Verify auth file v0                    | Buka `{userData}/vault-auth/{uuid}.auth.json`                      | `kdfAlgorithm: "pbkdf2"`, tidak ada `kdfParams`                       | ☐ |
| 2.1.3 | Lock aplikasi                           | Tutup app atau klik Lock                                           | Lock screen muncul                                                     | ☐ |
| 2.1.4 | Unlock vault legacy                     | Masukkan password yang sama                                        | Vault terbuka, toast/banner "Vault is using legacy encryption" muncul  | ☐ |
| 2.1.5 | Verify response                         | Perhatikan IPC response                                            | `needsMigration: true`                                                | ☐ |

### 2.2 Auto-Migration

| #  | Skenario                            | Langkah                                                | Ekspektasi                                                                   | ✓ |
| -- | ----------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- | --- |
| 2.2.1 | Tunggu background migration         | Tunggu 5-10 detik setelah unlock                       | Toast "Vault encryption upgraded to Argon2id" muncul                         | ☐ |
| 2.2.2 | Verify auth file v2                 | Buka file auth.json lagi                               | `kdfAlgorithm: "argon2id"`, `kdfParams.algorithm: "argon2id"`, `kdfVersion: 2` | ☐ |
| 2.2.3 | Verify `migratedAt` ada             | Lihat field migratedAt di file                         | Timestamp ISO, tidak null                                                     | ☐ |
| 2.2.4 | Backup dihapus                       | Cek direktori vault                                    | File `.pre-argon2id-backup` tidak ada                                       | ☐ |
| 2.2.5 | Lock + unlock setelah migrasi       | Lock, lalu unlock dengan password yang sama            | Vault terbuka, **tanpa** banner migrasi lagi                                 | ☐ |

---

## 3. Skenario Migration Failure

### 3.1 Gagal Backup (disk penuh simulasi)

**Setup khusus platform**:
- **Windows**: gunakan `fsutil` atau set permission read-only.
- **macOS/Linux**: gunakan `chmod 444` pada direktori vault.

```bash
# Simulasi disk penuh (Linux/macOS)
chmod 555 {userData}/vaults
# Atau gunakan storage penuh
df -h {userData}
```

| #  | Skenario                                | Langkah                                                          | Ekspektasi                                                                | ✓ |
| -- | --------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- | --- |
| 3.1.1 | Trigger migration                       | Unlock vault legacy dengan storage penuh                          | Migration gagal dengan `error` mengandung "backup"                         | ☐ |
| 3.1.2 | Verify response fields                  | Perhatikan IPC response                                          | `backupAvailable: false`, `manualRecoveryInstructions` undefined           | ☐ |
| 3.1.3 | Verify error log                         | Lihat console / log file                                         | Ada `[ERROR]` log dengan stack trace                                      | ☐ |
| 3.1.4 | Restore storage                         | `chmod 755 {userData}/vaults` (atau hapus storage penuh)         | -                                                                         | ☐ |
| 3.1.5 | Retry migration                         | Unlock + tunggu                                                   | Migration sukses kali ini                                                 | ☐ |

### 3.2 Gagal Re-Encryption

Skenario ini sulit di-reproduksi secara manual. Gunakan test otomatis
sebagai gantinya:

```bash
node --expose-gc ./node_modules/vitest/vitest.mjs run \
  tests/integration/kdfMigrationFailureRecovery.test.ts
# Expected: 16 tests pass
```

### 3.3 Gagal Key Derivation (Argon2id unavailable)

**Setup khusus**: disable Argon2id via env var.

```bash
# Set env var sebelum start app
ELECTRON_DISABLE_ARGON2ID=1 npm start
```

| #  | Skenario                                | Langkah                                                          | Ekspektasi                                                                | ✓ |
| -- | --------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- | --- |
| 3.3.1 | Start app dengan Argon2id disabled      | Set env var, start app                                            | App start normal                                                          | ☐ |
| 3.3.2 | Unlock vault legacy                     | Masukkan password                                                 | Vault terbuka, `needsMigration: true`, `argon2idUnavailable: true`        | ☐ |
| 3.3.3 | Trigger migration                       | Tunggu                                                            | Migration **gagal** dengan error `ARGON2ID_UNAVAILABLE`                 | ☐ |
| 3.3.4 | Verify response                         | Perhatikan response                                               | `fallbackToPbkdf2: true`                                                 | ☐ |
| 3.3.5 | Verify vault unchanged                  | Cek auth.json masih PBKDF2                                        | `kdfAlgorithm: "pbkdf2"` (tidak berubah)                                | ☐ |

---

## 4. Skenario Checksum Tampering

### 4.1 Simulasi Binary Corrupt (Windows)

```powershell
# Backup binary
Copy-Item node_modules\argon2\prebuilds\win32-x64\argon2.glibc.node `
  node_modules\argon2\prebuilds\win32-x64\argon2.glibc.node.bak

# Corrupt binary (zero out first 1KB)
$bytes = [System.IO.File]::ReadAllBytes('node_modules\argon2\prebuilds\win32-x64\argon2.glibc.node')
for ($i = 0; $i -lt 1024; $i++) { $bytes[$i] = 0 }
[System.IO.File]::WriteAllBytes('node_modules\argon2\prebuilds\win32-x64\argon2.glibc.node', $bytes)
```

### 4.2 Simulasi Binary Corrupt (macOS / Linux)

```bash
# Backup binary
cp node_modules/argon2/prebuilds/darwin-x64/argon2.glibc.node \
   /tmp/argon2.glibc.node.bak

# Corrupt: overwrite first 1KB with zeros
dd if=/dev/zero of=node_modules/argon2/prebuilds/darwin-x64/argon2.glibc.node \
   bs=1 count=1024 conv=notrunc
```

### 4.3 Test Expectations

| #  | Skenario                                | Langkah                                                          | Ekspektasi                                                                | ✓ |
| -- | --------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- | --- |
| 4.3.1 | Start app dengan binary corrupt         | `npm start`                                                       | App start tanpa crash                                                     | ☐ |
| 4.3.2 | Unlock vault                             | Masukkan password                                                 | Vault terbuka                                                            | ☐ |
| 4.3.3 | Verify error log                         | Console                                                           | `[ERROR] Argon2id native module checksum mismatch`                        | ☐ |
| 4.3.4 | Verify engine status                    | Cek IPC `AUTH_GET_KDF_STATUS`                                    | Status `wasm` atau `unavailable`                                          | ☐ |
| 4.3.5 | Restore binary                          | `cp /tmp/argon2.glibc.node.bak node_modules/argon2/prebuilds/...`  | -                                                                         | ☐ |
| 4.3.6 | Re-generate checksum                    | `node scripts/generate-argon2-checksums.js`                     | Checksum baru ditulis                                                     | ☐ |
| 4.3.7 | Restart app, retry unlock               | `npm start`                                                       | Vault terbuka dengan native Argon2id                                      | ☐ |

---

## 5. Skenario Performance

### 5.1 KDF Derivation Benchmark

```bash
node --expose-gc ./node_modules/vitest/vitest.mjs run \
  tests/performance/kdfMigrationPerformance.test.ts
# Expected: 14 tests pass
```

Verifikasi output (perhatikan angka-angka berikut):

| #  | Test                                                  | Batas waktu (target hardware minimum) | Aktual | ✓ |
| -- | ----------------------------------------------------- | -------------------------------------- | ------ | --- |
| 5.1.1 | PBKDF2 1,000 iter                                     | < 200 ms                                | ___    | ☐ |
| 5.1.2 | PBKDF2 600,000 iter (production default)               | < 6,000 ms                              | ___    | ☐ |
| 5.1.3 | Argon2id 1 MB / 1 / 1 (test params)                    | < 200 ms                                | ___    | ☐ |
| 5.1.4 | Argon2id 64 MB / 3 / 4 (production)                    | < 5,000 ms                              | ___    | ☐ |
| 5.1.5 | 1,000 items migration end-to-end                       | < 60,000 ms                             | ___    | ☐ |
| 5.1.6 | 50 attachments × 5 MB (no OOM)                       | < 90,000 ms                             | ___    | ☐ |

### 5.2 Memory Stability

Jalankan 5× Argon2id derivations secara berurutan. Peak heap
delta harus < 256 MB (lihat test "handles 5 sequential Argon2id
derivations without unbounded heap growth").

```bash
# Manual check (Linux/macOS)
/usr/bin/time -v node --expose-gc ./node_modules/vitest/vitest.mjs run \
  tests/performance/kdfMigrationPerformance.test.ts -t "5 sequential"
# Expected: Maximum resident set size < 512 MB
```

---

## 6. Skenario Cross-Platform Smoke

### 6.1 Windows

| #  | Item                                                                | Expected                                                | ✓ |
| -- | ------------------------------------------------------------------- | ------------------------------------------------------- | --- |
| 6.1.1 | Start app dari Start Menu                                            | App muncul dalam 3 detik                                | ☐ |
| 6.1.2 | Setup vault baru                                                    | Vault terbuat di `%APPDATA%/secure-pass-manager/`         | ☐ |
| 6.1.3 | Path khusus Windows                                                 | Path menggunakan backslash `\`                          | ☐ |
| 6.1.4 | Argon2id native                                                     | Lihat log: `Argon2id native module checksum verified`   | ☐ |
| 6.1.5 | Anti-virus scan                                                    | Windows Defender tidak block app                         | ☐ |
| 6.1.6 | Task Manager → Details tab                                          | Process `electron.exe` tidak crash, memory < 500 MB       | ☐ |

### 6.2 macOS

| #  | Item                                                                | Expected                                                | ✓ |
| -- | ------------------------------------------------------------------- | ------------------------------------------------------- | --- |
| 6.2.1 | Start app dari Applications                                         | App muncul dalam 3 detik                                | ☐ |
| 6.2.2 | Gatekeeper                                                         | App tidak diblokir (code-signed jika production)          | ☐ |
| 6.2.3 | Apple Silicon M1/M2/M3                                             | `uname -m` → `arm64`; prebuild `darwin-arm64` digunakan  | ☐ |
| 6.2.4 | Intel                                                               | `uname -m` → `x86_64`; prebuild `darwin-x64` digunakan  | ☐ |
| 6.2.5 | Activity Monitor                                                   | Process `Electron` tidak crash, memory < 500 MB         | ☐ |
| 6.2.6 | Sandbox permission                                                 | App tidak meminta akses yang tidak perlu                  | ☐ |

### 6.3 Linux

| #  | Item                                                                | Expected                                                | ✓ |
| -- | ------------------------------------------------------------------- | ------------------------------------------------------- | --- |
| 6.3.1 | AppImage start                                                      | `chmod +x SecurePass-*.AppImage && ./SecurePass-*.AppImage` | ☐ |
| 6.3.2 | glibc distro (Ubuntu, Fedora, Debian)                               | Lihat log: `Argon2id native module checksum verified`   | ☐ |
| 6.3.3 | musl distro (Alpine)                                                | Lihat log: prebuild `musl` digunakan                    | ☐ |
| 6.3.4 | Wayland                                                             | App berjalan normal tanpa flicker                       | ☐ |
| 6.3.5 | X11 fallback                                                       | App berjalan normal                                     | ☐ |
| 6.3.6 | SELinux enforcing                                                   | App tidak ditolak oleh SELinux                          | ☐ |
| 6.3.7 | File permissions                                                   | `ls -la {userData}/vault-auth/` → permission `700` atau lebih ketat | ☐ |

**Linux musl detection**:
```bash
# Di dalam app, log akan menampilkan nama file:
# - glibc: argon2.glibc.node
# - musl:  argon2.musl.node
```

---

## 7. Skenario Failure Logging (Audit)

### 7.1 Verifikasi Redaction

Trigger sebuah error dan inspect log untuk memastikan tidak ada
material kunci yang bocor.

```bash
# Setup: create vault lalu corrupt binary seperti di section 4
# Lalu start app dan unlock
```

| #  | Item                                                                | Expected                                                | ✓ |
| -- | ------------------------------------------------------------------- | ------------------------------------------------------- | --- |
| 7.1.1 | Log tidak mengandung master password                                | grep `<password>` di log file → 0 results              | ☐ |
| 7.1.2 | Log tidak mengandung derived key                                    | grep hex 64 char pattern → 0 matches                   | ☐ |
| 7.1.3 | Log tidak mengandung salt (base64)                                  | grep base64 44 char pattern → 0 matches                | ☐ |
| 7.1.4 | Log mengandung stack trace                                          | grep `at file:` atau `at .*\.ts:` → matches            | ☐ |
| 7.1.5 | Setiap error log memiliki field `stack`                             | grep `"stack":` → multiple matches                     | ☐ |

**PowerShell**:
```powershell
Get-Content %APPDATA%\secure-pass-manager\logs\*.log | Select-String "at file:"
```

**Bash**:
```bash
grep -E "at .*\.ts:" ~/.config/secure-pass-manager/logs/*.log
```

### 7.2 Verifikasi Manual Recovery Instructions

Trigger migration failure dan verifikasi response.

| #  | Item                                                                | Expected                                                | ✓ |
| -- | ------------------------------------------------------------------- | ------------------------------------------------------- | --- |
| 7.2.1 | Response mengandung `manualRecoveryInstructions`                    | String panjang > 100 char                                | ☐ |
| 7.2.2 | Instructions mengandung backup path                                 | `grep {vaultId}.pre-argon2id-backup` → match            | ☐ |
| 7.2.3 | Instructions tidak mengandung password                              | grep master password → 0 matches                        | ☐ |
| 7.2.4 | Backup file masih ada setelah failure                                | `ls {userData}/vaults/*.pre-argon2id-backup` → exists | ☐ |

---

## 8. Skenario Recovery (Manual)

### 8.1 Manual Recovery Setelah Migration Gagal

| #  | Item                                                                | Expected                                                | ✓ |
| -- | ------------------------------------------------------------------- | ------------------------------------------------------- | --- |
| 8.1.1 | Quit app                                                            | App shutdown bersih                                    | ☐ |
| 8.1.2 | Copy backup ke vault                                                | `cp vault.db.pre-argon2id-backup vault.db`              | ☐ |
| 8.1.3 | Delete modified vault metadata                                      | Lihat instruksi di `manualRecoveryInstructions`          | ☐ |
| 8.1.4 | Restart app                                                         | Vault muncul di vault selector                          | ☐ |
| 8.1.5 | Unlock dengan password lama                                        | Vault terbuka                                            | ☐ |
| 8.1.6 | Verify data integrity                                              | Items, folders, attachments semua intact                | ☐ |
| 8.1.7 | Delete backup file (opsional)                                      | `rm vault.db.pre-argon2id-backup`                        | ☐ |

---

## 9. Regresi Test (Automated)

Jalankan test suite penuh sebagai regression check.

```bash
# Full unit + integration + performance
npm run test

# Full pipeline (typecheck + test + e2e)
npm run test:all
```

| #  | Test File                                                       | Expected | Actual | ✓ |
| -- | --------------------------------------------------------------- | -------- | ------ | --- |
| 9.1 | `tests/unit/crypto/kdfEngine.test.ts`                           | 41 pass  | ___    | ☐ |
| 9.2 | `tests/unit/security/kdfSecurity.test.ts`                        | 17 pass  | ___    | ☐ |
| 9.3 | `tests/integration/kdfMigration.test.ts`                        | 7 pass   | ___    | ☐ |
| 9.4 | `tests/integration/kdfMigrationFailureRecovery.test.ts`         | 16 pass  | ___    | ☐ |
| 9.5 | `tests/integration/unlockDualPath.test.ts`                      | pass     | ___    | ☐ |
| 9.6 | `tests/performance/kdfMigrationPerformance.test.ts`              | 14 pass  | ___    | ☐ |

---

## 10. Sign-Off

| Role            | Name | Date | Pass / Fail | Notes |
| --------------- | ---- | ---- | ------------ | ----- |
| QA Engineer      |      |      |              |       |
| Security Review |      |      |              |       |
| Release Manager |      |      |              |       |

Kirim hasil ke `#release-checklist` channel setelah semua item
tertanda. Jika ada item yang gagal, jangan merge sampai issue
terselesaikan.
