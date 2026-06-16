# Planning: Import / Export Data

> Dokumen ini berisi rencana implementasi lengkap, terstruktur, dan detail untuk fitur Import/Export di SecurePass Manager.

---

## Overview Fitur

Pengguna SecurePass Manager harus dapat melakukan migrasi data masuk dan keluar dari aplikasi ini dengan mudah dan **aman**.

**Tujuan Utama**:
1. Menurunkan barrier adopsi: Pengguna KeePass/1Password/Bitwarden bisa pindah tanpa drama.
2. Memberikan rasa aman: Pengguna bisa ekspor data mereka kapan saja.
3. Memberikan rasa kontrol penuh atas data pribadi (zero-knowledge berarti pengguna harus bisa hold their own data).

**Prinsip Keamanan**:
- Data ekspor ke CSV/JSON plain text harus selalu melalui dialog konfirmasi eksplisit yang menceritakan risiko.
- Data ekspor terenkripsi harus menggunakan kunci yang sama derguna dengan vault (sehingga hanya SecurePass Manager pengguna yang bisa membacanya kembali).
- Data impor yang tidak dienkripsi harus langsung masuk ke vault dan dihapus dari file sumber setelah impor jika memungkinkan (tergantung user consent).

---

## 1. Task: Design Format Internal
- [x] Task 1 Complete

### Sub-Task 1.1: Definisikan JSON Schema untuk Export Terenkripsi
- [x] Buat schema JSON yang mendefinisikan struktur vault (metadata, folders, items, tags, attachments).
- [x] Tambahkan field versioning (`formatVersion`) untuk kemampuan migrasi format masa depan.

### Sub-Task 1.2: Definisikan Plain Text Export Format
- [x] **CSV**: Kolom `title`, `username`, `password`, `url`, `notes`, `tags`.
- [x] **JSON Plain**: Array of objects sama seperti CSV tapi nested untuk notes rich text.

### Sub-Task 1.3: UUID Mapping
- [x] Pastikan ID internal (UUID) tetap konsisten saat import/export agar tidak terjadi duplikat jika import kembali ke vault lain.

---

## 2. Task: Implementasi Import Layer
- [ ] Task 2 Complete

### Sub-Task 2.1: UI Import Dialog
- [x] Tombol "Import Data" di halaman Lock Screen atau di Settings.
- [x] Dialog untuk memilih format importer (KeePass XML, Bitwarden JSON, 1Password CSV, Generic CSV).
- [x] File picker untuk memilih file.
- [x] Validasi file extension dan MIME type sebelum parsing.

### Sub-Task 2.2: Parser & Transformer Umum
- [x] Buat interface `Importer` dan factory `ImporterFactory` yang mengembalikan instance parser yang sesuai.
- [x] Semua parser harus menghasilkan struktur internal yang sama: `ImportPayload { folders[], items[], tags[] }`.

### Sub-Task 2.3: Implementasi Parser KeePass XML
- [x] Parse `.kdbx` atau ekspor ke `.xml`. Acuan: KeePass XML schema.
- [x] Mapping struktur hierarki folder (Groups) ke SecurePass Manager.
- [x] Handle custom fields KeePass yang tidak punya padanan exact (masukkan ke field notes atau buat structured fields).

### Sub-Task 2.4: Implementasi Parser Bitwarden JSON
- [x] Parse file `.json` Bitwarden.
- [x] Mapping folder (Collections) ke SecurePass Manager.
- [x] Extract TOTP seeds jika ada (dan simpan untuk Rank 5).

### Sub-Task 2.5: Implementasi Parser 1Password CSV
- [x] Parse `.csv` 1Password (standar kolom 1Password biasanya: `title`, `username`, `password`, `url`, `notes`, `tags`).
- [x] Handle field `tags` yang bisa jadi multiple (comma-separated).

### Sub-Task 2.6: Generic CSV Parser
- [x] User memberikan file CSV dengan header apapun.
- [x] UI Pre-mapping: User melakukan drag-and-drop / map kolom mereka ke field SecurePass Manager sebelum import.

### Sub-Task 2.7: Handling Duplikat & Merge
- [x] Detect duplikat berdasarkan kombinasi `title` + `url`.
- [x] Pilihan user: Skip, Replace, atau Rename (append suffix).
- [x] Tampilkan preview sebelum commit import.

### Sub-Task 2.8: Encrypted JSON Import
- [ ] Parse JSON schema internal (Task 1.1).
- [ ] Dekripsi jika ada lapisan enkripsi tambahan.

---

## 3. Task: Implementasi Export Layer
- [ ] Task 3 Complete

