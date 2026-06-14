# SecurePass Manager — Product Requirements Document (PRD)

## 📋 Project Overview

**Name:** SecurePass Manager  
**Type:** Desktop Password Manager (Electron + React + TypeScript)  
**Architecture:** Zero-Knowledge, Local-First, Encrypted SQLite  
**Target Platform:** Windows, macOS, Linux (via Electron)  
**Security Standard:** AES-256-GCM, PBKDF2/Argon2, SQLCipher  
**UI Style:** Notion-inspired (minimalist, block-based, sidebar, dark mode support)

---

## 🎯 Objectives & Success Criteria

1. **Zero-Knowledge Architecture**: Server cannot read user data; only the user holds the master password.
2. **Hierarchical Organization**: Unlimited nested folders for grouping credentials.
3. **Notion-like UX**: Sidebar, quick find, drag-and-drop, emoji covers, and clean typography.
4. **High Security**: Encrypted database, auto-lock, secure password generation, health audit.
5. **Extensibility**: Clean architecture to support future features (cloud sync, browser extension, etc.).

---

## 🏗️ Tech Stack & Architecture Decisions

| Layer | Technology | Decision Rationale |
|---|---|---|
| **Desktop Shell** | Electron + Vite | Mature ecosystem, easy debugging, seamless Node.js native module integration for SQLCipher. |
| **Frontend Framework** | React 18 + TypeScript | Type safety is critical for security apps; vast ecosystem. |
| **Styling** | Tailwind CSS + Headless UI | Utility-first, fast to build custom Notion-like components without heavy CSS files. |
| **State Management** | Zustand + Immer | Lightweight, minimal boilerplate, excellent for deeply nested tree structures (folders). |
| **Database** | better-sqlite3 + SQLCipher | Synchronous API, high performance, well-documented encryption binding for Electron. |
| **Cryptography** | Node.js crypto (main) + Web Crypto API (renderer backup) | Node crypto for KDF (PBKDF2/Argon2) and AES-256-GCM; Web Crypto for potential future web-port. |
| **Rich Text Editor** | TipTap (ProseMirror-based) | Native support for slash commands, markdown-like shortcuts, and extensible node system. |
| **File Attachments** | Encrypted filesystem + SQLite metadata | Keeps DB size lean; encrypts files at rest using AES-256-GCM with derived key. |
| **Build Tool** | Vite | Extremely fast HMR and bundling; modern replacement for webpack in Electron apps. |

---

## 🗂️ Project Structure

```
secure-pass-manager/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── database/            # SQLCipher setup, schema, migrations
│   │   │   ├── connection.ts
│   │   │   ├── schema.sql
│   │   │   ├── migrations.ts
│   │   │   └── repositories/    # DAO layer for each entity
│   │   │       ├── FolderRepository.ts
│   │   │       ├── ItemRepository.ts
│   │   │       ├── TagRepository.ts
│   │   │       ├── FileAttachmentRepository.ts
│   │   │       └── TrashRepository.ts
│   │   ├── crypto/              # All cryptographic operations
│   │   │   ├── keyDerivation.ts
│   │   │   ├── encryption.ts
│   │   │   ├── passwordGenerator.ts
│   │   │   └── passwordHealth.ts
│   │   ├── ipc/                 # IPC handlers (secure bridge between main & renderer)
│   │   │   ├── authHandlers.ts
│   │   │   ├── folderHandlers.ts
│   │   │   ├── itemHandlers.ts
│   │   │   ├── searchHandlers.ts
│   │   │   ├── fileHandlers.ts
│   │   │   └── settingsHandlers.ts
│   │   ├── file-system/         # Encrypted file attachment storage
│   │   │   ├── storageManager.ts
│   │   │   └── encryptionStream.ts
│   │   └── index.ts             # Main process entry point
│   ├── renderer/                # React frontend (Chromium process)
│   │   ├── components/          # UI components
│   │   │   ├── layout/
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   ├── MainPanel.tsx
│   │   │   │   ├── TitleBar.tsx
│   │   │   │   └── QuickFind.tsx
│   │   │   ├── ui/
│   │   │   │   ├── Button.tsx
│   │   │   │   ├── Input.tsx
│   │   │   │   ├── Modal.tsx
│   │   │   │   ├── EmojiPicker.tsx
│   │   │   │   ├── CoverImage.tsx
│   │   │   │   └── TreeNode.tsx
│   │   │   ├── editor/
│   │   │   │   ├── RichTextEditor.tsx
│   │   │   │   ├── SlashCommandMenu.tsx
│   │   │   │   └── MarkdownToolbar.tsx
│   │   │   ├── views/
│   │   │   │   ├── LockScreen.tsx
│   │   │   │   ├── DashboardView.tsx
│   │   │   │   ├── FolderView.tsx
│   │   │   │   ├── ItemDetailView.tsx
│   │   │   │   ├── PasswordHealthView.tsx
│   │   │   │   ├── TrashView.tsx
│   │   │   │   └── SettingsView.tsx
│   │   │   └── widgets/
│   │   │       ├── PasswordGenerator.tsx
│   │   │       ├── PasswordStrength.tsx
│   │   │       ├── AutoLockTimer.tsx
│   │   │       └── SearchResultCard.tsx
│   │   ├── hooks/               # Custom React hooks
│   │   │   ├── useAuth.ts
│   │   │   ├── useFolders.ts
│   │   │   ├── useItems.ts
│   │   │   ├── useSearch.ts
│   │   │   ├── useCrypto.ts
│   │   │   ├── useAutoLock.ts
│   │   │   ├── useDragDrop.ts
│   │   │   └── useSettings.ts
│   │   ├── stores/              # Zustand global state stores
│   │   │   ├── authStore.ts
│   │   │   ├── folderStore.ts
│   │   │   ├── itemStore.ts
│   │   │   ├── uiStore.ts
│   │   │   └── settingsStore.ts
│   │   ├── styles/              # Tailwind & custom styles
│   │   │   ├── tailwind.config.js
│   │   │   ├── globals.css
│   │   │   └── notion-theme.css
│   │   ├── pages/               # Top-level page views
│   │   │   ├── App.tsx
│   │   │   ├── LockScreenPage.tsx
│   │   │   └── MainAppPage.tsx
│   │   ├── utils/               # Helper utilities
│   │   │   ├── constants.ts
│   │   │   ├── formatters.ts
│   │   │   └── validators.ts
│   │   └── index.tsx            # Renderer entry point
│   ├── shared/                  # Shared between main & renderer
│   │   ├── types.ts             # TypeScript interfaces
│   │   ├── constants.ts         # App constants
│   │   └── ipcChannels.ts       # IPC channel names (enum)
│   └── preload/                 # Preload script (secure bridge)
│       └── index.ts
├── resources/                   # Static assets, migrations, icons
│   ├── assets/
│   ├── icons/
│   └── migrations/
├── build/                       # Electron builder config
│   ├── electron-builder.yml
│   └── icons/
├── scripts/                     # Dev & setup scripts
│   ├── setup-sqlcipher.js
│   └── postinstall.js
├── tests/                       # Test suites
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── .env.example
├── .eslintrc.json
├── .prettierrc
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vite.main.config.ts
└── vite.preload.config.ts
```

