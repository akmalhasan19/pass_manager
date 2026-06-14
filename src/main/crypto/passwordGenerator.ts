import { randomBytes } from 'node:crypto';

export interface PasswordOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}

const DEFAULT_OPTIONS: PasswordOptions = {
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  excludeAmbiguous: true,
};

const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijkmnopqrstuvwxyz';
const NUMBERS = '23456789';
const SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?~';
const AMBIGUOUS = '0O1lI';

function getCharacterSet(options: PasswordOptions): string {
  let chars = '';

  if (options.uppercase) chars += UPPERCASE;
  if (options.lowercase) chars += LOWERCASE;
  if (options.numbers) chars += NUMBERS;
  if (options.symbols) chars += SYMBOLS;

  if (options.excludeAmbiguous) {
    for (const char of AMBIGUOUS) {
      chars = chars.replace(char, '');
    }
  }

  if (chars.length === 0) {
    chars = LOWERCASE + NUMBERS;
  }

  return chars;
}

export function generatePassword(options: Partial<PasswordOptions> = {}): string {
  const merged: PasswordOptions = { ...DEFAULT_OPTIONS, ...options };
  const charSet = getCharacterSet(merged);
  const { length } = merged;
  const charSetLength = charSet.length;

  const bytes = randomBytes(length);
  const password: string[] = [];

  for (let i = 0; i < length; i++) {
    const randomIndex = bytes[i] % charSetLength;
    password.push(charSet[randomIndex]);
  }

  return password.join('');
}

export function calculateEntropy(password: string): number {
  let poolSize = 0;

  if (/[a-z]/.test(password)) poolSize += 26;
  if (/[A-Z]/.test(password)) poolSize += 26;
  if (/[0-9]/.test(password)) poolSize += 10;
  if (/[^a-zA-Z0-9]/.test(password)) poolSize += 33;

  if (poolSize === 0) return 0;

  return Math.log2(poolSize) * password.length;
}

export type StrengthLabel = 'Very Weak' | 'Weak' | 'Fair' | 'Strong' | 'Very Strong';

export interface StrengthResult {
  score: 0 | 1 | 2 | 3 | 4;
  label: StrengthLabel;
  entropy: number;
}

export function evaluateStrength(password: string): StrengthResult {
  const entropy = calculateEntropy(password);
  const length = password.length;

  let score: 0 | 1 | 2 | 3 | 4;

  if (length < 6 || entropy < 28) {
    score = 0;
  } else if (length < 8 || entropy < 36) {
    score = 1;
  } else if (length < 12 || entropy < 60) {
    score = 2;
  } else if (length < 16 || entropy < 80) {
    score = 3;
  } else {
    score = 4;
  }

  const labels: StrengthLabel[] = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];

  return { score, label: labels[score], entropy: Math.round(entropy) };
}
