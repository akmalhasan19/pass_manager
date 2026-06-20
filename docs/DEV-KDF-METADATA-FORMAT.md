# Developer Documentation: KDF Metadata Format

> Spesifikasi teknis format metadata KDF (Key Derivation Function) yang
> disimpan di per-vault auth metadata file. Dokumen ini adalah referensi
> otoritatif untuk struktur field, versioning, dan backward compatibility
> yang harus dipahami developer yang bekerja dengan auth flow atau migrasi
> vault.

---

## 1. Lokasi File

Setiap vault punya satu auth metadata file:

```
{userData}/vault-auth/{vaultId}.auth.json
```

Lokasi absolut direalisasikan oleh
`getVaultAuthPath(vaultId)` di
`src/main/file-system/vaultAuthStorage.ts`.

---

## 2. Bentuk JSON

File auth.json berisi satu object JSON dengan field berikut:

```jsonc
{
  // === Field wajib (semua vault, semua versi) ===
  "salt": "base64-encoded 32-byte random salt",
  "kdfAlgorithm": "pbkdf2" | "argon2id",
  "kdfIterations": 600000,
  "verificationHash": "hex-encoded SHA-256 hash of derived key",
  "createdAt": 1718900000000,

  // === Field kondisional ===
  "kdfMemory": 65536,           // null atau hilang untuk PBKDF2
  "kdfParallelism": 4,          // null atau hilang untuk PBKDF2

  // === Field opsional (v1+) ===
  "kdfParams": {
    "algorithm": "pbkdf2" | "argon2id",
    // Untuk PBKDF2:
    "iterations": 600000
    // Untuk Argon2id:
    // "memoryCost": 65536,
    // "timeCost": 3,
    // "parallelism": 4
  },
  "kdfVersion": 2,

  // === Field khusus migrasi ===
  "migratedAt": 1718900000000    // timestamp migrasi, hanya ada setelah migrasi
}
```

---

## 3. Field Reference

### 3.1 `salt` (wajib, string base64)

- **Tipe**: string.
- **Format**: base64-encoded 32-byte random bytes.
- **Generasi**: `crypto.randomBytes(32)` di Node.js.
- **Lifetime**: 1 salt per vault, tidak pernah di-rotate (rotation
  butuh re-encrypt seluruh vault, yang sebenarnya terjadi saat
  password change).

Catatan: meski setiap vault regenerate salt saat password change,
kode saat ini tidak melakukan itu. Salt hanya di-regenerate saat
migration ke Argon2id.

### 3.2 `kdfAlgorithm` (wajib sejak v1, opsional untuk legacy)

- **Tipe**: `"pbkdf2" | "argon2id"`.
- **Default jika hilang**: `"pbkdf2"` (legacy behavior).
- **Kapan ditulis**: setiap kali vault dibuat atau di-migrasi.

### 3.3 `kdfIterations` (wajib)

- **Tipe**: number (integer).
- **Untuk PBKDF2**: jumlah iterasi (legacy: 600,000).
- **Untuk Argon2id**: jumlah `timeCost` (Argon2id iterations, saat
  ini 3).

Catatan: field ini digunakan untuk backward compatibility dengan
vault lama. Field `kdfParams` (v1+) lebih otoritatif.

### 3.4 `kdfMemory` (Argon2id only)

- **Tipe**: number (KiB) atau `null` untuk PBKDF2.
- **Default production**: 65536 (64 MB).
- **Range valid**: 8 (8 KiB) sampai 4_194_304 (4 GiB).

### 3.5 `kdfParallelism` (Argon2id only)

- **Tipe**: number (lanes) atau `null` untuk PBKDF2.
- **Default production**: 4.
- **Range valid**: 1 sampai 16.

### 3.6 `verificationHash` (wajib)

- **Tipe**: string (hex).
- **Format**: 64 hex chars (32 bytes SHA-256).
- **Algoritma**: `createHash('sha256').update(derivedKey).digest('hex')`.
- **Fungsi**: memvalidasi password tanpa menyimpan key. Saat unlock,
  derive key dari password + salt, hash, bandingkan dengan stored.
- **Timing-safe comparison**: gunakan `timingSafeEqual()` untuk
  perbandingan (lihat `src/main/crypto/keyDerivation.ts`).

### 3.7 `createdAt` (wajib)

- **Tipe**: number (Unix timestamp ms).
- **Fungsi**: audit trail, untuk UI ("vault dibuat 3 bulan lalu").

