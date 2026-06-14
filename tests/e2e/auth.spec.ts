import { test, expect } from '@playwright/test';
import {
  launchApp,
  closeApp,
  waitForLockScreen,
  fillMasterPassword,
  waitForMainApp,
} from './helpers';
import type { E2EContext } from './helpers';

const MASTER_PASSWORD = 'E2ETest!P@ssw0rd2024';
const WRONG_PASSWORD = 'Wr0ngP@ssw0rd!';

test.describe('Authentication E2E', () => {
  let ctx: E2EContext;

  test.beforeEach(async () => {
    ctx = await launchApp();
  });

  test.afterEach(async () => {
    await closeApp(ctx);
  });

  // =========================================================================
  // 9.3.2: First-time setup, create master password, unlock
  // =========================================================================
  test('should show lock screen on first launch', async () => {
    await waitForLockScreen(ctx.page);

    // Should see password input and either "Unlock" or setup options
    const passwordInput = ctx.page.locator('input[type="password"]');
    await expect(passwordInput).toBeVisible();
  });

  test('should complete first-time setup with strong master password', async () => {
    await waitForLockScreen(ctx.page);

    // First-time setup: fill master password
    const passwordInput = ctx.page.locator('input[type="password"]');
    await passwordInput.fill(MASTER_PASSWORD);

    // If there's a confirm password field (setup flow), fill it
    const confirmInput = ctx.page.locator('input[type="password"]').nth(1);
    if (await confirmInput.isVisible().catch(() => false)) {
      await confirmInput.fill(MASTER_PASSWORD);
    }

    // Submit
    const submitBtn = ctx.page
      .locator('button:has-text("Create"), button:has-text("Unlock"), button:has-text("Setup")')
      .first();
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
    }

    // Should navigate to main app
    await waitForMainApp(ctx.page);
    await expect(ctx.page.locator('nav, aside, [role="tree"]').first()).toBeVisible();
  });

  test('should reject weak master password during setup', async () => {
    await waitForLockScreen(ctx.page);

    // Try a weak password
    const passwordInput = ctx.page.locator('input[type="password"]');
    await passwordInput.fill('weak');

    // If setup flow, submit
    const submitBtn = ctx.page
      .locator('button:has-text("Create"), button:has-text("Unlock")')
      .first();
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
    }

    // Should show an error message
    const error = ctx.page.locator(
      'text=weak, [role="alert"], .error, .text-danger-500, .text-red-500',
    );
    await expect(error.first()).toBeVisible({ timeout: 5000 });
  });

  // =========================================================================
  // 9.3.6: Lock and unlock with correct/incorrect password
  // =========================================================================
  test('should lock and unlock with correct password', async () => {
    // Setup first
    await waitForLockScreen(ctx.page);
    await fillMasterPassword(ctx.page, MASTER_PASSWORD);

    // If this is first-time setup, need confirm too
    const confirmInput = ctx.page.locator('input[type="password"]').nth(1);
    if (await confirmInput.isVisible().catch(() => false)) {
      await confirmInput.fill(MASTER_PASSWORD);
      await ctx.page.locator('button:has-text("Create"), button:has-text("Setup")').first().click();
    }

    await waitForMainApp(ctx.page);

    // Lock the app — look for lock button in settings or sidebar
    // The lock action is typically triggered via a button or menu
    const lockBtn = ctx.page.locator(
      'button:has-text("Lock"), [aria-label*="lock" i], [aria-label*="Lock" i]',
    );
    if (await lockBtn.isVisible().catch(() => false)) {
      await lockBtn.click();
    } else {
      // Try to find lock via keyboard shortcut or menu
      await ctx.page.keyboard.press('Control+L');
    }

    // Should return to lock screen
    await waitForLockScreen(ctx.page);

    // Unlock with correct password
    await fillMasterPassword(ctx.page, MASTER_PASSWORD);
    await waitForMainApp(ctx.page);
  });

  test('should fail to unlock with incorrect password', async () => {
    // Setup first
    await waitForLockScreen(ctx.page);
    const passwordInput = ctx.page.locator('input[type="password"]');
    await passwordInput.fill(MASTER_PASSWORD);
    const confirmInput = ctx.page.locator('input[type="password"]').nth(1);
    if (await confirmInput.isVisible().catch(() => false)) {
      await confirmInput.fill(MASTER_PASSWORD);
    }
    const submitBtn = ctx.page
      .locator('button:has-text("Create"), button:has-text("Unlock")')
      .first();
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
    }

    await waitForMainApp(ctx.page);

    // Lock
    const lockBtn = ctx.page.locator('button:has-text("Lock"), [aria-label*="lock" i]');
    if (await lockBtn.isVisible().catch(() => false)) {
      await lockBtn.click();
    } else {
      await ctx.page.keyboard.press('Control+L');
    }

    await waitForLockScreen(ctx.page);

    // Try wrong password
    await fillMasterPassword(ctx.page, WRONG_PASSWORD);

    // Should show error
    const error = ctx.page.locator('text=Incorrect, text=Invalid, text=wrong, [role="alert"]');
    await expect(error.first()).toBeVisible({ timeout: 5000 });

    // Should still be on lock screen
    await expect(ctx.page.locator('input[type="password"]')).toBeVisible();
  });
});
