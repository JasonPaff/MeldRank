import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guards the engine's zero-runtime-dependency invariant: the package runs
 * unchanged in the web client, the Match Service, and bot workers, so it must
 * declare no runtime `dependencies` and may only consume `@meldrank/shared` as a
 * type-only import (erased at build).
 */

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = join(SRC_DIR, '..');

/** Every non-test TypeScript source file under `src` (the shipped surface). */
function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(path);
    }
  }
  return files;
}

describe('engine zero-runtime-deps invariant', () => {
  it('declares no runtime dependencies in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it('imports from @meldrank/shared only as type-only imports', () => {
    const offending: string[] = [];
    for (const file of sourceFiles(SRC_DIR)) {
      const contents = readFileSync(file, 'utf8');
      for (const line of contents.split('\n')) {
        const importsShared = /\bfrom\s+['"]@meldrank\/shared['"]/.test(line);
        if (importsShared && !/^\s*import\s+type\b/.test(line)) {
          offending.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(offending).toEqual([]);
  });
});
