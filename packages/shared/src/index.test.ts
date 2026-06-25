import { describe, expect, it } from 'vitest';
import {
  PACKAGE_NAME,
  healthy,
  HealthSchema,
  VariantDefinitionSchema,
  SINGLE_DECK_PARTNERS,
} from './index';

describe('@meldrank/shared', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@meldrank/shared');
  });

  it('produces a Zod-validated health record', () => {
    const health = healthy('test');
    expect(health).toEqual({ service: 'test', ok: true });
    expect(HealthSchema.safeParse(health).success).toBe(true);
  });

  it('re-exports the Variant Definition surface from the isomorphic root', () => {
    expect(typeof VariantDefinitionSchema.parse).toBe('function');
    expect(SINGLE_DECK_PARTNERS.id).toBe('single-deck-partners');
  });
});
