import { resolve } from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

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
            minify: process.env.NODE_ENV === 'production',
            sourcemap: true,
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
            minify: process.env.NODE_ENV === 'production',
            sourcemap: true,
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
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
