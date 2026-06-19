# Planning: Browser Extension & Global Autofill

> Dokumen ini berisi rencana implementasi lengkap, terstruktur, dan detail untuk fitur Browser Extension & Global Autofill di SecurePass Manager.

---

## Overview Fitur

Browser Extension & Global Autofill adalah fitur integrasi yang memungkinkan SecurePass Manager berkomunikasi dengan browser populer (Chrome, Firefox, Edge, Safari) untuk melakukan autofill otomatis pada form login dan formulir lainnya. Fitur ini juga menyediakan global shortcut untuk mengakses credential tanpa perlu membuka aplikasi utama.

Fitur ini harus menjaga keamanan komunikasi antara browser extension dan aplikasi Electron, mencegah serangan man-in-the-middle, dan memastikan credential tidak pernah di-expose ke proses browser yang tidak dipercaya.

**Tujuan Utama**:

1. Memberikan pengalaman autofill yang seamless di semua browser populer.
2. Mengurangi friction saat login ke website — tidak perlu copy-paste dari aplikasi utama.
3. Menyediakan global shortcut untuk quick copy username/password ke clipboard.
4. Membantu pengguna mengidentifikasi dan mengisi password yang lemah atau telah ter-compromise.
5. Menjadi fitur kompetitif yang membedakan SecurePass Manager dari solusi password manager sederhana.

**Prinsip Keamanan**:

- Komunikasi antara browser extension dan aplikasi utama harus menggunakan autentikasi mutual dan enkripsi end-to-end.
- Credential tidak boleh disimpan secara persistent di browser extension; hanya boleh di-cache secara ephemeral di memory dengan batas waktu yang ketat.
- Browser extension tidak boleh memiliki akses langsung ke file database vault atau kunci dekripsi.
- Semua pesan antara extension dan host harus di-validasi untuk mencegah replay attack dan man-in-the-middle.
- Content script extension harus di-isolate dari DOM halaman web untuk mencegak akses berbahaya.

---

## 1. Task: Desain Protokol Komunikasi

- [x] Task 1 Complete

### Sub-Task 1.1: Evaluasi dan Pilih Metode Komunikasi

- [x] **Native Messaging**: Komunikasi langsung antara browser extension dan native host application (Electron).
  - Pro: Aman, tidak perlu server berjalan di port tertentu.
  - Kontra: Setup registry/manifest lebih kompleks, per platform.
- [x] **WebSocket**: Extension connect ke WebSocket server yang dijalankan oleh Electron app.
  - Pro: Fleksibel, bisa digunakan dari luar browser jika diperlukan.
  - Kontra: Keamanan lebih sulit dijamin, risiko port scanning.
- [x] **Custom IPC via Local Server**: HTTP server lokal di Electron dengan autentikasi token.
  - Pro: Mudah implementasi.
  - Kontra: Risiko keamanan jika port tidak dikunci dengan benar.
- [x] Tentukan metode utama dan fallback. Rekomendasi awal: **Native Messaging sebagai primary, WebSocket sebagai fallback**.

### Sub-Task 1.2: Definisikan Protokol Pesan

- [x] Buat schema JSON untuk setiap tipe pesan antara extension dan host.
- [x] Pesan dari extension ke host: `GET_CREDENTIALS`, `GET_MATCHING_ITEMS`, `COPY_TO_CLIPBOARD`, `LOCK_VAULT`.
- [x] Pesan dari host ke extension: `CREDENTIALS_RESPONSE`, `NO_MATCH_FOUND`, `VAULT_LOCKED`, `ERROR`.
- [x] Setiap pesan harus memiliki `requestId` untuk tracing dan `timestamp` untuk mencegah replay attack.

### Sub-Task 1.3: Implementasi Autentikasi dan Enkripsi

- [x] Gunakan **ECDH (Elliptic Curve Diffie-Hellman)** untuk key exchange saat handshake awal.
- [x] Derive shared secret untuk enkripsi AES-GCM pada handshake.
- [x] Exchange public key antara extension dan host melalui signed message.
- [x] Implementasi token refresh dengan TTL (Time To Live) pendek untuk session extension.
- [x] Setiap pesan setelah handshake harus dienkripsi menggunakan derived key.

