import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { randomBytes } from 'node:crypto';
import {
  containsPathTraversal,
  isPathWithinDirectory,
  FILE_SIZE_LIMITS,
} from '../../shared/fileSecurity';

const COVERS_DIR_NAME = 'covers';

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export function getCoversDir(): string {
  const userDataPath = app?.getPath?.('userData') ?? join(process.cwd(), 'data');
  const dir = join(userDataPath, COVERS_DIR_NAME);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getExtension(fileName: string): string {
  const match = fileName.toLowerCase().match(/\.[^.]+$/);
  return match?.[0] ?? '';
}

function getMimeType(fileName: string): string {
  return MIME_TYPES[getExtension(fileName)] ?? 'application/octet-stream';
}

/**
 * Validates and saves a cover image to the app's covers directory.
 *
 * Cover images are stored unencrypted (cosmetic only) as required by the
 * zero-knowledge architecture: only the path/reference is kept in the DB.
 *
 * @param sourcePath - Absolute path to the source image file.
 * @returns The generated cover filename (stored in DB metadata).
 */
export function saveCoverImage(sourcePath: string): string {
  // Validate path for traversal attacks
  if (containsPathTraversal(sourcePath)) {
    throw new Error('Invalid file path: path traversal detected.');
  }

  const fileName = sourcePath.split(/[/\\]/).pop() ?? 'cover';
  const ext = getExtension(fileName);

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(
      `Unsupported image format: ${ext || 'none'}. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`,
    );
  }

  const stats = existsSync(sourcePath)
    ? (() => {
        try {
          return statSync(sourcePath);
        } catch {
          return null;
        }
      })()
    : null;

  if (!stats) {
    throw new Error(`Source image not found: ${sourcePath}`);
  }

  if (stats.size > FILE_SIZE_LIMITS.COVER_IMAGE) {
    throw new Error(
      `Cover image is too large (${(stats.size / 1024 / 1024).toFixed(1)} MB). Max: ${FILE_SIZE_LIMITS.COVER_IMAGE / 1024 / 1024} MB.`,
    );
  }

  const id = `${Date.now()}-${randomBytes(6).toString('hex')}`;
  const safeExt = ext.replace(/[^a-z0-9.]/g, '');
  const coverName = `cover-${id}${safeExt}`;
  const destPath = join(getCoversDir(), coverName);

  copyFileSync(sourcePath, destPath);

  return coverName;
}

/**
 * Reads a cover image and returns it as a base64 data URL.
 *
 * @param coverName - Filename returned by {@link saveCoverImage}.
 * @returns Base64 data URL suitable for `<img src="..." />`.
 */
export function readCoverImage(coverName: string): string {
  // Validate coverName for path traversal
  if (containsPathTraversal(coverName)) {
    throw new Error('Invalid cover image name: path traversal detected.');
  }

  const coversDir = getCoversDir();
  const filePath = join(coversDir, coverName);

  // Prevent path traversal: resolved path must be within covers directory
  if (!isPathWithinDirectory(coversDir, coverName)) {
    throw new Error('Invalid cover image path');
  }

  if (!existsSync(filePath)) {
    throw new Error(`Cover image not found: ${coverName}`);
  }

  const mimeType = getMimeType(coverName);
  const data = readFileSync(filePath);
  const base64 = data.toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Deletes a cover image from the app's covers directory.
 *
 * @param coverName - Filename returned by {@link saveCoverImage}.
 */
export function deleteCoverImage(coverName: string): void {
  // Validate coverName for path traversal
  if (containsPathTraversal(coverName)) {
    throw new Error('Invalid cover image name: path traversal detected.');
  }

  const coversDir = getCoversDir();
  const filePath = join(coversDir, coverName);

  // Prevent path traversal: resolved path must be within covers directory
  if (!isPathWithinDirectory(coversDir, coverName)) {
    throw new Error('Invalid cover image path');
  }

  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
