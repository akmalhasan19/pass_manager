/**
 * Post-install script for SecurePass Manager.
 *
 * This script runs after `npm install` to:
 * 1. Verify critical dependencies are available.
 * 2. Copy WASM file for sql.js to the public directory (if needed).
 * 3. Rebuild native modules (`argon2`) for Electron if not in a CI/dev-only install.
 */

const { copyFileSync, existsSync, mkdirSync, statSync } = require('fs');
const { resolve } = require('path');
const { execSync } = require('child_process');

const PACKAGE_ROOT = resolve(__dirname, '..');

function log(message) {
  console.log(`[postinstall] ${message}`);
}

function warn(message) {
  console.warn(`[postinstall] ⚠️  ${message}`);
}

function checkDependencies() {
  const required = ['sql.js'];

  for (const dep of required) {
    const depPath = resolve(PACKAGE_ROOT, 'node_modules', dep);
    if (!existsSync(depPath)) {
      warn(`Dependency "${dep}" is not installed. Run "npm install" first.`);
    }
  }
}

function copySqliteWasm() {
  const src = resolve(
    PACKAGE_ROOT,
    'node_modules',
    'sql.js',
    'dist',
    'sql-wasm.wasm',
  );
  const destDir = resolve(PACKAGE_ROOT, 'public');
  const dest = resolve(destDir, 'sql-wasm.wasm');

  if (existsSync(src)) {
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }
    copyFileSync(src, dest);
    log('Copied sql.js WASM file to public/');
  } else {
    warn('sql.js WASM file not found at node_modules/sql.js/dist/sql-wasm.wasm');
  }
}

/**
 * Rebuild native modules (`argon2`) for Electron.
 *
 * Skips rebuild when:
 * - The `ELECTRON_REBUILD_SKIP` env var is set (CI / non-Electron contexts).
 * - The electron binary is not found in node_modules (dev-only / headless CI).
 */
function rebuildNativeModules() {
  if (process.env.ELECTRON_REBUILD_SKIP) {
    log('ELECTRON_REBUILD_SKIP is set — skipping electron-rebuild');
    return;
  }

  const electronBin = resolve(
    PACKAGE_ROOT,
    'node_modules',
    'electron',
    'dist',
    'electron.exe',
  );
  if (!existsSync(electronBin)) {
    log('Electron binary not found — skipping electron-rebuild (dev-only install)');
    return;
  }

  const rebuildBin = resolve(
    PACKAGE_ROOT,
    'node_modules',
    '.bin',
    'electron-rebuild',
  );
  if (!existsSync(rebuildBin)) {
    warn('electron-rebuild binary not found — native modules may not work in Electron');
    return;
  }

  log('Rebuilding native modules for Electron...');
  try {
    execSync(`node "${rebuildBin}" --only argon2`, {
      cwd: PACKAGE_ROOT,
      stdio: 'inherit',
      timeout: 120_000,
    });
    log('Native module rebuild complete');

    // Generate checksums after rebuild for integrity verification
    log('Generating argon2 checksums for integrity verification...');
    try {
      execSync('node scripts/generate-argon2-checksums.js', {
        cwd: PACKAGE_ROOT,
        stdio: 'inherit',
        timeout: 30_000,
      });
      log('Argon2 checksums generated');
    } catch (checksumErr) {
      warn(`Checksum generation failed (non-fatal): ${checksumErr.message}`);
    }
  } catch (err) {
    warn(`Native module rebuild failed: ${err.message}`);
    warn('The app will fall back to WASM-based Argon2id implementation');
  }
}

async function main() {
  log('Running SecurePass Manager post-install checks...');

  checkDependencies();
  copySqliteWasm();
  rebuildNativeModules();

  log('Post-install complete.');
}

main().catch((err) => {
  console.error(`[postinstall] ❌ Unexpected error: ${err.message}`);
  process.exit(1);
});
