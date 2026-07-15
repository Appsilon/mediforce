import { describe, it, expect } from 'vitest';
import { GitHubApiError } from '../../scripts/github-api-error.js';

describe('GitHubApiError', () => {
  it('marks a 403 with X-RateLimit-Remaining: 0 as a rate limit and surfaces the reset time', () => {
    const error = new GitHubApiError({
      url: 'https://api.github.com/repos/x/y/branches',
      status: 403,
      statusText: 'rate limit exceeded',
      rateLimitRemaining: '0',
      rateLimitReset: '1700000000',
    });

    expect(error).toBeInstanceOf(GitHubApiError);
    expect(error.status).toBe(403);
    expect(error.message).toContain('rate limit exceeded');
    expect(error.message).toContain(new Date(1700000000 * 1000).toISOString());
  });

  it('marks a 429 with X-RateLimit-Remaining: 0 as a rate limit', () => {
    const error = new GitHubApiError({
      url: 'https://api.github.com/repos/x/y/issues',
      status: 429,
      statusText: 'Too Many Requests',
      rateLimitRemaining: '0',
      rateLimitReset: '1700000000',
    });

    expect(error.status).toBe(429);
    expect(error.message).toContain('rate limit exceeded');
  });

  it('does not treat a 403 as a rate limit when quota remains', () => {
    const error = new GitHubApiError({
      url: 'https://api.github.com/repos/x/y/branches',
      status: 403,
      statusText: 'Forbidden',
      rateLimitRemaining: '42',
      rateLimitReset: '1700000000',
    });

    expect(error.message).toBe(
      'GitHub API request failed: 403 Forbidden for https://api.github.com/repos/x/y/branches',
    );
  });

  it('omits the reset clause when no X-RateLimit-Reset header is present', () => {
    const error = new GitHubApiError({
      url: 'https://api.github.com/repos/x/y/branches',
      status: 403,
      statusText: 'rate limit exceeded',
      rateLimitRemaining: '0',
      rateLimitReset: null,
    });

    expect(error.message).toContain('rate limit exceeded');
    expect(error.message).not.toContain('resets at');
  });

  it('builds a descriptive message for unexpected non-2xx statuses', () => {
    const error = new GitHubApiError({
      url: 'https://api.github.com/repos/x/y/commits',
      status: 500,
      statusText: 'Internal Server Error',
      rateLimitRemaining: '5000',
      rateLimitReset: '1700000000',
    });

    expect(error.status).toBe(500);
    expect(error.message).toBe(
      'GitHub API request failed: 500 Internal Server Error for https://api.github.com/repos/x/y/commits',
    );
  });

  it('preserves a 409 status so callers can treat it as non-fatal', () => {
    const error = new GitHubApiError({
      url: 'https://api.github.com/repos/x/y/commits',
      status: 409,
      statusText: 'Conflict',
      rateLimitRemaining: '5000',
      rateLimitReset: '1700000000',
    });

    expect(error).toBeInstanceOf(GitHubApiError);
    expect(error.status).toBe(409);
  });
});
