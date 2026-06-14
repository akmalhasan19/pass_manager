-- SecurePass Manager Database Schema
-- Compatible with sql.js (SQLite compiled to WebAssembly)

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Folders (hierarchical, self-referencing)
CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    emoji TEXT,
    cover_image TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    sort_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);

-- Password Items
CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    username TEXT DEFAULT '',
    password_encrypted BLOB,
    url TEXT DEFAULT '',
    notes_encrypted BLOB,
    emoji TEXT,
    cover_image TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    is_favorite INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_items_folder ON items(folder_id);
CREATE INDEX IF NOT EXISTS idx_items_favorite ON items(is_favorite);

-- Tags
CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT '#6366f1'
);

-- Item-Tag relationship (many-to-many)
CREATE TABLE IF NOT EXISTS item_tags (
    item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
    tag_id TEXT REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_item_tags_item ON item_tags(item_id);
CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag_id);

-- File Attachments
CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
    folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    mime_type TEXT,
    file_size INTEGER,
    storage_path TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_item ON attachments(item_id);

-- Trash / Recycle Bin
CREATE TABLE IF NOT EXISTS trash (
    id TEXT PRIMARY KEY,
    original_type TEXT NOT NULL CHECK (original_type IN ('folder', 'item')),
    original_id TEXT NOT NULL,
    original_parent_id TEXT,
    data_encrypted BLOB,
    deleted_at INTEGER NOT NULL
);

-- App Settings
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Schema version for migrations
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_lock_time', '300000');
INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'system');
INSERT OR IGNORE INTO settings (key, value) VALUES ('default_password_length', '20');
INSERT OR IGNORE INTO settings (key, value) VALUES ('default_password_uppercase', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('default_password_lowercase', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('default_password_numbers', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('default_password_symbols', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('default_password_exclude_ambiguous', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('trash_auto_purge_days', '30');
INSERT OR IGNORE INTO settings (key, value) VALUES ('schema_version', '1');

-- Full-text search virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
    title,
    username,
    url,
    content='items',
    content_rowid='rowid'
);

-- Triggers to keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
    INSERT INTO items_fts(rowid, title, username, url)
    VALUES (new.rowid, new.title, new.username, new.url);
END;

CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
    INSERT INTO items_fts(items_fts, rowid, title, username, url)
    VALUES ('delete', old.rowid, old.title, old.username, old.url);
END;

CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
    INSERT INTO items_fts(items_fts, rowid, title, username, url)
    VALUES ('delete', old.rowid, old.title, old.username, old.url);
    INSERT INTO items_fts(rowid, title, username, url)
    VALUES (new.rowid, new.title, new.username, new.url);
END;
