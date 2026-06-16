import { describe, it, expect } from 'vitest';
import { secureClear, secureClearString, secureWipeObject } from '../../../src/shared/secureMemory';

describe('secureClear', () => {
  it('should overwrite Buffer contents with zeros', () => {
    const buffer = Buffer.from('sensitive data', 'utf-8');
    const originalLength = buffer.length;
    expect(originalLength).toBeGreaterThan(0);

    secureClear(buffer);

    // After secureClear, all bytes should be zero
    for (let i = 0; i < buffer.length; i++) {
      expect(buffer[i]).toBe(0);
    }
  });

  it('should overwrite ArrayBuffer contents with zeros', () => {
    const arrayBuffer = new ArrayBuffer(32);
    const view = new Uint8Array(arrayBuffer);
    // Fill with non-zero data
    for (let i = 0; i < view.length; i++) {
      view[i] = i + 1;
    }

    secureClear(arrayBuffer);

    // After secureClear, all bytes should be zero
    for (let i = 0; i < view.length; i++) {
      expect(view[i]).toBe(0);
    }
  });

  it('should overwrite Uint8Array contents with zeros', () => {
    const uint8Array = new Uint8Array([1, 2, 3, 4, 5]);
    secureClear(uint8Array);

    for (let i = 0; i < uint8Array.length; i++) {
      expect(uint8Array[i]).toBe(0);
    }
  });

  it('should handle null buffer gracefully', () => {
    // Should not throw
    expect(() => secureClear(null)).not.toThrow();
  });

  it('should handle undefined buffer gracefully', () => {
    // Should not throw
    expect(() => secureClear(undefined)).not.toThrow();
  });

  it('should handle empty buffer', () => {
    const emptyBuffer = Buffer.alloc(0);
    expect(() => secureClear(emptyBuffer)).not.toThrow();
  });

  it('should handle large buffers (1MB)', () => {
    const largeBuffer = Buffer.alloc(1024 * 1024, 0xff);
    secureClear(largeBuffer);

    // Verify all bytes are zero
    for (let i = 0; i < largeBuffer.length; i++) {
      expect(largeBuffer[i]).toBe(0);
    }
  });

  it('should handle Buffer with mixed content', () => {
    const buffer = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) {
      buffer[i] = i;
    }

    secureClear(buffer);

    for (let i = 0; i < buffer.length; i++) {
      expect(buffer[i]).toBe(0);
    }
  });
});

describe('secureClearString', () => {
  it('should return empty string', () => {
    const result = secureClearString('sensitive password');
    expect(result).toBe('');
  });

  it('should handle null string', () => {
    const result = secureClearString(null);
    expect(result).toBe('');
  });

  it('should handle undefined string', () => {
    const result = secureClearString(undefined);
    expect(result).toBe('');
  });

  it('should handle empty string', () => {
    const result = secureClearString('');
    expect(result).toBe('');
  });
});

describe('secureWipeObject', () => {
  it('should wipe Buffer properties', () => {
    const obj = {
      key: Buffer.from('secret key', 'utf-8'),
      other: 'not wiped',
    };

    secureWipeObject(obj);

    // Buffer should be wiped
    const keyBuf = obj.key as Buffer;
    for (let i = 0; i < keyBuf.length; i++) {
      expect(keyBuf[i]).toBe(0);
    }
    // String property should be replaced with empty string
    expect(obj.other).toBe('');
  });

  it('should wipe ArrayBuffer properties', () => {
    const obj = {
      data: new ArrayBuffer(16),
    };
    const view = new Uint8Array(obj.data);
    for (let i = 0; i < view.length; i++) {
      view[i] = i;
    }

    secureWipeObject(obj);

    for (let i = 0; i < view.length; i++) {
      expect(view[i]).toBe(0);
    }
  });

  it('should wipe Uint8Array properties', () => {
    const obj = {
      data: new Uint8Array([10, 20, 30]),
    };

    secureWipeObject(obj);

    expect(obj.data[0]).toBe(0);
    expect(obj.data[1]).toBe(0);
    expect(obj.data[2]).toBe(0);
  });

  it('should handle null object gracefully', () => {
    expect(() => secureWipeObject(null)).not.toThrow();
  });

  it('should handle undefined object gracefully', () => {
    expect(() => secureWipeObject(undefined)).not.toThrow();
  });

  it('should handle non-object input gracefully', () => {
    expect(() => secureWipeObject('string' as unknown as Record<string, unknown>)).not.toThrow();
  });

  it('should wipe mixed types in object', () => {
    const obj = {
      buffer: Buffer.from('data', 'utf-8'),
      arrayBuffer: new ArrayBuffer(8),
      uint8Array: new Uint8Array([1, 2, 3]),
      string: 'password123',
      number: 42,
      boolean: true,
    };

    secureWipeObject(obj);

    // Buffers should be wiped
    for (let i = 0; i < obj.buffer.length; i++) {
      expect(obj.buffer[i]).toBe(0);
    }
    const view = new Uint8Array(obj.arrayBuffer);
    for (let i = 0; i < view.length; i++) {
      expect(view[i]).toBe(0);
    }
    expect(obj.uint8Array[0]).toBe(0);
    expect(obj.uint8Array[1]).toBe(0);
    expect(obj.uint8Array[2]).toBe(0);
    // String should be replaced with empty string
    expect(obj.string).toBe('');
    // Non-sensitive types should remain unchanged
    expect(obj.number).toBe(42);
    expect(obj.boolean).toBe(true);
  });
});