---

## 🔐 Security Architecture

### 1. Zero-Knowledge Flow
```
User Input (Master Password)
    ↓
KDF (PBKDF2 / Argon2id) + Salt
    ↓
Master Key (256-bit)
    ↓
    ├─→ Database Key (wraps SQLCipher key)
    ├─→ Item Encryption Key (AES-256-GCM for individual items)
    └─→ File Encryption Key (AES-256-GCM for attachments)
```

### 2. Data-at-Rest Encryption
- **Database Layer**: SQLCipher encrypts the entire SQLite file transparently.
- **Application Layer**: Sensitive fields (passwords, notes, attachments) are additionally encrypted with AES-256-GCM before storage (defense in depth).
- **Key Storage**: Keys are **never** persisted to disk. Only derived at runtime and held in memory.

### 3. Auto-Lock
- Timer tracks user idle time (mouse/keyboard events).
- After configured idle time (default 5 min), app returns to Lock Screen.
- All keys are wiped from memory; encrypted DB remains on disk.

### 4. Password Generator
- Cryptographically secure random generation via `crypto.randomBytes()`.
- Customizable: length, uppercase, lowercase, numbers, symbols, exclude ambiguous characters.

### 5. Password Health Dashboard
- **Weak Detection**: Length < 12, no variety, dictionary checks.
- **Reuse Detection**: Hash-based comparison to find duplicates without exposing plaintext.
- **Age Detection**: Flags passwords older than 90 days (configurable).

---

## 📊 Database Schema (SQLCipher)

### Tables
```sql
-- Folders (hierarchical, self-referencing)
CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    emoji TEXT,
    cover_image TEXT,
    created_at INTEGER,
    updated_at INTEGER,
    sort_order INTEGER DEFAULT 0
);

-- Password Items
CREATE TABLE items (
    id TEXT PRIMARY KEY,
    folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    username TEXT,
    password_encrypted BLOB,        -- AES-256-GCM encrypted
    url TEXT,
    notes_encrypted BLOB,           -- AES-256-GCM encrypted (TipTap JSON)
    emoji TEXT,
    cover_image TEXT,
    created_at INTEGER,
    updated_at INTEGER,
    is_favorite INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0
);

-- Tags
CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT
);

-- Item-Tag relationship (many-to-many)
CREATE TABLE item_tags (
    item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
    tag_id TEXT REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, tag_id)
);

-- File Attachments
CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
    folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    mime_type TEXT,
    file_size INTEGER,
    storage_path TEXT NOT NULL,     -- encrypted file on disk
    created_at INTEGER
);

-- Trash / Recycle Bin
CREATE TABLE trash (
    id TEXT PRIMARY KEY,
    original_type TEXT NOT NULL,    -- 'folder' or 'item'
    original_id TEXT NOT NULL,
    original_parent_id TEXT,
    data_encrypted BLOB,            -- full serialized object encrypted
    deleted_at INTEGER
);

-- App Settings
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Auth metadata (salt, KDF params — NOT the key)
CREATE TABLE auth_metadata (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    salt BLOB NOT NULL,
    kdf_algorithm TEXT DEFAULT 'pbkdf2',
    kdf_iterations INTEGER DEFAULT 600000,
    kdf_memory INTEGER,             -- for Argon2
    kdf_parallelism INTEGER,        -- for Argon2
    created_at INTEGER
);
```

---

## 🎨 UI/UX Design System

### Core Principles
- **Minimalist**: White space, no borders, subtle shadows.
- **Notion-like**: Block-based layout, slash commands, draggable sidebar.
- **Typography**: Inter / Geist font family, 14px base, 1.5 line height.
- **Colors**: Neutral grays with accent color (indigo/slate). Full dark mode support.
- **Animations**: Framer Motion for smooth page transitions, sidebar collapse, and drag-and-drop.