### 3.8 `kdfParams` (v1+, opsional untuk backward compat)

- **Tipe**: object dengan struktur:
  ```typescript
  type KdfParams =
    | { algorithm: 'pbkdf2'; iterations: number }
    | { algorithm: 'argon2id'; memoryCost: number; timeCost: number; parallelism: number };
  ```
- **Sumber otoritatif**: jika ada, field ini lebih diutamakan daripada
  field flat (`kdfIterations`, `kdfMemory`, `kdfParallelism`).
- **Lihat**: `src/shared/types.ts`.

### 3.9 `kdfVersion` (v1+, opsional)

- **Tipe**: number.
- **Nilai saat ini**: `2` (lihat `KDF_VERSION` di
  `src/shared/constants.ts`).
- **History**:
  - `undefined` atau `< 1` → legacy flat format (pre-v1).
  - `1` → KDF params dengan field flat.
  - `2` → menambah `migratedAt` timestamp.
- **Aturan baca**: jika `kdfVersion < 1` atau hilang, perlakukan
  sebagai legacy (PBKDF2) dan trigger `needsMigration` saat unlock.

### 3.10 `migratedAt` (v2+, hanya setelah migrasi)

- **Tipe**: number (Unix timestamp ms).
- **Kapan ditulis**: hanya setelah migrasi PBKDF2 → Argon2id berhasil.
- **Fungsi**: audit trail untuk compliance, troubleshooting, dan
  UI ("vault di-migrasi 5 menit yang lalu").
- **Perilaku**: tidak pernah di-clear. Sekali migrasi sukses, field
  ini permanen.

---

## 4. Versioning & Migration Path

### 4.1 v0 (legacy, pra-migrasi)

```json
{
  "salt": "...",
  "kdfIterations": 600000,
  "verificationHash": "...",
  "createdAt": 1718900000000
}
```

- Tidak ada `kdfAlgorithm` → default PBKDF2.
- Tidak ada `kdfParams` → pakai flat field.
- Tidak ada `kdfVersion` → dianggap v0.
- Tidak ada `migratedAt`.

Vault dengan format ini terdeteksi sebagai **kandidat migrasi**
oleh `detectKdfMigrationCandidate()` di
`src/main/file-system/vaultAuthStorage.ts`.

### 4.2 v1 (intermediate)

```json
{
  "salt": "...",
  "kdfAlgorithm": "pbkdf2",
  "kdfIterations": 600000,
  "verificationHash": "...",
  "createdAt": 1718900000000,
  "kdfParams": { "algorithm": "pbkdf2", "iterations": 600000 },
  "kdfVersion": 1
}
```

- Menambahkan `kdfParams` (structured) dan `kdfVersion: 1`.
- Masih PBKDF2.

### 4.3 v2 (current, post-migrasi)

```json
{
  "salt": "...",
  "kdfAlgorithm": "argon2id",
  "kdfIterations": 3,
  "kdfMemory": 65536,
  "kdfParallelism": 4,
  "verificationHash": "...",
  "createdAt": 1718900000000,
  "kdfParams": {
    "algorithm": "argon2id",
    "memoryCost": 65536,
    "timeCost": 3,
    "parallelism": 4
  },
  "kdfVersion": 2,
  "migratedAt": 1718900000000
}
```

- `kdfAlgorithm: "argon2id"`.
- Field flat terisi dengan nilai yang konsisten dengan `kdfParams`.
- `kdfVersion: 2` dan `migratedAt` ada.

---

## 5. Aturan Baca (unlockVault)

Saat unlock, kode di `src/main/ipc/authHandlers.ts` mengikuti
algoritma berikut:

```
1. Baca metadata → authMetadata.
2. Tentukan kdfParams:
   IF authMetadata.kdfVersion >= 1 AND authMetadata.kdfParams:
     kdfParams = authMetadata.kdfParams
   ELIF authMetadata.kdfAlgorithm === 'argon2id':
     kdfParams = { algorithm: 'argon2id',
                   memoryCost: authMetadata.kdfMemory ?? 65536,
                   timeCost: 3,
                   parallelism: authMetadata.kdfParallelism ?? 4 }
   ELSE (legacy or PBKDF2):
     kdfParams = { algorithm: 'pbkdf2',
                   iterations: authMetadata.kdfIterations }
3. Validasi salt, verifikasi hash.
4. deriveMasterKey(masterPassword, salt, kdfParams).
5. Verifikasi hasil dengan verificationHash.
6. Tentukan needsMigration:
   detectedAlgorithm = authMetadata.kdfAlgorithm ?? 'pbkdf2'
   needsMigration = (detectedAlgorithm === 'pbkdf2')
```

