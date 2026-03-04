const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
  // 🔸 Ignorer les fichiers qui ne doivent pas être parsés
  {
    ignores: [
      'dist/',
      'node_modules/',
      'coverage/',
      'eslint.config.cjs',
      '.eslintrc.js',
      'jest.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'], // ✅ On limite ESLint aux fichiers sources TypeScript
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
];
