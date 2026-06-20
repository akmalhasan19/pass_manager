# SecurePass Manager

A zero-knowledge desktop password manager with a Notion-like interface. Built with Electron, React, TypeScript, and Tailwind CSS.

> **Version 0.1.0** — Core functionality complete: encryption, CRUD, rich text, password health, auto-lock, and E2E testing.

---

## Features

- **Zero-Knowledge Encryption**: Master password never leaves your device. AES-256-GCM encryption at rest and in transit.
- **Hierarchical Folders**: Unlimited nested folders with emoji icons and drag-and-drop reordering.
- **Notion-like UX**: Collapsible sidebar, slash-command-rich text editor, quick-find (Cmd+K), emoji covers.
- **Password Generator**: Cryptographically secure generation with customizable length and character sets.
- **Password Health Dashboard**: Audits passwords for weakness, reuse, and age with visual scoring.
- **Rich Text Notes (TipTap)**: Markdown-like editing with slash commands for code blocks, checklists, and links.
- **Auto-Lock**: Configurable idle timer that locks the app and wipes encryption keys from memory.
- **Dark Mode**: Full dark theme support with light/dark/system preference.
- **Encrypted File Attachments**: Attach and encrypt files using streaming AES-256-GCM.
- **Trash & Recovery**: Soft-delete with restore, configurable auto-purge.
- **Auto-Updates**: Built-in electron-updater support for GitHub Releases.

---

## Tech Stack

| Layer           | Technology                                         |
| --------------- | -------------------------------------------------- |
| Desktop Shell   | Electron 33 + Vite 6                               |
| Frontend        | React 18 + TypeScript                              |
| Styling         | Tailwind CSS 3 + Headless UI + Framer Motion       |
| State           | Zustand + Immer                                    |
| Database        | SQLite via sql.js (WASM)                           |
| Encryption      | AES-256-GCM + PBKDF2 via Node.js Crypto            |
| Rich Text       | TipTap (ProseMirror)                               |
| Testing (unit)  | Vitest + React Testing Library                     |
| Testing (e2e)   | Playwright + Electron                              |
| Packaging       | electron-builder                                   |
| Updates         | electron-updater                                   |

---

## Project Structure

```
secure-pass-manager/
├── src/
│   ├── main/              # Electron main process
│   │   ├── database/      # sql.js setup, schema, migrations, repositories
│   │   ├── crypto/        # Key derivation, AES-256-GCM, password tools
│   │   ├── ipc/           # IPC handlers (auth, folders, items, files, settings, updates)
│   │   ├── file-system/   # Encrypted file attachment storage (streaming)
│   │   └── index.ts       # Main process entry
│   ├── renderer/          # React frontend
│   │   ├── components/    # UI: layout, ui, editor, views, widgets
│   │   ├── hooks/         # Custom hooks (useAuth, useAutoLock, useTheme, etc.)
│   │   ├── stores/        # Zustand: auth, folder, item, ui, settings, toast
│   │   ├── styles/        # Tailwind + custom notion-theme.css
│   │   ├── pages/         # App.tsx, LockScreenPage, MainAppPage
│   │   └── utils/         # Constants, formatters, validators
│   ├── shared/            # Shared: types.ts, ipcChannels.ts, constants.ts
│   └── preload/           # contextBridge API (secure ipcRenderer bridge)
├── tests/
│   ├── unit/              # Unit tests (crypto, repos, stores, components, security)
│   ├── integration/       # Integration tests (auth flow, IPC, file attachment, auto-lock)
│   ├── e2e/               # End-to-end tests (Playwright + Electron)
│   └── performance/       # Stress tests (10K items, 100-level folders, 50MB files)
├── build/                 # electron-builder config + icons
├── resources/             # Static assets
└── docs/                  # Documentation (SECURITY.md, ARCHITECTURE.md, CHANGELOG.md)
```

---

## Getting Started

### Prerequisites

- **Node.js** >= 20.0.0
- **npm** >= 10.0.0

### Installation

```bash
git clone https://github.com/securepass-manager/securepass-manager.git
cd secure-pass-manager
npm install
```

### Development

```bash
# Start dev server with hot-reload (Vite + Electron)
npm run dev

# Force native messaging mode for testing browser extension integration
$env:SECURE_PASS_FORCE_NATIVE_MESSAGING="1"; npm run dev   # PowerShell
set SECURE_PASS_FORCE_NATIVE_MESSAGING=1 && npm run dev   # cmd / bash

# Type checking
npm run typecheck

# Lint (0 errors required)
npm run lint

# Auto-fix lint issues
npm run lint:fix

# Format code
npm run format

# Check formatting
npm run format:check
```

### Build

```bash
# Build for production (compiles main, preload, and renderer)
npm run build

# Package for distribution
npm run dist          # Current platform
npm run dist:win      # Windows (NSIS installer + portable)
npm run dist:mac      # macOS (DMG)
npm run dist:linux    # Linux (AppImage + DEB + RPM)
npm run dist:all      # All platforms

# Clean build artifacts
npm run clean
```

### Testing

```bash
# Run unit + integration + performance tests (403 tests)
npm run test

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage

# E2E tests (Playwright + Electron)
npm run test:e2e

# Full CI pipeline
npm run test:all       # typecheck + test + e2e
```

---

## Security Architecture

### Zero-Knowledge Flow

```
Master Password
    ↓
PBKDF2 (600,000 iterations + 32-byte random salt)
    ↓
256-bit Master Key (never persisted to disk)
    ↓
    ├── Database stored as encrypted SQLite blob
    ├── Individual fields encrypted via AES-256-GCM
    └── File attachments encrypted via streaming AES-256-GCM
```

### Key Principles

- **Keys are never persisted** — derived at runtime from master password + salt, wiped from memory on lock.
- **Defense in depth** — database encrypted at rest (sql.js in-memory with encrypted export), individual sensitive fields additionally encrypted before storage.
- **Auth metadata** — only salt (base64) + SHA-256 verification hash stored on disk. Raw key never written.
- **Secure IPC** — contextIsolation: true, nodeIntegration: false, sandbox: true, CSP with no unsafe-inline/unsafe-eval.
- **No telemetry** — all data stays local. No external network requests (except auto-update checks if enabled).
- **All SQL parameterized** — zero SQL injection surface. Input validation at every IPC boundary.

See [docs/SECURITY.md](docs/SECURITY.md) for the full threat model and responsible disclosure policy.

---

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for data flow diagrams, component hierarchy, and IPC communication details.

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run `npm run lint` and `npm run format` to ensure code quality
5. Run `npm run test` to ensure all tests pass
6. Run `npm run typecheck` for type safety
7. Commit with a descriptive message
8. Push and open a Pull Request

### Code Quality Requirements

- **TypeScript strict mode** — no `any` without explicit reason
- **ESLint** — 0 errors required
- **Prettier** — all files must be formatted
- **Tests** — new features require tests
- **Security** — no `console.log` of sensitive data, no `require('fs')` in renderer

---

## Changelog

See [docs/CHANGELOG.md](docs/CHANGELOG.md).

---

## License

MIT

---

## Security

If you discover a security vulnerability, please **do not** open a public GitHub issue. See [docs/SECURITY.md](docs/SECURITY.md) for responsible disclosure instructions.
