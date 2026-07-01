import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: ['dist/**', '.angular/**', '**/*.d.ts', 'node_modules/**']
  },
  {
    files: ['**/*.ts', '**/*.mts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json'
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      import: importPlugin
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'import/order': ['error', { 'newlines-between': 'always' }],
      '@typescript-eslint/no-explicit-any': 'error'
    }
  },
  prettier
];
