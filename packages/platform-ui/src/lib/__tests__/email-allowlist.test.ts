import { describe, it, expect } from 'vitest';
import { parseAllowedDomains, isEmailDomainAllowed } from '../email-allowlist';

describe('parseAllowedDomains', () => {
  it('splits, trims, lowercases and drops blanks', () => {
    expect(parseAllowedDomains(' Appsilon.com , acme.io ,, ')).toEqual(['appsilon.com', 'acme.io']);
  });

  it('returns an empty list for undefined or empty', () => {
    expect(parseAllowedDomains(undefined)).toEqual([]);
    expect(parseAllowedDomains('')).toEqual([]);
    expect(parseAllowedDomains('  ,  ')).toEqual([]);
  });
});

describe('isEmailDomainAllowed', () => {
  it('allows anything when the allowlist is empty (unset = no restriction)', () => {
    expect(isEmailDomainAllowed('anyone@anywhere.com', [])).toBe(true);
    expect(isEmailDomainAllowed(null, [])).toBe(true);
  });

  it('allows an email whose domain is on the list, case-insensitively', () => {
    expect(isEmailDomainAllowed('Alice@Appsilon.com', ['appsilon.com'])).toBe(true);
  });

  it('rejects an email whose domain is not on the list', () => {
    expect(isEmailDomainAllowed('mallory@evil.com', ['appsilon.com'])).toBe(false);
  });

  it('rejects a null/blank/malformed email when a list is set', () => {
    expect(isEmailDomainAllowed(null, ['appsilon.com'])).toBe(false);
    expect(isEmailDomainAllowed('', ['appsilon.com'])).toBe(false);
    expect(isEmailDomainAllowed('no-at-sign', ['appsilon.com'])).toBe(false);
  });

  it('matches the second domain in a multi-domain list', () => {
    expect(isEmailDomainAllowed('bob@acme.io', ['appsilon.com', 'acme.io'])).toBe(true);
  });
});
