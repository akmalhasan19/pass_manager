import { createHash } from 'node:crypto';
import type { Item, HealthReport } from '../../shared/types';

export interface PasswordHealthOptions {
  weakThreshold: number;
  oldDays: number;
}

const DEFAULT_OPTIONS: PasswordHealthOptions = {
  weakThreshold: 12,
  oldDays: 90,
};

/**
 * Hashes a password using SHA-256 for reuse detection.
 * Used to compare passwords without exposing plaintext.
 * @param password - The plaintext password to hash
 * @returns Hex-encoded SHA-256 hash
 */
function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

/**
 * Evaluates a single password for weakness based on length,
 * character variety, and common pattern checks.
 * @param password - The password to evaluate
 * @returns Object with `isWeak` flag and optional `reason` string
 */
function evaluatePasswordStrength(password: string): { isWeak: boolean; reason?: string } {
  if (password.length < 8) {
    return { isWeak: true, reason: 'Shorter than 8 characters' };
  }
  if (password.length < 12) {
    return { isWeak: true, reason: 'Shorter than 12 characters' };
  }
  let variety = 0;
  if (/[a-z]/.test(password)) variety++;
  if (/[A-Z]/.test(password)) variety++;
  if (/\d/.test(password)) variety++;
  if (/[^a-zA-Z0-9]/.test(password)) variety++;
  if (variety < 3) {
    return { isWeak: true, reason: 'Lacks character variety' };
  }
  const common = [
    'password',
    '123456',
    'qwerty',
    'admin',
    'letmein',
    'welcome',
    'monkey',
    'dragon',
    'master',
    'passw0rd',
  ];
  const lower = password.toLowerCase();
  for (const word of common) {
    if (lower.includes(word)) {
      return { isWeak: true, reason: `Contains common pattern "${word}"` };
    }
  }
  return { isWeak: false };
}

/**
 * Analyzes the health of all passwords in the vault.
 *
 * Checks for:
 * - **Weak passwords**: Shorter than 12 chars or fewer than 3 character types
 * - **Reused passwords**: Identical passwords used across multiple items (SHA-256 hash comparison)
 * - **Old passwords**: Passwords not updated in >90 days (configurable)
 *
 * Returns an overall score (A-F) based on the ratio of weak/reused passwords.
 *
 * @param items - Array of all items in the vault
 * @param passwords - Map of item ID to decrypted plaintext password
 * @param options - Optional thresholds for oldDays and scoring
 * @returns HealthReport with total counts, score, and detailed lists
 */
export function analyzeHealth(
  items: Item[],
  passwords: Map<string, string>,
  options: Partial<PasswordHealthOptions> = {},
): HealthReport {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const now = Date.now();
  const oldThresholdMs = opts.oldDays * 24 * 60 * 60 * 1000;

  const weakPasswords: HealthReport['weakPasswords'] = [];
  const reusedPasswords: HealthReport['reusedPasswords'] = [];
  const oldPasswords: HealthReport['oldPasswords'] = [];

  const passwordHashMap = new Map<string, Array<{ itemId: string; title: string }>>();
  let strongCount = 0;
  let weakCount = 0;

  for (const item of items) {
    const password = passwords.get(item.id);
    if (!password) continue;

    const hash = hashPassword(password);
    const existing = passwordHashMap.get(hash) || [];
    existing.push({ itemId: item.id, title: item.title });
    passwordHashMap.set(hash, existing);

    const strength = evaluatePasswordStrength(password);
    if (strength.isWeak) {
      weakCount++;
      weakPasswords.push({
        itemId: item.id,
        title: item.title,
        reason: strength.reason || 'Weak',
      });
    } else {
      strongCount++;
    }

    const ageMs = now - item.updatedAt;
    if (ageMs > oldThresholdMs) {
      const daysSinceChange = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      oldPasswords.push({
        itemId: item.id,
        title: item.title,
        daysSinceChange,
      });
    }
  }

  for (const [hash, passwordItems] of passwordHashMap.entries()) {
    if (passwordItems.length > 1) {
      reusedPasswords.push({
        hash,
        count: passwordItems.length,
        items: passwordItems,
      });
    }
  }

  const total = items.length;
  const reused = reusedPasswords.reduce((sum, g) => sum + g.count, 0) - reusedPasswords.length;

  let score: HealthReport['score'] = 'A';
  const weakRatio = total > 0 ? weakCount / total : 0;
  const reusedRatio = total > 0 ? reused / total : 0;
  if (weakRatio > 0.5 || reusedRatio > 0.5) {
    score = 'F';
  } else if (weakRatio > 0.3 || reusedRatio > 0.3) {
    score = 'D';
  } else if (weakRatio > 0.15 || reusedRatio > 0.15) {
    score = 'C';
  } else if (weakRatio > 0.05 || reusedRatio > 0.05) {
    score = 'B';
  } else {
    score = 'A';
  }

  return {
    total,
    weak: weakPasswords.length,
    reused: reusedPasswords.length,
    old: oldPasswords.length,
    strong: strongCount,
    score,
    weakPasswords,
    reusedPasswords,
    oldPasswords,
  };
}
