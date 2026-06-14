import { _electron as electron, ElectronApplication, Page } from 'playwright';
import { join, resolve } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

const PROJECT_ROOT = resolve(join(__dirname, '..', '..'));
const MAIN_ENTRY = join(PROJECT_ROOT, 'dist-electron', 'main', 'index.js');

export interface E2EContext {
  app: ElectronApplication;
  page: Page;
}

/**
 * Launch the SecurePass Electron app and return the app + page.
 * Cleans up any previous test data before launch.
 */
export async function launchApp(): Promise<E2EContext> {
  // Clean up test data from previous runs
  const dataDir = join(PROJECT_ROOT, 'data');
  const testDataDir = join(PROJECT_ROOT, 'test-data');
  if (existsSync(dataDir)) {
    try {
      rmSync(dataDir, { recursive: true });
    } catch {
      // Directory may be locked or not exist
    }
  }
  if (existsSync(testDataDir)) {
    try {
      rmSync(testDataDir, { recursive: true });
    } catch {
      // Directory may be locked or not exist
    }
  }

  const electronApp = await electron.launch({
    executablePath: getElectronPath(),
    args: [MAIN_ENTRY],
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  });

  // Wait for the first window to appear
  const page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  return { app: electronApp, page };
}

/**
 * Close the Electron app and clean up.
 */
export async function closeApp(ctx: E2EContext): Promise<void> {
  await ctx.app.close();
}

/**
 * Get the path to the Electron binary based on platform.
 */
function getElectronPath(): string {
  const platform = process.platform;
  const base = join(PROJECT_ROOT, 'node_modules', 'electron', 'dist');

  if (platform === 'win32') return join(base, 'electron.exe');
  if (platform === 'darwin') return join(base, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  return join(base, 'electron');
}

// ==========================================================================
// Common UI interaction helpers
// ==========================================================================

/** Wait for the lock screen to appear (initial app state). */
export async function waitForLockScreen(page: Page): Promise<void> {
  await page.waitForSelector('input[type="password"]', { timeout: 10000 });
}

/** Fill in the master password and submit (setup flow or unlock). */
export async function fillMasterPassword(page: Page, password: string): Promise<void> {
  const input = page.locator('input[type="password"]');
  await input.fill(password);
  await page.locator('button:has-text("Unlock"), button:has-text("Create")').click();
}

/** Wait for the main app interface (sidebar visible). */
export async function waitForMainApp(page: Page): Promise<void> {
  await page.waitForSelector('nav, [role="tree"], aside', { timeout: 15000 });
}

/** Search for an item via Quick Find (Cmd/Ctrl+K). */
export async function quickFind(page: Page, query: string): Promise<void> {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await page.waitForSelector('input[placeholder*="Search"], input[placeholder*="search"]', {
    timeout: 5000,
  });
  const searchInput = page
    .locator('input[placeholder*="Search"], input[placeholder*="search"]')
    .first();
  await searchInput.fill(query);
}

/** Click a sidebar folder by name. */
export async function clickSidebarFolder(page: Page, folderName: string): Promise<void> {
  await page.locator(`[role="treeitem"]:has-text("${folderName}")`).click();
}

/** Click a button by text. */
export async function clickButton(page: Page, text: string): Promise<void> {
  await page.locator(`button:has-text("${text}")`).first().click();
}
