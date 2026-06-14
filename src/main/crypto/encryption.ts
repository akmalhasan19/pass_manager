import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface EncryptedData {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

export function encryptAES256GCM(plaintext: Buffer, key: Buffer): EncryptedData {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Key must be ${KEY_BYTES} bytes (got ${key.length})`);
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return { ciphertext, iv, tag };
}

export function decryptAES256GCM(data: EncryptedData, key: Buffer): Buffer {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Key must be ${KEY_BYTES} bytes (got ${key.length})`);
  }

  const decipher = createDecipheriv(ALGORITHM, key, data.iv);
  decipher.setAuthTag(data.tag);
  return Buffer.concat([decipher.update(data.ciphertext), decipher.final()]);
}

export function encryptString(value: string, key: Buffer): Buffer {
  const encrypted = encryptAES256GCM(Buffer.from(value, 'utf-8'), key);
  return serializeEncrypted(encrypted);
}

export function decryptString(encryptedBlob: Buffer, key: Buffer): string {
  const data = deserializeEncrypted(encryptedBlob);
  return decryptAES256GCM(data, key).toString('utf-8');
}

export function encryptJSON(value: unknown, key: Buffer): Buffer {
  const json = JSON.stringify(value);
  return encryptString(json, key);
}

export function decryptJSON<T>(encryptedBlob: Buffer, key: Buffer): T {
  const json = decryptString(encryptedBlob, key);
  return JSON.parse(json) as T;
}

function serializeEncrypted(data: EncryptedData): Buffer {
  const ivLength = Buffer.alloc(1, data.iv.length);
  const tagLength = Buffer.alloc(1, data.tag.length);
  return Buffer.concat([ivLength, tagLength, data.iv, data.tag, data.ciphertext]);
}

function deserializeEncrypted(buffer: Buffer): EncryptedData {
  let offset = 0;
  const ivLength = buffer.readUInt8(offset);
  offset += 1;
  const tagLength = buffer.readUInt8(offset);
  offset += 1;
  const iv = buffer.subarray(offset, offset + ivLength);
  offset += ivLength;
  const tag = buffer.subarray(offset, offset + tagLength);
  offset += tagLength;
  const ciphertext = buffer.subarray(offset);
  return { ciphertext, iv, tag };
}
