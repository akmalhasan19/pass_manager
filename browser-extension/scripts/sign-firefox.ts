#!/usr/bin/env node
/**
 * Firefox AMO Signing Script for SecurePass Manager Browser Extension.
 *
 * Prerequisites:
 *   1. Obtain AMO API credentials from https://addons.mozilla.org/en-US/developers/addon/api/
 *   2. Set environment variables: FIREFOX_API_KEY, FIREFOX_API_SECRET
 *   3. Optionally set FIREFOX_EXTENSION_ID and FIREFOX_CHANNEL
 *
 * Usage:
 *   npx tsx scripts/sign-firefox.ts [firefox-build-dir]
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function main(): void {
  const buildDir = process.argv[2] || path.join(rootDir, 'dist', 'firefox');
  const apiKey = process.env.FIREFOX_API_KEY;
  const apiSecret = process.env.FIREFOX_API_SECRET;
  const extensionId = process.env.FIREFOX_EXTENSION_ID || 'securepass-manager@securepass-manager.org';
  const channel = process.env.FIREFOX_CHANNEL || 'listed';

  if (!apiKey || !apiSecret) {
    console.error('❌ Missing Firefox AMO credentials. Set FIREFOX_API_KEY and FIREFOX_API_SECRET.');
    console.error('Use "export FIREFOX_API_KEY=your-key" before running this script.');
    process.exit(1);
  }

  if (!fs.existsSync(buildDir)) {
    console.error(`❌ Build directory not found: ${buildDir}`);
    process.exit(1);
  }

  console.log('🔏 Signing Firefox extension via AMO...');
  console.log(`   Extension ID: ${extensionId}`);
  console.log(`   Channel: ${channel}`);
  console.log(`   Build dir: ${buildDir}`);

  try {
    const webExtPath = path.join(rootDir, 'node_modules', '.bin', 'web-ext');
    const execCmd = fs.existsSync(webExtPath)
      ? webExtPath
      : 'npx web-ext';

    const command = `${execCmd} sign --source-dir="${buildDir}" --api-key="${apiKey}" --api-secret="${apiSecret}"`;
    execSync(command, { stdio: 'inherit' });

    console.log('✅ Firefox extension signed successfully!');
  } catch (err) {
    console.error('❌ Firefox extension signing failed:', (err as Error).message);
    process.exit(1);
  }
}

main();
