import { describe, it, expect } from 'vitest';
import {
  OpenRouterCreditsInputSchema,
  OpenRouterCreditsOutputSchema,
} from '../system.js';

describe('OpenRouterCreditsInputSchema', () => {
  it('accepts valid namespace', () => {
    const result = OpenRouterCreditsInputSchema.safeParse({ namespace: 'my-org' });
    expect(result.success).toBe(true);
  });

  it('rejects empty namespace', () => {
    const result = OpenRouterCreditsInputSchema.safeParse({ namespace: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing namespace', () => {
    const result = OpenRouterCreditsInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('OpenRouterCreditsOutputSchema', () => {
  it('accepts available response', () => {
    const result = OpenRouterCreditsOutputSchema.safeParse({
      available: true,
      limit: 30,
      usage: 19.85,
      remaining: 10.15,
    });
    expect(result.success).toBe(true);
  });

  it('accepts unavailable response with error', () => {
    const result = OpenRouterCreditsOutputSchema.safeParse({
      available: false,
      limit: 0,
      usage: 0,
      remaining: 0,
      error: 'OPENROUTER_API_KEY not configured',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing fields', () => {
    const result = OpenRouterCreditsOutputSchema.safeParse({ available: true });
    expect(result.success).toBe(false);
  });
});
