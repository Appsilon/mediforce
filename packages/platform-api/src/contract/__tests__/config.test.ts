import { describe, it, expect } from 'vitest';
import { normalizeBaseUrl } from '../config';

describe('normalizeBaseUrl', () => {
  it('trims whitespace and strips trailing slashes', () => {
    expect(normalizeBaseUrl('  https://phuse.mediforce.ai//  ')).toBe(
      'https://phuse.mediforce.ai',
    );
  });

  it('returns a clean URL unchanged', () => {
    expect(normalizeBaseUrl('https://phuse.mediforce.ai')).toBe(
      'https://phuse.mediforce.ai',
    );
  });

  it('treats blank, whitespace-only, undefined, and null as unset', () => {
    expect(normalizeBaseUrl('')).toBeUndefined();
    expect(normalizeBaseUrl('   ')).toBeUndefined();
    expect(normalizeBaseUrl(undefined)).toBeUndefined();
    expect(normalizeBaseUrl(null)).toBeUndefined();
  });
});
