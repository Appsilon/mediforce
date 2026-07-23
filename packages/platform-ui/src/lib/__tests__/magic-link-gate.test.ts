import { describe, it, expect } from 'vitest';
import { shouldSendMagicLink } from '../magic-link-gate';

describe('shouldSendMagicLink', () => {
  it('sends when the user exists and the domain is allowed', () => {
    expect(shouldSendMagicLink({ userExists: true, domainAllowed: true })).toBe(true);
  });

  it('does not send when the user does not exist', () => {
    expect(shouldSendMagicLink({ userExists: false, domainAllowed: true })).toBe(false);
  });

  it('does not send when the domain is not allowed', () => {
    expect(shouldSendMagicLink({ userExists: true, domainAllowed: false })).toBe(false);
  });

  it('does not send when both conditions fail', () => {
    expect(shouldSendMagicLink({ userExists: false, domainAllowed: false })).toBe(false);
  });
});
