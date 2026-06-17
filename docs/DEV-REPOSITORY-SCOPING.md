# Developer Documentation: Repository & Database Connection Scoping

> Dokumen ini menjelaskan cara database connection dan repository layer di-scoped per vault, serta kontrak yang harus dipatuhi agar data tidak bocor antar vault.

---

## 1. Arsitektur Database Layer

SecurePass Manager menggunakan **sql.js** (SQLite di WASM) yang berjalan di main process Electron. Database bersifat **in-memory** dengan persistensi manual ke disk sebagai file SQLite binary.

### Komponen Utama

| File | Tanggung Jawab |
|------|---------------|
| `main/database/connection.ts` | Singleton db connection, path resolution, open/close/save/query |
| `main/database/migrations.ts` | Schema creation & per-vault migration |
| `main/database/repositories.ts` | CRUD layer untuk items, folders, tags, trash, attachments |
| `main/ipc/handlers/*.ts` | IPC bridge yang memanggil repositories |
| `renderer/stores/*.ts` | Zustand stores yang memanggil IPC |

---

## 2. Connection Scoping Model

### 2.1 Singleton Connection per Process

```typescript
// main/database/connection.ts
let db: SqlJsDatabase | null = null;
let dbPath: string | null = null;
let activeVaultId: string | null = null;
```

Main process hanya memegang **satu** database handle aktif pada satu waktu. Handle ini selalu mengacu pada vault yang sedang **unlocked**.

### 2.2 State Transitions

```
[state: no db open]
  │
  ▼ openDatabaseForVault(vaultId)
[state: db open for vault X]
  │
  ▼ closeDatabase()  →  nullifies db, dbPath, activeVaultId
[state: no db open]
  │
  ▼ openDatabaseForVault(vaultIdY)
[state: db open for vault Y]
```

**Tidak ada concurrent multi-vault access.** Switch vault = close + open.

### 2.3 Open Database Flow

```typescript
function openDatabaseAtPath(path: string, vaultId: string): SqlJsDatabase {
  if (db && activeVaultId === vaultId && dbPath === path) {
    return db;  // Reuse existing connection
  }

  // Close existing connection first
  if (db) {
    closeDatabase();
  }

  if (existsSync(path)) {
    const fileBuffer = readFileSync(path);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();  // Fresh in-memory DB
  }

  dbPath = path;
  activeVaultId = vaultId;
  return db;
}
```

### 2.4 Vault-Aware Entry Points

| Function | Penggunaan |
|----------|-----------|
| `openDatabaseForVault(vaultId)` | Buka DB untuk vault spesifik. Gunakan untuk unlock/switch. |
| `openDatabase(filePath?)` | Legacy API untuk single-vault. Sekarang primarily untuk backward-compat. |
| `getDatabase()` | Ambil DB handle aktif. Me-`assertActiveDatabaseOpen()`. |
| `getActiveVaultId()` | Ambil ID vault yang DB-nya sedang terbuka. |
| `isDatabaseOpen()` | Cek apakah ada DB yang terbuka. |

---

## 3. Migration per Vault

### 3.1 Per-Vault Schema Application

```typescript
// main/database/migrations.ts
export function migrateVaultDatabase(vaultId: string): void {
  openDatabaseForVault(vaultId);
  try {
    runMigrations();
    saveDatabase();
  } finally {
    closeDatabase();
  }
}
```

**Setiap vault menjalankan migrasi sendiri.** Schema version disimpan di dalam database vault itu sendiri (`settings` table, key `schema_version`), bukan di registry global.

### 3.2 Migration Trigger Points

| Timing | Action |
|--------|--------|
| Vault baru dibuat (`VAULT_CREATE`) | `migrateVaultDatabase(vaultId)` sebelum setup auth |
| Vault di-unlock (`AUTH_UNLOCK` / `VAULT_SELECT`) | `migrateVaultDatabase(vaultId)` sebelum `openDatabaseForVault` untuk penggunaan |
| Legacy single-vault migration | `migrateVaultDatabase` pada vault default yang terbuat dari legacy DB |

### 3.3 Rollback Behavior

Jika migrasi gagal:
- Database tidak di-save dalam state partial
- `closeDatabase()` di `finally` block menutup handle
- Active vault state **tidak di-set** — aplikasi tetap dalam kondisi "belum ada vault aktif"
- Error ditampilkan ke user

---

## 4. Repository Layer Contract

