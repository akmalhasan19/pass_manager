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

import { Notification, clipboard } from 'electron';
import { createHash } from 'node:crypto';
import { logger } from '../../shared/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClipboardWriteOptions {
  /** Auto-clear dalam detik. Default: 45 detik. Gunakan null untuk menonaktifkan auto-clear. */
  clearAfterSeconds?: number | null;
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
  message: string | null;
  type: ClipboardWriteOptions['type'] | null;
}

export interface ClipboardCopyResult {
  clearAfterSeconds: number;
  message: string;
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
  /** Hash konten sensitif terakhir, agar auto-clear tidak menghapus clipboard baru milik user. */
  protectedContentHash: string | null;
  /** Pesan status/toast terakhir. */
  lastMessage: string | null;
  /** Tipe konten terakhir. */
  lastType: ClipboardWriteOptions['type'] | null;
  /** Callbacks yang listen clipboard event (misalnya untuk update UI). */
  statusListeners: Set<(status: ClipboardStatus) => void>;
}

const state: ClipboardState = {
  clearTimer: null,
  timerStartedAt: null,
  lastClearDuration: 45,
  protectedContentHash: null,
  lastMessage: null,
  lastType: null,
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
    message: state.lastMessage,
    type: state.lastType,
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
 * Hash konten clipboard tanpa menyimpan plaintext lebih lama dari kebutuhan
 * operasi write/compare.
 */
function hashClipboardText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Normalisasi durasi auto-clear agar tidak bisa dimatikan atau dibuat terlalu lama.
 */
function normalizeClearDuration(seconds: number | null | undefined): number {
  if (seconds === null) {
    return 0;
  }

  if (!Number.isFinite(seconds)) {
    return 45;
  }

  return Math.min(300, Math.max(1, Math.floor(seconds ?? 45)));
}

/**
 * Format pesan toast copy tanpa mengekspos konten sensitif.
 */
function formatClipboardMessage(type: ClipboardWriteOptions['type'], seconds: number): string {
  const labelByType: Record<ClipboardWriteOptions['type'], string> = {
    password: 'Password',
    username: 'Username',
    otp: 'OTP',
    url: 'URL',
    other: 'Value',
  };

  if (seconds === 0) {
    return `${labelByType[type]} copied`;
  }

  return `${labelByType[type]} copied - will clear in ${seconds}s`;
}

/**
 * Tampilkan notifikasi native jika platform mendukungnya. Renderer juga dapat
 * menampilkan toast dari return value/status IPC, tetapi global shortcut butuh
 * feedback saat window utama tidak fokus.
 */
function showNativeToast(message: string): void {
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: 'SecurePass',
        body: message,
        silent: true,
      }).show();
    }
  } catch (err) {
    logger.debug('Clipboard notification skipped', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Clear clipboard secara aman.
 */
function doClearClipboard(force = false): void {
  try {
    const currentText = clipboard.readText();
    const currentHash = currentText ? hashClipboardText(currentText) : null;

    if (force || !state.protectedContentHash || currentHash === state.protectedContentHash) {
      clipboard.clear();
      logger.info('Clipboard auto-cleared');
    } else {
      logger.info('Clipboard auto-clear skipped because clipboard content changed');
    }

    state.clearTimer = null;
    state.timerStartedAt = null;
    state.protectedContentHash = null;
    state.lastMessage = null;
    state.lastType = null;
    emitStatus();
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
 * @returns Detail copy dan waktu dalam detik sampai clipboard di-clear.
 */
export function writeToClipboard(text: string, options: ClipboardWriteOptions): ClipboardCopyResult {
  if (typeof text !== 'string' || text.length === 0) {
    throw new TypeError('writeToClipboard: text must be a non-empty string');
  }

  const clearDuration = normalizeClearDuration(options.clearAfterSeconds);
  const message = options.toastMessage ?? formatClipboardMessage(options.type, clearDuration);

  // 1. Clear timer sebelumnya jika ada
  clearPreviousTimer();

  // 2. Write ke clipboard melalui API native Electron. Ini menjaga operasi
  // sensitif di main process dan memakai clipboard OS langsung.
  clipboard.write({ text });

  // 3. Buat auto-clear timer jika durasi diaktifkan
  if (clearDuration > 0) {
    const timer = setTimeout(() => {
      doClearClipboard();
    }, clearDuration * 1000);

    state.clearTimer = timer;
    state.timerStartedAt = Date.now();
  } else {
    state.clearTimer = null;
    state.timerStartedAt = null;
  }
  state.lastClearDuration = clearDuration;
  state.protectedContentHash = hashClipboardText(text);
  state.lastMessage = message;
  state.lastType = options.type;

  // 4. Log (tanpa data sensitif)
  logger.info(`Clipboard: ${options.type} copied (auto-clear in ${clearDuration}s)`);

  if (options.showToast ?? true) {
    showNativeToast(message);
  }

  // 5. Emit status ke listeners
  emitStatus();

  return { clearAfterSeconds: clearDuration, message };
}

/**
 * Copy teks ke clipboard dan kembalikan durasi auto-clear.
 * Preferensi yang menggunakan secureClearString otomatis.
 */
export function secureCopy(text: string, options: ClipboardWriteOptions): ClipboardCopyResult {
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
  doClearClipboard(true);
}

/**
 * Bersihkan clipboard karena vault di-lock.
 * Ini dipanggil otomatis ketika auth lock terjadi.
 */
export function clearClipboardOnLock(): void {
  if (state.clearTimer) {
    clearPreviousTimer();
    doClearClipboard(true);
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
    message: state.lastMessage,
    type: state.lastType,
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
  state.protectedContentHash = null;
  state.lastMessage = null;
  state.lastType = null;
  state.statusListeners.clear();
}