### Key Views
1. **Lock Screen**: Full-screen centered, master password input, logo.
2. **Main App**: Sidebar (left) + Main Panel (center/right).
3. **Sidebar**: Collapsible, tree view of folders, emoji icons, drag handles.
4. **Quick Find**: CMD+K modal, fuzzy search across folders/items/tags.
5. **Item Detail**: Cover image, emoji, title, username, password (reveal toggle), URL, rich text notes (TipTap), tags, attachments.
6. **Password Health**: Dashboard cards, charts, weak/reused/aged lists.
7. **Trash**: List of deleted items with restore/permanent delete.

---

## 🔌 IPC Communication (Main ↔ Renderer)

| Channel | Direction | Payload | Description |
|---|---|---|---|
| `auth:init` | R → M | `{ masterPassword }` | First-time setup, creates DB + salt |
| `auth:unlock` | R → M | `{ masterPassword }` | Unlock DB, derive keys |
| `auth:lock` | R → M | — | Wipe keys, return to lock |
| `auth:change-password` | R → M | `{ oldPassword, newPassword }` | Re-encrypt DB with new key |
| `folder:getTree` | R → M | — | Get full folder tree |
| `folder:create` | R → M | `{ parentId, name, emoji }` | Create new folder |
| `folder:update` | R → M | `{ id, name?, emoji?, cover? }` | Update folder |
| `folder:move` | R → M | `{ id, newParentId, newSortOrder }` | Move folder via DnD |
| `folder:delete` | R → M | `{ id }` | Move to trash |
| `item:getByFolder` | R → M | `{ folderId }` | Get items in folder |
| `item:getById` | R → M | `{ id }` | Get single item details |
| `item:create` | R → M | `{ folderId, ...fields }` | Create new item |
| `item:update` | R → M | `{ id, ...fields }` | Update item |
| `item:delete` | R → M | `{ id }` | Move to trash |
| `item:search` | R → M | `{ query }` | Full-text search |
| `tag:getAll` | R → M | — | Get all tags |
| `tag:attach` | R → M | `{ itemId, tagId }` | Attach tag to item |
| `file:attach` | R → M | `{ itemId, filePath }` | Encrypt & store file |
| `file:download` | R → M | `{ attachmentId }` | Decrypt & return path |
| `settings:get` | R → M | `{ key }` | Get setting value |
| `settings:set` | R → M | `{ key, value }` | Set setting value |

---

## ✅ Task Breakdown (Checklist)

### **PHASE 0: Project Scaffolding & Environment**
- [x] 0.1 Initialize project directory and initialize git repository.
- [x] 0.2 Create `package.json` with all dependencies (Electron, React, Vite, Tailwind, TypeScript, better-sqlite3, zustand, tiptap, etc.).
- [x] 0.3 Configure `tsconfig.json` for multi-entry (main, renderer, preload, shared).
- [x] 0.4 Configure Vite (`vite.config.ts`, `vite.main.config.ts`, `vite.preload.config.ts`) for Electron + HMR.
- [x] 0.5 Configure Tailwind CSS (`tailwind.config.js`, `globals.css`) with custom color palette and dark mode.
- [x] 0.6 Configure ESLint + Prettier for code quality and consistent formatting.
- [x] 0.7 Create `.env.example` and `.gitignore` (exclude node_modules, dist, encrypted DB files).
- [x] 0.8 Create directory structure as defined in the Project Structure section.
- [x] 0.9 Write `README.md` with setup instructions (install, dev, build, test).
- [x] 0.10 Write `scripts/postinstall.js` to automatically handle native module rebuilds (better-sqlite3).
- [x] **Phase 0 COMPLETE** — All scaffolding and configuration done.

### **PHASE 1: Security Foundation & Database**
- [x] 1.1 Implement `src/main/crypto/keyDerivation.ts`:
  - [x] 1.1.1 Implement `generateSalt()` — returns 32-byte random salt.
  - [x] 1.1.2 Implement `deriveKeyPBKDF2(password, salt, iterations)` — returns 256-bit key.
  - [x] 1.1.3 *(Nice-to-have)* Implement `deriveKeyArgon2id(password, salt, memory, iterations, parallelism)` wrapper (stub).
  - [x] 1.1.4 High-level `createAuthMetadata` deferred to authHandlers.ts (crypto-only layer).
  - [x] 1.1.5 High-level `verifyMasterPassword` deferred to authHandlers.ts; `verifyKeyAgainstHash` implemented.
- [x] 1.2 Implement `src/main/crypto/encryption.ts`:
  - [x] 1.2.1 Implement `encryptAES256GCM(plaintext, key)` — returns `{ ciphertext, iv, tag }`.
  - [x] 1.2.2 Implement `decryptAES256GCM(ciphertext, iv, tag, key)` — returns plaintext.
  - [x] 1.2.3 Implement `encryptField(value, key)` — handles JSON serialization + encryption (as `encryptString`/`encryptJSON`).
  - [x] 1.2.4 Implement `decryptField(encryptedBlob, key)` — handles decryption + JSON parsing (as `decryptString`/`decryptJSON`).
  - [x] 1.2.5 Write unit tests for all crypto functions (test vectors, edge cases).
- [x] 1.3 Implement `src/main/crypto/passwordGenerator.ts`:
  - [x] 1.3.1 Implement `generatePassword(options)` — length, uppercase, lowercase, numbers, symbols, exclude ambiguous.
  - [x] 1.3.2 Implement `calculateEntropy(password)` — returns bits of entropy.
  - [x] 1.3.3 Implement `evaluateStrength(password)` — returns score (0-4) and label (Weak → Strong).