### 4.1 Repository Tidak Menyimpan Connection Reference

Repository functions (ItemRepository, FolderRepository, dll.) **tidak menyimpan** database handle sebagai properti instance. Sebaliknya, setiap method memanggil `getDatabase()` untuk mendapatkan handle aktif.

```typescript
// Contoh pattern yang BENAR (ada di kode saat ini)
class ItemRepository {
  findById(id: string) {
    const db = getDatabase();  // Ambil dari singleton
    const stmt = db.prepare('SELECT ... WHERE id = ?');
    // ...
  }
}
```

```typescript
// Contoh pattern yang SALAH (JANGAN lakukan ini)
class ItemRepository {
  private db: Database;  // ❌ Stale reference!
  
  constructor(db: Database) {
    this.db = db;  // ❌ Tidak pernah di-update saat vault switch
  }
}
```

**Mengapa ini penting**: Jika repository menyimpan reference lama, setelah switch vault repository masih mengacu ke DB vault lama yang sudah ditutup, atau lebih buruk, berefek pada DB yang seharusnya tidak aktif.

### 4.2 Guard di Setiap Operasi

Semua repo method memanggil `getDatabase()` yang di dalamnya memanggil `assertActiveDatabaseOpen()`. Jika tidak ada vault aktif:

```
DatabaseNoActiveVaultError: No vault is currently active
```

Ini mencegah:
- Query "ghost" tanpa vault aktif
- Race condition saat auto-lock terjadi bersamaan dengan operasi data
- Bug di mana kode lupa panggil unlock sebelum query

### 4.3 Query Parameterization

Semua query menggunakan prepared statement dengan parameter binding:

```typescript
const stmt = db.prepare('SELECT * FROM items WHERE folder_id = ?');
stmt.bind([folderId]);
```

**Tidak ada string concatenation** untuk query values. Ini melindungi dari SQL injection bahkan jika input berasal dari vault yang berbeda.

---

## 5. Attachment & Cover Image Scoping

### 5.1 Storage Path Resolution

```
{userData}/
├── attachments/
│   └── {vaultId}/
│       └── {timestamp}-{random}.enc
└── covers/
    └── {vaultId}/
        └── {timestamp}-{random}.enc
```

Setiap attachment/cover file diberi nama acak dengan prefix timestamp. Tidak ada nama file asli yang dipreserve (kecuali untuk tampilan di UI yang disimpan di DB).

### 5.2 Path Validation

Sebelum setiap operasi file attachment:

```typescript
function deleteStoredFile(storagePath: string, vaultId: string): void {
  // 1. Cek path traversal
  if (containsPathTraversal(storagePath)) throw error;

  // 2. Cek path berada di dalam direktori vault
  const storageDir = getStoragePath(vaultId);
  if (!isPathWithinDirectory(storageDir, storagePath)) throw error;

  // 3. Baru lakukan operasi file
  unlinkSync(storagePath);
}
```

**Ini memastikan**:
- Vault A tidak bisa menghapus file milik Vault B
- User tidak bisa memanipulasi path untuk mengakses file di luar storage
- Tidak ada collision nama antar vault

### 5.3 Delete Vault Cleanup

Ketika vault dihapus dengan `deleteAttachments: true`:

```typescript
const attachmentsDir = join(getUserDataPath(), 'attachments', vaultId);
if (existsSync(attachmentsDir)) {
  rmSync(attachmentsDir, { recursive: true, force: true });
}
```

Seluruh subtree direktori vault dihapus, memastikan tidak ada sisa file terenkripsi yang terbengkalai.

---

## 6. IPC Handler Scoping Rules

### 6.1 Vault-Data Handlers

Semua handler operasi data (items, folders, tags, attachments, covers, trash, settings, import, export, health) harus memverifikasi bahwa ada vault aktif sebelum query. Pola yang digunakan:

```typescript
// Di dalam handler
if (!isDatabaseOpen()) {
  return { success: false, error: 'Database is not open. Unlock a vault first.' };
}

const currentVaultId = getActiveVaultId();
if (!currentVaultId) {
  return { success: false, error: 'No vault is currently active.' };
}
```

### 6.2 Auth-Sensitive Handlers

Handler yang memerlukan master key atau decryption:

```typescript
const key = getMasterKey();
if (!key) {
  return { success: false, error: 'Vault is locked.' };
}
```

### 6.3 Vault-Management Handlers

Handler yang tidak perlu vault aktif (list vaults, create vault, delete vault, recovery):

