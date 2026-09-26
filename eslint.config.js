import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist', 'coverage', 'docs/api', 'test-results', 'playwright-report', 'node_modules'],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { parserOptions: { projectService: false } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['scripts/**', 'test/**', 'tests/**', 'examples/**'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
