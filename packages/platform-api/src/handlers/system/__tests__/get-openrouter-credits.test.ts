import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { NamespaceSecretsRepository } from '@mediforce/platform-core';
import { getOpenRouterCredits } from '../get-openrouter-credits';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import { buildNamespaceSecretsRepo } from '../../secrets/__tests__/fakes';

function makeJsonResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 500,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Route fetches by URL: `/auth/key` returns key-level numbers, `/credits`
 * returns the account balance. Pass `null` for either to simulate that call
 * failing (non-OK 500).
 */
function routedFetch(opts: {
  key?: { limit?: number; usage?: number; limit_remaining?: number } | null;
  credits?: { total_credits?: number; total_usage?: number } | null;
}) {
  return vi.fn(async (url: string) => {
    if (url.includes('/auth/key')) {
      if (opts.key === null) return makeJsonResponse({}, false);
      return makeJsonResponse({ data: opts.key });
    }
    if (url.includes('/credits')) {
      if (opts.credits === null) return makeJsonResponse({}, false);
      return makeJsonResponse({ data: opts.credits });
    }
    throw new Error(`unexpected url ${url}`);
  });
}

describe('getOpenRouterCredits handler', () => {
  let secretsRepo: NamespaceSecretsRepository;

  beforeEach(() => {
    secretsRepo = buildNamespaceSecretsRepo({
      alpha: { OPENROUTER_API_KEY: 'sk-real' },
      beta: { OTHER: 'x' },
    });
  });

  it('fetches key + account credits and reports the effective minimum', async () => {
    // Account balance ($0.5) is far below the key cap ($90) — the binding
    // constraint is the account, so effectiveRemaining must be $0.5.
    const fetchSpy = routedFetch({
      key: { limit: 100, usage: 10, limit_remaining: 90 },
      credits: { total_credits: 10, total_usage: 9.5 },
    });

    const scope = createTestScope({ namespaceSecretsRepo: secretsRepo });
    const result = await getOpenRouterCredits(
      { namespace: 'alpha' },
      scope,
      { fetch: fetchSpy as unknown as typeof globalThis.fetch },
    );

    expect(result).toEqual({
      available: true,
      limit: 100,
      usage: 10,
      remaining: 90,
      accountRemaining: 0.5,
      effectiveRemaining: 0.5,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('uses the key remaining when it is the binding constraint', async () => {
    const fetchSpy = routedFetch({
      key: { limit: 20, usage: 18, limit_remaining: 2 },
      credits: { total_credits: 100, total_usage: 10 },
    });

    const scope = createTestScope({ namespaceSecretsRepo: secretsRepo });
    const result = await getOpenRouterCredits(
      { namespace: 'alpha' },
      scope,
      { fetch: fetchSpy as unknown as typeof globalThis.fetch },
    );

    expect(result.accountRemaining).toBe(90);
    expect(result.effectiveRemaining).toBe(2);
  });

  it('degrades to key-level numbers when the credits call fails', async () => {
    const fetchSpy = routedFetch({
      key: { limit: 100, usage: 10, limit_remaining: 90 },
      credits: null,
    });

    const scope = createTestScope({ namespaceSecretsRepo: secretsRepo });
    const result = await getOpenRouterCredits(
      { namespace: 'alpha' },
      scope,
      { fetch: fetchSpy as unknown as typeof globalThis.fetch },
    );

    expect(result.available).toBe(true);
    expect(result.accountRemaining).toBeUndefined();
    expect(result.effectiveRemaining).toBe(90);
  });

  it('degrades to key-level numbers when the credits payload shape is unexpected', async () => {
    const fetchSpy = routedFetch({
      key: { limit: 100, usage: 10, limit_remaining: 90 },
      credits: { total_credits: 5 },
    });

    const scope = createTestScope({ namespaceSecretsRepo: secretsRepo });
    const result = await getOpenRouterCredits(
      { namespace: 'alpha' },
      scope,
      { fetch: fetchSpy as unknown as typeof globalThis.fetch },
    );

    expect(result.available).toBe(true);
    expect(result.accountRemaining).toBeUndefined();
    expect(result.effectiveRemaining).toBe(90);
  });

  it('returns "not configured" when the workspace has no OPENROUTER_API_KEY', async () => {
    const scope = createTestScope({ namespaceSecretsRepo: secretsRepo });
    const result = await getOpenRouterCredits({ namespace: 'beta' }, scope);

    expect(result.available).toBe(false);
    expect(result.error).toContain('OPENROUTER_API_KEY');
  });

  it('soft-fails to "not configured" for a user caller outside the namespace', async () => {
    // The wrapper hides foreign-workspace secrets; the handler sees an empty
    // map and reports "not configured" instead of leaking namespace existence.
    const scope = createTestScope({
      namespaceSecretsRepo: secretsRepo,
      caller: userCaller('u-1', ['gamma']),
    });
    const result = await getOpenRouterCredits({ namespace: 'alpha' }, scope);

    expect(result.available).toBe(false);
    expect(result.error).toContain('OPENROUTER_API_KEY');
  });

  it('returns the available credits for a user caller in the namespace', async () => {
    const fetchSpy = vi.fn(async () =>
      makeJsonResponse({ data: { limit: 50, usage: 5, limit_remaining: 45 } }),
    );

    const scope = createTestScope({
      namespaceSecretsRepo: secretsRepo,
      caller: userCaller('u-2', ['alpha']),
    });
    const result = await getOpenRouterCredits(
      { namespace: 'alpha' },
      scope,
      { fetch: fetchSpy as unknown as typeof globalThis.fetch },
    );

    expect(result.available).toBe(true);
    expect(result.remaining).toBe(45);
  });

  it('returns the OpenRouter status as an error string when upstream is non-OK', async () => {
    const fetchSpy = vi.fn(async () => makeJsonResponse({}, false));

    const scope = createTestScope({ namespaceSecretsRepo: secretsRepo });
    const result = await getOpenRouterCredits(
      { namespace: 'alpha' },
      scope,
      { fetch: fetchSpy as unknown as typeof globalThis.fetch },
    );

    expect(result.available).toBe(false);
    expect(result.error).toContain('500');
  });

  it('reports "unexpected shape" when the upstream payload lacks data.limit_remaining', async () => {
    const fetchSpy = vi.fn(async () => makeJsonResponse({ data: { limit: 1 } }));

    const scope = createTestScope({ namespaceSecretsRepo: secretsRepo });
    const result = await getOpenRouterCredits(
      { namespace: 'alpha' },
      scope,
      { fetch: fetchSpy as unknown as typeof globalThis.fetch },
    );

    expect(result.available).toBe(false);
    expect(result.error).toMatch(/shape|unexpected/i);
  });
});
