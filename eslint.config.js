// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Project rules worth knowing:
 * - `src/core` is a pure library: it must not import from the app, worker or CLI.
 * - Only the network modules may call `fetch`; everything else receives data or
 *   an injected function, which keeps the core testable without a network.
 * - Logging goes through `src/core/log.ts`, the one place allowed to use `console`.
 */
const networkModules = [
  'src/core/reddit/client.ts',
  'src/core/ai/provider.ts',
  'src/core/profile/crawl.ts',
  'src/core/notify/webhook.ts',
];

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      '.next/',
      'coverage/',
      'data/',
      'test-results/',
      'playwright-report/',
      'next-env.d.ts',
      'src/core/db/migrations/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Network access belongs in the dedicated network modules.' },
      ],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/app/**', '**/worker/**', '**/cli/**', 'next', 'next/*', 'react'],
              message: 'The core library must not depend on the app, worker, CLI or React.',
            },
          ],
        },
      ],
    },
  },
  {
    files: networkModules,
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    files: ['src/core/log.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
);
