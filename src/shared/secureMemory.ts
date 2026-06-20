/**
 * Secure memory utilities for wiping sensitive data from memory.
 *
 * SECURITY: Buffer contents containing cryptographic keys, passwords, or other
 * sensitive material MUST be overwritten before the reference is released.
 * V8's garbage collector does NOT zero memory, so plaintext can linger in the
 * heap indefinitely after a variable goes out of scope.
 */

import { randomBytes } from 'node:crypto';

/**
 * Overwrite a buffer's contents with zero bytes, then fill with random bytes
 * for additional scrubbing. The final fill is zero so that the buffer is
 * left in a predictable state if it is ever reused.
 *
 * The function reads the first byte after writing to create a data dependency
 * that prevents the JIT compiler from eliding the fill as a dead store.
 *
 * @param buffer  The Buffer, ArrayBuffer, or Uint8Array to wipe. Null/undefined are no-ops.
 */
export function secureClear(buffer: Buffer | ArrayBuffer | Uint8Array | null | undefined): void {
  // SECURITY: Wipe sensitive material before leaving scope
  if (!buffer) return;

  const view =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const len = view.length;
  if (len === 0) return;

  // Pass 1 – overwrite with zeros
  view.fill(0x00);

  // Pass 2 – overwrite with random bytes (adds non-determinism to confuse
  // heap-analysis tools that might look for predictable zero patterns)
  const scratch = randomBytes(Math.min(len, 256));
  for (let i = 0; i < len; i += scratch.length) {
    const chunk = scratch.subarray(0, Math.min(scratch.length, len - i));
    view.set(chunk, i);
  }

  // Pass 3 – back to zero for deterministic final state
  view.fill(0x00);

  // Data-dependency barrier: read the first byte so the compiler cannot
  // prove the fill is a dead store and optimize it away.
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  view[0] ^ 0;
}

/**
 * Securely clear a string that may contain sensitive material.
 *
 * JavaScript strings are immutable and interned by V8, so there is no
 * guaranteed way to scrub them from memory.  This function attempts to
 * minimize exposure by:
 *  1. Overwriting the backing ArrayBuffer (for externalized strings).
 *  2. Returning an empty string so the caller can drop their reference.
 *
 * Callers MUST reassign their variable to the returned empty string:
 *
 * ```ts
 * password = secureClearString(password);
 * ```
 *
 * @param str  The sensitive string (or null/undefined).
 * @returns    An empty string.
 */
export function secureClearString(str: string | null | undefined): '' {
  // SECURITY: Wipe sensitive material before leaving scope
  if (!str) return '';

  // Force V8 to externalize the string so we can touch its bytes.
  // Buffer.from creates a copy of the string's UTF-8 bytes.
  const buf = Buffer.from(str, 'utf-8');
  secureClear(buf);

  return '';
}

/**
 * Securely clear an object whose properties may contain sensitive data.
 * Each enumerable property that is a Buffer, ArrayBuffer, or string will
 * be wiped in place.
 *
 * @param obj  The object to wipe. Null/undefined are no-ops.
 */
export function secureWipeObject(obj: Record<string, unknown> | null | undefined): void {
  // SECURITY: Wipe sensitive material before leaving scope
  if (!obj || typeof obj !== 'object') return;

  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val instanceof ArrayBuffer || val instanceof Uint8Array || Buffer.isBuffer(val)) {
      secureClear(val as Buffer | ArrayBuffer | Uint8Array);
    } else if (typeof val === 'string') {
      obj[key] = secureClearString(val);
    }
  }
}
