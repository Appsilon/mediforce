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

describe('getOpenRouterCredits handler', () => {
  let secretsRepo: NamespaceSecretsRepository;

  beforeEach(() => {
    secretsRepo = buildNamespaceSecretsRepo({
      alpha: { OPENROUTER_API_KEY: 'sk-real' },
      beta: { OTHER: 'x' },
    });
  });

  it('fetches credits when the api key is present (apiKey caller)', async () => {
    const fetchSpy = vi.fn(async () =>
      makeJsonResponse({ data: { limit: 100, usage: 10, limit_remaining: 90 } }),
    );

    const scope = createTestScope({ namespaceSecretsRepo: secretsRepo });
    const result = await getOpenRouterCredits(
      { namespace: 'alpha' },
      scope,
      { fetch: fetchSpy as unknown as typeof globalThis.fetch },
    );

    expect(result).toEqual({ available: true, limit: 100, usage: 10, remaining: 90 });
    expect(fetchSpy).toHaveBeenCalledOnce();
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