- [x] 1.4 Implement `src/main/database/connection.ts` (sql.js based):
  - [x] 1.4.1 Initialize sql.js with WASM binary loading.
  - [x] 1.4.2 Implement `openDatabase(dbPath)` — opens DB from file or creates new.
  - [x] 1.4.3 Implement `saveDatabase()` / `closeDatabase()`.
  - [x] 1.4.4 Implement `runQuery`, `runMany`, `prepare` helpers.
  - [x] 1.4.5 Handle errors (corrupted DB, file I/O errors).
- [x] 1.5 Create `src/main/database/schema.sql` with all tables defined in the Database Schema section.
- [x] 1.6 Implement `src/main/database/migrations.ts` — version tracking, migration runner.
- [x] 1.7 Implement `src/main/database/repositories/FolderRepository.ts`:
  - [x] 1.7.1 `createFolder(parentId, name, emoji)` — insert, return object.
  - [x] 1.7.2 `getFolderById(id)` — fetch single.
  - [x] 1.7.3 `getFolderTree()` — build full nested tree.
  - [x] 1.7.4 `updateFolder(id, fields)` — partial update.
  - [x] 1.7.5 `moveFolder(id, newParentId, sortOrder)` — circular reference prevention.
  - [x] 1.7.6 `deleteFolder(id)` — recursive cascade delete.
  - [x] 1.7.7 `searchByName(query)` — search folders by name.
- [x] 1.8 Implement `src/main/database/repositories/ItemRepository.ts`:
  - [x] 1.8.1 `createItem(folderId, fields)` — insert with encrypted fields.
  - [x] 1.8.2 `getItemById(id)` — fetch single.
  - [x] 1.8.3 `getItemsByFolder(folderId)` — list items.
  - [x] 1.8.4 `updateItem(id, fields)` — partial update.
  - [x] 1.8.5 `deleteItem(id)` — cascade delete tags/attachments.
  - [x] 1.8.6 `searchItems(query)` — search by title, username, URL, tags.
  - [x] 1.8.7 `getAll()` — fetch all items for health analysis.
- [x] 1.9 Implement `src/main/database/repositories/TagRepository.ts`:
  - [x] 1.9.1 `createTag(name, color)` — insert.
  - [x] 1.9.2 `getAllTags()` — list all.
  - [x] 1.9.3 `attachToItem(itemId, tagId)` — link.
  - [x] 1.9.4 `detachFromItem(itemId, tagId)` — unlink.
  - [x] 1.9.5 `getByItem(itemId)` — get tags for an item.
  - [x] 1.9.6 `delete(id)` — remove tag and all links.
- [x] 1.10 Implement `src/main/database/repositories/TrashRepository.ts`:
  - [x] 1.10.1 `add(type, id, parentId, data)` — insert into trash.
  - [x] 1.10.2 `getAll()` — list all trash entries.
  - [x] 1.10.3 `remove(id)` — remove from trash.
  - [x] 1.10.4 `empty()` — clear all trash.
  - [x] 1.10.5 `purgeOlderThan(ageMs)` — auto-purge old entries.
- [x] 1.11 Implement `src/main/database/repositories/FileAttachmentRepository.ts`:
  - [x] 1.11.1 `create(itemId, folderId, fileName, mimeType, fileSize, storagePath)` — metadata insert.
  - [x] 1.11.2 `getByItem(itemId)` — list attachments.
  - [x] 1.11.3 `getById(id)` — single attachment.
  - [x] 1.11.4 `delete(id)` — remove metadata.
- [x] 1.12 Write integration tests for all repositories (mock DB or in-memory SQLite).

### **PHASE 2: IPC Layer & Main Process**
- [x] 2.1 Implement `src/preload/index.ts` — expose secure API to renderer using `contextBridge`:
  - [x] 2.1.1 `window.electron.auth` — init, unlock, lock, changePassword.
  - [x] 2.1.2 `window.electron.folders` — all folder CRUD operations.
  - [x] 2.1.3 `window.electron.items` — all item CRUD operations.
  - [x] 2.1.4 `window.electron.tags` — tag management.
  - [x] 2.1.5 `window.electron.files` — attach, download, delete.
  - [x] 2.1.6 `window.electron.search` — search.
  - [x] 2.1.7 `window.electron.settings` — get/set settings.
- [x] 2.2 Implement `src/main/ipc/authHandlers.ts`:
  - [x] 2.2.1 `auth:init` — validate password strength, create salt, derive key, create DB, store metadata.
  - [x] 2.2.2 `auth:unlock` — derive key, attempt DB open, return success/failure.
  - [x] 2.2.3 `auth:lock` — clear memory keys, emit lock event.
  - [x] 2.2.4 `auth:change-password` — re-encrypt all data with new key, update metadata.
  - [x] 2.2.5 `auth:check` — verify if DB exists and is initialized.
- [x] 2.3 Implement `src/main/ipc/folderHandlers.ts`:
  - [x] 2.3.1 `folder:getTree` — return tree structure.
  - [x] 2.3.2 `folder:create` — create, return new folder.
  - [x] 2.3.3 `folder:update` — update, return updated.
  - [x] 2.3.4 `folder:move` — validate move, update DB, return updated tree.
  - [x] 2.3.5 `folder:delete` — move to trash.
  - [x] 2.3.6 `folder:restore` — restore from trash.
- [x] 2.4 Implement `src/main/ipc/itemHandlers.ts`:
  - [x] 2.4.1 `item:getByFolder` — list items.
  - [x] 2.4.2 `item:getById` — single item.
  - [x] 2.4.3 `item:create` — create, encrypt fields.
  - [x] 2.4.4 `item:update` — update, encrypt changed fields.
  - [x] 2.4.5 `item:delete` — move to trash.
  - [x] 2.4.6 `item:restore` — restore from trash.
  - [x] 2.4.7 `item:toggleFavorite` — toggle favorite status.
