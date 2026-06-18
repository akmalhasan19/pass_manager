# Evaluasi Metode Komunikasi Browser Extension ↔ Electron App

> Sub-Task 1.1: Evaluasi dan Pilih Metode Komunikasi
> Dokumen ini berisi analisis mendalam terhadap tiga metode komunikasi yang dievaluasi untuk integrasi Browser Extension dengan SecurePass Manager Electron app.

---

## Ringkasan Eksekutif

| Metode | Keamanan | Kompleksitas | Cross-Browser | Rekomendasi |
|--------|----------|--------------|---------------|-------------|
| **Native Messaging** | ★★★★★ | ★★★☆☆ | Chrome, Firefox, Edge | **PRIMARY** |
| **WebSocket** | ★★★☆☆ | ★★☆☆☆ | Semua browser | **FALLBACK** |
| **Custom IPC (Local HTTP)** | ★★☆☆☆ | ★☆☆☆☆ | Semua browser | **TIDAK Direkomendasikan** |

**Keputusan Akhir**: Native Messaging sebagai metode utama, WebSocket sebagai fallback.

---

## 1. Native Messaging

### 1.1 Deskripsi

Native Messaging adalah API bawaan WebExtension yang memungkinkan browser extension berkomunikasi langsung dengan native host application (Electron app) melalui stdin/stdout. Browser meluncurkan proses native host secara otomatis dan mengelola komunikasi terstruktur (4-byte length prefix + JSON UTF-8).

### 1.2 Analisis Keamanan

| Aspek | Penilaian | Detail |
|-------|-----------|--------|
| **Transport Security** | ★★★★★ | Tidak ada network exposure; komunikasi lokal via stdin/stdout |
| **Mutual Authentication** | ★★★★★ | Host manifest harus declare `allowed_origins` (Chrome) atau `allowed_extensions` (Firefox) dengan extension ID spesifik |
| **No Port Exposure** | ★★★★★ | Tidak ada port yang dibuka, sehingga tidak bisa di-scanned dari luar |
| **Process Isolation** | ★★★★☆ | Host berjalan di proses terpisah; browser mengelola lifecycle |
| **Message Integrity** | ★★★★★ | Browser menjamin integritas pesan; tidak ada MITM possibility |

### 1.3 Kompatibilitas Browser

| Browser | Status | Manifest | Catatan |
|---------|--------|----------|---------|
| **Chrome/Chromium** | ✅ Fully Supported | v3 | `allowed_origins` berisi `chrome-extension://<ID>/` |
| **Firefox** | ✅ Fully Supported | v2 & v3 | `allowed_extensions` berisi add-on ID; `browser_specific_settings.gecko.id` wajib |
| **Edge** | ✅ Fully Supported | v3 | Chromium-based, kompatibel dengan Chrome |
| **Safari** | ⚠️ Partial | — | Menggunakan mekanisme berbeda: `runtime.connectNative()` hanya bisa connect ke containing macOS app; tidak ada stdio-based protocol |

### 1.4 Kelebihan

1. **Keamanan Bawaan**: Tidak perlu autentikasi tambahan — browser sudah menangani izin akses
2. **Tidak Ada Network Exposure**: Komunikasi murni IPC lokal; tidak ada port yang terbuka
3. **Standar Web**: Didukung oleh standar WebExtension API
4. **Lifecycle Management**: Browser mengelola start/stop host process
5. **Message Framing**: Browser menangani 4-byte length prefix secara otomatis
6. **Ukuran Pesan Dikontrol**: Host→Browser max 1MB, Browser→Host max 64MB

### 1.5 Kekurangan