### Sub-Task 1.4: Native Host Manifest dan Registry

- [x] Buat native messaging host manifest JSON yang didaftarkan ke browser.
- [x] Registry key untuk Windows: `HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.securepass.manager`.
- [x] File config untuk macOS/Linux di lokasi browser-specific.
- [x] Manifest harus merujuk ke executable Electron app atau helper binary.
- [x] Handle edge case ketika aplikasi utama belum terinstall atau belum dijalankan.

---

## 2. Task: Implementasi Browser Extension

- [x] Task 2 Complete

### Sub-Task 2.1: Setup Project Extension

- [x] Buat direktori terpisah untuk browser extension, misalnya `/browser-extension/`.
- [x] Gunakan manifest v3 untuk Chrome/Edge dan manifest v2 untuk Firefox (jika masih diperlukan).
- [x] Setup build pipeline menggunakan Vite atau Webpack untuk bundling extension.
- [x] Support hot reload development mode.

### Sub-Task 2.2: Implementasi Content Script

- [x] Content script untuk detect form login secara otomatis ketika halaman web diload.
- [x] Deteksi field username/email dan password menggunakan heuristik (attribute, label text, Nearness, CSS selectors).
- [x] Support shadow DOM untuk modern web apps.
- [x] Isolasi content script menggunakan `chrome.messaging` atau `postMessage` untuk komunikasi dengan background script.
- [x] Jangan inject credential langsung ke DOM web page; gunakan overlay UI yang di-render oleh extension.

### Sub-Task 2.3: Implementasi Autofill engine

- [x] Ketika form login terdeteksi, kirim pesan ke background script untuk mencari item yang cocok berdasarkan URL.
- [x] Background script forward request ke Electron app melalui Native Messaging.
- [x] Terima credential yang dienkripsi, dekripsi di background script, lalu inject ke form (menggunakan Content Script).
- [x] Support autofill untuk form OTP/TOTP jika item memiliki OTP secret.
- [x] Handle iframe login (misalnya Google Sign-In, Facebook Login).

### Sub-Task 2.4: Implementasi Save/New Credential Prompt

- [x] Detect ketika user submit form login baru yang tidak ada di vault.
- [x] Tampilkan prompt bar untuk user: "Do you want to save this login to SecurePass Manager?"
- [x] Jika user setuju, kirim credential baru ke Electron app melalui pesan `CREATE_ITEM`.
- [x] Prompt harus non-intrusive dan tidak mengganggu aktivitas user.

### Sub-Task 2.5: Popup UI Extension

- [x] Popup HTML/CSS dipicu ketika user klik icon extension di toolbar.
- [x] Tampilkan list item vault yang matching dengan current URL (jika vault unlocked).
- [x] Tombol untuk copy username, copy password, dan autofill.
- [x] Indikator lock/unlock vault (jika vault locked, tampilkan pesan untuk unlock di aplikasi utama).
- [x] Support dark/light mode yang mengikuti theme browser.

### Sub-Task 2.6: Icon dan Badge Extension

- [x] Icon extension berubah warna ketika vault unlocked (misalnya hijau) vs locked (merah).
- [x] Badge bisa menampilkan jumlah matching items untuk URL saat ini.
- [x] Animasi subtle saat autofill berhasil.

---

## 3. Task: Integrasi Electron App dengan Extension

- [x] Task 3 Complete

### Sub-Task 3.1: Native Messaging Host di Main Process
- [x] Implementasi Native Messaging listener di Electron `main` process.
- [x] Handle lifecycle: connect, message, disconnect, error.
- [x] Parse dan validate setiap pesan yang diterima sesuai schema protokol.
- [x] Enforce rate limiting untuk mencegah brute-force message.

### Sub-Task 3.2: Bridge ke Vault dan Credential Service

- [x] Buat `ExtensionService` di main process yang bertindak sebagai bridge.
- [x] `ExtensionService` memiliki akses read-only ke vault yang sedang aktif dan unlocked.
- [x] Query matching items berdasarkan `url` atau `domain` dari request extension.
- [x] Return encrypted response yang hanya bisa didekripsi oleh extension yang berhasil handshake.