- [x] 2.5 Implement `src/main/ipc/searchHandlers.ts`:
  - [x] 2.5.1 `item:search` — full-text search, fuzzy matching, return results.
  - [x] 2.5.2 `item:searchByTag` — filter by tag.
- [x] 2.6 Implement `src/main/ipc/fileHandlers.ts`:
  - [x] 2.6.1 `file:attach` — read file, encrypt, store to filesystem, save metadata.
  - [x] 2.6.2 `file:download` — decrypt file, return temp path.
  - [x] 2.6.3 `file:delete` — remove file and metadata.
- [x] 2.7 Implement `src/main/ipc/settingsHandlers.ts`:
  - [x] 2.7.1 `settings:get` — read from DB.
  - [x] 2.7.2 `settings:set` — write to DB.
  - [x] 2.7.3 `settings:getAll` — bulk read.
- [x] 2.8 Implement `src/main/file-system/storageManager.ts`:
  - [x] 2.8.1 `getStoragePath()` — determine app data directory (Electron `app.getPath('userData')`).
  - [x] 2.8.2 `encryptAndStoreFile(filePath, key)` — read, encrypt, write to storage dir.
  - [x] 2.8.3 `decryptAndRetrieveFile(storagePath, key)` — read, decrypt, write to temp, return path.
  - [x] 2.8.4 `deleteStoredFile(storagePath)` — secure delete (overwrite + unlink).
  - [x] 2.8.5 Handle large files with streaming encryption to avoid memory issues.
- [x] 2.9 Implement `src/main/index.ts` (main process entry):
  - [x] 2.9.1 Create `BrowserWindow` with security settings (contextIsolation: true, nodeIntegration: false, webSecurity: true).
  - [x] 2.9.2 Load Vite dev server in development, or `index.html` in production.
  - [x] 2.9.3 Register all IPC handlers.
  - [x] 2.9.4 Handle app lifecycle events (ready, activate, before-quit).
  - [x] 2.9.5 Implement single-instance lock.
  - [x] 2.9.6 Implement secure CSP headers.

### **PHASE 3: Frontend Foundation (React + Tailwind)**
- [x] 3.1 Implement `src/renderer/index.tsx` — React root, StrictMode, error boundary.
- [x] 3.2 Implement `src/renderer/pages/App.tsx` — root component, routing logic (LockScreen vs MainApp).
- [x] 3.3 Implement `src/renderer/pages/LockScreenPage.tsx`:
  - [x] 3.3.1 Full-screen centered layout.
  - [x] 3.3.2 Master password input (password field, visibility toggle).
  - [x] 3.3.3 "Unlock" button with loading state.
  - [x] 3.3.4 "First time setup" flow (create master password, confirm password, strength indicator).
  - [x] 3.3.5 Error handling (wrong password, DB not found).
  - [x] 3.3.6 Logo and branding.
- [x] 3.4 Implement `src/renderer/pages/MainAppPage.tsx` — base layout with Sidebar + MainPanel.
- [x] 3.5 Implement `src/renderer/stores/authStore.ts` (Zustand):
  - [x] 3.5.1 `isAuthenticated`, `isLoading`, `error` states.
  - [x] 3.5.2 `initApp(password)` action.
  - [x] 3.5.3 `unlock(password)` action.
  - [x] 3.5.4 `lock()` action.
  - [x] 3.5.5 `changePassword(old, new)` action.
- [x] 3.6 Implement `src/renderer/stores/folderStore.ts` (Zustand + Immer):
  - [x] 3.6.1 `folders` state as normalized tree structure.
  - [x] 3.6.2 `selectedFolderId` state.
  - [x] 3.6.3 `loadTree()` action — fetch from main.
  - [x] 3.6.4 `createFolder(parentId, name, emoji)` action.
  - [x] 3.6.5 `updateFolder(id, fields)` action.
  - [x] 3.6.6 `moveFolder(id, newParentId)` action.
  - [x] 3.6.7 `deleteFolder(id)` action.
  - [x] 3.6.8 `setSelectedFolder(id)` action.
  - [x] 3.6.9 `expandFolder(id)` / `collapseFolder(id)` UI state.
- [x] 3.7 Implement `src/renderer/stores/itemStore.ts` (Zustand + Immer):
  - [x] 3.7.1 `items` state as normalized map.
  - [x] 3.7.2 `selectedItemId` state.
  - [x] 3.7.3 `loadItems(folderId)` action.
  - [x] 3.7.4 `createItem(folderId, fields)` action.
  - [x] 3.7.5 `updateItem(id, fields)` action.
  - [x] 3.7.6 `deleteItem(id)` action.
  - [x] 3.7.7 `setSelectedItem(id)` action.
  - [x] 3.7.8 `searchItems(query)` action.
- [x] 3.8 Implement `src/renderer/stores/uiStore.ts` (Zustand):
  - [x] 3.8.1 `sidebarOpen` state.
  - [x] 3.8.2 `darkMode` state.
  - [x] 3.8.3 `quickFindOpen` state.
  - [x] 3.8.4 `activeView` state ('folder', 'item', 'health', 'trash', 'settings').
  - [x] 3.8.5 `toggleSidebar()`, `toggleDarkMode()`, `toggleQuickFind()`, `setActiveView()` actions.
- [x] 3.9 Implement `src/renderer/stores/settingsStore.ts` (Zustand):
  - [x] 3.9.1 `settings` object (autoLockTime, theme, defaultPasswordLength, etc.).
  - [x] 3.9.2 `loadSettings()` action.
  - [x] 3.9.3 `updateSetting(key, value)` action.

