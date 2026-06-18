# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: crud.spec.ts >> Folder & Item CRUD E2E >> should create a folder in the sidebar
- Location: tests\e2e\crud.spec.ts:35:7

# Error details

```
Error: electron.launch: Target page, context or browser has been closed
Browser logs:

<launching> "C:\Users\user\pass_manager\node_modules\electron\dist\electron.exe" "--inspect=0" "--remote-debugging-port=0" "C:\Users\user\pass_manager\dist-electron\main\index.js" 
<launched> pid=22972
[pid=22972][out] 
[pid=22972][err] Debugger listening on ws://127.0.0.1:65408/31fe5196-01e5-41c4-9286-d74739fae2f5
[pid=22972][err] For help, see: https://nodejs.org/en/docs/inspector
[pid=22972][err] Debugger attached.
[pid=22972][err] 
[pid=22972][err] DevTools listening on ws://127.0.0.1:65410/devtools/browser/1e032db2-4a43-477b-a171-eaad263ee282
[pid=22972][err] Waiting for the debugger to disconnect...
Call log:
  - <launching> "C:\Users\user\pass_manager\node_modules\electron\dist\electron.exe" "--inspect=0" "--remote-debugging-port=0" "C:\Users\user\pass_manager\dist-electron\main\index.js"
  - <launched> pid=22972
  - [pid=22972][out]
  - [pid=22972][err] Debugger listening on ws://127.0.0.1:65408/31fe5196-01e5-41c4-9286-d74739fae2f5
  - [pid=22972][err] For help, see: https://nodejs.org/en/docs/inspector
  - <ws connecting> ws://127.0.0.1:65408/31fe5196-01e5-41c4-9286-d74739fae2f5
  - <ws connected> ws://127.0.0.1:65408/31fe5196-01e5-41c4-9286-d74739fae2f5
  - [pid=22972][err] Debugger attached.
  - [pid=22972][err]
  - [pid=22972][err] DevTools listening on ws://127.0.0.1:65410/devtools/browser/1e032db2-4a43-477b-a171-eaad263ee282
  - <ws connecting> ws://127.0.0.1:65410/devtools/browser/1e032db2-4a43-477b-a171-eaad263ee282
  - <ws connected> ws://127.0.0.1:65410/devtools/browser/1e032db2-4a43-477b-a171-eaad263ee282
  - [pid=22972][err] Waiting for the debugger to disconnect...
  - <ws disconnecting> ws://127.0.0.1:65408/31fe5196-01e5-41c4-9286-d74739fae2f5
  - <ws disconnected> ws://127.0.0.1:65408/31fe5196-01e5-41c4-9286-d74739fae2f5 code=1005 reason=
  - <ws disconnected> ws://127.0.0.1:65410/devtools/browser/1e032db2-4a43-477b-a171-eaad263ee282 code=1006 reason=
  - [pid=22972] <kill>
  - [pid=22972] <will force kill>
  - [pid=22972] taskkill stderr: ERROR: The process "22972" not found.
  - [pid=22972] <process did exit: exitCode=0, signal=null>
  - [pid=22972] starting temporary directories cleanup
  - [pid=22972] finished temporary directories cleanup

```

```
TypeError: Cannot read properties of undefined (reading 'app')
```

# Test source