### Sub-Task 3.3: WebSocket Fallback (Opsional)

- [x] Jika Native Messaging gagal atau tidak tersedia, buka WebSocket server lokal di port tertentu.
- [x] Port harus dipilih secara dinamik dan dikomunikasikan ke extension melalui local storage atau manifest.
- [x] Autentikasi WebSocket menggunakan token JWT yang expiring cepat.

### Sub-Task 3.4: Security Boundary dan Validation

- [x] Extension tidak boleh memiliki akses ke API-database atau storage langsung.
- [x] Semua request extension harus melalui `ExtensionService` dengan context `vaultId`.
- [x] Validate bahwa extension yang terkoneksi memiliki ID yang di-whitelist (Chrome Web Store ID atau Firefox Addon ID).
- [x] Reject request dari extension yang belum melalui handshake atau memiliki token expired.

### Sub-Task 3.5: Lifecycle dan Error Handling

- [x] Handle scenario ketika aplikasi utama di-close sementara extension masih aktif.
- [x] Tampilkan error yang bisa dipahami extension ketika vault locked.
- [x] Implementasi retry logic dengan exponential backoff untuk reconnect ke host.

---

## 4. Task: Global Shortcut dan Quick Access

- [x] Task 4 Complete

### Sub-Task 4.1: Global Keyboard Shortcut (System-Wide)

- [x] Definisikan global shortcut default: misalnya `Ctrl+Shift+P` untuk copy password, `Ctrl+Shift+U` untuk copy username, `Ctrl+Shift+L` untuk lock vault.
- [x] Shortcut harus bekerja bahkan ketika aplikasi tidak memiliki focus window (via Electron `globalShortcut` API).
- [x] Pengguna bisa mengubah shortcut melalui Settings di aplikasi utama (via IPC channels `shortcut:updateBinding`).
- [ ] Jika ada multiple matching items atau active item, tampilkan quick picker overlay (mirip Spotlight/Alfred).

### Sub-Task 4.2: Quick Picker Overlay

- [x] Implementasi tray icon atau system-level quick picker.
- [x] Di-trigger via global shortcut atau tray click.
- [x] Pengguna bisa search item vault menggunakan fuzzy search.
- [x] Ketika item dipilih, pilihan: Copy Username, Copy Password, Copy OTP, atau Open URL.
- [x] Overlay harus minimal dan tidak mengambil focus dari aplikasi yang sedang digunakan.

### Sub--Task 4.3: Clipboard Management

- [x] Setiap copy ke clipboard harus memiliki auto-clear timeout (misalnya 30 atau 45 detik).
- [x] Gunakan secure clipboard API jika tersedia di platform.
- [x] Tampilkan toast notification: "Password copied — will clear in 45s".

### Sub-Task 4.4: Tray Icon Integration

- [x] Tray icon menampilkan context menu: Open SecurePass, Copy Last Used, Lock Vault, Quit.
- [x] Tray icon berubah warna/indikator ketika vault unlocked.
- [x] Single click tray icon bisa membuka quick picker jika vault unlocked, atau lock screen jika locked.

---

## 5. Task: UI/UX Detail

- [ ] Task 5 Complete

### Sub-Task 5.1: Extension Popup Design

- [x] Layout popup responsive, max-width 380px, max-height 600px.
- [x] Header: Logo, Nama vault aktif, tombol Lock/Unlock (status only).
- [x] Search bar untuk filter items.
- [x] List item: favicon (jika ada), title, username, tombbol copy.
- [x] Ketika item diklik: expand detail, tombbol autofill, copy password, copy username, copy OTP.
- [x] Footer: Open Full App, Settings (link membuka Electron app).

### Sub-Task 5.2: Autofill Prompt Bar

- [x] Prompt bar muncul di atas/bawah halaman web ketika form login baru terdeteksi.
- [x] Style yang tidak mengganggu, bisa di-dismiss.
- [x] Tombol: "Save to SecurePass", "Never for this site", "Dismiss".
- [x] Mengikuti theme dan bahasa yang dipilih di aplikasi utama.

### Sub-Task 5.3: Error dan Empty States

