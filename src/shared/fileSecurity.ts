/**
 * File Security Utilities
 *
 * Provides helper functions to prevent path traversal attacks,
 * validate file extensions, and enforce file size limits.
 */

import { resolve, relative, sep, extname } from 'node:path';

/**
 * Maximum file sizes for different contexts (in bytes).
 */
export const FILE_SIZE_LIMITS = {
  /** Maximum size for file attachments: 50 MB */
  ATTACHMENT: 50 * 1024 * 1024,
  /** Maximum size for cover images: 5 MB */
  COVER_IMAGE: 5 * 1024 * 1024,
  /** Maximum size for import files: 100 MB */
  IMPORT: 100 * 1024 * 1024,
} as const;

/**
 * Allowed file extensions for attachments.
 * Blocks potentially dangerous executables and scripts.
 */
export const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  // Documents
  '.txt', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.odt', '.ods', '.odp', '.rtf', '.csv', '.tsv', '.md',
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg',
  // Audio/Video
  '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.m4a', '.avi',
  // Archives
  '.zip', '.gz', '.tar', '.7z',
  // Data
  '.json', '.xml', '.yaml', '.yml',
  // Other
  '.enc', '.key', '.pem', '.cer',
]);

/**
 * Dangerous file extensions that should never be allowed.
 * This is a blocklist as additional defense even if the allowlist is used.
 */
export const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.pif',
  '.vbs', '.vbe', '.js', '.jse', '.ws', '.wsf', '.wsc',
  '.ps1', '.psm1', '.psd1', '.ps1xml', '.pssc', '.psrc',
  '.reg', '.dll', '.sys', '.drv', '.cpl',
  '.app', '.sh', '.bash', '.command',
  '.jar', '.class', '.py', '.pyc', '.rb', '.pl',
  '.hta', '.cpl', '.msc', '.gadget',
]);

/**
 * Checks if a file path contains path traversal sequences.
 * Detects `..` in various forms including encoded variants.
 *
 * @param filePath - The file path to check
 * @returns true if path traversal is detected, false otherwise
 */
export function containsPathTraversal(filePath: string): boolean {
  if (typeof filePath !== 'string') return true;

  // Check for .. in various forms
  const normalized = filePath.replace(/\\/g, '/');

  // Direct .. sequences
  if (normalized.includes('..')) return true;

  // URL-encoded variants
  const decoded = decodeURIComponent(normalized);
  if (decoded.includes('..')) return true;

  // Double-encoded variants
  try {
    const doubleDecoded = decodeURIComponent(decoded);
    if (doubleDecoded.includes('..')) return true;
  } catch {
    // Ignore decode errors
  }

  // Null byte injection
  if (normalized.includes('\0') || normalized.includes('%00')) return true;

  return false;
}

/**
 * Validates that a resolved path is within the allowed base directory.
 * This is the primary defense against path traversal attacks.
 *
 * @param basePath - The base directory that must contain the file
 * @param filePath - The file path to validate
 * @returns true if the resolved path is within the base directory
 */
export function isPathWithinDirectory(basePath: string, filePath: string): boolean {
  const resolvedBase = resolve(basePath);
  const resolvedPath = resolve(basePath, filePath);
  const rel = relative(resolvedBase, resolvedPath);

  // Path must not start with .. (outside base) and must not be absolute
  return !rel.startsWith('..') && !rel.startsWith(sep) && !rel.startsWith('/');
}

/**
 * Sanitizes a filename by removing or replacing dangerous characters.
 * Preserves the extension but sanitizes the name part.
 *
 * @param fileName - The original filename
 * @returns A sanitized filename safe for filesystem use
 */
