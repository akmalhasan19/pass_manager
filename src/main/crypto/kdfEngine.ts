import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { secureClear } from '../../shared/secureMemory';
import { KEY_BYTES, PBKDF2_DIGEST } from './keyDerivation';
import {
  deriveKeyArgon2id as argon2idDerive,
  initArgon2idEngine,
  isArgon2idAvailable,
  DEFAULT_ARGON2ID_PARAMS,
  Argon2idParams,
} from './argon2id';

export type KdfAlgorithm = 'pbkdf2' | 'argon2id';

export interface KdfParamsPbkdf2 {
  algorithm: 'pbkdf2';
  iterations: number;
}

export type KdfParams = KdfParamsPbkdf2 | Argon2idParams;

export interface KeyDerivationResult {
  key: Buffer;
  salt: Buffer;
  params: KdfParams;
}

export interface KDFEngine {
  deriveKey(password: string, salt: Buffer, params: KdfParams): Promise<Buffer>;
  getAlgorithm(): KdfAlgorithm;
}

/**
 * Result of key derivation that includes fallback information.
 * Used when Argon2id falls back to PBKDF2.
 */
export interface KeyDerivationResultWithFallback extends KeyDerivationResult {
  /** True if Argon2id was requested but PBKDF2 was used instead */
  fallbackOccurred: boolean;
  /** Error message if fallback occurred */
  fallbackReason?: string;
}

export class PBKDF2Engine implements KDFEngine {
  getAlgorithm(): KdfAlgorithm {
    return 'pbkdf2';
  }

  async deriveKey(password: string, salt: Buffer, params: KdfParams): Promise<Buffer> {
    if (params.algorithm !== 'pbkdf2') {
      throw new Error('PBKDF2Engine received non-PBKDF2 params');
    }

    const passwordBuffer = Buffer.from(password, 'utf-8');
    try {
      return pbkdf2Sync(passwordBuffer, salt, params.iterations, KEY_BYTES, PBKDF2_DIGEST);
    } finally {
      secureClear(passwordBuffer);
    }
  }
}

export class Argon2idEngine implements KDFEngine {
  private initPromise: Promise<boolean> | null = null;
  private _fallbackOccurred = false;
  private _fallbackReason: string | undefined;

  getAlgorithm(): KdfAlgorithm {
    return 'argon2id';
  }

  /**
   * Returns true if Argon2id fell back to PBKDF2 during the last deriveKey call.
   */
  get fallbackOccurred(): boolean {
    return this._fallbackOccurred;
  }

  /**
   * Returns the reason for fallback, if any.
   */
  get fallbackReason(): string | undefined {
    return this._fallbackReason;
  }

  async deriveKey(password: string, salt: Buffer, params: KdfParams): Promise<Buffer> {
    if (params.algorithm !== 'argon2id') {
      throw new Error('Argon2idEngine received non-Argon2id params');
    }

    await this.ensureInitialized();

    // If Argon2id is not available after initialization, fallback to PBKDF2
    if (!isArgon2idAvailable()) {
      this._fallbackOccurred = true;
      this._fallbackReason = 'Argon2id not available, using PBKDF2 fallback';
      // Use PBKDF2 with default iterations as fallback
      return pbkdf2Sync(
        Buffer.from(password, 'utf-8'),
        salt,
        600000, // DEFAULT_PBKDF2_ITERATIONS
        KEY_BYTES,
        PBKDF2_DIGEST,
      );
    }

    return argon2idDerive(password, salt, params);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = (async () => {
      const status = await initArgon2idEngine();
      // Don't throw on unavailable - we'll handle fallback in deriveKey
      return status.status !== 'unavailable';
    })();

    await this.initPromise;
  }
}

export function createEngine(algorithm: KdfAlgorithm): KDFEngine {
  switch (algorithm) {
    case 'pbkdf2':
      return new PBKDF2Engine();
    case 'argon2id':
      return new Argon2idEngine();
    default: {
      const _exhaustive: never = algorithm;
      throw new Error(`Unknown KDF algorithm: ${_exhaustive}`);
    }
  }
}

/**
 * Creates a KDF engine with fallback tracking.
 * Returns both the engine and a way to check if fallback occurred.
 */
export function createEngineWithFallback(algorithm: KdfAlgorithm): {
  engine: KDFEngine;
  getFallbackInfo: () => { occurred: boolean; reason?: string };
} {
  const engine = createEngine(algorithm);

  if (engine instanceof Argon2idEngine) {
    return {
      engine,
      getFallbackInfo: () => ({
        occurred: engine.fallbackOccurred,
        reason: engine.fallbackReason,
      }),
    };
  }

  return {
    engine,
    getFallbackInfo: () => ({ occurred: false }),
  };
}

export function createSalt(length: number = 32): Buffer {
  return randomBytes(length);
}

export function extractPbkdf2Params(params: KdfParams): KdfParamsPbkdf2 {
  if (params.algorithm !== 'pbkdf2') {
    throw new Error('Expected PBKDF2 params');
  }
  return params;
}

export function extractArgon2idParams(params: KdfParams): Argon2idParams {
  if (params.algorithm !== 'argon2id') {
    throw new Error('Expected Argon2id params');
  }
  return params;
}
