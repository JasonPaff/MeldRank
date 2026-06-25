import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allEnvKeys } from './server/env/keys';

/** Variable names defined in the committed `.env.example` at the repo root. */
function readExampleKeys(): string[] {
  const path = fileURLToPath(new URL('../../../.env.example', import.meta.url));
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

describe('.env.example agreement', () => {
  it('documents exactly the variables the schema declares', () => {
    const schemaKeys = allEnvKeys();
    const exampleKeys = readExampleKeys();

    const missingFromExample = schemaKeys.filter((k) => !exampleKeys.includes(k));
    const missingFromSchema = exampleKeys.filter((k) => !schemaKeys.includes(k));

    expect(missingFromExample, 'schema variables absent from .env.example').toEqual([]);
    expect(missingFromSchema, '.env.example variables absent from the schema').toEqual([]);
  });
});
