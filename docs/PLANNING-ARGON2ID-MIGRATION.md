# Planning: Argon2id Migration

> Dokumen ini berisi rencana implementasi lengkap, terstruktur, dan detail untuk migrasi Key Derivation Function (KDF) dari PBKDF2 ke Argon2id di SecurePass Manager.

---

## Overview Fitur

Migrasi dari PBKDF2 ke Argon2id meningkatkan ketahanan vault terhadap serangan brute-force dengan perangkat keras khusus (GPU/ASIC). Argon2id adalah pemenang Password Hashing Competition (PHC) dan merupakan standar modern yang direkomendasikan oleh OWASP dan NIST.

**Tujuan Utama**:

1. Mengganti KDF lama (PBKDF2) dengan Argon2id yang memory-hard dan lebih sulit di-crack secara paralel.
2. Memastikan proses migrasi transparan bagi pengguna tanpa perlu reset password atau re-setup vault.
3. Menjaga backward compatibility terhadap vault lama yang masih menggunakan PBKDF2.
4. Memberikan fallback ke PBKDF2 jika native module Argon2id gagal di-load di lingkungan tertentu.

**Prinsip Keamanan**:

- Native module Argon2id harus dikompilasi secara deterministic dan diverifikasi checksum sebelum di-load.
- Proses migrasi tidak boleh menyebabkan kehilangan data walau sekalipun berhenti di tengah jalan.
- Key material baru yang dihasilkan oleh Argon2id harus memiliki entropi yang sama atau lebih tinggi dari PBKDF2.
- Fallback ke PBKDF2 hanya diijinkan jika Argon2id benar-benar tidak tersedia, bukan karena kemudahan implementasi.

---

## 1. Task: Implementasi Argon2id & Native Module Integration

- [x] Task 1 Complete

### Sub-Task 1.1: Pilihan Library dan Setup Native Module

- [x] Evaluasi dan pilih library Argon2id yang stabil untuk Node.js/Electron — pilih `argon2` (native binding, prebuild support) sebagai primary dan `hash-wasm` (WASM-based) sebagai fallback.
- [x] Pastikan library mendukung target platform utama: Windows, macOS (Intel & Apple Silicon), Linux — `argon2` via prebuild binaries, `hash-wasm` via WASM.
- [x] Setup build pipeline — tambahkan `@electron/rebuild` sebagai devDependency dan integrasikan ke `scripts/postinstall.js` untuk rebuild native module `argon2` untuk Electron.
- [x] Tambahkan fallback WASM jika native binding gagal — implementasi di `src/main/crypto/argon2id.ts` dengan auto-fallback dari native ke `hash-wasm`.

### Sub-Task 1.2: Abstraksi KDF Interface

- [x] Buat interface `KDFEngine` dengan method `deriveKey(password, salt, params) => Promise<Buffer>` — lihat `src/main/crypto/kdfEngine.ts`.
- [x] Implementasi `PBKDF2Engine` yang meng-wrap `crypto.pbkdf2Sync` dan mengembalikan `Promise<Buffer>`.
- [x] Implementasi `Argon2idEngine` yang meng-wrap `argon2id.ts` (native + WASM fallback) dengan lazy init otomatis.
- [x] Pastikan output kedua engine adalah `Buffer` dengan panjang 32 byte (AES-256), diverifikasi dengan unit tests deterministik.

### Sub-Task 1.3: Parameter Argon2id

- [x] Definisikan default parameter Argon2id yang aman:
  - `memoryCost`: 64 MB (65536 KB) — tune berdasarkan minimum hardware target.
  - `timeCost`: 3 iterations.
  - `parallelism`: 4 lanes.
- [x] Simpan parameter KDF sebagai bagian dari vault metadata (bukan hard-code) agar bisa di-tune masa depan tanpa migrasi format.
- [x] Beri `kdfVersion` dalam metadata untuk mempermudah deteksi algoritma dan parameter.

### Sub-Task 1.4: Secure Memory untuk Argon2id

- [x] Pastikan salt, password, dan output derived key di-handle dalam `Buffer` atau `ArrayBuffer`.
- [x] Implementasi `secureClear` untuk wipe memory setelah derivasi selesai.
- [x] Hindari konversi derived key ke string JavaScript sebelum dipakai di crypto API.

---

## 2. Task: Deteksi Format Vault Lama & Backward Compatibility

- [x] Task 2 Complete

### Sub-Task 2.1: Deteksi Algoritma KDF Saat Unlock

- [x] Baca metadata vault sebelum derivasi key.
- [x] Jika metadata tidak memiliki field `kdfAlgorithm`, asumsikan PBKDF2 (format lama).
- [x] Jika `kdfAlgorithm` eksplisit bernilai `pbkdf2`, gunakan `PBKDF2Engine`.
- [x] Jika `kdfAlgorithm` bernilai `argon2id`, gunakan `Argon2idEngine`.