### Sub-Task 3.1: UI Export Dialog
- [ ] Tombol "Export Data" di halaman Settings.
- [ ] Pilihan format: Encrypted JSON (default!), JSON Plain, CSV.
- [ ] Tampilkan **Security Warning** besar berwarna merah/kuning sebelum export ke format plain text.

### Sub-Task 3.2: Export ke Encrypted JSON (Default)
- [ ] Serialize vault internal ke JSON.
- [ ] Enkripsi seluruh JSON menggunakan kunci vault aktif (AES-256-GCM). Lini produk data sama dengan vault.
- [ ] Generate `.json.encr` atau file khusus dengan extension `.spm` (SecurePass Manager).
- [ ] Simpan metadata: `exportedAt`, `formatVersion`, `appVersion`.

### Sub-Task 3.3: Export ke JSON Plain Text
- [ ] Serialize vault internal ke JSON tanpa enkripsi.
- [ ] Warning yang eksplisit: "Data Anda akan tersimpan tanpa enkripsi..."
- [ ] Field `password` langsung ada sebagai plain text.
- [ ] Simpan ke `.json`.

### Sub-Task 3.4: Export ke CSV Plain Text
- [ ] Serialize vault internal ke CSV.
- [ ] Warning keamanan yang sama seperti JSON plain text.
- [ ] Handle kolom `notes` dengan escaping jika ada newline atau koma.
- [ ] Simpan ke `.csv`.

### Sub-Task 3.5: Progress Indikator
- [ ] Untuk vault dengan ribuan item, tampilkan progress bar sederhana karena serialization/decryption mungkin membutuhkan waktu > 100ms.

---

## 4. Task: Testing & Quality Assurance
- [ ] Task 4 Complete

### Sub-Task 4.1: Unit Tests untuk Parser
- [ ] Test fixture file berbagai format (KeePass XML, Bitwarden JSON, 1Password CSV).
- [ ] Assert setiap item yang tergenerasi sudah memiliki field wajib.
- [ ] Assert error handling jika file corrupt atau tidak sesuai format.

### Sub-Task 4.2: Integration Tests (IPC)
- [ ] Simulasi file select → parse → insert ke DB melalui IPC handlers.
- [ ] Assert integritas relasional (folder tidak duplikat, items terhubung ke folder yang benar).

### Sub-Task 4.3: Round Trip Test
- [ ] Export ke Encrypted JSON → Import kembali → Assert data asli sama persis (bandingkan hash atau deep equal).

### Sub-Task 4.4: Security Tests
- [ ] Import file CSV dengan XSS payload di kolom `title`: Harus idsanitasi sebelum masuk ke RichText/DB.
- [ ] Import file XML dengan external entity: Harus menghandle dengan aman (disable DTD).

---

## 5. Task: UX Polish & Error Handling
- [ ] Task 5 Complete

### Sub-Task 5.1: Feedback Visual
- [ ] Toast notification "Successfully imported 10 items" atau "Exported to /path/file.spm".
- [ ] Error feedback jika file tidak dikenali: "Unsupported file format. Please verify..."

### Sub-Task 5.2: Localization (I18n Ready)
- [ ] Semua string di UI Import/Export harus berasal dari keys file bahasa. Jangan hard-code Bahasa Inggris di dalam komponen, agar nantinya mudah diterjemahkan ke Bahasa Indonesia atau lainnya.

### Sub-Task 5.3: Drag & Drop Import
- [ ] User bisa drag file CSV/JSON/XML dari File Explorer ke area zona khusus di Lock Screen untuk memulai import.

---

## Summary Checklist Implementasi
- [x] Sub-Task 1.1: JSON Schema Export
- [x] Sub-Task 1.2: Plain Text Format Specs
- [x] Sub-Task 1.3: UUID Mapping Strategy
- [x] Sub-Task 2.1: UI Import Dialog
- [x] Sub-Task 2.2: Importer Factory
- [x] Sub-Task 2.3: KeePass XML Parser
- [x] Sub-Task 2.4: Bitwarden JSON Parser
- [x] Sub-Task 2.5: 1Password CSV Parser
- [x] Sub-Task 2.6: Generic CSV Parser + Mapper
- [x] Sub-Task 2.7: Duplicate Handling
- [ ] Sub-Task 2.8: Encrypted JSON Import
- [ ] Sub-Task 3.1: UI Export Dialog
- [ ] Sub-Task 3.2: Encrypted JSON Export
- [ ] Sub-Task 3.3: JSON Plain Export
- [ ] Sub-Task 3.4: CSV Plain Export
- [ ] Sub-Task 3.5: Progress Bar
- [ ] Sub-Task 4.1-4.4: Tests
- [ ] Sub-Task 5.1-5.3: UX Polish
