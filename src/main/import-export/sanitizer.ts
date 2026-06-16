import type { ImportPayload, ImportItem, ImportFolder, ImportTag } from '../../shared/types';

const HTML_TAG_RE = /<[^>]*>/g;

const DANGEROUS_URL_SCHEMES = /^(javascript|data|vbscript)\s*:/i;

const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export function sanitizeString(value: string): string {
  if (!value || typeof value !== 'string') return value;
  let sanitized = value.replace(CONTROL_CHARS_RE, '');
  sanitized = sanitized.replace(HTML_TAG_RE, '');
  return sanitized;
}

export function sanitizeUrl(value: string): string {
  if (!value || typeof value !== 'string') return value;
  let sanitized = value.replace(CONTROL_CHARS_RE, '');
  sanitized = sanitized.trim();
  if (DANGEROUS_URL_SCHEMES.test(sanitized)) {
    return '';
  }
  return sanitized;
}

export function sanitizeItem(item: ImportItem): ImportItem {
  return {
    ...item,
    title: sanitizeString(item.title),
    username: sanitizeString(item.username),
    password: item.password,
    url: sanitizeUrl(item.url),
    notes: item.notes ? sanitizeString(item.notes) : null,
    emoji: item.emoji ? sanitizeString(item.emoji) : null,
  };
}

export function sanitizeFolder(folder: ImportFolder): ImportFolder {
  return {
    ...folder,
    name: sanitizeString(folder.name),
    emoji: folder.emoji ? sanitizeString(folder.emoji) : null,
  };
}

export function sanitizeTag(tag: ImportTag): ImportTag {
  return {
    ...tag,
    name: sanitizeString(tag.name),
  };
}

export function sanitizePayload(payload: ImportPayload): ImportPayload {
  return {
    folders: payload.folders.map(sanitizeFolder),
    items: payload.items.map(sanitizeItem),
    tags: payload.tags.map(sanitizeTag),
    attachments: payload.attachments,
  };
}