Kode implementasi ada di `unlockVault()` di authHandlers.ts.
Lihat juga test `tests/integration/unlockDualPath.test.ts`.

---

## 6. Aturan Tulis (create + migration)

### 6.1 Vault Baru (create)

Saat vault dibuat, kode menulis:

```json
{
  "salt": "<32 random bytes base64>",
  "kdfAlgorithm": "pbkdf2",
  "kdfIterations": 600000,
  "kdfMemory": null,
  "kdfParallelism": null,
  "verificationHash": "<sha256 of derived key>",
  "createdAt": <now>,
  "kdfParams": { "algorithm": "pbkdf2", "iterations": 600000 },
  "kdfVersion": <KDF_VERSION constant>
}
```

Catatan: vault baru **dibuat dengan PBKDF2**, bukan Argon2id. Hal
ini agar:
- Backward compatibility (vault baru bisa dibuka di versi lama
  yang belum support Argon2id).
- Argon2id migration dilakukan di background setelah unlock
  pertama.

### 6.2 Migration (PBKDF2 → Argon2id)

Saat migration sukses, metadata lama di-overwrite dengan:

```json
{
  "salt": "<32 new random bytes base64>",
  "kdfAlgorithm": "argon2id",
  "kdfIterations": 3,
  "kdfMemory": 65536,
  "kdfParallelism": 4,
  "verificationHash": "<sha256 of new derived key>",
  "createdAt": <original createdAt>,  // PENTING: jangan di-overwrite
  "migratedAt": <now>,
  "kdfParams": {
    "algorithm": "argon2id",
    "memoryCost": 65536,
    "timeCost": 3,
    "parallelism": 4
  },
  "kdfVersion": 2
}
```

Catatan penting:
- `createdAt` **dipertahankan** (audit trail asal vault).
- `migratedAt` ditambahkan.
- File di-overwrite secara atomic (write temp, rename) di
  `writeVaultAuthMetadata()`.

---

## 7. Validasi

`validateAuthMetadata()` di `vaultAuthStorage.ts` memvalidasi:

| Field          | Aturan                                                              |
| -------------- | ------------------------------------------------------------------- |
| `salt`         | string, valid base64, decoded length > 0                            |
| `verificationHash` | string, hex 64 char                                              |
| `kdfAlgorithm` | (jika ada) `"pbkdf2"` atau `"argon2id"`                            |
| `kdfIterations` (PBKDF2) | (jika ada) number ≥ 1                                     |
| `kdfMemory` (Argon2id) | (jika ada) number ≥ 1                                     |
| `kdfParallelism` (Argon2id) | (jika ada) number ≥ 1                              |

Jika validasi gagal, fungsi throw error dengan pesan deskriptif
dan unlock akan return error.

---

## 8. Keamanan

### 8.1 Tidak Boleh Disimpan

- **Master password** plaintext.
- **Derived key** (bahkan dalam bentuk buffer).
- **Plaintext data** apapun.

### 8.2 Yang Boleh Disimpan

- `salt` (publik, aman).
- `verificationHash` (one-way function, aman).
- `kdfParams` (publik, aman).
- `createdAt`, `migratedAt` (metadata, aman).

### 8.3 Logging

Logger otomatis me-redact field bernama:
- `password`, `masterpassword`, `passwordencrypted`
- `salt`, `pepper`
- `key`, `derivedkey`, `masterkey`, `privatekey`, `secret`, `secretkey`
- `token`, `accesstoken`, `refreshtoken`
- `iv`, `authtag`, `ciphertext`
- `hash`, `verificationhash`
- `notesencrypted`
- `credential`, `credentials`
- `passphrase`, `pin`, `otp`, `seed`, `mnemonic`

Lihat `src/shared/logger.ts` untuk daftar lengkap.

### 8.4 File Permissions

Auth metadata file disimpan di `app.getPath('userData')` yang
OS-managed. Pada Linux/macOS, permission default ke `0600` jika
dibuat oleh app. Pada Windows, ACL bergantung pada user account.

