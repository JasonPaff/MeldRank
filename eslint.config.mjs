import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
  prettier,
);
