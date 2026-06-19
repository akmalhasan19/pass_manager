export function secureClearString(str: string | null | undefined): '' {
  if (!str || str.length === 0) return '';

  try {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(str);
    const view = new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength);

    const len = view.length;
    if (len === 0) return '';

    view.fill(0x00);

    const scratch = new Uint8Array(Math.min(len, 64));
    crypto.getRandomValues(scratch);
    for (let i = 0; i < len; i += scratch.length) {
      const chunkLen = Math.min(scratch.length, len - i);
      view.set(scratch.subarray(0, chunkLen), i);
    }

    view.fill(0x00);

    view[0] ^ 0;
  } catch {
  }

  return '';
}

export function secureClearArrayBuffer(ab: ArrayBuffer | ArrayBufferLike | null | undefined): void {
  if (!ab) return;

  try {
    const view = new Uint8Array(ab);
    const len = view.length;
    if (len === 0) return;

    view.fill(0x00);

    const scratch = new Uint8Array(Math.min(len, 64));
    crypto.getRandomValues(scratch);
    for (let i = 0; i < len; i += scratch.length) {
      const chunkLen = Math.min(scratch.length, len - i);
      view.set(scratch.subarray(0, chunkLen), i);
    }

    view.fill(0x00);

    view[0] ^ 0;
  } catch {
  }
}

export function clearSessionCredentials(
  obj: Record<string, unknown> | null | undefined,
): void {
  if (!obj || typeof obj !== 'object') return;

  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === 'string') {
      obj[key] = secureClearString(val);
    } else if (val instanceof ArrayBuffer || val instanceof Uint8Array) {
      if (val instanceof ArrayBuffer) {
        secureClearArrayBuffer(val);
      } else {
        secureClearArrayBuffer(val.buffer as ArrayBuffer);
      }
    }
  }
}