- [x] State: Vault locked — tampilkan pesan "Please unlock your vault in the SecurePass app" dengan tombol "Open App".
- [x] State: No matching items — tampilkan "No credentials found for this site" dan tombol "Add New".
- [x] State: Extension tidak terhubung ke host — tampilkan troubleshooting steps.

### Sub-Task 5.4: Settings dan Preferences Extension

- [x] Toggle: "Offer to save passwords" (default: on).
- [x] Toggle: "Auto-fill forms automatically" (default: on).
- [x] Toggle: "Clear clipboard after copy" (default: on, dengan input durasi).
- [x] Dropdown: Default action ketika item diklik (autofill, copy password, atau copy username).
- [x] Settings harus sync dengan aplikasi utama jika memungkinkan.

---

## 6. Task: Keamanan dan Anti-Exploit

- [ ] Task 6 Complete

### Sub-Task 6.1: Isolasi Content Script

- [x] Content script tidak boleh memiliki akses ke variabel JavaScript halaman web.
- [x] Gunakan isolated world di content script (default di manifest v3).
- [x] Hindari `eval` atau `Function()` construct di extension codebase.
- [x] Sandboxing iframe untuk UI extension (popup, prompt bar).

### Sub-Task 6.2: Validasi Input dan Sanitasi

- [x] Semua input dari extension (URL, form fields) harus di-sanitize term-sebelum diproses.
- [x] Validate URL scheme (hanya allow `http://` dan `https://`), tolak `javascript:`, `data:`, dll.
- [x] Escape output sebelum render di popup untuk mencegah XSS via malicious page title.

### Sub-Task 6.3: Anti-Phishing Protection

- [x] Implementasi domain matching yang ketat sebelum autofill.
- [x] Warning jika domain yang diminta tidak cocok dengan domain yang tersimpan di vault (misalnya phishing site dengan typo `paypa1.com` vs `paypal.com`).
- [x] Visual indicator yang jelas di browser extension ketika sedang melakukan autofill untuk domain berisiko.

### Sub-Task 6.4: Secure Memory Practices

- [x] Credential di memory extension harus di-clear secara eksplisit setelah digunakan.
- [x] Gunakan `chrome.storage.session` (di Chrome 102+) untuk menyimpan state yang tidak persistent dan otomatis dihapus ketika browser/session berakhir.
- [x] Hindari `localStorage` dan `chrome.storage.local` untuk data sensitif.

### Sub-Task 6.5: Audit dan Rate Limiting

- [x] Log semua request extension (tanpa credential) untuk audit trail.
- [x] Rate limit request per window/tab untuk mencegah abuse.
- [x] Alert user jika ada aktivitas extension yang mencurigakan (misalnya terlalu banyak request dalam waktu singkat).

---

## 7. Task: Testing & Quality Assurance

- [ ] Task 7 Complete

### Sub-Task 7.1: Unit Tests Extension

- [x] Test content script heuristik untuk form detection.
- [x] Test domain matching dan URL parsing (edge cases seperti subdomain, path, query params).
- [x] Test encryption/decryption round-trip di background script.
- [x] Test rate limiting dan error handling.

### Sub-Task 7.2: Integration Tests IPC dan Native Messaging

- [x] Test handshake ECDH antara extension dan Electron app.
- [x] Test send/receive pesan encrypted melalui Native Messaging mock.
- [x] Test fallback WebSocket (jika diimplementasikan).
- [x] Test scenario Electron app tidak berjalan atau vault locked.

### Sub-Task 7.3: Cross-Browser Testing

- [ ] Test extension di Chrome, Firefox, Edge, dan Safari (jika mungkin).
- [ ] Test manifest v3 compatibility terutama service worker lifecycle di Chrome.
- [ ] Test content script di berbagai website: Gmail, GitHub, Netflix, Facebook, Google SSO, banking sites.

### Sub-Task 7.4: Security Testing

- [x] Test XSS: Inject malicious page title/URL dan pastikan tidak dieksekusi di popup.
- [x] Test MITM: Intercept pesan Native Messaging, pastikan tidak bisa didekripsi tanpa shared key.
- [x] Test replay attack: Duplikasi pesan yang sudah dikirim sebelumnya harus ditolak karena timestamp/tid.
- [x] Test phishing resistance: Buat halaman phishing dengan typo domain, pastikan tidak auto-fill.

