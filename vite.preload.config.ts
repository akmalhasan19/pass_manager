import { resolve } from 'path';
import { defineConfig } from 'vite';
import { builtinModules } from 'module';

// SECURITY: Source maps are disabled in production builds to prevent
// exposure of internal logic, variable names, and code structure.
const isProduction = process.env.NODE_ENV === 'production';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    outDir: 'dist-electron/preload',
    lib: {
      entry: 'src/preload/index.ts',
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
    minify: isProduction,
    sourcemap: !isProduction,
  },
});
