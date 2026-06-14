export type StrengthScore = 0 | 1 | 2 | 3 | 4;

export type StrengthLabel = 'Very Weak' | 'Weak' | 'Fair' | 'Strong' | 'Very Strong';

export interface StrengthResult {
  score: StrengthScore;
  label: StrengthLabel;
  entropy: number;
}

const LABELS: StrengthLabel[] = [
  'Very Weak',
  'Weak',
  'Fair',
  'Strong',
  'Very Strong',
];

const STROKE_COLORS: Record<StrengthScore, string> = {
  0: 'bg-danger-500',
  1: 'bg-danger-400',
  2: 'bg-warning-500',
  3: 'bg-success-400',
  4: 'bg-success-500',
};

const TEXT_COLORS: Record<StrengthScore, string> = {
  0: 'text-danger-500',
  1: 'text-danger-400',
  2: 'text-warning-500',
  3: 'text-success-400',
  4: 'text-success-500',
};

export function calculateEntropy(password: string): number {
  let poolSize = 0;

  if (/[a-z]/.test(password)) poolSize += 26;
  if (/[A-Z]/.test(password)) poolSize += 26;
  if (/[0-9]/.test(password)) poolSize += 10;
  if (/[^a-zA-Z0-9]/.test(password)) poolSize += 33;

  if (poolSize === 0) return 0;

  return Math.log2(poolSize) * password.length;
}

export function evaluateStrength(password: string): StrengthResult {
  if (password.length === 0) {
    return { score: 0, label: LABELS[0], entropy: 0 };
  }

  const entropy = calculateEntropy(password);
  const length = password.length;

  let score: StrengthScore;

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

  return { score, label: LABELS[score], entropy: Math.round(entropy) };
}

export function getStrengthBarColor(score: StrengthScore): string {
  return STROKE_COLORS[score];
}

export function getStrengthTextColor(score: StrengthScore): string {
  return TEXT_COLORS[score];
}
