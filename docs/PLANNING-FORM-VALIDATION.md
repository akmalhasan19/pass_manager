# Planning: Form Validation & Edge Cases

> Dokumen ini berisi rencana implementasi lengkap, terstruktur, dan detail untuk memperketat validasi form dan menangani edge cases di seluruh SecurePass Manager.

---

## Overview Fitur

Validasi form dan penanganan edge cases adalah fondasi stabilitas aplikasi. Tanpa validasi yang ketat, pengguna bisa secara tidak sengaja merusak data, menimbulkan bug, atau bahkan mengeksploitasi celah keamanan melalui input yang tidak disaring.

**Tujuan Utama**:
1. Mencegah kehilangan data akibat input yang tidak valid atau terlalu panjang.
2. Menutup celah XSS (Cross-Site Scripting) melalui sanitasi input di seluruh UI.
3. Melindungi database dari injection melalui escaping dan parameterized queries.
4. Memberikan pengalaman pengguna yang mulus dengan feedback error yang jelas dan informatif.

**Prinsip Keamanan**:
- **Never trust user input**: Semua input dari pengguna harus divalidasi sebelum diproses.
- **Defense in depth**: Validasi di frontend (UX) AND backend (security) — jangan mengandalkan satu layer saja.
- **Fail fast, fail safe**: Jika input tidak valid, gagal segera dengan pesan error yang jelas, jangan biarkan data corrupt masuk ke sistem.

---

## 1. Task: Validasi Input Dasar
- [x] Task 1 Complete

### Sub-Task 1.1: Pembatasan Panjang Maksimum
- [x] Definisikan batas karakter untuk setiap field berdasarkan use case dan batas database.
- [x] **Folder Name**: Maksimum 100 karakter.
- [x] **Item Title**: Maksimum 255 karakter.
- [x] **Username**: Maksimum 500 karakter (email bisa sangat panjang).
- [x] **Password**: Maksimum 4096 karakter (support passphrase panjang).
- [x] **URL**: Maksimum 2048 karakter (batas praktis browser).
- [x] **Notes / Rich Text**: Maksimum 100,000 karakter (~100KB) untuk mencegah abuse storage.
- [x] **Tags**: Maksimum 50 karakter per tag, maksimum 10 tags per item.
- [x] Tampilkan pesan error real-time: "Maximum X characters allowed."

### Sub-Task 1.2: Validasi Format
- [x] **Email/Username**: Validasi format email opsional (banyak pengguna menggunakan username arbitrer, jangan terlalu ketat).
- [x] **URL**: Validasi format URL valid (protocol http/https). Tampilkan warning jika URL tidak valid, tapi tetap izinkan simpan (user bisa pakai URL internal).
- [x] **Required Fields**: title (item), name (folder) tidak boleh kosong atau whitespace-only.
- [x] **Whitespace Handling**: Trim leading/trailing whitespace secara otomatis sebelum validasi.

### Sub-Task 1.3: Validasi Karakter yang Diizinkan
- [x] Izinkan Unicode/Emoji untuk nama folder dan item (pengguna internasional perlu ini).
- [x] Blok karakter kontrol ASCII non-printable (`\x00` - `\x1F`) kecuali newline/tab untuk notes.
- [x] Untuk field teknis seperti username: perbolehkan semua karakter printable Unicode.
- [x] Untuk field URL: encode/decode URI components dengan benar.

---

## 2. Task: Duplikat Detection
- [ ] Task 2 Complete

### Sub-Task 2.1: Cek Duplikat di Database Level
- [x] Query database case-insensitive untuk nama folder/item dalam vault yang sama.
- [x] **Folder**: Nama folder harus unik dalam satu vault (case-insensitive).
- [x] **Item**: Duplikat title di folder yang sama harus ditangani (warning atau append counter).
- [x] Untuk rename: cek duplikat sebelum commit transaction.

