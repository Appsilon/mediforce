import { describe, it, expect } from 'vitest';
import { getPlatformServices as fromShim } from '@/lib/platform-services';
import { getPlatformServices as fromDirect } from '@mediforce/platform-api/services';

describe('platform-services singleton identity', () => {
  it('resolves to the same function reference via shim and direct import', () => {
    // Defense against alias-path divergence in webpack / vitest / tsc:
    // if these are different references, the seed-agent-definitions side
    // effect runs twice and we burn a Firestore write on every cold start.
    expect(fromShim).toBe(fromDirect);
  });
});
