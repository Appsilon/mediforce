import { describe, expect, it, afterEach } from 'vitest';
import { getDockerInfo } from '../get-docker-info';
import { createTestScope } from '../../../repositories/__tests__/create-test-scope';

/**
 * `getDockerInfo` is a five-line dispatcher around `_docker.ts`. The
 * shell-out and container-worker code paths get their own coverage in
 * `_docker.test.ts`; this file exists so the structural api-boundaries
 * guard sees a sibling test per handler.
 */
describe('getDockerInfo handler', () => {
  const originalAllow = process.env.ALLOW_LOCAL_AGENTS;
  const originalRedis = process.env.REDIS_URL;

  afterEach(() => {
    process.env.ALLOW_LOCAL_AGENTS = originalAllow;
    process.env.REDIS_URL = originalRedis;
  });

  it('returns {available: false} when both backends are unreachable', async () => {
    // No ALLOW_LOCAL_AGENTS set → container-worker path; default URL
    // (container-worker:3001) is unresolvable from the test process →
    // fetch throws → caught and degraded to {available: false}.
    delete process.env.ALLOW_LOCAL_AGENTS;
    delete process.env.REDIS_URL;

    const scope = createTestScope();
    const result = await getDockerInfo({}, scope);

    expect(result.available).toBe(false);
  });
});
