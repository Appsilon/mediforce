import { describe, it, expect } from 'vitest';
import { toSlug, uniqueName, uniqueSlug } from '../slug';

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

describe('uniqueName', () => {
  it('returns the candidate untouched when it is free', () => {
    expect(uniqueName('X-Header', ['Authorization'])).toBe('X-Header');
  });

  it('keeps the candidate verbatim rather than slugifying it', () => {
    expect(uniqueName('X-Header', ['X-Header'])).toBe('X-Header-2');
  });

  it('joins the suffix with the separator the naming convention uses', () => {
    expect(uniqueName('NEW_VAR', ['NEW_VAR'], '_')).toBe('NEW_VAR_2');
  });

  it('increments until the name is unique', () => {
    expect(uniqueName('NEW_VAR', ['NEW_VAR', 'NEW_VAR_2'], '_')).toBe('NEW_VAR_3');
  });
});
