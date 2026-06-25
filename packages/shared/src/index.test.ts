import { describe, expect, it } from 'vitest';
import { healthy, HealthSchema, PACKAGE_NAME } from './index';

describe('@meldrank/shared', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@meldrank/shared');
  });

  it('produces a Zod-validated health record', () => {
    const health = healthy('test');
    expect(health).toEqual({ service: 'test', ok: true });
    expect(HealthSchema.safeParse(health).success).toBe(true);
  });
});