### **PHASE 4: Core UI Components (Sidebar & Navigation)**
- [x] 4.1 Implement `src/renderer/components/layout/Sidebar.tsx`:
  - [x] 4.1.1 Collapsible container with smooth width transition.
  - [x] 4.1.2 Fixed header with "New Folder" button and Quick Find trigger.
  - [x] 4.1.3 Tree view rendering using recursive `TreeNode` component.
  - [x] 4.1.4 Favorites section (pinned items).
  - [x] 4.1.5 Trash bin link at bottom.
  - [x] 4.1.6 Settings/Profile link at bottom.
  - [x] 4.1.7 Drag-and-drop handles on each node.
  - [x] 4.1.8 Context menu (right-click) for rename, delete, new subfolder.
- [x] 4.2 Implement `src/renderer/components/ui/TreeNode.tsx`:
  - [x] 4.2.1 Display emoji + name.
  - [x] 4.2.2 Expand/collapse chevron for folders with children.
  - [x] 4.2.3 Indentation based on depth level.
  - [x] 4.2.4 Selected state highlight.
  - [x] 4.2.5 Hover state with drag handle and context menu trigger.
  - [x] 4.2.6 Inline rename (double-click or context menu).
  - [x] 4.2.7 DnD source and target (using HTML5 DnD or dnd-kit).
- [x] 4.3 Implement `src/renderer/components/layout/MainPanel.tsx`:
  - [x] 4.3.1 Breadcrumb navigation showing current path (Home > Folder > Subfolder).
  - [x] 4.3.2 Toolbar with "New Item", "New Folder", "Sort" controls.
  - [x] 4.3.3 Content area that switches views based on `uiStore.activeView`.
  - [x] 4.3.4 Empty state illustration when no items/folders.
- [x] 4.4 Implement `src/renderer/components/layout/QuickFind.tsx`:
  - [x] 4.4.1 CMD+K modal (or Ctrl+K) overlay.
  - [x] 4.4.2 Search input with focus on open.
  - [x] 4.4.3 Real-time search results list (folders + items + tags).
  - [x] 4.4.4 Keyboard navigation (arrow keys, Enter to select, Escape to close).
  - [x] 4.4.5 Fuzzy matching highlight.
  - [x] 4.4.6 Sectioned results: Folders, Items, Tags.
- [x] 4.5 Implement `src/renderer/components/layout/TitleBar.tsx`:
  - [x] 4.5.1 Custom title bar (frameless window) with drag region.
  - [x] 4.5.2 Window controls (minimize, maximize, close) for Windows/Linux.
  - [x] 4.5.3 macOS traffic lights integration (leave native or custom).
  - [x] 4.5.4 App logo and name.

### **PHASE 5: Item & Folder Views**
- [x] 5.1 Implement `src/renderer/components/views/FolderView.tsx`:
  - [x] 5.1.1 Grid or list layout of items in selected folder.
  - [x] 5.1.2 Each item card shows emoji, title, username preview, URL preview.
  - [x] 5.1.3 Click to open item detail.
  - [x] 5.1.4 Right-click context menu (edit, delete, duplicate, favorite).
  - [x] 5.1.5 Sort options (name, date created, date modified, custom).
  - [x] 5.1.6 Empty state for new folders.
- [x] 5.2 Implement `src/renderer/components/views/ItemDetailView.tsx`:
  - [x] 5.2.1 Cover image area (optional, with upload/remove).
  - [x] 5.2.2 Emoji picker (title area).
  - [x] 5.2.3 Title input (editable inline).
  - [x] 5.2.4 Username field (copy button).
  - [x] 5.2.5 Password field (masked by default, reveal toggle, copy button, strength indicator).
  - [x] 5.2.6 URL field (open in browser button, copy button).
  - [x] 5.2.7 Tags section (add/remove tags, create new tag inline).
  - [x] 5.2.8 Rich Text Notes area (TipTap editor, see Phase 7).
  - [x] 5.2.9 Attachments section (list, upload, download, delete).
  - [x] 5.2.10 Metadata footer (created at, updated at, ID).
  - [x] 5.2.11 Auto-save on blur/debounce for all fields.
- [x] 5.3 Implement `src/renderer/components/views/TrashView.tsx`:
  - [x] 5.3.1 List of deleted folders and items.
  - [x] 5.3.2 Restore button per item.
  - [x] 5.3.3 Permanent delete button per item (with confirmation dialog).
  - [x] 5.3.4 "Empty Trash" button.
  - [x] 5.3.5 Show original deletion date.
- [x] 5.4 Implement `src/renderer/components/views/SettingsView.tsx`:
  - [x] 5.4.1 General settings: theme (light/dark/auto), auto-lock timer.
  - [x] 5.4.2 Security settings: change master password, auto-purge trash timer.
  - [x] 5.4.3 Password generator defaults: length, character sets.
  - [x] 5.4.4 Data settings: export encrypted backup, import backup, purge trash.
  - [x] 5.4.5 About section: version, license, credits.

### **PHASE 6: Auto-Lock, Password Generator & Health**
- [x] 6.1 Implement `src/renderer/hooks/useAutoLock.ts`:
  - [x] 6.1.1 Track mouse/keyboard idle time using `mousemove`, `keydown`, `click` listeners.
  - [x] 6.1.2 Start a timer based on `settings.autoLockTime`.
  - [x] 6.1.3 Reset timer on any activity.
  - [x] 6.1.4 Call `authStore.lock()` when timer expires.
  - [x] 6.1.5 Show idle warning (30 seconds before lock) with ability to extend.
  - [x] 6.1.6 Handle screen lock/sleep events (Electron powerMonitor API).