```ts
  1   | import { _electron as electron, ElectronApplication, Page } from 'playwright';
  2   | import { join, resolve } from 'node:path';
  3   | import { rmSync, existsSync } from 'node:fs';
  4   | 
  5   | const PROJECT_ROOT = resolve(join(__dirname, '..', '..'));
  6   | const MAIN_ENTRY = join(PROJECT_ROOT, 'dist-electron', 'main', 'index.js');
  7   | 
  8   | export interface E2EContext {
  9   |   app: ElectronApplication;
  10  |   page: Page;
  11  | }
  12  | 
  13  | /**
  14  |  * Launch the SecurePass Electron app and return the app + page.
  15  |  * Cleans up any previous test data before launch.
  16  |  */
  17  | export async function launchApp(): Promise<E2EContext> {
  18  |   // Clean up test data from previous runs
  19  |   const dataDir = join(PROJECT_ROOT, 'data');
  20  |   const testDataDir = join(PROJECT_ROOT, 'test-data');
  21  |   if (existsSync(dataDir)) {
  22  |     try {
  23  |       rmSync(dataDir, { recursive: true });
  24  |     } catch {
  25  |       // Directory may be locked or not exist
  26  |     }
  27  |   }
  28  |   if (existsSync(testDataDir)) {
  29  |     try {
  30  |       rmSync(testDataDir, { recursive: true });
  31  |     } catch {
  32  |       // Directory may be locked or not exist
  33  |     }
  34  |   }
  35  | 
  36  |   const electronApp = await electron.launch({
  37  |     executablePath: getElectronPath(),
  38  |     args: [MAIN_ENTRY],
  39  |     cwd: PROJECT_ROOT,
  40  |     env: {
  41  |       ...process.env,
  42  |       NODE_ENV: 'test',
  43  |     },
  44  |   });
  45  | 
  46  |   // Wait for the first window to appear
  47  |   const page = await electronApp.firstWindow();
  48  |   await page.waitForLoadState('domcontentloaded');
  49  | 
  50  |   return { app: electronApp, page };
  51  | }
  52  | 
  53  | /**
  54  |  * Close the Electron app and clean up.
  55  |  */
  56  | export async function closeApp(ctx: E2EContext): Promise<void> {
> 57  |   await ctx.app.close();
      |             ^ TypeError: Cannot read properties of undefined (reading 'app')
  58  | }
  59  | 
  60  | /**
  61  |  * Get the path to the Electron binary based on platform.
  62  |  */
  63  | function getElectronPath(): string {
  64  |   const platform = process.platform;
  65  |   const base = join(PROJECT_ROOT, 'node_modules', 'electron', 'dist');
  66  | 
  67  |   if (platform === 'win32') return join(base, 'electron.exe');
  68  |   if (platform === 'darwin') return join(base, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  69  |   return join(base, 'electron');
  70  | }
  71  | 
  72  | // ==========================================================================
  73  | // Common UI interaction helpers
  74  | // ==========================================================================
  75  | 
  76  | /** Wait for the lock screen to appear (initial app state). */
  77  | export async function waitForLockScreen(page: Page): Promise<void> {
  78  |   await page.waitForSelector('input[type="password"]', { timeout: 10000 });
  79  | }
  80  | 
  81  | /** Fill in the master password and submit (setup flow or unlock). */
  82  | export async function fillMasterPassword(page: Page, password: string): Promise<void> {
  83  |   const input = page.locator('#master-password');
  84  |   await input.fill(password);
  85  |   const confirm = page.locator('#confirm-password');
  86  |   if (await confirm.isVisible().catch(() => false)) {
  87  |     await confirm.fill(password);
  88  |   }
  89  |   await page.locator('button:has-text("Unlock"), button:has-text("Create")').first().click();
  90  | }
  91  | 
  92  | /** Wait for the main app interface (sidebar visible). */
  93  | export async function waitForMainApp(page: Page): Promise<void> {
  94  |   await page.waitForSelector('nav, [role="tree"], aside', { timeout: 15000 });
  95  | }
  96  | 
  97  | /** Search for an item via Quick Find (Cmd/Ctrl+K). */
  98  | export async function quickFind(page: Page, query: string): Promise<void> {
  99  |   await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  100 |   await page.waitForSelector('input[placeholder*="Search"], input[placeholder*="search"]', {
  101 |     timeout: 5000,
  102 |   });
  103 |   const searchInput = page
  104 |     .locator('input[placeholder*="Search"], input[placeholder*="search"]')
  105 |     .first();
  106 |   await searchInput.fill(query);
  107 | }
  108 | 
  109 | /** Click a sidebar folder by name. */
  110 | export async function clickSidebarFolder(page: Page, folderName: string): Promise<void> {
  111 |   await page.locator(`[role="treeitem"]:has-text("${folderName}")`).click();
  112 | }
  113 | 
  114 | /** Click a button by text. */
  115 | export async function clickButton(page: Page, text: string): Promise<void> {
  116 |   await page.locator(`button:has-text("${text}")`).first().click();
  117 | }
  118 | 
```