1. **Setup Manifest Per-Platform**: Membutuhkan registry key (Windows) atau file manifest di lokasi spesifik (macOS/Linux)
2. **Host Binary Harus Executable**: Path di manifest harus menunjuk ke executable yang valid
3. **Service Worker Lifecycle (Chrome MV3)**: Service worker bisa terminate kapan saja; koneksi native harus di-setup ulang
4. **Tidak Ada Wildcard**: `allowed_origins` harus berisi extension ID spesifik, tidak bisa wildcard
5. **Debugging Lebih Sulit**: Tidak ada DevTools untuk inspect stdin/stdout langsung
6. **Safari Terbatas**: Hanya bisa connect ke containing app, bukan arbitrary native host

### 1.6 Arsitektur yang Direkomendasikan

```
┌─────────────────────┐
│   Browser Extension │
│   (Service Worker)  │
│                     │
│  runtime.connectNative()──┐
└─────────────────────┘     │
                            │ stdin/stdout
┌─────────────────────┐     │
│  Native Host Process│◄────┘
│  (Electron Helper)  │
│                     │
│  • Reads stdin      │
│  • Parses JSON      │
│  • Validates auth   │
│  • Queries vault    │
│  • Writes stdout    │
└─────────────────────┘
```

### 1.7 Implementasi di Electron

Electron app tidak bisa langsung menjadi native host karena path harus executable. Solusi:
1. **Helper Binary**: Buat Node.js script kecil yang di-bundle sebagai executable (atau gunakan `electron` path langsung)
2. **Script Wrapper**: Gunakan `.bat` (Windows) atau `.sh` (macOS/Linux) yang menjalankan Node script
3. **Electron CLI**: Point manifest ke `electron.exe` dengan argument ke script host

```json
{
  "name": "com.securepass.manager",
  "description": "SecurePass Manager Native Host",
  "path": "C:\\Program Files\\SecurePass Manager\\native-host.exe",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://<EXTENSION_ID>/"
  ]
}
```

---

## 2. WebSocket

### 2.1 Deskripsi

WebSocket memungkinkan extension menghubungi WebSocket server yang dijalankan oleh Electron app di localhost. Komunikasi full-duplex melalui satu koneksi TCP.

### 2.2 Analisis Keamanan

| Aspek | Penilaian | Detail |
|-------|-----------|--------|
| **Transport Security** | ★★★☆☆ | Localhost only; perlu TLS atau trusted network |
| **Mutual Authentication** | ★★☆☆☆ | Tidak ada bawaan; harus implementasi token/nonce manual |
| **Port Exposure** | ★★☆☆☆ | Port terbuka dan bisa di-scanned oleh aplikasi lain di mesin yang sama |
| **Process Isolation** | ★★★☆☆ | Server berjalan di Electron main process; terpisah dari extension |
| **Message Integrity** | ★★★★☆ | Bisa dijamin dengan HMAC/encryption; namun harus implementasi sendiri |

### 2.3 Kompatibilitas Browser

| Browser | Status | Catatan |
|---------|--------|---------|
| **Chrome** | ✅ Supported | Service worker bisa buka WebSocket connection |
| **Firefox** | ✅ Supported | Background script support WebSocket |
| **Edge** | ✅ Supported | Chromium-based |
| **Safari** | ✅ Supported | WebSocket API tersedia |

### 2.4 Kelebihan

1. **Cross-Browser Universal**: WebSocket tersedia di semua browser modern
2. **Full-Duplex**: Komunikasi dua arah simultan
3. **Fleksibel**: Bisa digunakan dari luar browser (testing, integrasi lain)
4. **Event-Driven**: Cocok untuk model pesan real-time
5. **Mudah Debug**: Bisa di-inspect via DevTools Network tab

### 2.5 Kekurangan

1. **Port Exposure**: Port WebSocket harus terbuka; rentan terhadap port scanning
2. **Autentikasi Manual**: Tidak ada built-in mutual auth; harus implementasi JWT/nonce
3. **Replay Attack Risk**: Tanpa timestamp/nonce, pesan bisa di-replay
4. **Firewall Issues**: Beberapa enterprise firewall memblokir localhost WebSocket
5. **Keamanan Lebih Rendah**: Membutuhkan usaha keamanan ekstensif untuk mencapai level Native Messaging
6. **Port Conflict**: Port bisa konflik dengan aplikasi lain