- [x] 6.2 Implement `src/renderer/components/widgets/PasswordGenerator.tsx`:
  - [x] 6.2.1 Length slider (4-128 characters).
  - [x] 6.2.2 Toggles: uppercase, lowercase, numbers, symbols.
  - [x] 6.2.3 Toggle: exclude ambiguous characters (0, O, l, 1, etc.).
  - [x] 6.2.4 Generated password display (copy button, regenerate button).
  - [x] 6.2.5 Entropy and strength display.
  - [x] 6.2.6 History of recently generated passwords (session only, not stored).
  - [x] 6.2.7 Modal or inline widget usable from ItemDetailView.
- [x] 6.3 Implement `src/renderer/components/views/PasswordHealthView.tsx`:
  - [x] 6.3.1 Overview cards: total passwords, weak, reused, old, strong.
  - [x] 6.3.2 Weak passwords list (click to edit item).
  - [x] 6.3.3 Reused passwords list (grouped by hash, shows count).
  - [x] 6.3.4 Old passwords list (not changed in >90 days, configurable).
  - [x] 6.3.5 Overall score/rating (e.g., A, B, C, D).
  - [x] 6.3.6 Action buttons: "Go to item" for each entry.
  - [x] 6.3.7 Visual charts (progress bars, donut charts) for summary.

### **PHASE 7: Rich Text Notes (TipTap)**
- [x] 7.1 Install and configure TipTap extensions:
  - [x] 7.1.1 `@tiptap/react` (core).
  - [x] 7.1.2 `@tiptap/starter-kit` (bold, italic, headings, lists, blockquote, code).
  - [x] 7.1.3 `@tiptap/extension-placeholder` (type '/' for commands).
  - [x] 7.1.4 `@tiptap/extension-link` (auto-link URLs).
  - [x] 7.1.5 `@tiptap/extension-code-block` (for code snippets like SSH keys).
  - [x] 7.1.6 `@tiptap/extension-task-list` (checkboxes for recovery codes).
- [x] 7.2 Implement `src/renderer/components/editor/RichTextEditor.tsx`:
  - [x] 7.2.1 TipTap `EditorContent` component.
  - [x] 7.2.2 Bubble menu (formatting toolbar on text selection).
  - [x] 7.2.3 Floating menu (quick insert on empty line).
  - [x] 7.2.4 Dark mode support via Tailwind classes.
  - [x] 7.2.5 Store content as JSON (TipTap doc format), encrypt before saving.
  - [x] 7.2.6 Load and decrypt JSON on item open.
- [x] 7.3 Implement `src/renderer/components/editor/SlashCommandMenu.tsx`:
  - [x] 7.3.1 Triggered by typing `/`.
  - [x] 7.3.2 Menu items: Heading 1, Heading 2, Bullet List, Numbered List, Code Block, Blockquote, Divider, Checkbox.
  - [x] 7.3.3 Keyboard navigation (arrow keys, Enter, Escape).
  - [x] 7.3.4 Filter items based on typed text after `/`.
  - [x] 7.3.5 Insert corresponding node on selection.
- [x] 7.4 Implement `src/renderer/components/editor/MarkdownToolbar.tsx`:
  - [x] 7.4.1 Fixed toolbar with formatting buttons (bold, italic, heading, list, code, link).
  - [x] 7.4.2 Active state highlighting based on current cursor position.
  - [x] 7.4.3 Keyboard shortcuts (Ctrl+B, Ctrl+I, etc.).

### **PHASE 8: Visual Polish (Emoji, Cover, Dark Mode, Animations)**
- [x] 8.1 Implement `src/renderer/components/ui/EmojiPicker.tsx`:
  - [x] 8.1.1 Popover with emoji grid (use `emoji-picker-react` or native).
  - [x] 8.1.2 Search emojis by name.
  - [x] 8.1.3 Recently used emojis section.
  - [x] 8.1.4 Used in folder tree and item detail.
- [x] 8.2 Implement `src/renderer/components/ui/CoverImage.tsx`:
  - [x] 8.2.1 Upload area for cover image (drag & drop or file picker).
  - [x] 8.2.2 Display as wide banner (Notion style, 16:9 or 3:1 ratio).
  - [x] 8.2.3 Gradient overlay option (predefined gradients as alternative to image).
  - [x] 8.2.4 Remove/replace button.
  - [x] 8.2.5 Store image path in metadata; image itself is NOT encrypted (cosmetic), or optionally encrypt if sensitive.
- [x] 8.3 Implement Dark Mode:
  - [x] 8.3.1 `darkMode` class strategy in Tailwind.
  - [x] 8.3.2 Toggle in settings (light / dark / system).
  - [x] 8.3.3 Persist preference in settings DB.
  - [x] 8.3.4 All components must render correctly in both modes.
- [x] 8.4 Implement Animations (Framer Motion):
  - [x] 8.4.1 Page transitions (fade/slide between views).
  - [x] 8.4.2 Sidebar collapse/expand animation.
  - [x] 8.4.3 Modal enter/exit animations (Quick Find, Password Generator, Confirm Dialog).
  - [x] 8.4.4 Tree node expand/collapse animation.
  - [x] 8.4.5 Drag-and-drop ghost/placeholder animation.
  - [x] 8.4.6 Toast notifications (success, error, info) with auto-dismiss.

### **PHASE 9: Testing & Quality Assurance**
- [ ] 9.1 Unit Tests (Jest + React Testing Library):
  - [ ] 9.1.1 Test all crypto functions (encryption/decryption round-trip, wrong key fails, key derivation consistency).
  - [ ] 9.1.2 Test password generator (length, character set constraints, randomness).
  - [ ] 9.1.3 Test password health evaluation (weak, strong, reused detection).
  - [ ] 9.1.4 Test repository layer (CRUD, tree construction, trash logic).
  - [ ] 9.1.5 Test Zustand store actions (state updates, async flows, error handling).
  - [ ] 9.1.6 Test React components (rendering, user interactions, accessibility).
