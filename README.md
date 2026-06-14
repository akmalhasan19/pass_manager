# SecurePass Manager

A zero-knowledge desktop password manager with a Notion-like interface. Built with Electron, React, TypeScript, and Tailwind CSS.

> ⚠️ **Pre-release**: Version 0.1.0 — Core architecture and scaffolding complete.

---

## Features

- **Zero-Knowledge Encryption**: Your master password never leaves your device. All data is encrypted locally with AES-256-GCM.
- **Hierarchical Folders**: Organize credentials in unlimited nested folders (like a file explorer).
- **Notion-like Sidebar**: Collapsible sidebar with emoji icons, drag-and-drop reordering, and quick search.
- **Password Generator**: Cryptographically secure random passwords with customizable character sets.
- **Rich Text Notes**: Markdown-powered notes with slash commands for recovery codes, SSH keys, and more.
- **Password Health Dashboard**: Analyzes password strength, detects reused and weak passwords.
- **Auto-Lock Timer**: Automatically locks the app after a configurable idle period.
- **Dark Mode**: Full dark theme support with system preference detection.
- **File Attachments**: Encrypted attachment storage for identity documents, PDFs, and more.
- **Trash Bin**: Deleted items go to trash for recovery, with configurable auto-purge.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop Shell | Electron 33 + Vite 6 |
| Frontend | React 18 + TypeScript |
| Styling | Tailwind CSS 3 + Headless UI |
| State | Zustand + Immer |
| Database | SQLite + SQLCipher (via better-sqlite3) |
| Encryption | AES-256-GCM via Node.js Crypto |
| Rich Text | TipTap (ProseMirror) |
| Animation | Framer Motion |
| Testing | Vitest + React Testing Library |

---

## Project Structure

```
secure-pass-manager/
├── src/
│   ├── main/              # Electron main process
│   │   ├── database/      # SQLCipher setup, migrations, repositories
│   │   ├── crypto/        # Key derivation, encryption, password tools
│   │   ├── ipc/           # IPC handlers (auth, folders, items, etc.)
│   │   └── file-system/   # Encrypted file attachment storage
│   ├── renderer/          # React frontend
│   │   ├── components/    # UI components (layout, ui, editor, views, widgets)
│   │   ├── hooks/         # Custom React hooks
│   │   ├── stores/        # Zustand state stores
│   │   ├── styles/        # Tailwind CSS and custom styles
│   │   ├── pages/         # Page-level views
│   │   └── utils/         # Utilities and helpers
│   ├── shared/            # Shared types and constants
│   └── preload/           # Preload script (secure bridge)
├── tests/                 # Test suites
├── resources/             # Static assets and icons
└── build/                 # Electron builder config
```

---

## Getting Started

### Prerequisites

- **Node.js** >= 20.0.0
- **npm** >= 10.0.0
- **Python** 3.x (required for native module compilation)
- **C++ Build Tools** (required for better-sqlite3 native binding)
  - **Windows**: Visual Studio Build Tools or `npm install --global windows-build-tools`
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Linux**: `build-essential` (`sudo apt install build-essential`)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/secure-pass-manager.git
cd secure-pass-manager

# Install dependencies
npm install

# The postinstall script will automatically rebuild native modules
```

### Development

```bash
# Start the development server with hot-reload
npm run dev

# Type checking (in a separate terminal)
npm run typecheck

# Lint
npm run lint
```

### Build & Package

```bash
# Build for production
npm run build

# Package for current platform
npm run dist

# Package for specific platform
npm run dist:win       # Windows installer
npm run dist:mac       # macOS .dmg
npm run dist:linux     # Linux AppImage
```

### Testing

```bash
# Run all tests
npm run test

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage
```

---

## Security Architecture

### Zero-Knowledge Flow

```
Master Password
    ↓
PBKDF2 / Argon2id (+ unique salt)
    ↓
256-bit Master Key
    ↓
    ├── SQLCipher Database Key
    ├── Item Encryption Key (AES-256-GCM)
    └── File Encryption Key (AES-256-GCM)
```

- **Keys are never persisted** — derived at runtime, wiped on lock.
- **Defense in depth** — database encrypted at rest via SQLCipher, individual fields additionally encrypted.
- **No telemetry** — all data stays local. No cloud, no tracking.

---

## License

MIT

---

## Security

If you discover a security vulnerability, please report it responsibly. Do not open a public GitHub issue.