### 2.6 Arsitektur

```
┌─────────────────────┐     ws://localhost:PORT
│   Browser Extension │◄──────────────────────►┌──────────────────────┐
│                     │     (Auth Required)    │  WebSocket Server    │
└─────────────────────┘                        │  (Electron Main)    │
                                               │                     │
                                               │  • Token Validation  │
                                               │  • Rate Limiting     │
                                               │  • Message Routing   │
                                               └──────────────────────┘
```

### 2.7 Contoh Implementasi

```typescript
// Extension side (background script)
const port = chrome.runtime.connectNative('securepass-host');

// Atau via WebSocket
const ws = new WebSocket('ws://localhost:PORT');
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'GET_MATCHING_ITEMS',
    url: currentUrl,
    token: sessionToken
  }));
};
```

```typescript
// Electron main process
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 0 }); // Dynamic port
wss.on('connection', (ws) => {
  ws.on('message', async (data) => {
    const message = JSON.parse(data.toString());
    // Validate token, query vault, respond
  });
});
```

---

## 3. Custom IPC via Local Server (HTTP)

### 3.1 Deskripsi

HTTP server lokal dijalankan oleh Electron app. Extension mengirim HTTP request ke localhost untuk berinteraksi dengan vault.

### 3.2 Analisis Keamanan

| Aspek | Penilaian | Detail |
|-------|-----------|--------|
| **Transport Security** | ★★☆☆☆ | HTTP tanpa enkripsi; localhost saja |
| **Mutual Authentication** | ★★☆☆☆ | Token-based; harus manage token lifecycle |
| **Port Exposure** | ★☆☆☆☆ | HTTP port terbuka; mudah di-scanned |
| **Process Isolation** | ★★★☆☆ | Server di Electron main process |
| **Message Integrity** | ★★★☆☆ | Bisa dijamin dengan HTTPS, namun overkill untuk localhost |

### 3.3 Kompatibilitas Browser

| Browser | Status | Catatan |
|---------|--------|---------|
| **Chrome** | ⚠️ Restricted | MV3 service worker tidak bisa langsung `fetch('http://localhost')` tanpa `host_permissions` |
| **Firefox** | ✅ Supported | fetch ke localhost diizinkan |
| **Edge** | ⚠️ Restricted | Sama seperti Chrome |
| **Safari** | ✅ Supported | fetch tersedia |

### 3.4 Kelebihan

1. **Paling Mudah Diimplementasi**: HTTP server sudah built-in di Node.js/Electron
2. **Familiar**: Developer sudah mengenal HTTP/REST
3. **Stateless**: Setiap request mandiri
4. **Tooling Kaya**: Bisa test dengan curl, Postman, dll.

### 3.5 Kekurangan

1. **Port Exposure Paling Berisiko**: HTTP port terbuka untuk semua aplikasi di mesin
2. **Tidak ada Enkripsi Bawaan**: HTTP tanpa TLS; credential ter-ekspos di network stack
3. **Chrome MV3 Restrictions**: Service worker memerlukan `host_permissions` untuk localhost
4. **Autentikasi Lemah**: Token-based auth rentan terhadap theft jika port ter-ekspos
5. **Performance**: HTTP overhead lebih tinggi daripada stdio atau WebSocket
6. **Tidak Direkomendasikan untuk Credential Manager**: Standar keamanan industri tidak membenarkan HTTP untuk credential handling

### 3.6 Mengapa Tidak Direkomendasikan

Untuk **password manager**, HTTP localhost server adalah pilihan keamanan terburuk karena:
- Credential dikirim melalui network stack (walaupun localhost)
- Port bisa di-scanned dan di-sniff
- Tidak ada standar enkripsi bawaan
- Chrome MV3 mempersulit akses localhost dari service worker

