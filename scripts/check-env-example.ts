#!/usr/bin/env tsx
/**
 * Asserts that `.env.example` and the environment schema declare exactly the
 * same set of variables. Run via `pnpm env:check`; also exercised as a Vitest
 * test (`packages/shared/src/env-example.test.ts`) so CI's `turbo test` covers
 * it. Exits non-zero on any drift.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allEnvKeys } from '@meldrank/shared/server';

function readExampleKeys(): string[] {
  const path = fileURLToPath(new URL('../.env', import.meta.url));
  const text = readFileSync(path, 'utf8');
  const keys: string[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const name = line.split('=', 1)[0]?.trim();
    if (name) keys.push(name);
  }
  return keys.sort();
}

const schemaKeys = allEnvKeys();
const exampleKeys = readExampleKeys();

const missingFromExample = schemaKeys.filter((k) => !exampleKeys.includes(k));
const missingFromSchema = exampleKeys.filter((k) => !schemaKeys.includes(k));

if (missingFromExample.length === 0 && missingFromSchema.length === 0) {
  console.log(`.env.example agrees with the schema (${schemaKeys.length} variables).`);
  process.exit(0);
}

if (missingFromExample.length > 0) {
  console.error(`Missing from .env.example: ${missingFromExample.join(', ')}`);
}
if (missingFromSchema.length > 0) {
  console.error(`Present in .env.example but not the schema: ${missingFromSchema.join(', ')}`);
}
process.exit(1);