### Sub-Task 2.2: UX untuk Konflik Duplikat
- [x] Saat rename folder/item: tampilkan error inline "A folder with this name already exists."
- [x] Saat create baru: auto-suggest nama alternatif (misal: "Work (2)") atau blok create.
- [x] Saat import: tampilkan dialog pilihan — Skip, Replace, atau Keep Both (sesuai PLANNING-IMPORT-EXPORT.md).

### Sub-Task 2.3: Edge Cases Duplikat
- [x] Handle perbedaan casing: "Work" vs "work" dianggap sama (case-insensitive).
- [x] Handle whitespace-only differences: "Work " vs "Work" di-trim dulu sebelum compare.
- [x] Handle Unicode normalization: "Café" (e+combining accent) dan "Café" (é precomposed) dianggap sama setelah NFC normalization.

---

## 3. Task: Sanitasi & Keamanan Input
- [x] Task 3 Complete

### Sub-Task 3.1: XSS Prevention di Teks Biasa
- [x] Escape atau strip HTML tags di field yang bukan rich text (title, username, URL plaintext).
- [x] Gunakan `textContent` atau equivalent alih-alih `innerHTML` saat rendering user data.
- [x] Validasi bahwa `<`, `>`, `&`, `"`, `'` di-escape sebelum ditampilkan.

### Sub-Task 3.2: XSS Prevention di Rich Text Editor
- [x] Integrasi DOMPurify sebelum menyimpan rich text notes ke database.
- [x] Konfigurasi whitelist tags/attributes yang diizinkan (hanya basic formatting: `p`, `b`, `i`, `u`, `ol`, `ul`, `li`, `blockquote`, `code`, `pre`).
- [x] Strip event handlers (`onclick`, `onerror`, dll.) meskipun di tag yang diizinkan.
- [x] Strip `javascript:` dan `data:` URLs dari atribut apapun.
- [x] Verifikasi bahwa DOMPurify bekerja pada saat render (default) dan saat paste dari clipboard.

### Sub-Task 3.3: SQL Injection Prevention
- [x] **Audit semua query**: Pastikan seluruh query menggunakan parameterized statements (`?` placeholders).
- [x] **Never concatenate user input ke SQL string** — lint rule atau code review checklist.
- [x] Escape karakter khusus SQL seperti backslash jika ada raw query edge cases.
- [x] Validasi input integer (IDs) sebelum digunakan dalam query.

### Sub-Task 3.4: Path Traversal & File Upload Security
- [x] Jika ada file operations (attachment, export): sanitize path, reject `..` sequences.
- [x] Validasi file extension whitelist saat memproses drag & drop upload.
- [x] Limit file size untuk upload (jika ada attachment feature di masa depan).

---

## 4. Task: Rich Text Editor Edge Cases
- [ ] Task 4 Complete

### Sub-Task 4.1: Paste Handling
- [x] Sanitize content dari clipboard menggunakan DOMPurify sebelum dimasukkan ke editor.
- [x] Strip formatting tidak diinginkan (misal: styles, classes, fonts) saat paste.
- [x] Handle paste dari Microsoft Word / Google Docs (mengandung banyak inline styles) — strip atau convert ke plain semantic HTML.
- [x] Mode "Paste as Plain Text" sebagai fallback (toolbar button atau Ctrl+Shift+V).

### Sub-Task 4.2: Malformed DOM Handling
- [ ] Handle unclosed tags, nested incorrectly tags — let browser/DOMPurify cleanup.
- [ ] Handle paste dari extension formatter (Grammarly, LanguageTool) yang bisa memodifikasi DOM secara tidak terduga.
- [ ] Test dengan extreme long text (100KB+) di editor: pastikan tidak crash atau freeze UI.

### Sub-Task 4.3: Auto-Save Edge Cases
- [ ] Jangan auto-save jika content setelah sanitasi menjadi kosong (hapus semua teks → save kosong, bukan tidak save).
- [ ] Debounce auto-save untuk menghindari race condition saat typing cepat.
- [ ] Handle kasus perangkat low memory / slow: batalkan auto-save jika previous save masih pending.

---

## 5. Task: Testing & Quality Assurance
- [ ] Task 5 Complete

