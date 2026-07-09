import { describe, it, expect } from 'vitest';
import { formatBytes } from '../format';

describe('formatBytes', () => {
  it('[DATA] formats zero bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('[DATA] formats bytes without a decimal', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('[DATA] formats kilobytes with one decimal (1024-based)', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('[DATA] formats megabytes', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('[DATA] caps the unit at GB', () => {
    expect(formatBytes(3 * 1024 ** 4)).toBe('3072.0 GB');
  });
});
