# Developer Documentation: Vault Registry & Lifecycle

> Dokumen ini menjelaskan struktur vault registry, alur hidup vault, dan kontrak keamanan yang harus dipatuhi oleh setiap developer yang menyentuh kode terkait multi-vault di SecurePass Manager.

---

## 1. Arsitektur Overview

SecurePass Manager mendukung multiple vault terisolasi. Setiap vault memiliki:

- **File database SQLite terpisah** (`vault-{uuid}.db`)
- **Auth metadata terpisah** (`vault-auth/{uuid}.auth.json`) — salt, KDF params, verifier
- **Attachment storage terpisah** (`attachments/{vaultId}/`)
- **Cover image storage terpisah** (`covers/{vaultId}/`)

Semua vault direkam dalam satu **Vault Registry** (`vault-registry.json`) yang disimpan di direktori user data aplikasi (`app.getPath('userData')`).

### Prinsip Keamanan Utama

- **Registry tidak pernah menyimpan master password, encryption key, derived key, atau material kriptografis apa pun.**
- **Hanya satu vault yang bisa unlocked pada satu waktu.**
- **Switch vault selalu mengunci vault lama, wipe key material, lalu buka vault baru.**
- **Attachment dan cover path selalu divalidasi agar berada di dalam direktori vault yang sesuai** untuk mencegah path traversal.

---

## 2. Struktur Vault Registry

### File Lokasi

```
{userData}/
├── vault-registry.json          # Registry induk
├── vault-registry.json.backup.{timestamp}  # Backup otomatis sebelum perubahan destruktif
├── single-vault-migration.marker.json      # Marker migrasi single→multi
├── vaults/
│   ├── vault-{uuid-1}.db
│   ├── vault-{uuid-2}.db
│   └── ...
├── vault-auth/
│   ├── {uuid-1}.auth.json
│   ├── {uuid-2}.auth.json
│   └── ...
├── attachments/
│   ├── {vaultId-1}/
│   └── {vaultId-2}/
└── covers/
    ├── {vaultId-1}/
    └── {vaultId-2}/
```

### Schema VaultRegistryEntry

```typescript
interface VaultRegistryEntry {
  id: string;                    // UUID v4 stabil, tidak berubah sepanjang hidup vault
  name: string;                  // Display name, 1–100 karakter, unik case-insensitive
  databasePath: string;          // Absolute path ke file .db
  createdAt: number;             // Unix timestamp (ms)
  lastOpenedAt: number | null;   // Unix timestamp terakhir dibuka
  lastOpenedVersion: string | null;  // Versi aplikasi saat terakhir dibuka
  description: string | null;
  color: string | null;
  icon: string | null;
  isDefault: boolean;            // Vault default saat lock screen muncul
  sortOrder: number;             // Urutan tampilan di UI
  isCustomLocation: boolean;     // true jika DB di luar managed vaults dir
}
```

### Schema VaultRegistryFile

```typescript
interface VaultRegistryFile {
  version: number;               // Saat ini: 1
  vaults: VaultRegistryEntry[];
}
```

---

## 3. Vault Lifecycle

### 3.1 Create Vault

**File terlibat**: `main/ipc/vaultHandlers.ts` → `main/file-system/storageManager.ts` → `main/file-system/vaultRegistry.ts`

```
User input (name, masterPassword)
  → VAULT_CREATE IPC handler
    → createVaultMetadata()   # Validasi nama, resolve path, buat registry entry
    → migrateVaultDatabase()  # Jalankan schema & migration di file DB baru
    → writeVaultAuthMetadata()# Simpan salt + KDF params + verifier
    → unlockVault()           # Derive key, verify, buka DB
    → Return VaultRegistryEntry
```

**Catatan Keamanan**:
- Password tidak pernah di-persist dalam bentuk plaintext. Key derivation terjadi di main process.
- Jika setup auth gagal, vault entry di-rollback (hapus dari registry + hapus file DB).

### 3.2 Unlock Vault

**File terlibat**: `main/ipc/authHandlers.ts`

```
User input (masterPassword, vaultId?)
  → VAULT_SELECT / AUTH_UNLOCK IPC handler
    → Jika ada vault aktif → lockCurrentVault() dulu
    → readVaultAuthMetadata(vaultId)
    → deriveMasterKey(password, salt, kdfParams)
    → verifyKeyAgainstHash(key, verificationHash)
    → migrateVaultDatabase(vaultId)  # Jalankan migration jika diperlukan
    → openDatabaseForVault(vaultId)
    → Set session state: activeVaultId, masterKey, salt, kdfParams
    → recordVaultOpened()
```

### 3.3 Lock Vault

**File terlibat**: `main/ipc/authHandlers.ts`, `src/renderer/stores/authStore.ts`

```
Trigger: user lock / auto-lock / switch vault / app close
  → lockCurrentVault()
    → saveDatabase()          # Persist perubahan ke disk
    → closeDatabase()         # Tutup sql.js connection
    → clearKeys()             # Wipe masterKey, salt dari memory
    → activeVaultId = null
  → Renderer: resetAllVaultStores()
    → clearSensitiveData() pada itemStore
    → reset() pada folderStore, uiStore, settingsStore
    → clearToasts() dan clearAll() errors
```

### 3.4 Switch Vault

**File terlibat**: `src/renderer/stores/authStore.ts`, `main/ipc/authHandlers.ts`

```
User pilih vault lain di UI
  → Renderer: resetAllVaultStores() + cleanupListeners()
  → IPC VAULT_SELECT (vaultId, masterPassword)
  → Main: lockCurrentVault()       # Kunci vault lama (save, close, wipe keys)
  → Main: unlockVault(newVaultId)  # Buka vault baru
  → Renderer: On success → load vaults list, set activeVaultId/Name
  → Renderer: On failure → locked state, tampilkan error
```

