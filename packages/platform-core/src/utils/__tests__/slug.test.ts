import { describe, it, expect } from 'vitest';
import { toSlug, uniqueSlug } from '../slug';

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

describe('uniqueSlug', () => {
  it('suffixes a slug that already exists', () => {
    expect(uniqueSlug('Input Text', ['input-text'])).toBe('input-text-2');
  });

  it('keeps the current id available while renaming a step', () => {
    expect(uniqueSlug('Input Text', ['input-text'], 'input-text')).toBe('input-text');
  });

  it('increments until the slug is unique', () => {
    expect(uniqueSlug('Input Text', ['input-text', 'input-text-2'])).toBe('input-text-3');
  });
});
