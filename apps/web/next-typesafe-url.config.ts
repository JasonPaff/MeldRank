import { type Config } from 'next-typesafe-url';

/**
 * next-typesafe-url generator config. This app keeps its `app/` directory at the
 * package root (no `src/`), so point `srcPath` there — the default of `./src`
 * would not find the routes. The generated `_next-typesafe-url_.d.ts` lands at
 * the package root and is consumed by `$path` and the route-param hooks.
 *
 * `watch` is intentionally left to the CLI (`-w` in the `dev` script) rather than
 * set here, so the one-shot `build`/`typecheck` runs generate and exit instead of
 * hanging in watch mode.
 */
const config: Config = {
  filename: 'route-type',
  srcPath: './',
};

export default config;
