import { describe, it, expect } from 'vitest';
import { autoJoinHandlesForEmail, parseAutoJoinWorkspaces } from '../auth-env';

describe('parseAutoJoinWorkspaces', () => {
  it('parses a CSV of domain:handle pairs', () => {
    expect(parseAutoJoinWorkspaces('appsilon.com:appsilon,contoso.com:contoso')).toEqual([
      { domain: 'appsilon.com', handle: 'appsilon' },
      { domain: 'contoso.com', handle: 'contoso' },
    ]);
  });

  it('treats unset and empty as the feature being off', () => {
    expect(parseAutoJoinWorkspaces(undefined)).toEqual([]);
    expect(parseAutoJoinWorkspaces('')).toEqual([]);
    expect(parseAutoJoinWorkspaces('  ,  ')).toEqual([]);
  });

  it('normalises whitespace and case', () => {
    expect(parseAutoJoinWorkspaces('  Appsilon.COM : Appsilon  ')).toEqual([
      { domain: 'appsilon.com', handle: 'appsilon' },
    ]);
  });

  it('skips malformed pairs instead of throwing, so one typo cannot stop boot', () => {
    expect(
      parseAutoJoinWorkspaces('appsilon.com,:,orphan:,:orphan,a:b:c,good.com:good'),
    ).toEqual([{ domain: 'good.com', handle: 'good' }]);
  });
});

describe('autoJoinHandlesForEmail', () => {
  const rules = parseAutoJoinWorkspaces('appsilon.com:appsilon,appsilon.com:shared,other.com:other');

  it('returns every workspace the address maps to', () => {
    expect(autoJoinHandlesForEmail('krystian@appsilon.com', rules)).toEqual(['appsilon', 'shared']);
  });

  it('matches the domain case-insensitively', () => {
    expect(autoJoinHandlesForEmail('Krystian@Appsilon.COM', rules)).toEqual(['appsilon', 'shared']);
  });

  it('returns nothing for an unmapped domain, a missing domain, or no email', () => {
    expect(autoJoinHandlesForEmail('mallory@evil.com', rules)).toEqual([]);
    expect(autoJoinHandlesForEmail('not-an-email', rules)).toEqual([]);
    expect(autoJoinHandlesForEmail(null, rules)).toEqual([]);
    expect(autoJoinHandlesForEmail('', rules)).toEqual([]);
  });

  it('does not honour a wildcard domain — that blast radius is not configurable', () => {
    expect(autoJoinHandlesForEmail('mallory@evil.com', parseAutoJoinWorkspaces('*:appsilon'))).toEqual([]);
  });
});