### Sub-Task 5.1: Unit Tests untuk Validasi
- [ ] Test setiap rules panjang maksimum (boundary: exactly max, max+1, 0, whitespace-only).
-ZB- Test format email/URL valid dan invalid.
- [ ] Test duplikat logic dengan berbagai casing dan Unicode normalization.

### Sub-Task 5.2: XSS Injection Tests
- [ ] Test fixtures berisi payload XSS common:
  ```html
  <script>alert('xss')</script>
  <img src=x onerror=alert('xss')>
  javascript:alert('xss')
  <iframe src="evil.com">
  ```
- [ ] Assert output setelah sanitasi tidak mengandung JavaScript executable.
- [ ] Assert rendering di UI tidak mengeksekusi script (DOM testing).

### Sub-Task 5.3: SQL Injection Tests
- [ ] Test input dengan payload SQLi seperti `' OR '1'='1`, `'; DROP TABLE items; --`, `1; DELETE FROM items`.
- [ ] Assert query parameterized — database tidak terpengaruh (gunakan mock/spy pada query builder).

### Sub-Task 5.4: Edge Case Regression Tests
- [ ] **Unicode extremes**: Test dengan emoji sequences (👨‍👩‍👧‍👦 — 7 code points, 1 grapheme), RTL text (Arabic, Hebrew), combining characters.
- [ ] **Extreme length**: Test 100KB notes, 4096 char passwords, nested tags berjauhan.
- [ ] **Memory stress**: Rapid create/edit/delete operations dalam loop — monitor memory leak.

---

## 6. Task: UX Polish & Error Handling
- [ ] Task 6 Complete

### Sub-Task 6.1: Error Feedback Visual
- [ ] Inline validation dengan border merah dan pesan error di bawah field.
- [ ] Error message harus spesifik: "Folder name is required" bukan "Error occurred."
- [ ] Disable submit button sampai semua field valid.
- [ ] Show character counter ketika mendekati limit (misal: "245/255").

### Sub-Task 6.2: Localization (I18n Ready)
- [ ] Semua validation messages harus berasal dari keys file bahasa.
- [ ] Format dynamic values (counts, lengths) menggunakan i18n interpolation agar grammar berbagai bahasa tetap benar.

### Sub-Task 6.3: Accessibility (A11y)
- [ ] Associate error message dengan input menggunakan `aria-describedby` dan `aria-invalid`.
- [ ] Pastikan error state diumumkan oleh screen reader (live region atau `aria-live`).
- [ ] Keyboard navigation tetap fokus saat error muncul (trap focus dalam modal/dialog).

---

## Summary Checklist Implementasi

- [x] Sub-Task 1.1: Pembatasan Panjang Maksimum Semua Field
- [x] Sub-Task 1.2: Validasi Format (Email, URL, Required, Whitespace)
- [x] Sub-Task 1.3: Validasi Karakter yang Diizinkan (Unicode, kontrol chars)
- [x] Sub-Task 2.1: Cek Duplikat di Database Level (folder, item, case-insensitive)
- [x] Sub-Task 2.2: UX untuk Konflik Duplikat (inline error, auto-suggest)
- [x] Sub-Task 2.3: Edge Cases Duplikat (casing, whitespace, Unicode normalization)
- [x] Sub-Task 3.1: XSS Prevention di Teks Biasa (escape, textContent)
- [x] Sub-Task 3.2: XSS Prevention di Rich Text Editor (DOMPurify, whitelist tags)
- [x] Sub-Task 3.3: SQL Injection Prevention (parameterized queries audit)
- [x] Sub-Task 3.4: Path Traversal & File Upload Security
- [x] Sub-Task 4.1: Paste Handling di Rich Text (clipboard sanitize, Word/GDocs)
- [ ] Sub-Task 4.2: Malformed DOM Handling (cleanup, extension interference)
- [ ] Sub-Task 4.3: Auto-Save Edge Cases (empty after sanitize, debounce, race)
- [ ] Sub-Task 5.1-5.4: Unit, XSS, SQLi, dan Regression Tests
- [ ] Sub-Task 6.1-6.3: UX Error Feedback, I18n, A11y
