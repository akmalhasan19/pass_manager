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
        'sql.js',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
    minify: isProduction,
    sourcemap: !isProduction,
  },
});
