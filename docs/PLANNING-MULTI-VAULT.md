# Planning: Multi-Vault Support

> Dokumen ini berisi rencana implementasi lengkap, terstruktur, dan detail untuk fitur Multi-Vault Support di SecurePass Manager.

---

## Overview Fitur

Multi-Vault Support memungkinkan pengguna membuat, membuka, dan berpindah antar beberapa vault terpisah dalam satu aplikasi, misalnya `Personal`, `Work`, atau `Family`.

Fitur ini harus menjaga isolasi data antar vault. Item, folder, tag, attachment, metadata, dan status unlock tidak boleh tercampur antar vault, sementara pengalaman pengguna tetap sederhana dan cepat.

**Tujuan Utama**:

1. Memisahkan konteks data pengguna tanpa perlu install aplikasi terpisah.
2. Mendukung file database berbeda seperti `vault-personal.db` dan `vault-work.db`.
3. Menjaga keamanan tiap vault dengan master password, key material, dan session state yang terisolasi.
4. Membuat switch vault terasa natural dari Lock Screen dan Main App.

**Prinsip Keamanan**:

- Vault aktif harus menjadi scope eksplisit untuk semua operasi database dan IPC.
- Switching vault harus mengunci vault saat ini, membersihkan key material dari memory, lalu membuka vault target.
- Metadata vault boleh disimpan terpisah dari isi terenkripsi, tetapi tidak boleh membocorkan item, folder, URL, username, atau notes.
- File path vault harus divalidasi dan tidak boleh memungkinkan path traversal atau akses file arbitrer.

---

## 1. Task: Desain Model Vault Registry

- [x] Task 1 Complete

### Sub-Task 1.1: Definisikan Vault Registry

- [x] Buat registry lokal yang menyimpan daftar vault yang dikenal aplikasi.
- [x] Field minimum: `id`, `name`, `databasePath`, `createdAt`, `lastOpenedAt`, `lastOpenedVersion`.
- [x] Tambahkan field opsional: `description`, `color`, `icon`, `isDefault`, `sortOrder`.
- [x] Simpan registry di lokasi app config, bukan di dalam salah satu vault database.

### Sub-Task 1.2: Validasi Nama dan Metadata Vault

- [x] Nama vault wajib diisi, trim whitespace, dan maksimum 100 karakter.
- [x] Nama vault harus unik secara case-insensitive setelah Unicode normalization.
- [x] Tolak karakter kontrol dan nama yang berpotensi membingungkan seperti `.` atau `..`.
- [x] Jangan simpan master password, encryption key, atau derived key dalam registry.

### Sub-Task 1.3: Strategi ID dan File Path

- [x] Gunakan UUID sebagai `vaultId` stabil, bukan nama vault.
- [x] Generate filename aman dari `vaultId`, misalnya `vault-{uuid}.db`.
- [x] Pisahkan display name dari physical filename agar rename vault tidak memindahkan file.
- [x] Pastikan semua file vault berada di directory yang dikelola aplikasi kecuali user memilih custom location secara eksplisit.

---

## 2. Task: Storage dan Database Multi-File

- [x] Task 2 Complete

### Sub-Task 2.1: Update Storage Manager

- [x] Ubah `storageManager` agar bisa resolve path berdasarkan `vaultId`.
- [x] Tambahkan API untuk membuat, membaca, rename metadata, menghapus, dan memvalidasi vault.
- [x] Pastikan path hasil resolve selalu berada di directory vault yang diizinkan.
- [x] Tambahkan migration path dari single-vault lama ke registry default vault.

### Sub-Task 2.2: Update Database Connection Layer

- [x] Ubah `connection.ts` agar connection aktif mengikuti vault yang sedang dibuka.
- [x] Pastikan repository (`ItemRepository`, `FolderRepository`, `TagRepository`, `TrashRepository`, attachment repository) tidak memegang connection stale setelah switch vault.
- [x] Tutup connection vault lama sebelum membuka connection vault baru.
- [x] Tambahkan guard agar operasi database gagal jelas jika tidak ada vault aktif.

