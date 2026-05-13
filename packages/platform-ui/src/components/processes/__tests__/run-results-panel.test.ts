import { describe, it, expect } from 'vitest';
import { parseGithubPrUrl } from '../run-results-panel';

describe('parseGithubPrUrl', () => {
  it('parses a plain PR URL', () => {
    expect(parseGithubPrUrl('https://github.com/org/repo/pull/123')).toEqual({
      org: 'org',
      repo: 'repo',
      number: '123',
    });
  });

  it('parses PR URL with extra path segments (/files)', () => {
    expect(parseGithubPrUrl('https://github.com/org/repo/pull/123/files')).toEqual({
      org: 'org',
      repo: 'repo',
      number: '123',
    });
  });

  it('parses PR URL with a query string', () => {
    expect(parseGithubPrUrl('https://github.com/org/repo/pull/123?diff=split')).toEqual({
      org: 'org',
      repo: 'repo',
      number: '123',
    });
  });

  it('parses PR URL with a fragment', () => {
    expect(parseGithubPrUrl('https://github.com/org/repo/pull/123#issuecomment-1')).toEqual({
      org: 'org',
      repo: 'repo',
      number: '123',
    });
  });

  it('returns null for a non-GitHub URL', () => {
    expect(parseGithubPrUrl('https://gitlab.com/org/repo/pull/123')).toBeNull();
  });

  it('returns null for an issues URL on GitHub', () => {
    expect(parseGithubPrUrl('https://github.com/org/repo/issues/123')).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(parseGithubPrUrl('not-a-url')).toBeNull();
    expect(parseGithubPrUrl('')).toBeNull();
    expect(parseGithubPrUrl('https://github.com/org/repo/pull/abc')).toBeNull();
  });

  it('rejects http:// (non-https) GitHub URLs', () => {
    expect(parseGithubPrUrl('http://github.com/org/repo/pull/123')).toBeNull();
  });
});