### Sub-Task 7.5: UX Regression Testing

- [ ] Test global shortcut: pastikan berfungsi ketika window lain aktif.
- [ ] Test quick picker performance dengan vault berisi ribuan items.
- [ ] Test tray functionality di Windows, macOS, dan Linux.
- [ ] Test i18n untuk Bahasa Inggris dan Bahasa Indonesia.

---

## 8. Task: Distribusi dan Mrollout

- [ ] Task 8 Complete

### Sub-Task 8.1: Build dan Package Extension

- [x] Script CI/CD untuk build extension untuk Chrome, Firefox, dan Edge secara otomatis.
- [x] Package extension dalam format `.zip` untuk submission ke store.
- [x] Generate source maps untuk debugging dan review store.
- [x] Signing extension (Firefox AMO, Edge Partner Center).

### Sub-Task 8.2: Integrasi dengan Aplikasi Utama

- [ ] Electron app setup harus menginstal native messaging host manifest secara otomatis (wizard setup).
- [ ] Setting di aplikasi utama untuk enable/disable extension integration.
- [ ] Link dari aplikasi utama ke Chrome Web Store / Firefox Addons halaman download extension.
- [ ] Auto-detect apakah extension sudah terinstall dan tampilkan banner reminder jika belom.

### Sub-Task 8.3: Dokumentasi User

- [ ] Buat halaman docs: "How to install and use the SecurePass browser extension".
- [ ] Video tutorial singkat (opsional).
- [ ] FAQ: Troubleshooting jika extension tidak terhubung.
- [ ] Dokumentasi global shortcut default dan cara mengubahnya di settings.

---

## Summary Checklist Implementasi

- [x] Sub-Task 1.1: Evaluasi dan Pilih Metode Komunikasi
- [x] Sub-Task 1.2: Definisikan Protokol Pesan
- [x] Sub-Task 1.3: Implementasi Autentikasi dan Enkripsi
- [ ] Sub-Task 1.4: Native Host Manifest dan Registry
- [ ] Sub-Task 2.1: Setup Project Extension
- [x] Sub-Task 2.2: Implementasi Content Script
- [x] Sub-Task 2.3: Implementasi Autofill Engine
- [x] Sub-Task 2.4: Save/New Credential Prompt
- [x] Sub-Task 2.5: Popup UI Extension
- [x] Sub-Task 2.6: Icon dan Badge Extension
- [x] Sub-Task 3.1: Native Messaging Host Listener
- [x] Sub-Task 3.2: Bridge ke Vault Service
- [x] Sub-Task 3.3: WebSocket Fallback (Opsional)
- [x] Sub-Task 3.4: Security Boundary dan Validation
- [x] Sub-Task 3.5: Lifecycle dan Error Handling
- [x] Sub-Task 4.1: Global Keyboard Shortcut
- [x] Sub-Task 4.2: Quick Picker Overlay (Lihat daftar lengkap di atas)
- [x] Sub-Task 4.3: Clipboard Management
- [x] Sub-Task 4.4: Tray Icon Integration
- [x] Sub-Task 5.1: Extension Popup Design
- [x] Sub-Task 5.2: Autofill Prompt Bar
- [x] Sub-Task 5.3: Error dan Empty States
- [x] Sub-Task 5.4: Settings Extension
- [x] Sub-Task 6.1: Isolasi Content Script
- [x] Sub-Task 6.2: Validasi Input dan Sanitasi
- [x] Sub-Task 6.3: Anti-Phishing Protection
- [x] Sub-Task 6.4: Secure Memory Practices
- [x] Sub-Task 6.5: Audit dan Rate Limiting
- [x] Sub-Task 7.1: Unit Tests Extension
- [x] Sub-Task 7.2: Integration Tests IPC
- [ ] Sub-Task 7.3: Cross-Browser Testing
- [x] Sub-Task 7.4: Security Testing
- [ ] Sub-Task 7.5: UX Regression Testing
- [x] Sub-Task 8.1: Build dan Package Extension
- [ ] Sub-Task 8.2: Integrasi dengan Aplikasi Utama
- [ ] Sub-Task 8.3: Dokumentasi User