### Sub-Task 2.3: Migration per Vault

- [x] Jalankan `migrations.ts` per file database vault, bukan sekali global.
- [x] Simpan schema version di masing-masing database vault.
- [x] Saat vault lama dibuka, jalankan migration hanya setelah auth berhasil.
- [x] Jika migration gagal, jangan ubah active vault state dan tampilkan error yang bisa dipahami.

### Sub-Task 2.4: Attachment dan Cover Image Scope

- [x] Scope attachment storage berdasarkan `vaultId`.
- [x] Scope cover image storage berdasarkan `vaultId`.
- [x] Pastikan delete vault juga menawarkan opsi menghapus file attachment terkait.
- [x] Cegah collision nama file attachment antar vault.

---

## 3. Task: Auth dan Session State Multi-Vault

- [x] Task 3 Complete

### Sub-Task 3.1: Auth Metadata per Vault

- [x] Tentukan apakah auth metadata disimpan per vault atau shared registry dengan pointer ke vault.
- [x] Rekomendasi awal: master password dan salt per vault agar vault benar-benar independen.
- [x] Simpan KDF params, salt, verifier, dan encryption metadata per vault.
- [x] Pastikan reset atau delete satu vault tidak memengaruhi vault lain.

### Sub-Task 3.2: Update IPC Auth Handlers

- [x] Update `authHandlers` agar `initApp`, `unlock`, `lock`, dan `checkAuth` menerima atau mengembalikan konteks `vaultId`.
- [x] Tambahkan IPC untuk `listVaults`, `createVault`, `selectVault`, `renameVault`, `deleteVault`, dan `getActiveVault`.
- [x] Semua handler item/folder/search/export/import harus membaca active vault dari session yang sudah tervalidasi.
- [x] Jangan izinkan operasi data jika vault target belum unlocked.

### Sub-Task 3.3: Secure Memory Saat Switch Vault

- [x] Saat switch vault, panggil lock flow untuk vault aktif sebelum membuka vault target.
- [x] Wipe key material, cached derived key, dan sensitive state dari memory.
- [x] Reset store renderer yang memuat item, folder, search results, selected item, dan UI state vault-specific.
- [x] Tampilkan toast security setelah vault lama terkunci dan vault baru siap dibuka.

### Sub-Task 3.4: Auto-Lock per Active Vault

- [x] Pastikan `useAutoLock` mengunci vault aktif, bukan asumsi single global vault.
- [x] Reset timer auto-lock saat active vault berubah.
- [x] Jangan membawa status idle vault lama ke vault baru.
- [x] Test edge case saat auto-lock terjadi bersamaan dengan switch vault.

---

## 4. Task: State Management Renderer

- [x] Task 4 Complete

### Sub-Task 4.1: Update Auth Store

- [x] Tambahkan state `vaults`, `activeVaultId`, `activeVaultName`, dan `selectedVaultId`.
- [x] Bedakan status `setup`, `locked`, dan `unlocked` berdasarkan vault yang dipilih.
- [x] Update action `checkAuth`, `initApp`, `unlock`, `lock`, dan `clearError` agar sadar konteks vault.
- [x] Handle migration single-vault lama sebagai default vault di store.

### Sub-Task 4.2: Reset Store Saat Switch

- [x] Tambahkan helper reset untuk `itemStore`, `folderStore`, `uiStore`, dan store lain yang menyimpan data vault-specific.
- [x] Jalankan reset setelah lock vault lama dan sebelum load vault baru.
- [x] Pastikan selected folder/item tidak menunjuk ID dari vault lama.
- [x] Bersihkan cache search dan password health saat vault berubah.

### Sub-Task 4.3: Error dan Loading State

- [x] Tambahkan loading state untuk create vault, list vaults, switch vault, dan delete vault.
- [x] Error harus menyebut vault target jika relevan.
- [x] Jangan tampilkan item kosong sebagai sukses jika sebenarnya load vault gagal.
- [x] Capture error tetap masuk ke `errorStore` dengan context seperti `vaultStore` atau `authStore`.

