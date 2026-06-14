import { describe, it, expect } from 'vitest';
import { analyzeHealth } from '../../../src/main/crypto/passwordHealth';
import type { Item } from '../../../src/shared/types';

function makeItem(
  id: string,
  title: string,
  updatedAt: number,
  overrides: Partial<Item> = {},
): Item {
  return {
    id,
    folderId: 'folder-1',
    title,
    username: 'user@example.com',
    passwordEncrypted: null,
    url: '',
    notesEncrypted: null,
    emoji: null,
    coverImage: null,
    createdAt: updatedAt - 86400000,
    updatedAt,
    isFavorite: false,
    sortOrder: 0,
    ...overrides,
  };
}

const now = Date.now();
const oneDayMs = 24 * 60 * 60 * 1000;

describe('analyzeHealth', () => {
  it('should return an empty report for empty items list', () => {
    const report = analyzeHealth([], new Map());
    expect(report.total).toBe(0);
    expect(report.weak).toBe(0);
    expect(report.reused).toBe(0);
    expect(report.old).toBe(0);
    expect(report.strong).toBe(0);
    expect(report.score).toBe('A');
    expect(report.weakPasswords).toHaveLength(0);
    expect(report.reusedPasswords).toHaveLength(0);
    expect(report.oldPasswords).toHaveLength(0);
  });

  it('should skip items without passwords in the map', () => {
    const items = [makeItem('1', 'No Password', now)];
    const report = analyzeHealth(items, new Map());
    expect(report.total).toBe(1);
    expect(report.weak).toBe(0);
    expect(report.strong).toBe(0);
  });

  it('should detect weak password: shorter than 8 characters', () => {
    const items = [makeItem('1', 'Short PW', now)];
    const passwords = new Map([['1', 'ab']]);
    const report = analyzeHealth(items, passwords);

    expect(report.weak).toBe(1);
    expect(report.strong).toBe(0);
    expect(report.weakPasswords).toHaveLength(1);
    expect(report.weakPasswords[0].reason).toContain('Shorter than 8');
  });

  it('should detect weak password: shorter than 12 characters', () => {
    const items = [makeItem('1', 'Medium', now)];
    const passwords = new Map([['1', 'abcdefgh']]); // 8 chars, only lowercase
    const report = analyzeHealth(items, passwords);

    expect(report.weak).toBe(1);
    expect(report.weakPasswords[0].reason).toContain('Shorter than 12');
  });

  it('should detect weak password: lacks character variety', () => {
    const items = [makeItem('1', 'No Variety', now)];
    // 12+ chars but only lowercase letters
    const passwords = new Map([['1', 'abcdefghijkl']]);
    const report = analyzeHealth(items, passwords);

    expect(report.weak).toBe(1);
    expect(report.weakPasswords[0].reason).toContain('variety');
  });

  it('should detect weak password: contains common pattern "password"', () => {
    const items = [makeItem('1', 'Common', now)];
    const passwords = new Map([['1', 'MyPassword123!']]);
    const report = analyzeHealth(items, passwords);

    expect(report.weak).toBe(1);
    expect(report.weakPasswords[0].reason).toContain('common pattern');
    expect(report.weakPasswords[0].reason).toContain('password');
  });

  it('should detect weak password: contains common pattern "123456"', () => {
    const items = [makeItem('1', 'Common', now)];
    const passwords = new Map([['1', 'abc123456xyz!A']]);
    const report = analyzeHealth(items, passwords);

    expect(report.weak).toBe(1);
    expect(report.weakPasswords[0].reason).toContain('123456');
  });

  it('should detect weak password: contains common pattern "qwerty"', () => {
    const items = [makeItem('1', 'Common', now)];
    const passwords = new Map([['1', 'Qwerty123!@#']]);
    const report = analyzeHealth(items, passwords);

    expect(report.weak).toBe(1);
    expect(report.weakPasswords[0].reason).toContain('qwerty');
  });

  it('should detect weak password: contains "admin"', () => {
    const items = [makeItem('1', 'Admin', now)];
    const passwords = new Map([['1', 'Admin1234!@#$']]);
    const report = analyzeHealth(items, passwords);

    expect(report.weak).toBe(1);
    expect(report.weakPasswords[0].reason).toContain('admin');
  });

  it('should classify a strong password correctly', () => {
    const items = [makeItem('1', 'Strong', now)];
    // 14+ chars, mixed case, numbers, symbols
    const passwords = new Map([['1', 'V3ry$tr0ng!P@ss']]);
    const report = analyzeHealth(items, passwords);

    expect(report.weak).toBe(0);
    expect(report.strong).toBe(1);
  });

  it('should detect reused passwords', () => {
    const items = [
      makeItem('1', 'Item One', now),
      makeItem('2', 'Item Two', now),
      makeItem('3', 'Item Three', now),
    ];
    const passwords = new Map([
      ['1', 'SamePassword123!'],
      ['2', 'SamePassword123!'],
      ['3', 'UniquePassword456!'],
    ]);
    const report = analyzeHealth(items, passwords);

    expect(report.reused).toBe(1);
    expect(report.reusedPasswords).toHaveLength(1);
    expect(report.reusedPasswords[0].count).toBe(2);
    expect(report.reusedPasswords[0].items).toHaveLength(2);
  });

  it('should detect multiple reuse groups', () => {
    const items = [
      makeItem('1', 'A', now),
      makeItem('2', 'B', now),
      makeItem('3', 'C', now),
      makeItem('4', 'D', now),
    ];
    const passwords = new Map([
      ['1', 'SamePassword123!'],
      ['2', 'SamePassword123!'],
      ['3', 'AnotherShared!'],
      ['4', 'AnotherShared!'],
    ]);
    const report = analyzeHealth(items, passwords);

    expect(report.reused).toBe(2);
    expect(report.reusedPasswords).toHaveLength(2);
  });

  it('should detect old passwords (not updated in >90 days)', () => {
    const oldDate = now - 100 * oneDayMs;
    const items = [makeItem('1', 'Old Password', oldDate)];
    const passwords = new Map([['1', 'V3ry$tr0ng!P@ss']]);
    const report = analyzeHealth(items, passwords);

    expect(report.old).toBe(1);
    expect(report.oldPasswords).toHaveLength(1);
    expect(report.oldPasswords[0].daysSinceChange).toBe(100);
  });

  it('should not flag recently updated passwords as old', () => {
    const recentDate = now - 10 * oneDayMs;
    const items = [makeItem('1', 'Recent', recentDate)];
    const passwords = new Map([['1', 'V3ry$tr0ng!P@ss']]);
    const report = analyzeHealth(items, passwords);

    expect(report.old).toBe(0);
  });

  it('should respect custom oldDays threshold', () => {
    const sixtyDaysAgo = now - 60 * oneDayMs;
    const items = [makeItem('1', '60 Day Old', sixtyDaysAgo)];
    const passwords = new Map([['1', 'V3ry$tr0ng!P@ss']]);

    // Default 90 days → not old
    const defaultReport = analyzeHealth(items, passwords);
    expect(defaultReport.old).toBe(0);

    // Custom 30 days → old
    const customReport = analyzeHealth(items, passwords, { oldDays: 30 });
    expect(customReport.old).toBe(1);
    expect(customReport.oldPasswords[0].daysSinceChange).toBe(60);
  });

  it('should return score A when all passwords are safe', () => {
    const items = [makeItem('1', 'Safe One', now), makeItem('2', 'Safe Two', now)];
    const passwords = new Map([
      ['1', 'V3ry$tr0ng!P@ss1'],
      ['2', 'An0th3r$tr0ng!P@ss'],
    ]);
    const report = analyzeHealth(items, passwords);

    expect(report.score).toBe('A');
    expect(report.weak).toBe(0);
    expect(report.reused).toBe(0);
  });

  it('should return score B when <=5% weak and no reuse', () => {
    // 1 weak out of 10 = 10% weak (>5%, <=15%) → B
    const items = [
      makeItem('1', 'Strong 1', now),
      makeItem('2', 'Strong 2', now),
      makeItem('3', 'Strong 3', now),
      makeItem('4', 'Strong 4', now),
      makeItem('5', 'Strong 5', now),
      makeItem('6', 'Strong 6', now),
      makeItem('7', 'Strong 7', now),
      makeItem('8', 'Strong 8', now),
      makeItem('9', 'Strong 9', now),
      makeItem('10', 'Weak 1', now),
    ];
    const passwords = new Map([
      ['1', 'V3ry$tr0ng!Un1queA'],
      ['2', 'V3ry$tr0ng!Un1queB'],
      ['3', 'V3ry$tr0ng!Un1queC'],
      ['4', 'V3ry$tr0ng!Un1queD'],
      ['5', 'V3ry$tr0ng!Un1queE'],
      ['6', 'V3ry$tr0ng!Un1queF'],
      ['7', 'V3ry$tr0ng!Un1queG'],
      ['8', 'V3ry$tr0ng!Un1queH'],
      ['9', 'V3ry$tr0ng!Un1queI'],
      ['10', 'short'],
    ]);
    const report = analyzeHealth(items, passwords);
    expect(report.score).toBe('B');
  });

  it('should return score C when >15% weak or reused', () => {
    // 10 items, 2 weak (20%) → C
    const items = [
      makeItem('1', 'Strong 1', now),
      makeItem('2', 'Strong 2', now),
      makeItem('3', 'Strong 3', now),
      makeItem('4', 'Strong 4', now),
      makeItem('5', 'Strong 5', now),
      makeItem('6', 'Strong 6', now),
      makeItem('7', 'Strong 7', now),
      makeItem('8', 'Strong 8', now),
      makeItem('9', 'Weak 1', now),
      makeItem('10', 'Weak 2', now),
    ];
    const passwords = new Map([
      ['1', 'V3ry$tr0ng!P@ssA'],
      ['2', 'V3ry$tr0ng!P@ssB'],
      ['3', 'V3ry$tr0ng!P@ssC'],
      ['4', 'V3ry$tr0ng!P@ssD'],
      ['5', 'V3ry$tr0ng!P@ssE'],
      ['6', 'V3ry$tr0ng!P@ssF'],
      ['7', 'V3ry$tr0ng!P@ssG'],
      ['8', 'V3ry$tr0ng!P@ssH'],
      ['9', 'ab'],
      ['10', 'cd'],
    ]);
    const report = analyzeHealth(items, passwords);
    expect(report.score).toBe('C');
  });

  it('should return score D when >30% weak or reused', () => {
    // 10 items, 4 weak (40%) → D
    const items = [
      makeItem('1', 'Strong 1', now),
      makeItem('2', 'Strong 2', now),
      makeItem('3', 'Strong 3', now),
      makeItem('4', 'Strong 4', now),
      makeItem('5', 'Strong 5', now),
      makeItem('6', 'Strong 6', now),
      makeItem('7', 'Weak 1', now),
      makeItem('8', 'Weak 2', now),
      makeItem('9', 'Weak 3', now),
      makeItem('10', 'Weak 4', now),
    ];
    const passwords = new Map([
      ['1', 'V3ry$tr0ng!P@ssA'],
      ['2', 'V3ry$tr0ng!P@ssB'],
      ['3', 'V3ry$tr0ng!P@ssC'],
      ['4', 'V3ry$tr0ng!P@ssD'],
      ['5', 'V3ry$tr0ng!P@ssE'],
      ['6', 'V3ry$tr0ng!P@ssF'],
      ['7', 'short1'],
      ['8', 'short2'],
      ['9', 'short3'],
      ['10', 'short4'],
    ]);
    const report = analyzeHealth(items, passwords);
    expect(report.score).toBe('D');
  });

  it('should return score F when >50% weak or reused', () => {
    // 10 items, 6 weak (60%) → F
    const items = [
      makeItem('1', 'Strong 1', now),
      makeItem('2', 'Strong 2', now),
      makeItem('3', 'Strong 3', now),
      makeItem('4', 'Strong 4', now),
      makeItem('5', 'Weak 1', now),
      makeItem('6', 'Weak 2', now),
      makeItem('7', 'Weak 3', now),
      makeItem('8', 'Weak 4', now),
      makeItem('9', 'Weak 5', now),
      makeItem('10', 'Weak 6', now),
    ];
    const passwords = new Map([
      ['1', 'V3ry$tr0ng!P@ssA'],
      ['2', 'V3ry$tr0ng!P@ssB'],
      ['3', 'V3ry$tr0ng!P@ssC'],
      ['4', 'V3ry$tr0ng!P@ssD'],
      ['5', 'bad1'],
      ['6', 'bad2'],
      ['7', 'bad3'],
      ['8', 'bad4'],
      ['9', 'bad5'],
      ['10', 'bad6'],
    ]);
    const report = analyzeHealth(items, passwords);
    expect(report.score).toBe('F');
  });

  it('should return score F when >50% reused', () => {
    const items = [
      makeItem('1', 'Item 1', now),
      makeItem('2', 'Item 2', now),
      makeItem('3', 'Item 3', now),
      makeItem('4', 'Item 4', now),
      makeItem('5', 'Item 5', now),
    ];
    const passwords = new Map([
      ['1', 'SharedP@ssw0rd!'],
      ['2', 'SharedP@ssw0rd!'],
      ['3', 'SharedP@ssw0rd!'],
      ['4', 'SharedP@ssw0rd!'],
      ['5', 'UniqueP@ssw0rd!'],
    ]);
    const report = analyzeHealth(items, passwords);
    // 4 out of 5 share same password → reused = 4-1 = 3, ratio 3/5 = 0.6 > 0.5 → F
    expect(report.score).toBe('F');
  });

  it('should count strong passwords correctly', () => {
    const items = [makeItem('1', 'Strong', now), makeItem('2', 'Weak', now)];
    const passwords = new Map([
      ['1', 'V3ry$tr0ng!P@ssw0rd'],
      ['2', 'short'],
    ]);
    const report = analyzeHealth(items, passwords);

    expect(report.strong).toBe(1);
    expect(report.weak).toBe(1);
    expect(report.total).toBe(2);
  });

  it('should include itemId and title in weak password entries', () => {
    const items = [makeItem('item-abc', 'My Bank Account', now)];
    const passwords = new Map([['item-abc', 'weak']]);
    const report = analyzeHealth(items, passwords);

    expect(report.weakPasswords[0].itemId).toBe('item-abc');
    expect(report.weakPasswords[0].title).toBe('My Bank Account');
    expect(report.weakPasswords[0].reason).toBeDefined();
  });

  it('should include itemId and title in reused password entries', () => {
    const items = [makeItem('item-1', 'Service A', now), makeItem('item-2', 'Service B', now)];
    const passwords = new Map([
      ['item-1', 'SamePassword!@#'],
      ['item-2', 'SamePassword!@#'],
    ]);
    const report = analyzeHealth(items, passwords);

    expect(report.reusedPasswords[0].items).toEqual([
      { itemId: 'item-1', title: 'Service A' },
      { itemId: 'item-2', title: 'Service B' },
    ]);
    expect(report.reusedPasswords[0].count).toBe(2);
    expect(report.reusedPasswords[0].hash).toBeDefined();
  });

  it('should include itemId, title, and daysSinceChange in old password entries', () => {
    const oldDate = now - 200 * oneDayMs;
    const items = [makeItem('old-item', 'Old Service', oldDate)];
    const passwords = new Map([['old-item', 'V3ry$tr0ng!P@ssw0rd']]);
    const report = analyzeHealth(items, passwords);

    expect(report.oldPasswords[0].itemId).toBe('old-item');
    expect(report.oldPasswords[0].title).toBe('Old Service');
    expect(report.oldPasswords[0].daysSinceChange).toBe(200);
  });

  it('should handle an item that is both weak and old', () => {
    const oldDate = now - 120 * oneDayMs;
    const items = [makeItem('1', 'Weak & Old', oldDate)];
    const passwords = new Map([['1', 'short']]);
    const report = analyzeHealth(items, passwords);

    expect(report.weak).toBe(1);
    expect(report.old).toBe(1);
    expect(report.weakPasswords).toHaveLength(1);
    expect(report.oldPasswords).toHaveLength(1);
  });

  it('should handle passwords with only uppercase and numbers', () => {
    const items = [makeItem('1', 'Mixed', now)];
    // 12+ chars, uppercase + numbers = 2 variety (needs 3)
    const passwords = new Map([['1', 'ABCDEFGH1234']]);
    const report = analyzeHealth(items, passwords);

    expect(report.weak).toBe(1);
    expect(report.weakPasswords[0].reason).toContain('variety');
  });

  it('should handle passwords with lowercase + numbers + symbols (3 variety, strong)', () => {
    const items = [makeItem('1', 'Good Variety', now)];
    // 12+ chars, lowercase + numbers + symbols = 3 variety
    const passwords = new Map([['1', 'abcdefgh1234!@']]);
    const report = analyzeHealth(items, passwords);

    expect(report.weak).toBe(0);
    expect(report.strong).toBe(1);
  });

  it('should detect common pattern "letmein"', () => {
    const items = [makeItem('1', 'Let Me In', now)];
    const passwords = new Map([['1', 'MyLetMeIn123!@']]);
    const report = analyzeHealth(items, passwords);

    expect(report.weak).toBe(1);
    expect(report.weakPasswords[0].reason).toContain('letmein');
  });

  it('should detect common pattern "welcome"', () => {
    const items = [makeItem('1', 'Welcome', now)];
    const passwords = new Map([['1', 'MyWelcome123!@#']]);
    const report = analyzeHealth(items, passwords);

    expect(report.weak).toBe(1);
    expect(report.weakPasswords[0].reason).toContain('welcome');
  });

  it('should detect common pattern "monkey"', () => {
    const items = [makeItem('1', 'Monkey', now)];
    const passwords = new Map([['1', 'MyMonkey123!@#']]);
    const report = analyzeHealth(items, passwords);

    expect(report.weak).toBe(1);
    expect(report.weakPasswords[0].reason).toContain('monkey');
  });

  it('should detect common pattern "dragon"', () => {
    const items = [makeItem('1', 'Dragon', now)];
    const passwords = new Map([['1', 'MyDragon123!@#']]);
    const report = analyzeHealth(items, passwords);

    expect(report.weak).toBe(1);
    expect(report.weakPasswords[0].reason).toContain('dragon');
  });

  it('should detect common pattern "master"', () => {
    const items = [makeItem('1', 'Master', now)];
    const passwords = new Map([['1', 'MyMaster123!@#']]);
    const report = analyzeHealth(items, passwords);

    expect(report.weak).toBe(1);
    expect(report.weakPasswords[0].reason).toContain('master');
  });

  it('should detect common pattern "passw0rd"', () => {
    const items = [makeItem('1', 'Passw0rd', now)];
    const passwords = new Map([['1', 'MyPassw0rd!@#$']]);
    const report = analyzeHealth(items, passwords);

    expect(report.weak).toBe(1);
    expect(report.weakPasswords[0].reason).toContain('passw0rd');
  });

  it('should return correct total count', () => {
    const items = [
      makeItem('1', 'Item 1', now),
      makeItem('2', 'Item 2', now),
      makeItem('3', 'Item 3', now),
    ];
    const passwords = new Map([
      ['1', 'V3ry$tr0ng!P@ssA'],
      ['2', 'V3ry$tr0ng!P@ssB'],
    ]);
    const report = analyzeHealth(items, passwords);

    expect(report.total).toBe(3);
  });

  it('should produce consistent hashes for reuse detection', () => {
    const items = [makeItem('1', 'First', now), makeItem('2', 'Second', now)];
    const passwords1 = new Map([
      ['1', 'MySecretP@ss!'],
      ['2', 'MySecretP@ss!'],
    ]);
    const report1 = analyzeHealth(items, passwords1);

    const passwords2 = new Map([
      ['1', 'MySecretP@ss!'],
      ['2', 'MySecretP@ss!'],
    ]);
    const report2 = analyzeHealth(items, passwords2);

    expect(report1.reusedPasswords[0].hash).toBe(report2.reusedPasswords[0].hash);
  });
});
