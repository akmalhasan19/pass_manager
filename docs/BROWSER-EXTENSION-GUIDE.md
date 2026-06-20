# SecurePass Manager — Browser Extension User Guide

> Panduan lengkap penggunaan Browser Extension SecurePass Manager untuk autofill
> otomatis, quick access credential, dan manajemen password yang lebih efisien.

---

## Table of Contents

- [1. Overview](#1-overview)
- [2. Installation](#2-installation)
  - [2.1 Prerequisites](#21-prerequisites)
  - [2.2 Install via Chrome Web Store](#22-install-via-chrome-web-store)
  - [2.3 Install via Firefox Add-ons](#23-install-via-firefox-add-ons)
  - [2.4 Install via Edge Add-ons](#24-install-via-edge-add-ons)
  - [2.5 Manual Installation (Developer Mode)](#25-manual-installation-developer-mode)
  - [2.6 Verify Native Messaging Host](#26-verify-native-messaging-host)
- [3. Getting Started](#3-getting-started)
  - [3.1 First Launch](#31-first-launch)
  - [3.2 Connecting to Desktop App](#32-connecting-to-desktop-app)
  - [3.3 Vault Status Indicator](#33-vault-status-indicator)
- [4. Using the Extension](#4-using-the-extension)
  - [4.1 Extension Popup](#41-extension-popup)
  - [4.2 Autofill Login Forms](#42-autofill-login-forms)
  - [4.3 Save New Credentials](#43-save-new-credentials)
  - [4.4 Copy Username / Password / OTP](#44-copy-username--password--otp)
  - [4.5 Search Credentials](#45-search-credentials)
- [5. Extension Settings](#5-extension-settings)
  - [5.1 Autofill & Save Settings](#51-autofill--save-settings)
  - [5.2 Clipboard Settings](#52-clipboard-settings)
  - [5.3 Default Actions](#53-default-actions)
  - [5.4 Advanced Settings](#54-advanced-settings)
- [6. Global Shortcuts](#6-global-shortcuts)
  - [6.1 Default Shortcuts](#61-default-shortcuts)
  - [6.2 Customizing Shortcuts](#62-customizing-shortcuts)
  - [6.3 Shortcut Behavior](#63-shortcut-behavior)
- [7. Troubleshooting (FAQ)](#7-troubleshooting-faq)
  - [7.1 Extension Not Connecting to Desktop App](#71-extension-not-connecting-to-desktop-app)
  - [7.2 Autofill Not Working](#72-autofill-not-working)
  - [7.3 Extension Shows "Vault Locked"](#73-extension-shows-vault-locked)
  - [7.4 Extension Icon Stays Red](#74-extension-icon-stays-red)
  - [7.5 Quick Picker Not Appearing](#75-quick-picker-not-appearing)
  - [7.6 Clipboard Not Clearing](#76-clipboard-not-clearing)
  - [7.7 Credential Not Found for Current Site](#77-credential-not-found-for-current-site)
- [8. Security](#8-security)
- [9. Video Tutorial Script](#9-video-tutorial-script)

---

## 1. Overview

SecurePass Browser Extension memungkinkan Anda untuk:

- **Autofill** form login secara otomatis di website.
- **Copy** username, password, atau kode OTP ke clipboard dengan satu klik.
- **Save** credential baru langsung dari browser ke vault.
- **Quick Access** credential menggunakan global shortcut dari aplikasi mana pun.
- **Deteksi** form login dan menawarkan save saat Anda login ke akun baru.

Extension berkomunikasi dengan aplikasi desktop SecurePass Manager melalui
**Native Messaging** (koneksi langsung, aman) atau **WebSocket** (fallback).

---

## 2. Installation

### 2.1 Prerequisites

- Aplikasi **SecurePass Manager** desktop harus sudah terinstall dan berjalan.
- Browser yang didukung: **Chrome 109+**, **Firefox**, atau **Microsoft Edge**.
- Vault harus dalam keadaan **unlocked** agar extension dapat berfungsi.

### 2.2 Install via Chrome Web Store

1. Buka Chrome Web Store dan cari **"SecurePass Manager"**.
2. Klik **"Add to Chrome"**.
3. Pada dialog konfirmasi, klik **"Add extension"**.
4. Ikon SecurePass akan muncul di toolbar Chrome.

> **Catatan**: Saat pertama kali, native messaging host akan didaftarkan
> secara otomatis oleh aplikasi desktop. Jika tidak, lihat
> [Verifikasi Native Messaging Host](#26-verify-native-messaging-host).

### 2.3 Install via Firefox Add-ons

1. Buka Firefox Add-ons (addons.mozilla.org) dan cari **"SecurePass Manager"**.
2. Klik **"Add to Firefox"**.
3. Pada dialog izin, klik **"Add"**.
4. Ikon SecurePass akan muncul di toolbar Firefox.

### 2.4 Install via Edge Add-ons

1. Buka Edge Add-ons (microsoftedge.microsoft.com/addons) dan cari **"SecurePass Manager"**.
2. Klik **"Get"**.
3. Pada dialog konfirmasi, klik **"Add extension"**.

### 2.5 Manual Installation (Developer Mode)

Jika Anda mengembangkan extension atau menginstal dari source:

#### Chrome / Edge

1. Buka `chrome://extensions/` (Chrome) atau `edge://extensions/` (Edge).
2. Aktifkan **Developer mode** (toggle di pojok kanan atas).
3. Klik **"Load unpacked"**.
4. Pilih direktori `browser-extension/dist/` dari project SecurePass.
5. Extension akan dimuat dan ikon muncul di toolbar.

#### Firefox

1. Buka `about:debugging#/runtime/this-firefox`.
2. Klik **"Load Temporary Add-on..."**.
3. Pilih file `manifest.json` dari direktori `browser-extension/dist/`.

> **Catatan**: Extension yang di-load dalam mode developer tidak akan
> bertahan setelah browser di-restart. Untuk penggunaan permanen, gunakan
> versi signed dari store.

### 2.6 Verify Native Messaging Host

Extension memerlukan **native messaging host** yang terdaftar agar dapat
berkomunikasi dengan aplikasi desktop. Host ini didaftarkan secara otomatis
saat Anda menjalankan aplikasi desktop untuk pertama kali.

**Untuk memverifikasi:**

1. Buka **SecurePass Manager** desktop app.
2. Buka **Settings** > **Browser Extension Integration**.
3. Pastikan status menunjukkan **"Host registered"** untuk browser yang Anda gunakan.
4. Jika belum terdaftar, klik **"Register Host"**.

**Pendaftaran manual (jika diperlukan):**

- **Windows**: Registry key ditulis ke:
  - Chrome: `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.securepass.manager`
  - Edge: `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.securepass.manager`
  - Firefox: `HKCU\Software\Mozilla\NativeMessagingHosts\com.securepass.manager`
- **macOS**: Manifest ditulis ke `~/Library/Application Support/<browser>/NativeMessagingHosts/`
- **Linux**: Manifest ditulis ke `~/.config/<browser>/NativeMessagingHosts/`

---

## 3. Getting Started

### 3.1 First Launch

Setelah menginstall extension:

1. Klik ikon **SecurePass** di toolbar browser.
2. Popup akan menampilkan status koneksi ke aplikasi desktop.
3. Jika vault **locked**, popup akan menampilkan pesan:
   **"Please unlock your vault in the SecurePass app"**.
4. Buka aplikasi desktop dan unlock vault.
5. Setelah vault unlocked, extension akan terhubung secara otomatis.

### 3.2 Connecting to Desktop App

Extension secara otomatis mendeteksi aplikasi desktop:

- **Status bar** di bagian atas popup menunjukkan koneksi:
  - **Hijau (Connected)** — Terhubung ke aplikasi desktop.
  - **Kuning (Connecting)** — Sedang mencoba menghubungkan.
  - **Merah (Disconnected)** — Tidak dapat terhubung.

- Jika terputus, klik tombol **"Refresh"** di footer popup untuk mencoba
  menghubungkan kembali.

### 3.3 Vault Status Indicator

- **Badge hijau** di toolbar: Vault unlocked, extension aktif.
- **Badge merah** di toolbar: Vault locked, extension dalam mode terbatas.
- Jumlah pada badge (jika ada): Jumlah credential yang cocok dengan URL
  halaman saat ini.

---

## 4. Using the Extension

### 4.1 Extension Popup

Klik ikon SecurePass di toolbar untuk membuka popup. Popup terdiri dari:

- **Header**: Nama vault aktif dan status lock/unlock.
- **Status bar**: Status koneksi dan jumlah item yang cocok.
- **Search bar**: Filter credential berdasarkan nama atau URL.
- **Credential list**: Daftar item yang cocok dengan domain halaman saat ini.
- **Footer**: Tombol Refresh, Open App, dan Settings.

### 4.2 Autofill Login Forms

Ketika Anda mengunjungi halaman login:

1. Extension secara otomatis mendeteksi form login di halaman.
2. Jika ada credential yang cocok di vault, tombol **autofill** akan tersedia.
3. Klik ikon **"U"** (autofill) di sebelah item credential, atau:
   - Klik item untuk expand detail, lalu klik **"Autofill"**.
4. Credential akan diisi otomatis ke form login.

**Autofill juga mendukung:**
- Form OTP/TOTP jika item memiliki OTP secret.
- Login iframe (Google Sign-In, Facebook Login, dll.).

### 4.3 Save New Credentials

Ketika Anda submit form login baru:

1. Extension akan mendeteksi form submission.
2. Prompt bar muncul di bagian bawah halaman:
   **"Do you want to save this login to SecurePass Manager?"**
3. Pilihan:
   - **"Save to SecurePass"** — Simpan credential baru ke vault.
   - **"Never for this site"** — Jangan tawarkan lagi untuk domain ini.
   - **"Dismiss"** — Tutup prompt tanpa aksi.

> **Catatan**: Prompt hanya muncul jika setting "Offer to save passwords"
> aktif di Settings extension.

### 4.4 Copy Username / Password / OTP

Dari popup extension:

1. **Copy Username**: Klik ikon **"U"** di sebelah item credential.
2. **Copy Password**: Klik ikon **"P"** di sebelah item credential.
3. **Copy OTP**: Jika item memiliki OTP, klik badge **"OTP"** di sebelah item.
4. **Expand detail**: Klik item, lalu gunakan tombol aksi yang tersedia.

> **Keamanan**: Clipboard akan otomatis dibersihkan setelah durasi yang
> ditentukan di Settings (default: 30 detik). Toast notification akan
> muncul: "Password copied — will clear in 30s".

### 4.5 Search Credentials

1. Klik search bar di bagian atas popup.
2. Ketik nama credential, username, atau URL.
3. Daftar akan difilter secara real-time.

---

## 5. Extension Settings

Akses Settings dengan mengklik tombol **"Settings"** di footer popup.

### 5.1 Autofill & Save Settings

| Setting | Default | Deskripsi |
|---------|---------|-----------|
| Offer to save passwords | **On** | Tawarkan untuk menyimpan credential baru saat form login dideteksi. |
| Auto-fill forms automatically | **On** | Isi form login secara otomatis saat credential cocok ditemukan. |

### 5.2 Clipboard Settings

| Setting | Default | Deskripsi |
|---------|---------|-----------|
| Clear clipboard after copy | **On** | Bersihkan clipboard secara otomatis setelah menyalin credential. |
| Clipboard clear delay | **30 seconds** | Durasi sebelum clipboard dibersihkan (10–300 detik). |

### 5.3 Default Actions

| Setting | Default | Deskripsi |
|---------|---------|-----------|
| Default click action | **Autofill** | Aksi yang dilakukan saat item credential diklik. Pilihan: Autofill, Copy Password, Copy Username. |

### 5.4 Advanced Settings

| Setting | Default | Deskripsi |
|---------|---------|-----------|
| Sync with desktop app | **On** | Sinkronkan setting extension dengan aplikasi desktop. |

---

## 6. Global Shortcuts

Global shortcut memungkinkan Anda mengakses credential dari aplikasi mana
pun, tanpa perlu membuka browser atau aplikasi desktop.

### 6.1 Default Shortcuts

| Aksi | Windows / Linux | macOS |
|------|----------------|-------|
| **Copy Password** | `Ctrl+Shift+P` | `Cmd+Shift+P` |
| **Copy Username** | `Ctrl+Shift+U` | `Cmd+Shift+U` |
| **Lock Vault** | `Ctrl+Shift+L` | `Cmd+Shift+L` |
| **Quick Picker** | `Ctrl+Shift+Space` | `Cmd+Shift+Space` |

### 6.2 Customizing Shortcuts

Untuk mengubah shortcut:

1. Buka **SecurePass Manager** desktop app.
2. Buka **Settings** > **Shortcuts**.
3. Klik pada shortcut yang ingin diubah.
4. Tekan kombinasi tombol baru.
5. Klik **"Save"** untuk menyimpan perubahan.

> **Validasi**: Shortcut harus menggunakan minimal satu modifier key
> (Ctrl, Alt, Shift, atau Cmd/CmdOrCtrl) diikuti dengan letter, number,
> atau function key. Contoh valid: `Ctrl+Shift+A`, `Alt+Ctrl+X`.

### 6.3 Shortcut Behavior

- Shortcut **hanya bekerja** ketika vault dalam keadaan **unlocked**.
- Shortcut **Copy Password/Username** akan menyalin credential dari item
  yang sedang aktif atau terakhir digunakan.
- Shortcut **Lock Vault** akan langsung mengunci vault dan menghapus
  encryption key dari memory.
- Shortcut **Quick Picker** membuka overlay pencarian credential yang
  muncul di atas aplikasi yang sedang aktif.
- Clipboard auto-clear tetap berlaku untuk copy via shortcut.

---

## 7. Troubleshooting (FAQ)

### 7.1 Extension Not Connecting to Desktop App

**Gejala**: Status bar menunjukkan "Disconnected" atau "Connecting" terus-menerus.

**Solusi**:

1. **Pastikan aplikasi desktop berjalan** — Buka SecurePass Manager dan
   pastikan tidak dalam mode minimized ke tray.
2. **Pastikan vault unlocked** — Klik ikon tray atau buka aplikasi, lalu
   unlock vault dengan master password.
3. **Restart browser** — Tutup browser sepenuhnya, lalu buka kembali.
4. **Restart aplikasi desktop** — Tutup SecurePass Manager sepenuhnya,
   lalu jalankan ulang.
5. **Periksa native messaging host**:
   - Buka Settings di aplikasi desktop > Browser Extension Integration.
   - Pastikan host terdaftar untuk browser yang Anda gunakan.
   - Jika tidak, klik "Register Host".
6. **Untuk Windows**: Periksa registry key:
   ```
   HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.securepass.manager
   ```
   Pastikan path ke manifest file benar.
7. **Periksa log**: Buka DevTools extension (klik kanan ikon > Inspect),
   tab Console, untuk melihat error log.

### 7.2 Autofill Not Working

**Gejala**: Form login tidak terisi otomatis meskipun credential ada di vault.

**Solusi**:

1. **Periksa setting autofill**: Pastikan "Auto-fill forms automatically"
   aktif di Settings extension.
2. **Periksa URL match**: Extension hanya mengisi form untuk domain yang
   cocok dengan URL yang tersimpan di vault. Periksa apakah URL di vault
   sesuai dengan domain halaman saat ini.
3. **Form kompleks**: Beberapa website menggunakan shadow DOM atau iframe
   untuk form login. Extension mendukung ini, tetapi beberapa website
   mungkin memerlukan pendekatan manual.
4. **Anti-phishing warning**: Jika domain tidak cocok persis, extension
   akan menampilkan warning dan tidak mengisi form secara otomatis.

### 7.3 Extension Shows "Vault Locked"

**Gejala**: Popup menampilkan "Please unlock your vault in the SecurePass app".

**Solusi**:

1. Buka **SecurePass Manager** desktop app.
2. Masukkan master password untuk unlock vault.
3. Kembali ke browser — extension akan mendeteksi unlock secara otomatis.
4. Jika masih locked, klik tombol **"Refresh"** di footer popup.

### 7.4 Extension Icon Stays Red

**Gejala**: Ikon extension di toolbar selalu berwarna merah.

**Penyebab**: Vault dalam keadaan locked atau extension tidak terhubung ke host.

**Solusi**:

1. Pastikan aplikasi desktop berjalan dan vault unlocked.
2. Jika sudah unlocked tapi ikon masih merah, klik tombol **"Refresh"**
   di footer popup.
3. Jika masih merah, coba restart browser.

### 7.5 Quick Picker Not Appearing

**Gejala**: Menekan shortcut `Ctrl+Shift+Space` tidak menampilkan quick picker.

**Solusi**:

1. **Vault harus unlocked** — Quick picker hanya berfungsi saat vault unlocked.
2. **Periksa shortcut lain**: Mungkin ada aplikasi lain yang menggunakan
   shortcut yang sama. Coba ubah shortcut di Settings desktop app.
3. **Pastikan app berjalan**: Quick picker dijalankan oleh aplikasi desktop,
   bukan extension. Pastikan SecurePass Manager berjalan.

### 7.6 Clipboard Not Clearing

**Gejala**: Credential yang disalin tidak terhapus dari clipboard setelah durasi yang ditentukan.

**Solusi**:

1. **Periksa setting clipboard**: Pastikan "Clear clipboard after copy"
   aktif di Settings extension.
2. **Durasi terlalu pendek**: Jika durasi terlalu pendek, mungkin sudah
   terhapus sebelum Anda sempat menggunakannya. Naikkan durasi di Settings.
3. **Clipboard manager**: Beberapa clipboard manager mungkin memblokir
   auto-clear. Coba nonaktifkan clipboard manager sementara.

### 7.7 Credential Not Found for Current Site

**Gejala**: Extension tidak menampilkan credential yang cocok untuk website.

**Solusi**:

1. **Periksa URL di vault**: Pastikan URL atau domain credential di vault
   cocok dengan domain halaman saat ini.
2. **Gunakan search**: Ketik nama website di search bar popup untuk
   mencari credential secara manual.
3. **Tambahkan credential baru**: Jika belum ada, submit form login
   lalu pilih "Save to SecurePass" saat prompt muncul.
4. **Periksa folder**: Credential mungkin berada di folder yang berbeda.
   Gunakan search untuk mencari di semua folder.

---

## 8. Security

Browser extension dirancang dengan prinsip keamanan berikut:

- **Zero-Knowledge**: Extension tidak memiliki akses ke master password
  atau kunci dekripsi. Semua dekripsi dilakukan oleh aplikasi desktop.
- **Encrypted Communication**: Semua pesan antara extension dan host
  dienkripsi menggunakan AES-256-GCM dengan key yang dihasilkan dari
  ECDH key exchange.
- **No Persistent Storage**: Credential tidak disimpan secara persisten
  di browser. Hanya di-cache secara ephemeral di memory dengan TTL ketat.
- **Isolated Content Script**: Content script berjalan di isolated world
  dan tidak memiliki akses ke JavaScript halaman web.
- **Anti-Phishing**: Domain matching yang ketat sebelum autofill.
  Warning ditampilkan jika domain tidak cocok.
- **Rate Limiting**: Request dibatasi per tab/window untuk mencegah abuse.
- **Audit Logging**: Semua request logged (tanpa credential) untuk
  audit trail.
- **Clipboard Auto-Clear**: Clipboard otomatis dibersihkan setelah
  durasi yang ditentukan.

---

## 9. Video Tutorial Script

> **Catatan**: Bagian ini berisi script untuk video tutorial yang dapat
> direkam menggunakan screen recording tool (OBS, dll.).

### Script Video: "Getting Started with SecurePass Browser Extension"

**Durasi**: ~3 menit

#### Scene 1: Introduction (0:00 – 0:20)

- Tampilan desktop dengan ikon SecurePass.
- Narasi: "In this video, we'll show you how to install and use the
  SecurePass Manager browser extension for automatic password autofill."

#### Scene 2: Installation (0:20 – 0:50)

- Buka Chrome Web Store.
- Cari "SecurePass Manager".
- Klik "Add to Chrome".
- Tampilkan ikon extension muncul di toolbar.
- Narasi: "Install the extension from your browser's store. It takes
  just a few seconds."

#### Scene 3: First Connection (0:50 – 1:20)

- Buka SecurePass desktop app.
- Unlock vault.
- Kembali ke browser, klik ikon extension.
- Tampilkan popup dengan status "Connected" dan vault unlocked.
- Narasi: "Open the SecurePass desktop app and unlock your vault.
  The extension will automatically connect."

#### Scene 4: Autofill (1:20 – 1:50)

- Buka halaman login (contoh: github.com/login).
- Tampilkan form login kosong.
- Tampilkan icon autofill muncul di sebelah form.
- Klik autofill, form terisi.
- Narasi: "When you visit a login page, the extension detects the form
  and offers to autofill your saved credentials."

#### Scene 5: Copy & Quick Access (1:50 – 2:20)

- Klik ikon extension.
- Tampilkan daftar credential.
- Klik ikon copy password.
- Tampilkan toast notification.
- Tekan `Ctrl+Shift+Space` dari Notepad.
- Tampilkan quick picker overlay.
- Narasi: "You can also copy credentials directly from the popup, or
  use global shortcuts to access them from any app."

#### Scene 6: Save New Credential (2:20 – 2:50)

- Login ke website baru.
- Submit form.
- Tampilkan prompt "Save to SecurePass?".
- Klik "Save to SecurePass".
- Narasi: "When you log in to a new site, the extension offers to save
  the credential to your vault."

#### Scene 7: Closing (2:50 – 3:00)

- Tampilan SecurePass website atau logo.
- Narasi: "Download SecurePass Manager today and simplify your
  password management. Visit securepass.app for more information."

---

*Document version: 1.0 — Last updated: 2026-06-20*
