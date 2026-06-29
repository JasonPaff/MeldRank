import path from 'node:path';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import vitest from '@vitest/eslint-plugin';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import nextPlugin from '@next/eslint-plugin-next';
import reactRefresh from 'eslint-plugin-react-refresh';
import perfectionist from 'eslint-plugin-perfectionist';
import betterTailwind from 'eslint-plugin-better-tailwindcss';
import pluginQuery from '@tanstack/eslint-plugin-query';
import prettier from 'eslint-config-prettier';

/**
 * The browser client (`apps/web`) is the only React + Next.js surface in the
 * monorepo. Its UI-framework linting is scoped to these globs so the pure
 * packages (engine, shared) and the Node services (api, match, bots) never see
 * React/Next/Tailwind rules. `.ts` is included alongside `.tsx` so non-JSX
 * client modules (the tRPC client, the store) are still covered by the hooks,
 * query, and import-sorting rules.
 */
const WEB_FILES = ['apps/web/**/*.{ts,tsx}'];

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
    // Structured-logging guard (capability `structured-logging`, design D6): the three
    // Node services log through the shared `@meldrank/shared/server` logger, never raw
    // `console`. Scoped to their `src`; test files are exempted via `ignores` below.
    files: ['apps/match/src/**/*.ts', 'apps/api/src/**/*.ts', 'apps/bots/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-console': 'error',
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
  // ── apps/web client linting (React 19 / Next 16 / Tailwind v4 / TanStack Query) ──
  // Each preset is a single flat-config object ({ plugins, rules[, languageOptions] });
  // spreading it under `files: WEB_FILES` registers the plugin and scopes its rules to
  // the client. The react/jsx-a11y presets only add `parserOptions.ecmaFeatures.jsx`,
  // which deep-merges with the global typescript-eslint parser — the TS parser stays.
  { files: WEB_FILES, ...react.configs.flat.recommended },
  // React 19 automatic JSX runtime: drop the legacy "React must be in scope" rules.
  { files: WEB_FILES, ...react.configs.flat['jsx-runtime'] },
  // Rules of Hooks + exhaustive-deps, plus the React Compiler-powered rules.
  { files: WEB_FILES, ...reactHooks.configs.flat['recommended-latest'] },
  { files: WEB_FILES, ...jsxA11y.flatConfigs.recommended },
  // Next-specific correctness, escalated to errors on Core Web Vitals concerns.
  { files: WEB_FILES, ...nextPlugin.configs['core-web-vitals'] },
  // Fast Refresh safety, with the Next preset's Page/Layout export allowances.
  { files: WEB_FILES, ...reactRefresh.configs.next },
  // Deterministic sorting (imports, objects, types, JSX props, …). Perfectionist
  // owns import ordering in apps/web; the repo-wide `import-x/order` is disabled
  // below so the two sorters never conflict.
  { files: WEB_FILES, ...perfectionist.configs['recommended-natural'] },
  // Tailwind v4 class linting (consistent order, no conflicting/unregistered classes).
  { files: WEB_FILES, ...betterTailwind.configs.recommended },
  // TanStack Query correctness (exhaustive query deps, stable client, …).
  { files: WEB_FILES, ...pluginQuery.configs['flat/recommended'][0] },
  {
    files: WEB_FILES,
    settings: {
      // Pin the React version explicitly. `version: 'detect'` makes
      // eslint-plugin-react@7 call the removed `context.getFilename()` under
      // ESLint 10 flat config, which crashes linting on the first file; an
      // explicit version skips that auto-detection codepath.
      react: { version: '19.2.7' },
      // Tailwind v4 resolves utilities from the CSS entry file, not a JS config.
      // Absolute path so it resolves whether ESLint runs from the repo root or
      // from apps/web (turbo runs each package's `eslint .` with its own cwd).
      'better-tailwindcss': { entryPoint: path.resolve(import.meta.dirname, 'apps/web/app/globals.css') },
    },
    rules: {
      // Perfectionist's `sort-imports` owns import ordering here (decision); turn
      // off the repo's `import-x/order` for the client so they don't fight.
      'import-x/order': 'off',
    },
  },
  {
    // Deliberate co-location: shadcn/ui components ship a component + its `cva`
    // variants in one file, and our client providers co-locate the provider with
    // its consumer hook. Fast Refresh fidelity on these rarely-edited infra modules
    // isn't worth splitting them, so exempt these dirs; `only-export-components`
    // stays on for route/feature components (app/**, components/** outside ui).
    files: ['apps/web/components/ui/**/*.tsx', 'apps/web/lib/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  prettier,
);
