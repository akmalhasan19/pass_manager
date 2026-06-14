import { describe, it, expect } from 'vitest';
import {
  generatePassword,
  calculateEntropy,
  evaluateStrength,
} from '../../../src/main/crypto/passwordGenerator';

describe('generatePassword', () => {
  it('should return a password of default length (20)', () => {
    const pw = generatePassword();
    expect(pw).toHaveLength(20);
  });

  it('should return a password of specified length', () => {
    const pw = generatePassword({ length: 32 });
    expect(pw).toHaveLength(32);
  });

  it('should return a password of minimum length', () => {
    const pw = generatePassword({ length: 4 });
    expect(pw).toHaveLength(4);
  });

  it('should return a password of maximum length', () => {
    const pw = generatePassword({ length: 128 });
    expect(pw).toHaveLength(128);
  });

  it('should only contain uppercase characters when only uppercase is selected', () => {
    const pw = generatePassword({
      length: 100,
      uppercase: true,
      lowercase: false,
      numbers: false,
      symbols: false,
    });
    expect(pw).toMatch(/^[A-Z]+$/);
  });

  it('should only contain lowercase characters when only lowercase is selected', () => {
    const pw = generatePassword({
      length: 100,
      uppercase: false,
      lowercase: true,
      numbers: false,
      symbols: false,
    });
    expect(pw).toMatch(/^[a-z]+$/);
  });

  it('should only contain numbers when only numbers is selected', () => {
    const pw = generatePassword({
      length: 100,
      uppercase: false,
      lowercase: false,
      numbers: true,
      symbols: false,
    });
    expect(pw).toMatch(/^[2-9]+$/);
  });

  it('should only contain symbols when only symbols is selected', () => {
    const pw = generatePassword({
      length: 100,
      uppercase: false,
      lowercase: false,
      numbers: false,
      symbols: true,
    });
    expect(pw).toMatch(/^[!@#$%^&*()_+\-=\[\]{}|;:,.<>?~]+$/);
  });

  it('should exclude ambiguous characters when excludeAmbiguous is true', () => {
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword({ length: 50, excludeAmbiguous: true });
      expect(pw).not.toContain('0');
      expect(pw).not.toContain('O');
      expect(pw).not.toContain('1');
      expect(pw).not.toContain('l');
      expect(pw).not.toContain('I');
    }
  });

  it('should not mutate character sets when excludeAmbiguous is false', () => {
    const pw = generatePassword({ excludeAmbiguous: false });
    expect(pw).toHaveLength(20);
  });

  it('should produce different passwords on each call', () => {
    const passwords = new Set<string>();
    for (let i = 0; i < 20; i++) {
      passwords.add(generatePassword({ length: 32 }));
    }
    expect(passwords.size).toBeGreaterThan(15);
  });

  it('should fall back to lowercase+numbers when no char set is selected', () => {
    const pw = generatePassword({
      length: 50,
      uppercase: false,
      lowercase: false,
      numbers: false,
      symbols: false,
    });
    expect(pw).toMatch(/^[a-z2-9]+$/);
  });

  it('should not return empty string for any valid length', () => {
    const pw = generatePassword({ length: 1 });
    expect(pw).toHaveLength(1);
  });
});

describe('calculateEntropy', () => {
  it('should return 0 for empty string', () => {
    expect(calculateEntropy('')).toBe(0);
  });

  it('should return correct entropy for lowercase-only password', () => {
    const entropy = calculateEntropy('abcdefgh');
    expect(entropy).toBeCloseTo(Math.log2(26) * 8, 1);
  });

  it('should return correct entropy for mixed-case password', () => {
    const entropy = calculateEntropy('AbCdEfG');
    expect(entropy).toBeCloseTo(Math.log2(52) * 7, 1);
  });

  it('should return correct entropy for full-complexity password', () => {
    const entropy = calculateEntropy('Ab1!xY9#');
    expect(entropy).toBeCloseTo(Math.log2(95) * 8, 1);
  });

  it('should be higher for longer passwords', () => {
    const short = calculateEntropy('abc');
    const long = calculateEntropy('abcdefghij');
    expect(long).toBeGreaterThan(short);
  });

  it('should be higher for more complex character sets', () => {
    const onlyLower = calculateEntropy('password');
    const mixed = calculateEntropy('P4ssw0rd!');
    expect(mixed).toBeGreaterThan(onlyLower);
  });
});

describe('evaluateStrength', () => {
  it('should return score 0 (Very Weak) for very short passwords', () => {
    const result = evaluateStrength('ab');
    expect(result.score).toBe(0);
    expect(result.label).toBe('Very Weak');
    expect(result.entropy).toBe(Math.round(calculateEntropy('ab')));
  });

  it('should return score 1 (Weak) for short simple passwords', () => {
    const result = evaluateStrength('passw0');
    expect(result.score).toBe(1);
    expect(result.label).toBe('Weak');
  });

  it('should return score 2 (Fair) for medium passwords', () => {
    const result = evaluateStrength('passw0rd12');
    expect(result.score).toBe(2);
    expect(result.label).toBe('Fair');
  });

  it('should return score 3 (Strong) for longer passwords', () => {
    const result = evaluateStrength('P4ssw0rd!Exam');
    expect(result.score).toBe(3);
    expect(result.label).toBe('Strong');
  });

  it('should return score 4 (Very Strong) for long complex passwords', () => {
    const result = evaluateStrength('P4ssw0rd!Ex@mpl3Str0ng!');
    expect(result.score).toBe(4);
    expect(result.label).toBe('Very Strong');
  });

  it('should include entropy in the result', () => {
    const result = evaluateStrength('HelloWorld123!');
    expect(result.entropy).toBeGreaterThan(0);
    expect(typeof result.score).toBe('number');
    expect(typeof result.label).toBe('string');
  });

  it('should return score 0 for entropy < 28 even if length >= 6', () => {
    const result = evaluateStrength('123456');
    expect(result.score).toBe(0);
  });
});
