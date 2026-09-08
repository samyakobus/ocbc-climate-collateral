/**
 * Smoke assertion for the `unit` Vitest project (S4).
 *
 * Proves the harness runs on the node environment with no database and no DOM,
 * which is the contract the AC-2 formula tests and the AC-17 payload tests rely
 * on: they are assigned to this project precisely because they need neither.
 */

import { describe, expect, it } from 'vitest';

import { RULE_SET_SEED_DEFAULTS } from '../../lib/rules/bands';

describe('unit project harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });

  it('runs on the node environment, with no DOM', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof process.versions.node).toBe('string');
  });

  it('resolves project modules by relative path', () => {
    expect(RULE_SET_SEED_DEFAULTS.p_2050).toBe(0.22);
  });
});
