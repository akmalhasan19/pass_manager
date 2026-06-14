/**
 * Post-install script for SecurePass Manager.
 *
 * This script runs after `npm install` to:
 * 1. Verify critical dependencies are available.
 * 2. Copy WASM file for sql.js to the public directory (if needed).
 */

const { copyFileSync, existsSync, mkdirSync } = require('fs');
const { resolve, dirname } = require('path');

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

async function main() {
  log('Running SecurePass Manager post-install checks...');

  checkDependencies();
  copySqliteWasm();

  log('Post-install complete.');
}

main().catch((err) => {
  console.error(`[postinstall] ❌ Unexpected error: ${err.message}`);
  process.exit(1);
});
