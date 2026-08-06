import { describe, it, expect } from 'vitest';
import { toSlug } from '../slug';

describe('toSlug', () => {
  it('lowercases and hyphenates', () => {
    expect(toSlug('Send Results Email')).toBe('send-results-email');
  });

  it('collapses non-alphanumeric runs into a single hyphen', () => {
    expect(toSlug('Check Etymology!!  (v2)')).toBe('check-etymology-v2');
  });

  it('trims leading/trailing hyphens', () => {
    expect(toSlug('--Done--')).toBe('done');
  });

  it('returns an empty string for a name with no alphanumeric characters', () => {
    expect(toSlug('###')).toBe('');
  });
});