- [ ] 9.2 Integration Tests:
  - [ ] 9.2.1 Test IPC round-trip (renderer calls → main process → DB → response).
  - [ ] 9.2.2 Test file attachment encrypt/decrypt flow (end-to-end).
  - [ ] 9.2.3 Test auth flow (init → unlock → lock → unlock with wrong password).
  - [ ] 9.2.4 Test auto-lock timer (simulate idle, verify lock triggered).
- [ ] 9.3 E2E Tests (Playwright + Electron):
  - [ ] 9.3.1 Setup Playwright to launch Electron app.
  - [ ] 9.3.2 Test: first-time setup, create master password, unlock.
  - [ ] 9.3.3 Test: create folder, create item, search item, open item detail.
  - [ ] 9.3.4 Test: delete item, restore from trash, permanently delete.
  - [ ] 9.3.5 Test: generate password, copy password, use password generator in item.
  - [ ] 9.3.6 Test: lock and unlock with correct/incorrect password.
  - [ ] 9.3.7 Test: settings change (theme, auto-lock), verify persistence.
- [ ] 9.4 Security Audit:
  - [ ] 9.4.1 Verify no sensitive data is logged to console or files.
  - [ ] 9.4.2 Verify keys are cleared from memory on lock.
  - [ ] 9.4.3 Test SQL injection resistance (parameterized queries).
  - [ ] 9.4.4 Test XSS resistance in rich text editor (sanitize HTML output).
  - [ ] 9.4.5 Verify preload script exposes only necessary APIs (no `require('fs')` in renderer).
  - [ ] 9.4.6 Verify CSP prevents inline scripts and unsafe-eval.
- [ ] 9.5 Performance & Stress Testing:
  - [ ] 9.5.1 Test with 10,000 items — search performance, tree rendering.
  - [ ] 9.5.2 Test with deeply nested folders (100 levels) — tree navigation, move operations.
  - [ ] 9.5.3 Test large file attachment (100MB PDF) — streaming encryption, memory usage.
  - [ ] 9.5.4 Measure bundle size, optimize with Vite code splitting.

### **PHASE 10: Build, Package & Deployment**
- [ ] 10.1 Configure `electron-builder` (`build/electron-builder.yml`):
  - [ ] 10.1.1 Windows: NSIS installer + portable, code signing if cert available.
  - [ ] 10.1.2 macOS: DMG, code signing, notarization (if Apple Developer ID).
  - [ ] 10.1.3 Linux: AppImage, DEB, RPM.
  - [ ] 10.1.4 Auto-updater configuration (electron-updater + GitHub releases or custom server).
- [ ] 10.2 Environment & Scripts:
  - [ ] 10.2.1 `npm run dev` — start Vite dev server + Electron.
  - [ ] 10.2.2 `npm run build` — build renderer and main for production.
  - [ ] 10.2.3 `npm run dist` — package with electron-builder.
  - [ ] 10.2.4 `npm run test` — run all test suites.
  - [ ] 10.2.5 `npm run lint` — run ESLint.
  - [ ] 10.2.6 `npm run format` — run Prettier.
- [ ] 10.3 Documentation:
  - [ ] 10.3.1 Update `README.md` with final setup, build, and contribution instructions.
  - [ ] 10.3.2 Create `docs/SECURITY.md` explaining the zero-knowledge architecture, threat model, and responsible disclosure.
  - [ ] 10.3.3 Create `docs/ARCHITECTURE.md` with diagrams (data flow, component hierarchy, IPC flow).
  - [ ] 10.3.4 Create `docs/CHANGELOG.md` (initial version 0.1.0).
  - [ ] 10.3.5 Write inline JSDoc/TSDoc for all public functions and components.

---

## 🚀 Post-MVP Roadmap (Future Features)

1. **Browser Extension**: Auto-fill and save passwords from Chrome/Firefox.
2. **Cloud Sync**: End-to-end encrypted sync via WebDAV, Dropbox, or custom server.
3. **TOTP / 2FA Storage**: Store and generate TOTP codes (like Google Authenticator).
4. **Passkey / WebAuthn Support**: Store and manage modern passkeys.
5. **Secure Sharing**: Share individual items via encrypted links (e.g., magic link with password).
6. **Biometric Unlock**: Windows Hello / Touch ID integration (via native modules).
7. **Import/Export**: Import from Bitwarden, 1Password, LastPass CSV/JSON.
8. **CLI Tool**: Command-line interface for power users.

---

## 📎 Appendix

### A.1 Glossary
- **KDF**: Key Derivation Function (PBKDF2, Argon2).
- **SQLCipher**: SQLite extension that provides transparent 256-bit AES encryption.
- **Zero-Knowledge**: Service/provider cannot access plaintext data; only the user has the key.
- **AES-256-GCM**: Advanced Encryption Standard with 256-bit key, Galois/Counter Mode (authenticated encryption).
- **IPC**: Inter-Process Communication (Electron main ↔ renderer).
- **DnD**: Drag and Drop.

### A.2 References
- [Electron Security Best Practices](https://www.electronjs.org/docs/latest/tutorial/security)
- [SQLCipher Documentation](https://www.zetetic.net/sqlcipher/)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [TipTap Documentation](https://tiptap.dev/)
- [Tailwind CSS Documentation](https://tailwindcss.com/)

---

**Document Version:** 1.0  
**Last Updated:** 2026-06-14  
**Author:** AI Software Architect