---

## 5. Task: UI Lock Screen dan Main App

- [ ] Task 5 Complete

### Sub-Task 5.1: Vault Selector di Lock Screen

- [ ] Tampilkan dropdown atau segmented selector untuk memilih vault sebelum unlock.
- [ ] Jika belum ada vault, tampilkan setup flow untuk membuat vault pertama.
- [ ] Tambahkan tombol "Create Vault" dan "Import Existing Vault" dari Lock Screen.
- [ ] Tampilkan metadata aman seperti nama vault dan terakhir dibuka, tanpa preview isi.

### Sub-Task 5.2: Vault Switcher di Main App

- [ ] Tambahkan vault switcher di sidebar atau title area Main App.
- [ ] Saat user memilih vault lain, tampilkan confirm dialog bahwa vault saat ini akan dikunci.
- [ ] Setelah confirm, lock vault aktif dan arahkan ke Lock Screen vault target.
- [ ] Tampilkan active vault secara jelas agar user tidak salah memasukkan data ke vault yang berbeda.

### Sub-Task 5.3: Vault Management Dialog

- [ ] UI untuk rename vault, set default vault, reveal file location, dan delete vault.
- [ ] Delete vault harus membutuhkan konfirmasi eksplisit dengan nama vault.
- [ ] Jika vault sedang aktif, delete harus memaksa lock dan wipe memory sebelum file dihapus.
- [ ] Tampilkan warning bahwa delete vault tidak bisa dibatalkan kecuali user punya backup/export.

### Sub-Task 5.4: Localization dan Accessibility

- [ ] Semua string UI vault memakai i18n keys di `en.json` dan `id.json`.
- [ ] Vault selector harus bisa digunakan dengan keyboard.
- [ ] Error dan status switch vault diumumkan dengan `aria-live`.
- [ ] Confirm dialog harus trap focus dan mengembalikan focus ke trigger setelah ditutup.

---

## 6. Task: Import, Export, dan Backup Multi-Vault

- [ ] Task 6 Complete

### Sub-Task 6.1: Import ke Vault Aktif

- [ ] Import data selalu masuk ke vault aktif yang unlocked.
- [ ] Dialog import harus menampilkan nama vault target sebelum commit.
- [ ] Prevent import jika tidak ada vault aktif atau vault belum unlocked.
- [ ] Duplicate detection hanya membandingkan data dalam vault target.

### Sub-Task 6.2: Export dari Vault Aktif

- [ ] Export data hanya mengambil isi vault aktif.
- [ ] Metadata export menyertakan `sourceVaultId` dan `sourceVaultName` jika aman.
- [ ] Plain text export warning harus menyebut vault yang sedang diekspor.
- [ ] Encrypted export tetap memakai key vault aktif.

### Sub-Task 6.3: Backup dan Restore Vault File

- [ ] Tambahkan opsi backup seluruh vault file terenkripsi tanpa decrypt isi.
- [ ] Restore vault file harus memvalidasi format database dan auth metadata sebelum masuk registry.
- [ ] Jika restore vault punya nama sama, tawarkan rename.
- [ ] Jangan overwrite vault existing tanpa konfirmasi eksplisit.

---

## 7. Task: Testing & Quality Assurance

- [ ] Task 7 Complete

### Sub-Task 7.1: Unit Tests Storage dan Registry

- [ ] Test create/list/rename/delete vault registry.
- [ ] Test validasi nama vault, duplicate name, dan Unicode normalization.
- [ ] Test path resolver menolak path traversal.
- [ ] Test migration single-vault ke default vault.

### Sub-Task 7.2: Integration Tests IPC

- [ ] Test create vault lalu unlock vault tersebut.
- [ ] Test switch vault menutup connection lama dan membuka connection baru.
- [ ] Test handler item/folder tidak bisa berjalan tanpa vault unlocked.
- [ ] Test delete vault menghapus registry entry dan file sesuai opsi user.

### Sub-Task 7.3: Isolation Tests