**TBD**: enforce permission 0600 secara eksplisit saat
`writeFileSync` (lihat TODO di Sub-Task 6.1).

---

## 9. Contoh End-to-End

### 9.1 Vault Baru (PBKDF2)

```typescript
const salt = generateSalt(); // 32 random bytes
const key = await deriveMasterKey(masterPassword, salt, {
  algorithm: 'pbkdf2',
  iterations: 600000,
});
const verificationHash = hashKeyForVerification(key);

const authMetadata: AuthMetadata = {
  salt,
  kdfAlgorithm: 'pbkdf2',
  kdfIterations: 600000,
  kdfMemory: null,
  kdfParallelism: null,
  verificationHash,
  createdAt: Date.now(),
  kdfParams: { algorithm: 'pbkdf2', iterations: 600000 },
  kdfVersion: KDF_VERSION, // 2
};

writeVaultAuthMetadata(vaultId, authMetadata);
```

### 9.2 Migration ke Argon2id

```typescript
// In AUTH_MIGRATE_KDF handler:
const newSalt = generateSalt(); // NEW salt
const newKey = await deriveMasterKey(oldKey.toString('utf-8'), newSalt, {
  algorithm: 'argon2id',
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
});
const newVerificationHash = hashKeyForVerification(newKey);

const newAuthMetadata: AuthMetadata = {
  salt: newSalt,
  kdfAlgorithm: 'argon2id',
  kdfIterations: 3,    // timeCost
  kdfMemory: 65536,
  kdfParallelism: 4,
  verificationHash: newVerificationHash,
  createdAt: oldAuthMetadata.createdAt, // preserve!
  migratedAt: Date.now(),
  kdfParams: {
    algorithm: 'argon2id',
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  },
  kdfVersion: KDF_VERSION, // 2
};

writeVaultAuthMetadata(vaultId, newAuthMetadata);
```

### 9.3 Unlock (semua vault)

```typescript
async function unlockVault(vaultId: string, masterPassword: string) {
  const authMetadata = readVaultAuthMetadata(vaultId);

  // Detect algorithm
  const detectedAlgorithm = authMetadata.kdfAlgorithm ?? 'pbkdf2';

  // Build kdfParams (prefer structured, fall back to flat)
  let kdfParams: KdfParams;
  if (authMetadata.kdfVersion && authMetadata.kdfVersion >= 1 && authMetadata.kdfParams) {
    kdfParams = authMetadata.kdfParams;
  } else if (detectedAlgorithm === 'argon2id') {
    kdfParams = {
      algorithm: 'argon2id',
      memoryCost: authMetadata.kdfMemory ?? 65536,
      timeCost: 3,
      parallelism: authMetadata.kdfParallelism ?? 4,
    };
  } else {
    const iterations = authMetadata.kdfIterations;
    if (typeof iterations !== 'number' || iterations < 1) {
      throw new Error('Invalid PBKDF2 iterations');
    }
    kdfParams = { algorithm: 'pbkdf2', iterations };
  }

  // Validate salt
  if (!Buffer.isBuffer(authMetadata.salt) || authMetadata.salt.length === 0) {
    throw new Error('Invalid salt');
  }

  // Derive and verify
  const key = await deriveMasterKey(masterPassword, authMetadata.salt, kdfParams);
  if (!verifyKeyAgainstHash(key, authMetadata.verificationHash)) {
    throw new Error('Invalid master password');
  }

  return { key, needsMigration: detectedAlgorithm === 'pbkdf2' };
}
```

---

## 10. Referensi Kode

- **Tipe**: `src/shared/types.ts` (lihat `AuthMetadata`, `KdfParams`).
- **Konstanta**: `src/shared/constants.ts` (lihat `KDF_VERSION`).
- **Storage**: `src/main/file-system/vaultAuthStorage.ts` (lihat
  `readVaultAuthMetadata`, `writeVaultAuthMetadata`,
  `validateAuthMetadata`, `detectKdfMigrationCandidate`).
- **Unlock**: `src/main/ipc/authHandlers.ts` (lihat `unlockVault`).
- **Migration**: `src/main/ipc/authHandlers.ts` (lihat handler
  `AUTH_MIGRATE_KDF`).
- **Key derivation**: `src/main/crypto/keyDerivation.ts`.
- **Tests**: `tests/integration/unlockDualPath.test.ts`,
  `tests/integration/kdfMigration.test.ts`,
  `tests/unit/security/kdfSecurity.test.ts`.
