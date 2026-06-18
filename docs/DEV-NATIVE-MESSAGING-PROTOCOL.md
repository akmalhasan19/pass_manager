# Developer Notes: Native Messaging Protocol

> Dokumentasi teknis untuk developer yang bekerja dengan integrasi Browser Extension
> dan Electron host via Native Messaging.

---

## 1. Protocol Overview

SecurePass Manager menggunakan **Native Messaging API** untuk komunikasi antara browser extension (Chrome, Firefox, Edge) dan aplikasi Electron host.

### 1.1 Arsitektur Komunikasi

```
┌─────────────────────┐     stdin/stdout     ┌──────────────────────┐
│   Browser Extension │◄────────────────────►│  Electron Host       │
│   (Service Worker)  │   4-byte length +    │  (Main Process)      │
│                     │   JSON payload       │                      │
│  chrome.runtime.    │                      │  ExtensionService    │
│  connectNative()    │                      │  validates & routes  │
└─────────────────────┘                      └──────────────────────┘
```

### 1.2 Message Flow

```
Extension                        Host
   │                               │
   │──── GET_MATCHING_ITEMS ──────►│
   │     {url: "github.com"}       │
   │                               │ ── Query vault ──
   │                               │ ── Match domain ──
   │◄── MATCHING_ITEMS_RESPONSE ───│
   │     {items: [...]}            │
   │                               │
   │──── GET_CREDENTIALS ─────────►│
   │     {itemId: "abc123"}        │
   │                               │ ── Fetch item ──
   │                               │ ── Decrypt password ──
   │◄── CREDENTIALS_RESPONSE ──────│
   │     {item: {...}}             │
```

---

## 2. Message Format

### 2.1 Base Message

Semua pesan (request dan response) memiliki struktur dasar yang sama:

```typescript
interface ProtocolMessage {
  requestId: string;      // UUID untuk tracing
  timestamp: number;      // Unix timestamp (ms)
  protocolVersion: number; // Versi protokol (saat ini: 1)
}
```

### 2.2 Wire Format (Native Messaging)

```
[4 bytes: message length (uint32 LE)] [N bytes: UTF-8 JSON]
```

- Browser → Host: max 64 MiB
- Host → Browser: max 1 MiB

### 2.3 Timestamp Validation

Pesan ditolak jika timestamp lebih tua dari 5 menit (PROTOCOL_MAX_AGE_MS = 300000ms). Ini mencegah replay attack.

---

## 3. Request Types (Extension → Host)

### 3.1 GET_CREDENTIALS

Mengambil satu credential berdasarkan item ID.