- [ ] Buat dua vault dengan item berbeda, lalu pastikan query vault A tidak pernah mengembalikan data vault B.
- [ ] Test folder ID yang sama di dua vault tidak menyebabkan collision di UI.
- [ ] Test search, password health, trash, attachment, dan export tetap scoped ke vault aktif.
- [ ] Test store reset setelah switch vault.

### Sub-Task 7.4: Security Regression Tests

- [ ] Test key material vault lama tidak dipakai setelah switch vault.
- [ ] Test auto-lock saat switch vault tidak meninggalkan status unlocked palsu.
- [ ] Test file path malicious pada import existing vault.
- [ ] Test delete active vault membersihkan memory dan menutup DB connection sebelum file operation.

### Sub-Task 7.5: UX Regression Tests

- [ ] Test Lock Screen saat tidak ada vault, satu vault, dan banyak vault.
- [ ] Test keyboard navigation di vault selector dan management dialog.
- [ ] Test error flow saat vault file hilang atau corrupt.
- [ ] Test i18n untuk Bahasa Inggris dan Bahasa Indonesia.

---

## 8. Task: Rollout dan Backward Compatibility

- [ ] Task 8 Complete

### Sub-Task 8.1: Single-Vault Migration

- [ ] Saat aplikasi lama dibuka, detect database existing dan buat registry dengan satu default vault.
- [ ] Nama default awal bisa `Personal Vault` atau `Default Vault`.
- [ ] Jangan memindahkan file database lama sebelum backup atau validasi path sukses.
- [ ] Simpan marker migration agar proses tidak diulang.

### Sub-Task 8.2: Failure Recovery

- [ ] Jika registry rusak, tawarkan recovery dengan scan directory vault.
- [ ] Jika vault file hilang, tampilkan status missing dan opsi remove from registry.
- [ ] Jika migration partial gagal, rollback registry update.
- [ ] Log error teknis tanpa membocorkan data sensitif.

### Sub-Task 8.3: Documentation Internal

- [ ] Update `PLANNING-ROADMAP.md` status jika fitur selesai.
- [ ] Dokumentasikan struktur registry dan lifecycle switch vault.
- [ ] Tambahkan developer notes untuk repository/database connection scoping.
- [ ] Tambahkan manual QA checklist untuk release build.

---

## Summary Checklist Implementasi

- [x] Sub-Task 1.1: Vault Registry
- [x] Sub-Task 1.2: Validasi Nama dan Metadata Vault
- [x] Sub-Task 1.3: Strategi ID dan File Path
- [x] Sub-Task 2.1: Update Storage Manager
- [x] Sub-Task 2.2: Update Database Connection Layer
- [x] Sub-Task 2.3: Migration per Vault
- [x] Sub-Task 2.4: Attachment dan Cover Image Scope
- [x] Sub-Task 3.1: Auth Metadata per Vault
- [x] Sub-Task 3.2: Update IPC Auth Handlers
- [x] Sub-Task 3.3: Secure Memory Saat Switch Vault
- [x] Sub-Task 3.4: Auto-Lock per Active Vault
- [x] Sub-Task 4.1: Update Auth Store
- [x] Sub-Task 4.2: Reset Store Saat Switch
- [x] Sub-Task 4.3: Error dan Loading State
- [ ] Sub-Task 5.1: Vault Selector di Lock Screen
- [ ] Sub-Task 5.2: Vault Switcher di Main App
- [ ] Sub-Task 5.3: Vault Management Dialog
- [ ] Sub-Task 5.4: Localization dan Accessibility
- [ ] Sub-Task 6.1: Import ke Vault Aktif
- [ ] Sub-Task 6.2: Export dari Vault Aktif
- [ ] Sub-Task 6.3: Backup dan Restore Vault File
- [ ] Sub-Task 7.1-7.5: Unit, Integration, Isolation, Security, dan UX Tests
- [ ] Sub-Task 8.1: Single-Vault Migration
- [ ] Sub-Task 8.2: Failure Recovery
- [ ] Sub-Task 8.3: Documentation Internal
