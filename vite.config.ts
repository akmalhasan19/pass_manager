import { resolve } from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { builtinModules } from 'module';

// SECURITY: Source maps are disabled in production builds to prevent
// exposure of internal logic, variable names, and code structure.
// Source maps are only generated during development (dev server).
const isProduction = process.env.NODE_ENV === 'production';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/index.ts',
        vite: {
          resolve: {
            alias: {
              '@shared': resolve(__dirname, 'src/shared'),
              '@main': resolve(__dirname, 'src/main'),
            },
          },
          build: {
            outDir: 'dist-electron/main',
            minify: isProduction,
            sourcemap: !isProduction,
            rollupOptions: {
              external: [
                'electron',
                'sql.js',
                ...builtinModules,
                ...builtinModules.map((m) => `node:${m}`),
              ],
            },
          },
        },
      },
      {
        entry: 'src/preload/index.ts',
        vite: {
          resolve: {
            alias: {
              '@shared': resolve(__dirname, 'src/shared'),
            },
          },
          build: {
            outDir: 'dist-electron/preload',
            minify: isProduction,
            sourcemap: !isProduction,
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: !isProduction,
    // Multi-page app: quick-picker is a separate entry for the overlay
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'quick-picker': resolve(__dirname, 'quick-picker.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
});
