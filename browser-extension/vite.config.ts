import { defineConfig } from 'vite';
import { resolve } from 'path';
import * as fs from 'fs';

const targetBrowser = process.env.TARGET_BROWSER || 'chrome';

// Map specific browser builds to appropriate manifest adjustments
const browserManifestOverrides: Record<string, object> = {
  firefox: {
    browser_specific_settings: {
      gecko: {
        id: 'securepass-manager@securepass-manager.org',
        strict_min_version: '109.0',
      },
    },
  },
  edge: {
    minimum_chrome_version: undefined,
    minimum_edge_version: '109',
  },
};

export default defineConfig({
  base: './',
  build: {
    outDir: `dist/${targetBrowser}`,
    emptyOutDir: true,
    sourcemap: true, // Enabled for debugging and store review
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
        popup: resolve(__dirname, 'src/popup/index.html'),
      },
      output: {
        entryFileNames: '[name]/index.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
        format: 'es',
      },
    },
    target: 'es2022',
    minify: true,
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  plugins: [
    {
      name: 'generate-browser-manifest',
      closeBundle() {
        const manifestPath = resolve(__dirname, 'manifest.json');
        const outDir = resolve(__dirname, `dist/${targetBrowser}`);
        const outManifestPath = resolve(outDir, 'manifest.json');

        if (!fs.existsSync(manifestPath)) {
          console.warn('manifest.json not found, skipping manifest generation');
          return;
        }

        const baseManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const overrides = browserManifestOverrides[targetBrowser] || {};
        const mergedManifest = { ...baseManifest, ...overrides };

        fs.writeFileSync(outManifestPath, JSON.stringify(mergedManifest, null, 2));
        console.log(`Generated ${targetBrowser} manifest at ${outManifestPath}`);
      },
    },
  ],
});
