import { resolve } from 'path';
import { defineConfig } from 'vite';
import { builtinModules } from 'module';
import pkg from './package.json';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
    },
  },
  build: {
    outDir: 'dist-electron/main',
    lib: {
      entry: 'src/main/index.ts',
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: [
        'electron',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
    minify: process.env.NODE_ENV === 'production',
    sourcemap: true,
  },
});