---

## 4. Perbandingan Detail

### 4.1 Skor Keamanan (1-10)

| Kriteria | Native Messaging | WebSocket | Local HTTP |
|----------|-----------------|-----------|------------|
| Transport Encryption | 10 (stdio) | 6 (localhost) | 4 (HTTP) |
| Authentication | 10 (browser-managed) | 6 (manual) | 5 (manual) |
| Port Exposure Risk | 10 (no port) | 4 (open port) | 2 (open port) |
| Message Integrity | 10 (browser-guaranteed) | 7 (custom) | 5 (custom) |
| MITM Resistance | 10 (no network) | 5 (local) | 4 (local) |
| **Total Keamanan** | **50/50** | **28/50** | **20/50** |

### 4.2 Skor Implementasi (1-10)

| Kriteria | Native Messaging | WebSocket | Local HTTP |
|----------|-----------------|-----------|------------|
| Kemudahan Setup | 5 | 8 | 9 |
| Cross-Browser | 7 | 10 | 7 |
| Debugging | 5 | 8 | 9 |
| Maintenance | 6 | 7 | 8 |
| **Total Implementasi** | **23/40** | **33/40** | **33/40** |

### 4.3 Skor Keseluruhan

| Metode | Keamanan (50) | Implementasi (40) | **Total (90)** |
|--------|--------------|-------------------|----------------|
| **Native Messaging** | 50 | 23 | **73** |
| **WebSocket** | 28 | 33 | **61** |
| **Local HTTP** | 20 | 33 | **53** |

---

## 5. Keputusan Akhir

### 5.1 Metode Utama: **Native Messaging**

**Alasan**:
1. Keamanan superior untuk password manager (tidak ada network exposure)
2. Browser-managed authentication (minimal attack surface)
3. Standar industri untuk password manager (1Password, Bitwarden, LastPass menggunakan ini)
4. Full support di Chrome, Firefox, Edge
5. Safari bisa ditangani dengan contoh native messaging yang sudah ada di Apple docs

### 5.2 Metode Fallback: **WebSocket**

**Alasan**:
1. Universal cross-browser support
2. Bisa digunakan jika Native Messaging setup gagal
3. Berguna untuk debugging dan development
4. Bisa di-enhance dengan JWT authentication

### 5.3 Metode yang DITOLAK: **Local HTTP Server**

**Alasan**:
1. Keamanan tidak memadai untuk credential manager
2. Chrome MV3 mempersulit akses localhost dari service worker
3. Port exposure adalah risiko keamanan yang tidak perlu diambil

---

## 6. Rencana Implementasi

### Phase 1: Native Messaging (Primary)
1. Buat native messaging host manifest untuk Chrome, Firefox, Edge
2. Implementasi stdio-based message handler di Electron main process
3. Implementasi extension-side native messaging client
4. Setup auto-registration manifest saat app install

### Phase 2: WebSocket Fallback
1. Implementasi WebSocket server di Electron main process
2. Auto-select port dan communicate ke extension
3. JWT-based authentication
4. Fallback detection dan auto-switch

### Phase 3: Safari Support
1. Investigasi Safari native messaging (containing app model)
2. Bridge communication via Safari Web Extension API

---

## 7. Referensi

- [Chrome Native Messaging Docs](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Firefox Native Messaging Docs](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging)
- [Edge Native Messaging Docs](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging)
- [Safari Web Extension Messaging](https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension)
- [MDN WebExtensions Examples - Native Messaging](https://github.com/mdn/webextensions-examples/tree/main/native-messaging)
- [Rust native_messaging crate (concept reference)](https://crates.io/crates/native_messaging)

---

*Dokumen ini disusun sebagai bagian dari Sub-Task 1.1: Evaluasi dan Pilih Metode Komunikasi*
*Tanggal: 18 Juni 2026*
