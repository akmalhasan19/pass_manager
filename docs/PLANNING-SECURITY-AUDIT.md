# Planning: Security Audit (Memory Wipe)

> Dokumen ini berisi rencana implementasi lengkap, terstruktur, dan detail untuk melakukan audit keamanan memori dan memastikan penghapusan kunci dekripsi dari memory saat aplikasi lock atau di-close di SecurePass Manager.

---

## Overview Fitur

Security audit dan memory wipe adalah fondasi integritas zero-knowledge. Jika kunci dekripsi dapat *leak* atau bertahan di memory setelah aplikasi lock atau ditutup, jaminan keamanan seluruh sistem menjadi tidak bermakna.

**Tujuan Utama**:
1. Memastikan kunci dekripsi dan materi sensitif lainnya dihapus secara deterministik dari memory.
2. Mencegah *memory leak* akibat referensi variabel yang masih tertahan oleh Garbage Collector (GC).
3. Menutup celah potensial penampakan data sensitif di DevTools atau log debug.
4. Membangun kepercayaan pengguna dengan memastikan core value proposition zero-knowledge benar-benar terjaga.

**Prinsip Keamanan**:
- **Memory is a liability**: Data sensitif harus berada di memory sesingkat mungkin.
- **Deterministic wipe**: Jangan mengandalkan GC untuk menghapus data; overwrite buffer secara eksplisit dengan zero atau random bytes sebelum dispose.
- **Zero-knowledge integrity**: Kunci harus diperlakukan sebagai rahasia yang paling berharga; leak di memory sama berbahayanya dengan leak ke disk.

---

## 1. Task: Memory Buffer & ArrayBuffer Audit
- [x] Task 1 Complete

### Sub-Task 1.1: Identifikasi Semua Buffer Kunci
- [x] Audit seluruh code path yang menyimpan kunci dekripsi (AES key, master key, derived key) dalam variabel `Buffer`, `ArrayBuffer`, `Uint8Array`, atau typed arrays lainnya.
- [x] Buat daftar referensi (file, fungsi, nama variabel) yang menampung data sensitif di `main` process dan `renderer` process.
- [x] Pastikan kunci tidak disalin ke variabel sementara tanpa diperlukan (minimisasi surface area).

### Sub-Task 1.2: Implementasi Secure Overwrite
- [x] Sebelum `Buffer` atau `ArrayBuffer` di-dispose (`= null` atau out-of-scope), overwrite kontennya dengan nilai zero (`0x00`) atau random bytes.
- [x] Pastikan overwrite benar-benar tertulis ke memory (tidak dioptimasi compiler/JIT menjadi no-op). Gunakan `crypto` secure clear jika tersedia.
- [x] Lakukan overwrite untuk setiap instance buffer yang berisi kunci, termasuk buffer hasil pembacaan dari file vault atau input password.

### Sub-Task 1.3: String Kunci di Memory
- [x] Verifikasi bahwa kunci dekripsi tidak pernah di-*convert* ke `String` (terutama dari `ArrayBuffer`/`Buffer`) untuk menghindari immutable interning di V8.
- [x] Jika ada konversi string yang tidak dapat dihindari (misal untuk IPC), lakukan overwrite manual atau gunakan `Buffer.fill(0)` segera setelah penggunaan.
- [x] Audit penggunaan `.toString()` pada buffer kunci dan ganti dengan metode aman jika memungkinkan.

---

## 2. Task: Garbage Collector Reference Audit
- [x] Task 2 Complete

### Sub-Task 2.1: Verifikasi Referensi Kunci Tidak Bertahan
- [x] Audit closure, event listener, dan callback yang mungkin *capture* variabel kunci secara tidak langsung, mencegah GC membersihkannya.
- [x] Pastikan setelah fungsi derivasi kunci selesai, semua variabel interim (salt, pepper, intermediate hash) juga di-nullify dan di-overwrite.

### Sub-Task 2.2: Handle Lock Screen State
- [x] Saat aplikasi lock (user menekan tombol lock atau timeout), pastikan kunci dekripsi utama dihapus dari memory renderer process.
- [x] Kunci h boleh disimpan di `main` process jika benar-benar diperlukan untuk operasi dekripsi/enkripsi, tetapi tetap harus di-wipe saat lock atau shutdown.
- [x] Pastikan state management (Zustand/Redux store di renderer) tidak menyimpan salinan kunci atau decrypted data setelah lock.

### Sub-Task 2.3: IPC & Inter-Process Communication
- [x] Audit pesan IPC antara `main` dan `renderer` yang membawa data sensitif; minimalisasi atau enkripsi data dalam transit.
- [x] Pastikan tidak ada *lingering* data di IPC channel atau event listener setelah operasi selesai.
- [x] Implementasi `ipcRenderer.removeAllListeners` atau pendengar spesifik untuk membersihkan referensi setelah callback dieksekusi.

---

## 3. Task: Secure Memory Clearing Implementation
- [x] Task 3 Complete

### Sub-Task 3.1: Helper Function Secure Clear
- [x] Buat fungsi utilitas `secureClear(buffer: Buffer | ArrayBuffer | null): void` yang mengisi buffer dengan zero dan kemudian menetapkan referensi ke `null`.
- [x] Fungsi ini harus digunakan secara konsisten di seluruh codebase untuk membersihkan data sensitif.
- [x] Tambahkan *unit test* untuk `secureClear` yang memverifikasi buffer di-overwrite dan referensi di-nullify.