### Sub-Task 2.2: Validasi Parameter Vault Lama

- [x] Untuk vault PBKDF2 lama, baca parameter yang sudah tersimpan: `salt`, `iterations`.
- [x] Pastikan parameter lama tetap valid dan bisa menghasilkan key yang sama (verify dengan test vector).
- [x] Jika parameter lama corrupt atau tidak lengkap, tampilkan error yang informatif ke user.

### Sub-Task 2.3: Dual-Read Path

- [x] Implementasi code path yang memungkinkan unlock PBKDF2 vault tanpa error.
- [x] Jangan hapus atau ubah metadata lama sebelum proses migrasi berhasil 100%.
- [x] Pastikan `AuthService.unlock()` bisa menangani kedua algoritma tanpa kludge atau hack kondisional.

---

## 3. Task: Auto-Migration (Re-Encrypt) ke Argon2id

- [ ] Task 3 Complete

### Sub-Task 3.1: Trigger Migrasi Setelah Unlock

- [x] Setelah vault berhasil di-unlock dengan PBKDF2, deteksi bahwa migrasi dibutuhkan.
- [x] Tampilkan toast atau banner informatif: "Vault Anda menggunakan enkripsi lama. Kami akan meningkatkannya sekarang."
- [x] Jalankan migrasi secara background / non-blocking agar UI tetap responsif.
- [x] Jangan tampilkan modal blok yang menghalangi user menggunakan aplikasi.

### Sub-Task 3.2: Proses Re-Encrypt Vault

- [x] Dapatkan `masterKey` plain dari sesi unlock saat ini.
- [x] Generate `newSalt` baru dengan `crypto.randomBytes()`.
- [x] Derive key baru menggunakan `Argon2idEngine` dengan parameter default.
- [x] Re-encrypt seluruh data vault (items, folders, attachments metadata) dengan key baru.
- [x] Buat transaction atomik: write metadata baru + re-encrypted data ke file temporary.
- [x] Setelah write sukses, lakukan `fs.rename()` atomic untuk overwrite file database lama.

### Sub-Task 3.3: Atomic Switch dan Recovery

- [x] Simpan backup dari vault lama sebelum overwrite (suffix `.pre-argon2id-backup`).
- [x] Jika proses migrasi gagal di tengah jalan, jangan hapus vault lama — user tetap bisa unlock dengan PBKDF2.
- [x] Hapus file backup hanya setelah migrasi berhasil dan vault baru berhasil di-verifikasi (unlock test).
- [x] Log error migrasi (tanpa memuat key material) untuk diagnosis developer.

### Sub-Task 3.4: Update Metadata Vault

- [x] Setelah migrasi sukses, update metadata vault dengan:
  - `kdfAlgorithm`: `"argon2id"`
  - `kdfParams`: { memoryCost, timeCost, parallelism }
  - `salt`: salt baru
  - `version`: bump ke versi format vault terbaru
- [x] Simpan timestamp `migratedAt` untuk audit dan troubleshooting.
- [x] Pastikan metadata baru tetap kompatibel dengan `checkAuth` flow di session berikutnya.

---

## 4. Task: Fallback & Error Handling

- [ ] Task 4 Complete

### Sub-Task 4.1: Fallback ke PBKDF2

- [x] Jika `Argon2idEngine` gagal diinisialisasi (native module missing, compile error, unsupported arch), fallback otomatis ke `PBKDF2Engine`.
- [x] Tampilkan warning di UI: "Argon2id tidak tersedia di perangkat ini. Vault tetap aman dengan enkripsi standar lama."
- [x] Jangan blok user dari mengakses vault hanya karena Argon2id tidak tersedia — keamanan PBKDF2 masih acceptable.

### Sub-Task 4.2: Handling Corrupt Native Module

- [x] Tanamkan checksum hash (SHA-256) dari binary native module dalam bundled app.
- [x] Saat startup, verifikasi binary native module terhadap checksum sebelum digunakan.
- [x] Jika checksum mismatch, anggap module corrupt dan fallback ke PBKDF2/WASM.
- [x] Log checksum failure untuk debugging distribusi build.

### Sub-Task 4.3: Graceful Degradation UI

- [ ] Pastikan UI Settings tetap bisa diakses meski Argon2id tidak tersedia.
- [ ] Tampilkan info di panel security settings jika vault masih menggunakan PBKDF2.
- [ ] Berikan user opsi manual untuk re-trigger migrasi jika sebelumnya gagal (dari Settings > Security).

---

## 5. Task: Testing & Quality Assurance

- [ ] Task 5 Complete

### Sub-Task 5.1: Unit Tests untuk KDF Engine

- [x] Test determinisme: input yang sama menghasilkan output yang sama untuk Argon2id dan PBKDF2.
- [x] Test panjang key output selalu 32 bytes untuk AES-256.
- [x] Test dengan password kosong, password Unicode, dan password panjang > 1000 karakter.
- [x] Test error handling ketika native module gagal di-load (mock failure).

