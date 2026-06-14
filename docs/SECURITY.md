# Security Architecture & Threat Model

## Zero-Knowledge Architecture

SecurePass Manager implements a zero-knowledge architecture: the master password is the **only** way to decrypt user data. It is never transmitted, stored, or accessible to any third party.

### Key Derivation

```
User Input (Master Password)
    ↓
PBKDF2-SHA512 (600,000 iterations)
    ↓
32-byte Random Salt (generated at setup, stored in auth.json as base64)
    ↓
256-bit Master Key
    ↓
    ├── Database Key → Encrypts SQLite database at rest
    ├── Item Encryption Key → AES-256-GCM for individual fields (password, notes)
    └── File Encryption Key → AES-256-GCM for file attachments (streaming)
```

### Authentication

1. **Setup (first launch)**: Master password → PBKDF2 → 256-bit key → SHA-256 hash stored in `auth.json` alongside the salt. The raw key and password are **never persisted**.

2. **Unlock (subsequent launches)**: Master password + stored salt → PBKDF2 → derive key → compare SHA-256 hash against `auth.json`. Constant-time comparison via `timingSafeEqual`.

3. **Lock**: All keys (`masterKey`, `currentSalt`) are nullified in memory. The database handle is closed. All BrowserWindows receive a lock notification.

4. **Password Change**: Old password verified → all items decrypted with old key → re-encrypted with new key → old key buffer zeroed with `.fill(0)` → new auth metadata written.

### Data at Rest

| Layer | Encryption | Scope |
|-------|-----------|-------|
| **Database** | sql.js in-memory DB; exported to encrypted blob on save | Entire DB |
| **Application** | AES-256-GCM per sensitive field | `items.password_encrypted`, `items.notes_encrypted` |
| **Files** | AES-256-GCM streaming encryption per attachment | `attachments/` directory |
| **Auth Metadata** | `auth.json` contains: salt (base64), SHA-256 verification hash, KDF params | No raw secrets |

---

## Threat Model

### Assets

| Asset | Sensitivity | Location |
|-------|------------|----------|
| Master Password | **Critical** | User's memory only |
| Master Key (256-bit) | **Critical** | Memory only, cleared on lock |
| Auth Metadata (salt + hash) | **Medium** | `auth.json` on disk |
| Encrypted Passwords | **High** | SQLite DB on disk |
| Encrypted Notes | **High** | SQLite DB on disk |
| Encrypted Files | **High** | `attachments/` directory |
| Password Health Hashes | **Low** | Memory only (SHA-256 for reuse detection) |

### Attack Vectors & Mitigations

| Vector | Mitigation |
|--------|-----------|
| **Physical disk access** | All data AES-256-GCM encrypted. Auth metadata contains only hash (not key). Brute-force requires >600K PBKDF2 iterations per attempt. |
| **Memory dump / cold boot** | Keys held in memory only while unlocked. Auto-lock clears keys. `oldKey.fill(0)` on password change. |
| **Malware on host** | No defense against OS-level keyloggers or memory scrapers (inherent to all password managers). Recommend OS-level security. |
| **Supply chain (dependencies)** | Dependencies pinned with `^` ranges. `npm audit` run routinely. Critical deps: `sql.js`, `electron`, `react`. |
| **IPC tampering** | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Preload exposes only whitelisted `ipcRenderer.invoke` channels. No `ipcRenderer.send`. |
| **XSS in rich text editor** | Content stored as ProseMirror JSON (not HTML). Rendered via `<EditorContent>` (React DOM, not `innerHTML`). No `dangerouslySetInnerHTML` in entire codebase. |
| **SQL injection** | All queries use parameterized `?` placeholders. Zero string concatenation with user input in SQL. Column names in dynamic queries are hardcoded. |
| **CSP bypass** | `script-src 'self'` only. No `unsafe-inline` or `unsafe-eval`. `frame-ancestors 'none'`. `form-action 'none'`. `base-uri 'self'`. |
| **Electron vulnerability exploitation** | Electron 33+, `webSecurity: true`, `sandbox: true`, auto-updater for prompt patching. |
| **Brute-force unlock** | PBKDF2 with 600K iterations per attempt. No rate limiting at IPC layer (local app). Strong master password policy enforced (score ≥ 2). |

### What We Cannot Protect Against

- **OS-level keyloggers**: Once the user types their master password, it exists in the input field. No in-app mitigation.
- **Compromised OS kernel**: Ring-0 malware can read process memory regardless of in-app protections.
- **Physical coercion**: The app has no duress mode or hidden volumes.
- **Side-channel from password strength feedback**: The strength meter reveals character composition but not actual characters.

---

## Security Design Decisions

### Why sql.js instead of better-sqlite3?

- **Portability**: sql.js is pure WASM — no native compilation required. Works identically on all platforms.
- **No native node-gyp issues**: Simplifies CI, packaging, and cross-platform builds.
- **In-memory + encrypted export**: The database lives in memory and is exported as an encrypted blob on save, rather than using SQLCipher's transparent encryption.

### Why AES-256-GCM (not CBC)?

- **Authenticated encryption**: GCM provides both confidentiality and integrity. Tampered ciphertext is detected (decryption fails with authentication error).
- **No padding oracle attacks**: Unlike CBC, GCM doesn't require padding.

### Why PBKDF2 (not Argon2)?

- **Node.js native support**: PBKDF2 is built into `node:crypto`. Argon2 requires an additional native dependency (`argon2` npm package).
- **Future-proof**: The codebase has a stub for `deriveKeyArgon2id()` ready when the dependency is added.

---

## Responsible Disclosure

If you discover a security vulnerability in SecurePass Manager, please report it privately. **Do not open a public GitHub issue.**

**Contact**: Send an encrypted email to `security@securepass.example.com` with:

1. A detailed description of the vulnerability
2. Steps to reproduce
3. Affected version(s)
4. Any suggested fixes

**PGP Key**: Not yet published. Will be available before v1.0.

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 5 business days
- **Fix timeline**: Depends on severity; critical fixes prioritized within 7 days
- **Public disclosure**: Coordinated with reporter after fix is released

### Scope

| In Scope | Out of Scope |
|----------|-------------|
| Encryption implementation | OS-level vulnerabilities |
| IPC security boundary | Social engineering |
| CSP configuration | Physical attacks |
| Dependency vulnerabilities (known CVEs) | DoS via 100K items |
| Key management lifecycle | Issues in upstream Electron |

---

## Audit History

| Date | Version | Auditor | Findings |
|------|---------|---------|----------|
| 2026-06-14 | 0.1.0 | Automated + manual review | No critical/high findings. 4 medium recommendations addressed: sandbox enabled, base-uri CSP added, old key zeroing, connect-src note. |

---

## Security Checklist

- [x] No sensitive data logged to console or files
- [x] Keys cleared from memory on lock (`masterKey = null`, `salt = null`)
- [x] Old key zeroed on password change (`oldKey.fill(0)`)
- [x] All SQL queries parameterized (no string concatenation)
- [x] XSS: no `dangerouslySetInnerHTML`, ProseMirror JSON storage
- [x] Preload: only `contextBridge` + `ipcRenderer.invoke`
- [x] CSP: `script-src 'self'`, no `unsafe-inline`, no `unsafe-eval`
- [x] `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- [x] Auth metadata: salt + SHA-256 hash only (no raw key)
- [x] Constant-time hash comparison via `timingSafeEqual`