### Sub-Task 3.2: Integrasi dengan Crypto Layer
- [x] Pastikan fungsi enkripsi/dekripsi (misal di `src/main/crypto.ts` atau sejenisnya) selalu memanggil `secureClear` pada kunci sementara setelah operasi selesai.
- [x] Periksa bahwa stream cipher atau mode operasi lain tidak menyimpan salinan kunci internal setelah finalisasi.

### Sub-Task 3.3: Password Input Handling
- [x] Field input password di UI harus di-*clear* secara eksplisit dari state komponen setelah digunakan untuk derivasi kunci.
- [x] Pastikan tidak ada *undo history* atau *value caching* di komponen input yang menyimpan password dalam plain text di memory.

---

## 4. Task: DevTools & Debug Security
- [x] Task 4 Complete

### Sub-Task 4.1: Disable DevTools di Production
- [x] Pastikan DevTools Electron tidak dapat dibuka di build *production* / *packaged* app.
- [x] Konfigurasi `webPreferences` (`devTools: false`) untuk renderer windows di production environment.
- [x] Pastikan shortcut keyboard (F12, Ctrl+Shift+I) tidak membuka DevTools.

### Sub-Task 4.2: Log & Console Sanitization
- [x] Audit seluruh `console.log`, `console.error`, dan mechanism logging di aplikasi untuk memastikan tidak ada kunci, hash, atau data sensitif yang tercetak.
- [x] Gunakan logger terpusat yang memiliki *sanitization middleware* untuk secara otomatis menyaring field sensitif sebelum output ke log.
- [x] Hapus atau *comment out* log debug yang mengandung raw data setelah fase development selesai.

### Sub-Task 4.3: Source Map & Symbol Security
- [x] Pastikan source map (`*.js.map`) tidak di-bundle bersama aplikasi production jika tidak diperlukan, untuk mengurangi exposure internal logic.
- [x] Jika source map diperlukan untuk error reporting, pertimbangkan hosting di server privat dengan autentikasi.

---

## 5. Task: Testing & Verification
- [x] Task 5 Complete

### Sub-Task 5.1: Unit Tests untuk Secure Clear
- [x] Test `secureClear` dengan berbagai jenis input (`Buffer`, `ArrayBuffer`, `Uint8Array`).
- [x] Assert bahwa setelah `secureClear`, buffer mengandung nilai zero dan referensi variabel menjadi `null`.

### Sub-Task 5.2: Memory Leak Tests
- [x] Gunakan工具 profiler memory (Chrome DevTools Memory tab) untuk merekam heap sebelum dan sesudah lock/unlock vault.
- [x] Assert tidak ada objek berkategori `ArrayBuffer`, `Buffer`, atau plain text string kunci yang bertahan di heap setelah aplikasi di-lock.

### Sub-Task 5.3: Regression Security Tests
- [x] Test skenario lock screen: setelah lock, lakukan heap snapshot dan cari referensi kunci atau plaintext data item.
- [x] Test skenario close app: pastikan tidak ada core dump atau crash log yang mengandung data sensitif.

---

## 6. Task: UX Polish & Documentation
- [x] Task 6 Complete

### Sub-Task 6.1: Security Indicator
- [x] Tambahkan indikator visual di lock screen atau status bar yang menunjukkan bahwa aplikasi telah di-lock dan memory telah di-*cleared*.
- [x] Opsional: Tampilkan pesan reassuring kepada pengguna saat lock, misal: "Your keys have been securely wiped from memory."

### Sub-Task 6.2: Localization (I18n Ready)
- [x] Semua pesan keamanan (warning, error, notification status) harus berasal dari keys file bahasa agar dapat diterjemahkan.

### Sub-Task 6.3: Documentation & Code Comments
- [x] Dokumentasikan fungsi `secureClear` dan code path sensitif lainnya dengan komentar yang jelas: `// SECURITY: Wipe sensitive material before leaving scope`.
- [x] Update `SECURITY.md` jika ada untuk mencantumkan langkah-langkah memory wipe ini sebagai bagian dari hardening aplikasi.

---

## Summary Checklist Implementasi

- [x] Sub-Task 1.1: Identifikasi Semua Buffer Kunci (file, fungsi, variabel)
- [x] Sub-Task 1.2: Implementasi Secure Overwrite (fill zero/random, prevent optimization)
- [x] Sub-Task 1.3: String Kunci di Memory (avoid .toString(), handle IPC strings)
- [x] Sub-Task 2.1: Verifikasi Referensi Kunci Tidak Bertahan (closure, listener, callback)
- [x] Sub-Task 2.2: Handle Lock Screen State (wipe on lock, state management cleanup)
- [x] Sub-Task 2.3: IPC & Inter-Process Communication (sanitize channel, remove listeners)
- [x] Sub-Task 3.1: Helper Function Secure Clear (unified utility, unit test)
- [x] Sub-Task 3.2: Integrasi dengan Crypto Layer (post-operation wipe)
- [x] Sub-Task 3.3: Password Input Handling (clear from React/Vue/Angular state & input caching)
- [x] Sub-Task 4.1: Disable DevTools di Production (webPreferences, shortcuts)
- [x] Sub-Task 4.2: Log & Console Sanitization (audit console.log, centralized sanitization)
- [x] Sub-Task 4.3: Source Map & Symbol Security (exclude production maps)
- [x] Sub-Task 5.1-5.3: Unit, Memory Leak, Regression Tests
- [x] Sub-Task 6.1: Security Indicator (visual feedback on lock)
- [x] Sub-Task 6.2: Localization (I18n Ready)
- [x] Sub-Task 6.3: Documentation & Code Comments
