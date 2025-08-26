// ESLint v9 flat config
// Migrated from .eslintrc.cjs

const js = require('@eslint/js');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const globals = require('globals');

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
  // Ignore patterns
  {
    ignores: ['dist/**', 'node_modules/**', 'src/ml/**', 'src/analysis/**'],
  },

  // Base JS recommended
  js.configs.recommended,

  // Global adjustments to avoid JS core rules conflicting with TS
  {
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },

  // TypeScript rules applied to TS files
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        // Use projectService for TS 5+ without mandating a tsconfig path
        projectService: true,
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // Turn off base rule so TS variant is authoritative
      'no-unused-vars': 'off',
      // From previous .eslintrc.cjs
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-case-declarations': 'off',
    },
  },

  // File-specific overrides
  {
    files: ['src/parsers/ASTParser.ts'],
    rules: {
      'no-duplicate-case': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
];
