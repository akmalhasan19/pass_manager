# Changelog

All notable changes to SecurePass Manager will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

#### Argon2id KDF Migration (PLANNING-ARGON2ID-MIGRATION)
- Argon2id native module via `argon2@0.44.0` with prebuild binaries
  for Windows x64, macOS (Intel + Apple Silicon), and Linux (glibc
  + musl).
- WASM fallback via `hash-wasm` for environments without a usable
  native binary, and a final PBKDF2-SHA512 fallback when neither
  is available.
- SHA-256 checksum verification of the native binary against
  `src/main/crypto/argon2-checksums.json` before load to detect
  tampering or corruption.
- New `kdfAlgorithm`, `kdfParams`, `kdfVersion`, and `migratedAt`
  fields in the per-vault auth metadata. See
  [docs/DEV-KDF-METADATA-FORMAT.md](DEV-KDF-METADATA-FORMAT.md).
- Automatic, atomic PBKDF2 → Argon2id migration in the background
  after the first unlock of a legacy vault. Backup file
  (`.pre-argon2id-backup`) is created before re-encryption and
  removed only on verified success. On failure the vault is rolled
  back to PBKDF2 and the user receives manual recovery
  instructions.
- 90+ new tests covering unit, integration, security, performance
  and failure recovery of the migration path.

### Documentation

- [docs/DEV-ARGON2ID-NATIVE-MODULE.md](DEV-ARGON2ID-NATIVE-MODULE.md) —
  developer notes for the Argon2id native module: library choice,
  build pipeline, checksum verification, fallback behavior, and
  troubleshooting recipes per platform.
- [docs/DEV-KDF-METADATA-FORMAT.md](DEV-KDF-METADATA-FORMAT.md) —
  specification of the new KDF metadata format, including
  versioning rules, read/write paths, and end-to-end examples.
- [docs/QA-ARGON2ID-CHECKLIST.md](QA-ARGON2ID-CHECKLIST.md) — QA
  runbook with platform-specific test cases for Windows, macOS,
  and Linux, covering pre-flight checks, unlock, migration,
  failure recovery, and performance benchmarks.
- [docs/PLANNING-ARGON2ID-MIGRATION.md](PLANNING-ARGON2ID-MIGRATION.md) —
  implementation plan that drove the work (Sub-Tasks 1.1–6.3).

---

## [0.1.0] — 2026-06-14

### Added

#### Core Infrastructure
- Electron 33 + Vite 6 + React 18 + TypeScript project scaffolding
- Tailwind CSS with custom `notion-theme.css` design system and dark mode support
- Zustand state management with 5 stores: `auth`, `folder`, `item`, `ui`, `settings`
- ESLint + Prettier configuration with TypeScript strict rules
- Vite multi-entry build: main process, preload, and renderer

#### Security Foundation
- AES-256-GCM encryption/decryption with authenticated data (GCM auth tag)
- PBKDF2-SHA512 key derivation (600,000 iterations, 32-byte salt)
- Constant-time hash comparison via `timingSafeEqual`
- Argon2id stub ready for future native integration
- Password strength evaluation (0–4 score, entropy calculation)
- Password health analyzer: weak detection, reuse detection, age audit
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- CSP headers: `script-src 'self'`, `frame-ancestors 'none'`, `form-action 'none'`
- Old key zeroing on password change (`oldKey.fill(0)`)

#### Database
- sql.js (WASM-based SQLite) with in-memory database
- Schema: folders (self-referencing), items, tags, item_tags, attachments, trash, settings
- Migration system with version tracking
- Repository layer: Folder, Item, Tag, Trash, FileAttachment

#### IPC Layer
- 14 IPC channels for auth, folders, items, tags, files, settings, trash, health
- `contextBridge.exposeInMainWorld` with 49 whitelisted API methods
- All communication via `ipcRenderer.invoke` (no `send`)
- Auto-updater IPC handlers with electron-updater integration

#### Frontend UI
- Lock Screen with master password input and setup flow
- Sidebar with recursive `TreeNode` component (drag-and-drop, context menu)
- Quick Find modal (Cmd+K) with real-time search
- Folder View with grid/list layouts for items
- Item Detail View with cover image, emoji, inline editing
- TipTap rich text editor: slash commands, markdown toolbar, bubble menu
- Password Generator modal: length slider, character toggles, strength meter
- Password Health Dashboard: score cards, weak/reused/old lists
- Trash View: restore, permanent delete, empty trash
- Settings View: theme, auto-lock, password defaults, about section
- Custom Title Bar with window controls (frameless)
- Toast notification system (success, error, info)

#### Auto-Lock
- Idle detection via mouse/keyboard/scroll events
- Configurable timeout (via settings)
- 30-second warning before lock
- Extend timer on any activity
- Lock triggers on OS screen lock / system sleep

#### File Attachments
- Buffer-based AES-256-GCM encryption
- Streaming file encryption/decryption for large files
- Secure delete: overwrite with random bytes + unlink
- MIME type detection for 40+ file types

#### Testing
- **Unit tests** (277 tests): crypto, repositories, stores, components, security audit
- **Integration tests** (30 tests): auth flow, IPC round-trip, file attachment, auto-lock
- **E2E tests** (18 tests): Playwright + Electron for full app flow
- **Performance tests** (17 tests): 10K items, 100-level folders, 50MB encryption, bundle analysis
- Security audit: 27 automated checks (logging, key clearing, SQL injection, XSS, CSP, preload)

#### Build & Packaging
- electron-builder config: Windows (NSIS + portable), macOS (DMG), Linux (AppImage + DEB + RPM)
- electron-updater with GitHub Releases provider
- Build pipeline: `tsc && vite build`
- Platform-specific dist scripts: `dist:win`, `dist:mac`, `dist:linux`, `dist:all`

#### Documentation
- README with setup, build, test, and contribution instructions
- SECURITY.md: zero-knowledge architecture, threat model, responsible disclosure
- ARCHITECTURE.md: data flow diagrams, component hierarchy, IPC map, DB schema

---

[0.1.0]: https://github.com/securepass-manager/securepass-manager/releases/tag/v0.1.0
