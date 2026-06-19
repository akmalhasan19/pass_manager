#!/usr/bin/env node
/**
 * Microsoft Edge Extension Signing / Submission Script
 *
 * Prerequisites:
 *   1. Register at Microsoft Edge Partner Center
 *   2. Set environment variables: EDGE_CLIENT_ID, EDGE_CLIENT_SECRET
 *
 * Usage:
 *   npx tsx scripts/sign-edge.ts [edge-build-dir]
 */
import * as fs from 'fs';
import * as path from 'path';
import { createWriteStream } from 'fs';
import { fileURLToPath } from 'url';
import archiver from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

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

function main(): void {
  const buildDir = process.argv[2] || path.join(rootDir, 'dist', 'edge');
  const clientId = process.env.EDGE_CLIENT_ID;
  const clientSecret = process.env.EDGE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('Missing Edge Partner Center credentials.');
    console.error('Set EDGE_CLIENT_ID and EDGE_CLIENT_SECRET environment variables.');
    process.exit(1);
  }

  if (!fs.existsSync(buildDir)) {
    console.error(`Build directory not found: ${buildDir}`);
    process.exit(1);
  }

  console.log('Packaging Edge extension for Partner Center submission...');
  console.log(`Build dir: ${buildDir}`);

  const releaseDir = path.join(rootDir, 'releases', 'edge-signed');
  fs.mkdirSync(releaseDir, { recursive: true });

  const zipPath = path.join(releaseDir, 'securepass-extension-edge-submission.zip');
  const packageJsonPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  zipDirectory(buildDir, zipPath)
    .then(() => {
      console.log('Edge extension packaged for submission!');
      console.log(`Zip: ${zipPath}`);
      console.log(`Version: ${pkg.version}`);
      console.log('NOTE: Upload the zip via Microsoft Edge Partner Center portal.');
    })
    .catch((err) => {
      console.error('Edge packaging failed:', err.message);
      process.exit(1);
    });
}

main();
