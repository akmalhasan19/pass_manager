import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import exportV1Schema from '@shared/schemas/export-v1.schema.json';
import type { ExportPayload, EncryptedExportFile } from '@shared/types';
import { EXPORT_FORMAT_VERSION, EXPORT_MAGIC } from '@shared/types';

const ajv = new Ajv({ allErrors: true, strict: false });

const validateExportPayload: ValidateFunction = ajv.compile(exportV1Schema);

export class ExportSchemaError extends Error {
  public readonly errors: ErrorObject[];

  constructor(message: string, errors: ErrorObject[] = []) {
    super(message);
    this.name = 'ExportSchemaError';
    this.errors = errors;
  }
}

export function validateExportPayloadSchema(payload: unknown): ExportPayload {
  if (validateExportPayload(payload)) {
    return payload as ExportPayload;
  }

  const details = formatAjvErrors(validateExportPayload.errors ?? []);
  throw new ExportSchemaError(
    `Export payload failed schema validation: ${details}`,
    validateExportPayload.errors ?? [],
  );
}

export function getSupportedFormatVersions(): number[] {
  return [1];
}

export function isSupportedFormatVersion(version: number): boolean {
  return getSupportedFormatVersions().includes(version);
}

export function validateEncryptedFileStructure(data: unknown): EncryptedExportFile {
  if (typeof data !== 'object' || data === null) {
    throw new ExportSchemaError('Encrypted export file must be a JSON object.');
  }

  const obj = data as Record<string, unknown>;

  if (obj.magic !== EXPORT_MAGIC) {
    throw new ExportSchemaError(
      `Invalid file format. Expected magic "${EXPORT_MAGIC}", got "${String(obj.magic)}".`,
    );
  }

  if (typeof obj.formatVersion !== 'number') {
    throw new ExportSchemaError('Missing or invalid "formatVersion" in encrypted export file.');
  }

  if (!isSupportedFormatVersion(obj.formatVersion)) {
    throw new ExportSchemaError(
      `Unsupported export format version ${obj.formatVersion}. Supported versions: ${getSupportedFormatVersions().join(', ')}.`,
    );
  }

  if (obj.encryptionAlgorithm !== 'aes-256-gcm') {
    throw new ExportSchemaError(
      `Unsupported encryption algorithm: "${String(obj.encryptionAlgorithm)}".`,
    );
  }

  if (typeof obj.iv !== 'string' || obj.iv.length === 0) {
    throw new ExportSchemaError('Missing or invalid "iv" in encrypted export file.');
  }

  if (typeof obj.authTag !== 'string' || obj.authTag.length === 0) {
    throw new ExportSchemaError('Missing or invalid "authTag" in encrypted export file.');
  }

  if (typeof obj.ciphertext !== 'string' || obj.ciphertext.length === 0) {
    throw new ExportSchemaError('Missing or invalid "ciphertext" in encrypted export file.');
  }

  return {
    magic: obj.magic as string,
    formatVersion: obj.formatVersion as number,
    encryptionAlgorithm: obj.encryptionAlgorithm as 'aes-256-gcm',
    iv: obj.iv as string,
    authTag: obj.authTag as string,
    ciphertext: obj.ciphertext as string,
  };
}

export function createExportMetadata(
  appVersion: string,
  schemaVersion: number,
  counts: { items: number; folders: number; tags: number; attachments: number },
): ExportPayload['metadata'] {
  return {
    appName: 'SecurePass Manager',
    appVersion,
    exportedAt: Date.now(),
    formatVersion: EXPORT_FORMAT_VERSION,
    schemaVersion,
    itemCount: counts.items,
    folderCount: counts.folders,
    tagCount: counts.tags,
    attachmentCount: counts.attachments,
  };
}

function formatAjvErrors(errors: ErrorObject[]): string {
  return errors
    .map((err) => {
      const path = err.instancePath || '(root)';
      return `${path}: ${err.message ?? 'unknown error'}`;
    })
    .join('; ');
}