- Boleh dipanggil dari lock screen — tidak perlu unlocked vault.
- Operasi pada vault yang sedang aktif (e.g. delete vault aktif) harus memanggil `lockCurrentVault()` dulu.

---

## 7. Auto-Lock & Race Condition Handling

### 7.1 Auto-Lock Timer Reset

`useAutoLock` hook di renderer:
- Reset timer saat ada aktivitas user (mouse, keyboard, scroll)
- Reset timer saat vault berubah (`activeVaultId` change effect)
- Lock otomatis saat tab/window hidden lebih dari auto-lock timeout
- Lock otomatis pada event OS lock/suspend

### 7.2 Race Condition: Lock + Operasi Data

Skenario yang harus ditangani:

```
T0: User klik "Delete Item"
T1: Renderer kirim IPC ITEM_DELETE
T2: Auto-lock trigger (timer habis)
T3: Main lock vault (close DB, wipe keys)
T4: Main terima IPC ITEM_DELETE → db sudah closed!
```

**Perlindungan**:
1. Handler ITEM_DELETE memanggil `getDatabase()` → `assertActiveDatabaseOpen()` → melempar `DatabaseNotOpenError`
2. Error dikembalikan ke renderer sebagai failure
3. Renderer menampilkan toast "Operation failed — vault was locked"
4. UI state di-refresh untuk mencerminkan status locked

### 7.3 Concurrent Switch + Auto-Lock

Skenario:

```
T0: User pilih vault lain
T1: Renderer kirim VAULT_SELECT
T2: Auto-lock trigger untuk vault lama (timer habis)
```

**Perlindungan**:
- `lockCurrentVault()` idempotent — jika DB sudah ditutup oleh auto-lock, closeDatabase() menjadi no-op
- `unlockVault()` selalu dimulai dengan state "no vault open" karena lock sudah terjadi
- `resetAllVaultStores()` wiper renderer data sebelum IPC sehingga data lama tidak tersisa

---

## 8. Testing Connection Scoping

### 8.1 Unit Tests Wajib

File test yang sudah ada dan harus tetap hijau:

| Test File | Apa yang Diverifikasi |
|-----------|----------------------|
| `tests/unit/database/connectionMultiVault.test.ts` | Open/close/switch DB antar vault, `getActiveVaultId()` mengikuti vault yang dibuka |
| `tests/unit/database/migrationPerVault.test.ts` | Migrasi berjalan per file DB, schema version tersimpan per vault |
| `tests/integration/vaultIsolation.test.ts` | Item dari vault A tidak muncul di query vault B |
| `tests/integration/vaultIpcIntegration.test.ts` | Create → unlock → switch → delete flow bekerja end-to-end |
| `tests/integration/securityRegression.test.ts` | Key material vault lama tidak dipakai setelah switch |

### 8.2 Bagaimana Menulis Test Baru yang Aman

Jika menambahkan repository baru atau handler baru:

```typescript
// Pattern yang benar untuk test vault-aware operation
beforeEach(() => {
  // Pastikan state bersih
  if (isDatabaseOpen()) closeDatabase();
  clearKeys();
});

it('should scope query to active vault', () => {
  // Setup vault A
  openDatabaseForVault('vault-a');
  runQuery('INSERT INTO items ...');
  saveDatabase();
  closeDatabase();

  // Setup vault B
  openDatabaseForVault('vault-b');
  // Vault B harus kosong meski vault A punya data
  const count = runQuery('SELECT COUNT(*) FROM items');
  expect(count).toBe(0);
});
```

---

## 9. Developer Checklist untuk Operasi Baru

Sebelum merge fitur yang menyentuh database atau repository:

- [ ] Apakah operasi memanggil `getDatabase()` atau `assertActiveDatabaseOpen()`?
- [ ] Apakah prepared statement digunakan (tidak string concatenation)?
- [ ] Apakah ada fallback jika `getMasterKey()` mengembalikan null?
- [ ] Apakah test mencakup skenario "vault locked saat operasi berjalan"?
- [ ] Apakah test mencakup skenario "switch vault lalu query tidak bocor"?
- [ ] Apakah handler memeriksa `isDatabaseOpen()` sebelum query?
- [ ] Apakah attachment/cover path divalidasi dengan `isPathWithinDirectory()`?
- [ ] Apakah auto-lock timer di-reset jika operasi bersifat panjang (import, export)?
