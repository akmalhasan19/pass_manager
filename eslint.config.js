import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/', 'dist-electron/', 'node_modules/', '*.js', '*.mjs', '*.cjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Test files: allow console.log for performance output, require() for helpers
    files: ['tests/**/*.{ts,tsx}', 'scripts/**/*.js'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off',
      'no-empty': 'off',
    },
  },
  {
    // Database connection: empty catch blocks are intentional for error recovery
    files: ['src/main/database/connection.ts'],
    rules: {
      'no-empty': 'off',
    },
  },
  {
    // Migrations: require() is used internally for circular dependency avoidance
    files: ['src/main/database/migrations.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // Argon2id: require() is used for dynamic native module loading
    files: ['src/main/crypto/argon2id.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  prettierConfig,
);