**Catatan Keamanan Penting**:
- `resetAllVaultStores()` dipanggil **SEBELUM** IPC call, bukan setelah. Ini memastikan bahkan jika switch gagal, data vault lama sudah di-wipe dari renderer memory.
- Auto-lock timer di-reset saat active vault berubah (lihat `useAutoLock`).

### 3.5 Delete Vault

**File terlibat**: `main/ipc/vaultHandlers.ts`

```
User konfirmasi delete vault X
  → Jika X adalah vault aktif → lockCurrentVault() dulu
  → deleteVaultMetadata(vaultId, { deleteDatabaseFile?, deleteAttachments? })
    → deleteVault(vaultId) dari registry
    → Hapus file DB jika diminta
    → Hapus direktori attachments dan covers jika diminta
    → deleteVaultAuthMetadata(vaultId)  # Hapus auth file
  → Renderer: reset state jika vault aktif dihapus
```

---

## 4. Registry Cache & Consistency

`vaultRegistry.ts` menggunakan **in-memory cache** (`registryCache`) untuk mengurangi I/O disk. Cache di-invalidasi dengan `invalidateRegistryCache()`.

### Kapan Cache Di-invalidasi

| Skenario | Cache Invalidated? |
|----------|-------------------|
| `createVault()` | Ya (implisit via `saveRegistry()`) |
| `updateVault()` | Ya |
| `deleteVault()` | Ya |
| `commitRecovery()` | Ya |
| `removeMissingVaults()` | Ya |
| `restoreRegistryFromBackup()` | Ya |
| External file modification | Tidak otomatis — restart app diperlukan |

**Developer Note**: Jika kamu menulis kode yang memodifikasi registry secara langsung (bypassing API `vaultRegistry.ts`), kamu **harus** memanggil `invalidateRegistryCache()` untuk menghindari stale state.

---

## 5. Singleton Vault Active State

Di **main process**, tiga modul memegang state vault aktif:

1. **`main/database/connection.ts`**: `db`, `dbPath`, `activeVaultId`
2. **`main/ipc/authHandlers.ts`**: `masterKey`, `currentSalt`, `activeVaultId`
3. **`main/ipc/authHandlers.ts`**: KDF params (`currentKdfAlgorithm`, `currentKdfIterations`)

**Aturan Emas**: Semua state ini merupakan **singleton** dalam satu main process. Tidak ada concurrent vault access. Saat switch vault, lock terlebih dahulu, lalu unlock vault target.

### Getter API

```typescript
// connection.ts
getActiveVaultId(): string | null
getActiveDatabasePath(): string | null
isDatabaseOpen(): boolean

// authHandlers.ts
getActiveAuthVaultId(): string | null
getMasterKey(): Buffer | null
getCurrentSalt(): Buffer | null
```

### Guardian: assertActiveDatabaseOpen

Semua query function (`runQuery`, `runMany`, `prepare`) memanggil `assertActiveDatabaseOpen()` yang melempar `DatabaseNoActiveVaultError` jika tidak ada vault aktif. Ini mencegah operasi DB tanpa konteks vault yang jelas.

---

## 6. Registry Recovery & Failure Handling

### 6.1 Registry Corruption

Jika `vault-registry.json` rusak (JSON tidak valid atau schema tidak cocok):

1. `loadRegistry()` akan melempar `VaultRegistryError('REGISTRY_CORRUPTED')`
2. IPC handler menangkap error dan mengembalikannya ke renderer
3. Renderer bisa menawarkan opsi **Recover from Disk** (VAULT_RECOVER IPC)
4. Recovery scan direktori `vaults/` dan `vault-auth/` untuk file matching pattern

### 6.2 Missing Vault Files

Jika file DB vault hilang tetapi entry masih ada di registry:

1. `checkVaultFileStatus()` mengembalikan `'missing'` atau `'auth_missing'`
2. UI menampilkan indikator warning
3. User bisa menjalankan **Remove Missing Vaults** untuk membersihkan registry

### 6.3 Migration dari Single-Vault

Saat aplikasi lama (pre-multi-vault) pertama kali dibuka:

1. `ensureDefaultVaultRegistry()` mendeteksi `securepass.db` legacy
2. Backup legacy DB ke `securepass.db.backup.{timestamp}`
3. Backup registry sekarang
4. Buat entry registry baru dengan `customDatabasePath` menunjuk ke legacy DB
5. Tulis migration marker (`single-vault-migration.marker.json`)
6. Jika gagal, rollback registry dari backup

---

## 7. Checklist untuk Developer

Sebelum menambahkan fitur baru yang menyentuh vault:

- [ ] Apakah operasi memerlukan vault aktif? Gunakan `assertActiveDatabaseOpen()` atau `getActiveAuthVaultId()`.
- [ ] Apakah perlu switch vault? Pastikan panggil `lockCurrentVault()` sebelum membuka vault baru.
- [ ] Apakah ada data sensitif di renderer? Pastikan `resetAllVaultStores()` dipanggil setelah lock.
- [ ] Apakah modifikasi registry dilakukan via API `vaultRegistry.ts`? Jika tidak, panggil `invalidateRegistryCache()`.
- [ ] Apakah path file divalidasi? Gunakan `validateVaultDatabasePath()` untuk setiap entry sebelum digunakan.
- [ ] Apakah attachment/cover path dicek scope vault? Gunakan `isPathWithinDirectory()`.
