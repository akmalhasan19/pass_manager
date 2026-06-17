#!/usr/bin/env node

/**
 * Post-build script to strip source maps from production build output.
 *
 * SECURITY: This is a defense-in-depth measure. Source maps expose internal
 * logic, variable names, and code structure. Even though Vite config now
 * conditionally disables source maps in production, this script ensures
 * any .map files that slip through are removed before packaging.
 *
 * Source maps are ONLY useful during development. In production, they are
 * a security liability for a password manager application.
 *
 * Usage: node scripts/strip-sourcemaps.js
 * Called automatically by `npm run build` (postbuild hook).
 */

const fs = require('fs');
const path = require('path');

const DIRECTORIES = ['dist', 'dist-electron'];
let removedCount = 0;

function removeMapFiles(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      removeMapFiles(fullPath);
    } else if (entry.name.endsWith('.map')) {
      fs.unlinkSync(fullPath);
      removedCount++;
      console.log(`  Removed: ${fullPath}`);
    }
  }
}

console.log('[security] Stripping source maps from production build...\n');

for (const dir of DIRECTORIES) {
  removeMapFiles(dir);
}

if (removedCount === 0) {
  console.log('[security] No source map files found (clean build).');
} else {
  console.log(`\n[security] Removed ${removedCount} source map file(s).`);
}
