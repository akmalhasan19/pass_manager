#!/usr/bin/env node
/**
 * Package extension for store submission.
 * Generates .zip archives for each target browser with source maps and signing metadata.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createWriteStream } from 'fs';
import { fileURLToPath } from 'url';
import archiver from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

interface PackageResult {
  browser: string;
  success: boolean;
  zipPath: string;
  error?: string;
}

const browsers = ['chrome', 'firefox', 'edge'];

function zipDirectory(sourceDir: string, outFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outFile);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`Packed ${archive.pointer()} total bytes to ${outFile}`);
      resolve();
    });

    archive.on('error', (err) => reject(err));
    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.warn('Archiver warning:', err.message);
      } else {
        reject(err);
      }
    });

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function packageBrowser(browser: string): Promise<PackageResult> {
  const buildDir = path.join(rootDir, 'dist', browser);
  const releaseDir = path.join(rootDir, 'releases');
  const zipPath = path.join(releaseDir, `securepass-extension-${browser}.zip`);

  if (!fs.existsSync(buildDir)) {
    return {
      browser,
      success: false,
      zipPath,
      error: `Build directory not found at ${buildDir}. Run build first.`,
    };
  }

  try {
    console.log(`\n📦 Packaging ${browser.toUpperCase()}...`);
    fs.mkdirSync(releaseDir, { recursive: true });
    await zipDirectory(buildDir, zipPath);
    console.log(`✅ Packaged ${browser.toUpperCase()} → ${zipPath}`);
    return { browser, success: true, zipPath };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`❌ Packaging ${browser.toUpperCase()} failed:`, error);
    return { browser, success: false, zipPath, error };
  }
}

function writePackageInfo(results: PackageResult[]): void {
  const releaseDir = path.join(rootDir, 'releases');
  const infoPath = path.join(releaseDir, 'package-info.json');
  const info = {
    version: process.env.EXTENSION_VERSION || '0.1.0',
    timestamp: new Date().toISOString(),
    packages: results
      .filter((r) => r.success)
      .map((r) => ({
        browser: r.browser,
        filename: path.basename(r.zipPath),
        path: r.zipPath,
      })),
    errors: results.filter((r) => !r.success).map((r) => ({ browser: r.browser, error: r.error })),
  };

  fs.writeFileSync(infoPath, JSON.stringify(info, null, 2));
  console.log(`\n📋 Package info written to ${infoPath}`);
}

async function main() {
  const args = process.argv.slice(2);
  const requestedBrowser = args[0];

  if (requestedBrowser && !browsers.includes(requestedBrowser)) {
    console.error(`Unknown browser: ${requestedBrowser}. Expected one of: ${browsers.join(', ')}`);
    process.exit(1);
  }

  const targets = requestedBrowser ? [requestedBrowser] : browsers;

  const results: PackageResult[] = [];
  for (const browser of targets) {
    const result = await packageBrowser(browser);
    results.push(result);
  }

  writePackageInfo(results);

  // Summary
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                   PACKAGING SUMMARY                        ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  for (const r of results) {
    const status = r.success ? '✅ DONE' : '❌ FAIL';
    console.log(`║ ${status}  ${r.browser.padEnd(9)} → ${r.zipPath}`);
    if (r.error) {
      console.log(`║          Error: ${r.error}`);
    }
  }
  console.log('╚════════════════════════════════════════════════════════════╝');

  const failed = results.filter((r) => !r.success);
  if (failed.length > 0) {
    console.error(`\n❌ ${failed.length} package(s) failed.`);
    process.exit(1);
  }

  console.log('\n🎉 All packages generated successfully!');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