export function sanitizeFileName(fileName: string): string {
  if (typeof fileName !== 'string') return 'unnamed';

  // Extract just the filename (no path)
  const nameOnly = fileName.split(/[/\\]/).pop() ?? 'unnamed';

  // Replace dangerous characters with underscores
  // Allow: alphanumeric, dots, hyphens, underscores, spaces
  const sanitized = nameOnly
    .replace(/[^\w.\- ()[\]]/g, '_')
    .replace(/\.{2,}/g, '.')  // No consecutive dots
    .replace(/^\./, '_')      // No leading dot (hidden files)
    .trim();

  // Limit length (255 is typical filesystem max)
  if (sanitized.length > 255) {
    const ext = extname(sanitized);
    const nameWithoutExt = sanitized.slice(0, sanitized.length - ext.length);
    return nameWithoutExt.slice(0, 255 - ext.length) + ext;
  }

  return sanitized || 'unnamed';
}

/**
 * Validates a file extension against the allowed list.
 * Also checks against the blocklist as defense-in-depth.
 *
 * @param fileName - The filename to check
 * @param allowedExtensions - Optional custom allowed extensions set
 * @returns true if the extension is allowed, false otherwise
 */
export function isAllowedExtension(
  fileName: string,
  allowedExtensions: Set<string> = ALLOWED_ATTACHMENT_EXTENSIONS,
): boolean {
  if (typeof fileName !== 'string') return false;

  const ext = extname(fileName).toLowerCase();
  if (!ext) return false;

  // Check blocklist first (defense-in-depth)
  if (BLOCKED_EXTENSIONS.has(ext)) return false;

  return allowedExtensions.has(ext);
}

/**
 * Validates file size against a limit.
 *
 * @param fileSize - The file size in bytes
 * @param maxSize - The maximum allowed size in bytes
 * @returns true if the file size is within the limit
 */
export function isValidFileSize(fileSize: number, maxSize: number): boolean {
  if (typeof fileSize !== 'number' || !Number.isFinite(fileSize)) return false;
  return fileSize > 0 && fileSize <= maxSize;
}

/**
 * Comprehensive file validation for uploads.
 * Checks path traversal, extension, and size in one call.
 *
 * @param filePath - The source file path
 * @param fileSize - The file size in bytes (if known)
 * @param options - Validation options
 * @returns An object with `valid` flag and `error` message if invalid
 */
export function validateFileUpload(
  filePath: string,
  fileSize?: number,
  options: {
    maxSize?: number;
    allowedExtensions?: Set<string>;
    basePath?: string;
  } = {},
): { valid: boolean; error?: string } {
  const {
    maxSize = FILE_SIZE_LIMITS.ATTACHMENT,
    allowedExtensions = ALLOWED_ATTACHMENT_EXTENSIONS,
    basePath,
  } = options;

  // Check path traversal
  if (containsPathTraversal(filePath)) {
    return { valid: false, error: 'File path contains invalid traversal sequences.' };
  }

  // Check if path is within base directory (if specified)
  if (basePath && !isPathWithinDirectory(basePath, filePath)) {
    return { valid: false, error: 'File path is outside the allowed directory.' };
  }

  // Extract and validate filename
  const fileName = filePath.split(/[/\\]/).pop() ?? '';
  if (!fileName) {
    return { valid: false, error: 'Invalid filename.' };
  }

  // Check extension
  if (!isAllowedExtension(fileName, allowedExtensions)) {
    const ext = extname(fileName).toLowerCase();
    return {
      valid: false,
      error: `File type '${ext || 'unknown'}' is not allowed for security reasons.`,
    };
  }

  // Check size (if provided)
  if (fileSize !== undefined && !isValidFileSize(fileSize, maxSize)) {
    const maxMB = (maxSize / 1024 / 1024).toFixed(0);
    if (fileSize <= 0) {
      return { valid: false, error: 'File is empty.' };
    }
    return {
      valid: false,
      error: `File is too large (${(fileSize / 1024 / 1024).toFixed(1)} MB). Maximum: ${maxMB} MB.`,
    };
  }

  return { valid: true };
}

/**
 * Formats a file size in bytes to a human-readable string.
 *
 * @param bytes - The file size in bytes
 * @returns Formatted string like "1.5 MB"
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}