```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": 1718736000000,
  "protocolVersion": 1,
  "type": "GET_CREDENTIALS",
  "itemId": "item_abc123",
  "includeOtp": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `itemId` | string | ✅ | ID item di vault |
| `includeOtp` | boolean | ❌ | Sertakan kode TOTP saat ini |

### 3.2 GET_MATCHING_ITEMS

Mencari credential yang cocok dengan URL/domain tertentu.

```json
{
  "requestId": "660e8400-e29b-41d4-a716-446655440001",
  "timestamp": 1718736000000,
  "protocolVersion": 1,
  "type": "GET_MATCHING_ITEMS",
  "url": "https://github.com/login",
  "domain": "github.com",
  "limit": 10
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | ✅ | URL halaman saat ini |
| `domain` | string | ❌ | Override domain |
| `limit` | number | ❌ | Max items (default: 50) |

### 3.3 COPY_TO_CLIPBOARD

Menyalin field credential ke clipboard.

```json
{
  "requestId": "770e8400-e29b-41d4-a716-446655440002",
  "timestamp": 1718736000000,
  "protocolVersion": 1,
  "type": "COPY_TO_CLIPBOARD",
  "itemId": "item_abc123",
  "field": "password",
  "clearAfterSeconds": 45
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `itemId` | string | ✅ | ID item |
| `field` | enum | ✅ | `username`, `password`, atau `otp` |
| `clearAfterSeconds` | number | ❌ | Auto-clear (default: 45, max: 300) |

### 3.4 LOCK_VAULT

Meminta host untuk lock vault segera.

```json
{
  "requestId": "880e8400-e29b-41d4-a716-446655440003",
  "timestamp": 1718736000000,
  "protocolVersion": 1,
  "type": "LOCK_VAULT"
}
```

---

## 4. Response Types (Host → Extension)

### 4.1 CREDENTIALS_RESPONSE

Response sukses untuk GET_CREDENTIALS.

```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": 1718736000001,
  "protocolVersion": 1,
  "type": "CREDENTIALS_RESPONSE",
  "item": {
    "id": "item_abc123",
    "title": "GitHub",
    "username": "user@example.com",
    "passwordEncrypted": "base64-encoded-aes-gcm-blob",
    "url": "https://github.com",
    "isFavorite": true,
    "emoji": "🐙",
    "otpCode": "123456",
    "otpRemainingSeconds": 15
  }
}
```

### 4.2 MATCHING_ITEMS_RESPONSE

Response sukses untuk GET_MATCHING_ITEMS.

```json
{
  "requestId": "660e8400-e29b-41d4-a716-446655440001",
  "timestamp": 1718736000001,
  "protocolVersion": 1,
  "type": "MATCHING_ITEMS_RESPONSE",
  "items": [...],
  "matchedDomain": "github.com",
  "totalCount": 2
}
```

### 4.3 NO_MATCH_FOUND

Tidak ada credential yang cocok.

```json
{
  "requestId": "...",
  "timestamp": 1718736000001,
  "protocolVersion": 1,
  "type": "NO_MATCH_FOUND",
  "searchedDomain": "unknown-site.com",
  "searchedUrl": "https://unknown-site.com/login"
}
```

### 4.4 VAULT_LOCKED

Vault sedang terkunci.

```json
{
  "requestId": "...",
  "timestamp": 1718736000001,
  "protocolVersion": 1,
  "type": "VAULT_LOCKED",
  "message": "Vault is locked. Please unlock in the SecurePass app."
}
```

### 4.5 CLIPBOARD_CONFIRMATION

Konfirmasi clipboard copy berhasil.

```json
{
  "requestId": "...",
  "timestamp": 1718736000001,
  "protocolVersion": 1,
  "type": "CLIPBOARD_CONFIRMATION",
  "field": "password",
  "clearAfterSeconds": 45
}
```

### 4.6 ERROR

Response error.

```json
{
  "requestId": "...",
  "timestamp": 1718736000001,
  "protocolVersion": 1,
  "type": "ERROR",
  "code": "ITEM_NOT_FOUND",
  "message": "The requested item does not exist in the vault.",
  "details": { "itemId": "item_abc123" }
}
```

---

## 5. Error Codes

| Code | HTTP-like | Description |
|------|-----------|-------------|
| `INVALID_MESSAGE` | 400 | Pesan tidak bisa di-parse |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Tipe pesan tidak dikenal |
| `UNSUPPORTED_PROTOCOL_VERSION` | 400 | Versi protokol tidak didukung |
| `TIMESTAMP_EXPIRED` | 400 | Timestamp terlalu tua (>5 menit) |
| `DUPLICATE_REQUEST_ID` | 409 | Request ID sudah digunakan (replay) |
| `VAULT_LOCKED` | 423 | Vault terkunci |
| `ITEM_NOT_FOUND` | 404 | Item tidak ditemukan |
| `NO_PASSWORD` | 404 | Item tidak memiliki password |
| `NO_OTP_CONFIGURED` | 404 | Item tidak memiliki OTP |
| `INVALID_URL` | 400 | URL tidak valid |
| `CLIPBOARD_FAILED` | 500 | Gagal menyalin ke clipboard |
| `INTERNAL_ERROR` | 500 | Error internal host |
| `RATE_LIMITED` | 429 | Rate limit terlampaui |
| `UNAUTHORIZED` | 401 | Extension tidak terautentikasi |

---

## 6. Security Properties

### 6.1 Replay Attack Prevention

- Setiap pesan memiliki `timestamp` yang divalidasi (max age: 5 menit)
- `requestId` di-track untuk mendeteksi duplikasi
- `RequestIdTracker` class menyimpan ID yang sudah digunakan dan auto-purge setelah expiry

### 6.2 Credential Isolation

- Password dikirim sebagai encrypted blob (AES-256-GCM)
- Hanya extension yang sudah handshake yang bisa mendekripsi
- Credential TIDAK pernah disimpan di memory extension secara persistent

### 6.3 Domain Matching

- URL di-parse untuk mengekstrak domain
- Domain matching dilakukan di host (bukan extension)
- Subdomain di-support: `sub.github.com` match dengan `github.com`

---

## 7. TypeScript Types

```typescript
// Import semua tipe dari satu lokasi
import {
  HostRequestType,
  ExtensionResponseType,
  ErrorCode,
  type HostRequest,
  type ExtensionResponse,
  type GetCredentialsRequest,
  type GetMatchingItemsRequest,
  // ... dst
} from '@shared/protocols/nativeMessaging';

// Import validasi
import {
  validateIncomingRequest,
  validateIncomingResponse,
  isTimestampFresh,
  RequestIdTracker,
  createErrorResponse,
} from '@shared/protocols/validation';
```

---

## 8. File Locations

| File | Peran |
|------|-------|
| `src/shared/protocols/nativeMessaging.ts` | TypeScript type definitions, enums, type guards |
| `src/shared/protocols/validation.ts` | Validation functions, RequestIdTracker, error factory |
| `src/shared/schemas/native-messaging-v1.schema.json` | JSON Schema untuk validasi |
| `docs/DEV-NATIVE-MESSAGING-PROTOCOL.md` | Dokumentasi ini |

---

## 9. Integration Checklist

- [ ] Extension: Kirim `requestId` (UUID) di setiap request
- [ ] Extension: Kirim `timestamp` (Date.now()) di setiap request
- [ ] Extension: Kirim `protocolVersion: 1` di setiap request
- [ ] Host: Validasi timestamp (< 5 menit)
- [ ] Host: Cek `requestId` duplikat
- [ ] Host: Validasi semua field sesuai schema
- [ ] Host: Return error response yang valid jika validasi gagal
- [ ] Extension: Handle semua tipe response termasuk error
- [ ] Extension: Handle `VAULT_LOCKED` dengan menampilkan pesan yang sesuai

---

*Dokumen ini disusun sebagai bagian dari Sub-Task 1.2: Definisikan Protokol Pesan*
*Tanggal: 18 Juni 2026*