### Sub-Task 5.2: Integration Tests untuk Unlock Dual-Path

- [x] Test unlock vault dengan metadata PBKDF2 lama → assert vault terbuka dan tidak crash.
- [x] Test unlock vault dengan metadata Argon2id baru → assert vault terbuka.
- [x] Test unlock vault tanpa field `kdfAlgorithm` → assume PBKDF2 dan assert sukses.

### Sub-Task 5.3: Migration Tests

- [x] Test migrasi vault PBKDF2 ke Argon2id: assert file vault berubah, backup terbuat, metadata terupdate.
- [x] Test rollback jika migrasi gagal di tengah: assert vault lama masih bisa di-unlock.
- [x] Test bahwa data item tidak corrupt setelah migrasi (hash sebelum dan sesudah harus sama setelah decrypt).
- [x] Test migrasi vault yang sudah Argon2id: assert tidak ada double-migration atau loop.

### Sub-Task 5.4: Security Tests

- [x] Test bahwa salt baru di-generate secara kriptografikal random untuk setiap migrasi.
- [x] Test bahwa derived key Argon2id tidak sama dengan derived key PBKDF2 lama walau password sama.
- [x] Test memory wipe setelah derivasi: assert tidak ada residual key di memory (best effort dengan heap snapshot test).
- [x] Test checksum native module: assert fallback ke PBKDF2 jika binary di-tamper.

### Sub-Task 5.5: Performance & Stress Tests

- [x] Benchmark waktu derivasi Argon2id vs PBKDF2 di target hardware minimum.
- [x] Benchmark waktu re-encrypt seluruh vault (1000 items) untuk estimasi UX saat migrasi.
- [x] Test vault dengan attachment besar: assert proses migrasi tidak OOM (out of memory).

---

## 6. Task: Rollout & Backward Compatibility

- [x] Task 6 Complete

### Sub-Task 6.1: Single-Vault Legacy Migration

- [x] Detect vault lama yang masih single-file tanpa `kdfAlgorithm` dan tandai sebagai candidate migrasi.
- [x] Pastikan migrasi PBKDF2 → Argon2id dilakukan sebelum atau bersamaan dengan migrasi format vault lainnya.
- [x] Jangan ubah format file vault kecuali user sudah berhasil unlock minimal sekali.

### Sub-Task 6.2: Failure Recovery & Rollback

- [x] Implementasi mekanisme rollback otomatis: jika migrasi gagal, hapus file temporary dan pertahankan vault lama.
- [x] Berikan user instruksi manual recovery jika backup file tetap tersedia.
- [x] Log setiap kegagalan migrasi dengan stack trace (tanpa memuat password atau key).

### Sub-Task 6.3: Documentation Internal

- [x] Tambahkan developer notes tentang native module Argon2id, build requirement, dan troubleshooting.
- [x] Update `PLANNING-ROADMAP.md` status setelah Argon2id migration selesai.
- [x] Dokumentasikan format metadata baru (`kdfAlgorithm`, `kdfParams`, `kdfVersion`).
- [x] Buat runbook QA checklist khusus untuk test Argon2id di platform Windows, macOS, dan Linux.

---

## Summary Checklist Implementasi

- [x] Sub-Task 1.1: Pilihan Library dan Setup Native Module
- [x] Sub-Task 1.2: Abstraksi KDF Interface (PBKDF2Engine & Argon2idEngine)
- [x] Sub-Task 1.3: Parameter Argon2id Default dan `kdfVersion`
- [x] Sub-Task 1.4: Secure Memory untuk Argon2id (Buffer, secureClear)
- [x] Sub-Task 2.1: Deteksi Algoritma KDF Saat Unlock
- [x] Sub-Task 2.2: Validasi Parameter Vault Lama
- [x] Sub-Task 2.3: Dual-Read Path untuk Backward Compatibility
- [x] Sub-Task 3.1: Trigger Migrasi Setelah Unlock
- [x] Sub-Task 3.2: Proses Re-Encrypt Vault Atomik
- [x] Sub-Task 3.3: Atomic Switch dan Recovery dengan Backup
- [x] Sub-Task 3.4: Update Metadata Vault Post-Migrasi
- [x] Sub-Task 4.1: Fallback ke PBKDF2 jika Native Module Gagal
- [x] Sub-Task 4.2: Handling Corrupt Native Module (Checksum Verify)
- [ ] Sub-Task 4.3: Graceful Degradation UI
- [x] Sub-Task 5.1-5.5: Unit, Integration, Migration, Security, dan Performance Tests
- [x] Sub-Task 6.1: Single-Vault Legacy Migration Path
- [x] Sub-Task 6.2: Failure Recovery & Rollback Manual
- [x] Sub-Task 6.3: Documentation Internal dan QA Runbook
