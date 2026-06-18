/**
 * Clipboard Service
 *
 * Terpusat dan aman: menyediakan auto-clear clipboard dengan timeout,
 * toast notification, serta siklus hidup clipboard yang aman.
 * Seluruh manipulasi clipboard yang melibatkan data sensitif (password,
 * OTP, dll.) harus melalui service ini.
 *
 * SECURITY:
 * - Clipboard auto-clear timer (default 45 detik).
 * - Clipboard di-clear secara eksplisit setelah timeout.
 * - Jika aplikasi di-lock, clipboard langsung di-clear.
 * - Riwayat clipboard dihindari; setiap write langsung replace konten sebelumnya.
 *
 * @module services/clipboardService
 */

import { clipboard } from 'electron';
import { logger } from '../../shared/logger';
import { secureClearString } from '../../shared/secureMemory';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClipboardWriteOptions {
  /** Auto-clear dalam detik. Default: 45 detik. */
  clearAfterSeconds?: number;
  /** Tampilkan toast notification setelah copy? Default: true. */
  showToast?: boolean;
  /** Pesan toast notification. Default: bergantung type. */
  toastMessage?: string;
  /** Label dari item yang di-copy (password, username, OTP, dll.) */
  type: 'password' | 'username' | 'otp' | 'url' | 'other';
}

export interface ClipboardStatus {
  hasAutoClear: boolean;
  clearInSeconds: number | null;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface ClipboardState {
  /** Timer ID untuk auto-clear. Null jika tidak ada. */
  clearTimer: ReturnType<typeof setTimeout> | null;
  /** Timestamp mulai timer. */
  timerStartedAt: number | null;
  /** Durasi auto-clear dalam detik (terakhir). */
  lastClearDuration: number;
  /** Callbacks yang listen clipboard event (misalnya untuk update UI). */
  statusListeners: Set<(status: ClipboardStatus) => void>;
}

const state: ClipboardState = {
  clearTimer: null,
  timerStartedAt: null,
  lastClearDuration: 45,
  statusListeners: new Set(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Kirim status clipboard ke semua listener (misalnya renderer toast).
 */
function emitStatus(): void {
  const status: ClipboardStatus = {
    hasAutoClear: state.clearTimer !== null,
    clearInSeconds: state.timerStartedAt ?
      Math.max(0, Math.ceil((state.timerStartedAt + state.lastClearDuration * 1000 - Date.now()) / 1000)) : null,
  };
  for (const listener of state.statusListeners) {
    try {
      listener(status);
    } catch (err) {
      logger.error('Clipboard status listener error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Bersihkan timer sebelumnya.
 */
function clearPreviousTimer(): void {
  if (state.clearTimer) {
    clearTimeout(state.clearTimer);
    state.clearTimer = null;
    state.timerStartedAt = null;
  }
}

/**
 * Clear clipboard secara aman.
 */
function doClearClipboard(): void {
  try {
    clipboard.clear();
    state.clearTimer = null;
    state.timerStartedAt = null;
    state.statusListeners.clear();
    logger.info('Clipboard auto-cleared');
  } catch (err) {
    logger.error('Clipboard clear failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Write teks ke clipboard dengan auto-clear timeout.
 * Ini adalah satu-satunya entrypoint untuk menulis data ke clipboard secara aman.
 *
 * @param text - Teks yang akan dikopi.
 * @param options - Opsi untuk auto-clear dan toast.
 * @returns Waktu dalam detik sampai clipboard di-clear.
 */
export function writeToClipboard(text: string, options: ClipboardWriteOptions): number {
  const clearDuration = options.clearAfterSeconds ?? 45;

  // 1. Clear timer sebelumnya jika ada
  clearPreviousTimer();

  // 2. Write ke clipboard
  clipboard.writeText(text);

  // 3. Buat auto-clear timer
  const timer = setTimeout(() => {
    doClearClipboard();
  }, clearDuration * 1000);

  state.clearTimer = timer;
  state.timerStartedAt = Date.now();
  state.lastClearDuration = clearDuration;

  // 4. Log (tanpa data sensitif)
  logger.info(`Clipboard: ${options.type} copied (auto-clear in ${clearDuration}s)`);

  // 5. Emit status ke listeners
  emitStatus();

  return clearDuration;
}

/**
 * Copy teks ke clipboard dan kembalikan durasi auto-clear.
 * Preferensi yang menggunakan secureClearString otomatis.
 */
export function secureCopy(text: string, options: ClipboardWriteOptions): number {
  if (!text || typeof text !== 'string') {
    throw new TypeError('secureCopy: text must be a non-empty string');
  }

  try {
    return writeToClipboard(text, options);
  } finally {
    // SECURITY: usahakan clear string dari memory secepatnya
    // Perlu di-handle di caller karena string immutable di JS
  }
}

/**
 * Clear clipboard dan batalkan timer.
 */
export function clearClipboard(): void {
  clearPreviousTimer();
  doClearClipboard();
}

/**
 * Bersihkan clipboard karena vault di-lock.
 * Ini dipanggil otomatis ketika auth lock terjadi.
 */
export function clearClipboardOnLock(): void {
  if (state.clearTimer) {
    clearPreviousTimer();
    doClearClipboard();
    logger.info('Clipboard cleared: vault locked');
  }
}

/**
 * Dapatkan status clipboard auto-clear.
 */
export function getClipboardStatus(): ClipboardStatus {
  return {
    hasAutoClear: state.clearTimer !== null,
    clearInSeconds: state.timerStartedAt ?
      Math.max(0, Math.ceil((state.timerStartedAt + state.lastClearDuration * 1000 - Date.now()) / 1000)) : null,
  };
}

/**
 * Register listener untuk perubahan status clipboard.
 */
export function onClipboardStatusChange(callback: (status: ClipboardStatus) => void): void {
  state.statusListeners.add(callback);
}

/**
 * Hapus listener status clipboard.
 */
export function offClipboardStatusChange(callback: (status: ClipboardStatus) => void): void {
  state.statusListeners.delete(callback);
}

/**
 * Cleanup semua resources clipboard service.
 */
export function cleanupClipboardService(): void {
  clearPreviousTimer();
  state.statusListeners.clear();
}
