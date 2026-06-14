# Architecture

## High-Level Overview

```
┌─────────────────────────────────────────────────────────┐
│                    ELECTRON SHELL                        │
│                                                         │
│  ┌──────────────────┐     ┌──────────────────────────┐  │
│  │   MAIN PROCESS    │     │     RENDERER PROCESS      │  │
│  │   (Node.js)       │ IPC │     (Chromium)            │  │
│  │                   │◄───►│                           │  │
│  │  • IPC Handlers   │     │  • React 18 + TypeScript  │  │
│  │  • sql.js DB      │     │  • Zustand Stores         │  │
│  │  • AES-256-GCM    │     │  • Tailwind CSS           │  │
│  │  • PBKDF2 KDF     │     │  • TipTap Editor          │  │
│  │  • File System    │     │  • Framer Motion          │  │
│  │  • Auto-Updater   │     │                           │  │
│  └──────────────────┘     └──────────────────────────┘  │
│           │                                               │
│     ┌─────┴─────┐                                        │
│     │  PRELOAD   │  contextBridge + ipcRenderer          │
│     │  (Secure)  │  Whitelisted API surface              │
│     └───────────┘                                        │
└─────────────────────────────────────────────────────────┘
```

## Data Flow

### Authentication Flow

```
Renderer (React)                    Main Process                   Disk
─────────────────                   ────────────                   ────
                                     auth:init
LockScreenPage ──► window.electron ──► generateSalt()
                    .auth.init()     │ deriveKeyPBKDF2()
                                     │ hashKeyForVerification()
                                     │ writeAuthMetadata() ──────► auth.json
                                     │                                   (salt + hash)
                                     │
                                     auth:unlock
LockScreenPage ──► window.electron ──► readAuthMetadata() ◄──────── auth.json
                    .auth.unlock()   │ deriveKeyPBKDF2()
                                     │ verifyKeyAgainstHash()
                                     │ openDatabase()
                                     ◄── success/failure
```

### Item CRUD Flow

```
Renderer                    Main Process                   Database
────────                    ────────────                   ────────
                             item:create
ItemDetailView ──► IPC ──► registerItemHandlers() ──► itemRepo.create()
                            │ encryptString(fields, key)    │ INSERT INTO items
                            │                              │
                             item:getByFolder
FolderView ──► IPC ──► registerItemHandlers() ──► itemRepo.getByFolder()
                            │ decryptItem(item, key)        │ SELECT FROM items
                            ◄── { success, data }           │
```

### File Attachment Flow

```
Renderer          Main Process              File System
────────          ────────────              ───────────
                   file:attach
ItemDetail ──► IPC ──► readFileSync() ──► source file
                       │ encryptAES256GCM()
                       │ writeFileSync() ──► attachments/*.enc
                       │ fileRepo.create() ──► DB (metadata)
                       ◄── attachment

                   file:download
ItemDetail ──► IPC ──► readFileSync() ◄── attachments/*.enc
                       │ decryptAES256GCM()
                       │ writeFileSync() ──► temp/decrypted-file
                       ◄── { filePath }
```

## Component Hierarchy

```
<App>
  ├── isAuthenticated?
  │   ├── NO  → <LockScreenPage>
  │   │          ├── Password Input
  │   │          ├── Strength Indicator
  │   │          └── Unlock / Setup Button
  │   │
  │   └── YES → <MainAppPage>
  │              ├── <TitleBar>           (frameless drag region)
  │              ├── <Sidebar>
  │              │    ├── <TreeNode>      (recursive, DnD)
  │              │    ├── "New Folder" btn
  │              │    ├── Favorites
  │              │    ├── Trash link
  │              │    └── Settings link
  │              ├── <MainPanel>
  │              │    ├── Breadcrumb
  │              │    ├── Toolbar (sort, new item)
  │              │    └── Active View:
  │              │         ├── <FolderView>     (grid/list)
  │              │         ├── <ItemDetailView>
  │              │         │    ├── CoverImage
  │              │         │    ├── EmojiPicker
  │              │         │    ├── RichTextEditor (TipTap)
  │              │         │    │    ├── SlashCommandMenu
  │              │         │    │    └── MarkdownToolbar
  │              │         │    ├── PasswordGenerator (modal)
  │              │         │    └── Attachments
  │              │         ├── <PasswordHealthView>
  │              │         ├── <TrashView>
  │              │         └── <SettingsView>
  │              └── <QuickFind>           (Cmd+K modal)
  └── <ToastContainer>                     (global notifications)
```

## State Management (Zustand)

```
┌─────────────┐  ┌──────────────┐  ┌───────────┐  ┌──────────────┐  ┌───────────────┐
│  authStore   │  │ folderStore   │  │ itemStore  │  │   uiStore    │  │ settingsStore │
├─────────────┤  ├──────────────┤  ├───────────┤  ├──────────────┤  ├───────────────┤
│ status       │  │ folders[]    │  │ items{}    │  │ sidebarOpen  │  │ settings{}    │
│ isAuth'd     │  │ selectedId   │  │ itemIds[]  │  │ darkMode     │  │ isLoaded      │
│ error        │  │ expandedSet  │  │ selectedId │  │ quickFind    │  │ error         │
│              │  │ isLoading    │  │ isLoading  │  │ activeView   │  │               │
│ checkAuth()  │  │              │  │            │  │              │  │ loadSettings()│
│ initApp()    │  │ loadTree()   │  │ loadItems()│  │ toggleX()    │  │ updateSetting()│
│ unlock()     │  │ createFolder │  │ createItem │  │ setActiveView│  │               │
│ lock()       │  │ moveFolder   │  │ updateItem │  │              │  │               │
│ changePw()   │  │ deleteFolder │  │ deleteItem │  │              │  │               │
└─────────────┘  └──────────────┘  └───────────┘  └──────────────┘  └───────────────┘
```

