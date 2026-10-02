import { describe, it, expect } from 'vitest';
import { canonicalJson } from '../canonical-json';

describe('canonicalJson', () => {
  it('serializes equal values equally, whatever their key order', () => {
    expect(canonicalJson({ subject: '1001', visit: { day: 1, arm: 'A' } }))
      .toBe(canonicalJson({ visit: { arm: 'A', day: 1 }, subject: '1001' }));
    expect(canonicalJson({ ids: [2, 1] })).not.toBe(canonicalJson({ ids: [1, 2] }));
  });

  it('sorts keys at every depth and drops undefined values', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { f: 3, e: undefined }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"f":3}]},"b":1}');
  });
});
