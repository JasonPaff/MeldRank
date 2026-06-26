import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/coverage/**', '**/.turbo/**', '**/next-env.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Type-aware linting: promise-safety (no-floating-promises, no-misused-promises),
  // `any`-leak containment (no-unsafe-*), and correctness rules that need the type
  // checker. The value lands at the I/O boundaries (shared/server, apps) where wire
  // intents, redis payloads, and async handlers live; the pure engine stays quiet.
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Auto-discovers the nearest tsconfig per file across the monorepo.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // TypeScript sources: enforce type-only imports and a clean import graph.
    files: ['**/*.{ts,tsx,mts,cts}'],
    plugins: { 'import-x': importX },
    settings: {
      // Resolve `@meldrank/*` path aliases and `.ts` extensions so the
      // import-graph rules below see real edges, not unresolved guesses.
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          project: ['tsconfig.json', 'packages/*/tsconfig.json', 'apps/*/tsconfig.json'],
        }),
      ],
    },
    rules: {
      // The engine ships zero runtime dependencies; type-only imports are what
      // keeps `@meldrank/shared` (Zod, drivers) erased at build. Enforce
      // `import type` everywhere so an accidental value import is caught at lint
      // time with an autofix, not only by the engine's runtime invariant test.
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'separate-type-imports' }],
      // The engine is barrel-heavy with many intra-package modules; forbid import
      // cycles before they can form.
      'import-x/no-cycle': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
          'newlines-between': 'never',
        },
      ],
    },
  },
  {
    // Boundary guard: `apps/web` is browser-reachable, so it must never import
    // the server-only surface of `@meldrank/shared` (which carries the Neon and
    // Upstash drivers). Use `@meldrank/shared` instead. See packages/shared/README.md.
    files: ['apps/web/**/*.{ts,tsx,js,jsx,mjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@meldrank/shared/server', '@meldrank/shared/server/*'],
              message:
                'apps/web is browser-reachable; do not import the server-only surface (@meldrank/shared/server). Use @meldrank/shared.',
            },
          ],
        },
      ],
    },
  },
  {
    // Vitest suites: catch focused/skipped tests and malformed assertions. Tests
    // routinely poke at `any`/`unknown` fixtures and malformed inputs on purpose,
    // so the `no-unsafe-*` family is relaxed here to keep that intentional.
    files: ['**/*.test.{ts,tsx}'],
    ...vitest.configs.recommended,
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/no-focused-tests': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // Plain JS / config files (this file included) have no type information; turn
    // off the type-aware rules so the parser never tries to project them.
    files: ['**/*.{js,mjs,cjs,jsx}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