## IPC Communication Map

### Request-Response (`ipcMain.handle` / `ipcRenderer.invoke`)

| Category | Channels | Handler File |
|----------|----------|-------------|
| **Auth** | `auth:init`, `auth:unlock`, `auth:lock`, `auth:change-password`, `auth:check` | `authHandlers.ts` |
| **Folders** | `folder:getTree`, `folder:create`, `folder:update`, `folder:move`, `folder:delete`, `folder:restore` | `folderHandlers.ts` |
| **Items** | `item:getByFolder`, `item:getById`, `item:create`, `item:update`, `item:delete`, `item:restore`, `item:toggleFavorite`, `item:search`, `item:getAll` | `itemHandlers.ts` |
| **Search** | `item:search`, `item:searchByTag` | `searchHandlers.ts` |
| **Tags** | `tag:getAll`, `tag:create`, `tag:attach`, `tag:detach`, `tag:delete` | (via itemHandlers) |
| **Files** | `file:getByItem`, `file:attach`, `file:download`, `file:delete` | `fileHandlers.ts` |
| **Settings** | `settings:get`, `settings:set`, `settings:getAll` | `settingsHandlers.ts` |
| **Trash** | `trash:get`, `trash:restore`, `trash:permanent-delete`, `trash:empty`, `trash:purge` | (via itemHandlers) |
| **Health** | `health:analyze` | `healthHandlers.ts` |
| **Window** | `window:minimize`, `window:maximize`, `window:close`, `window:isMaximized` | `index.ts` |
| **Updates** | `update:check`, `update:download`, `update:quit-and-install` | `updateHandlers.ts` |

### Push Events (`ipcRenderer.on` / `webContents.send`)

| Event | Direction | Purpose |
|-------|-----------|---------|
| `auth:locked` | Main → Renderer | Lock screen trigger |
| `power-monitor:lock-screen` | Main → Renderer | OS lock screen detected |
| `power-monitor:suspend` | Main → Renderer | OS sleep detected |
| `update:available` | Main → Renderer | Update notification |
| `update:download-progress` | Main → Renderer | Download progress % |
| `update:downloaded` | Main → Renderer | Ready to install |
| `update:error` | Main → Renderer | Update failure |

## Database Schema

```
folders ───────────┐
  id (PK)          │
  parent_id (FK) ──┘ (self-referencing)
  name
  emoji, cover_image
  created_at, updated_at, sort_order

items ─────────────┐
  id (PK)          │
  folder_id (FK) ──┘
  title, username
  password_encrypted (BLOB)
  url
  notes_encrypted (BLOB)
  emoji, cover_image
  is_favorite, sort_order
  created_at, updated_at

tags
  id (PK), name (UNIQUE), color

item_tags ─────────┐
  item_id (FK) ────┤── items
  tag_id (FK) ─────┘── tags
  (composite PK)

attachments ───────┐
  id (PK)          │
  item_id (FK) ────┤── items
  folder_id (FK) ──┘── folders
  file_name, mime_type, file_size, storage_path
  created_at

trash
  id (PK)
  original_type ('folder' | 'item')
  original_id, original_parent_id
  data_encrypted (BLOB)
  deleted_at

settings
  key (PK), value

auth_metadata (stored as auth.json, not in DB)
  salt, kdf_algorithm, kdf_iterations, verificationHash, createdAt
```

## Build Pipeline

```
Source (.ts/.tsx)                Output
─────────────────                ──────
                                  ┌─► dist-electron/main/index.js
src/main/ ───► vite (main) ──────┤
                                  │   ┌─► dist-electron/preload/index.js
src/preload/ ───► vite (preload) ─┘   │
                                       │
src/renderer/ ───► vite (react) ──────┼─► dist/index.html
                  + tailwind           │   dist/assets/*.js
                  + postcss            │   dist/assets/*.css
                                       │
public/ ──────────────────────────────┘   dist/sql-wasm.wasm
```

## Test Architecture

```
tests/
├── unit/                    # Isolated unit tests (node env)
│   ├── crypto/             # keyDerivation, encryption, passwordGen, passwordHealth
│   ├── database/           # All 5 repositories
│   ├── stores/             # All 5 Zustand stores
│   ├── components/         # React components (jsdom env)
│   └── security/           # Security audit checks
├── integration/            # Multi-layer integration tests
│   ├── ipc-roundtrip       # Folder → Item → Search → Settings
│   ├── authFlow            # Init → Unlock → Lock → Change password
│   ├── fileAttachment      # Encrypt/decrypt round-trip
│   └── autoLock            # Timer lifecycle (jsdom)
├── e2e/                    # Full Electron app tests (Playwright)
│   ├── auth                # Setup, lock, unlock
│   ├── crud                # Folder/Item create, search, delete
│   ├── generator           # Password generator interaction
│   └── settings            # Theme, auto-lock, persistence
└── performance/            # Stress & benchmark tests
    ├── 10K items           # Bulk insert, search, delete
    ├── 100-level folders   # Deep tree navigation
    ├── 50MB encryption     # Large file streaming
    └── bundle size         # Build output analysis
```
