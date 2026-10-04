import { describe, it, expect } from 'vitest';
import { unfence } from '../code-fence';

describe('unfence', () => {
  it('[DATA] returns the body of a ```json fence', () => {
    expect(unfence('```json\n{"grade": 3}\n```')).toBe('{"grade": 3}');
  });

  it('[DATA] returns the body of a bare ``` fence', () => {
    expect(unfence('```\n{"grade": 3}\n```')).toBe('{"grade": 3}');
  });

  it('[DATA] finds the fence inside surrounding prose', () => {
    expect(unfence('Here is the result:\n```json\n{"grade": 3}\n```\nDone.')).toBe('{"grade": 3}');
  });

  it('[DATA] returns unfenced text trimmed', () => {
    expect(unfence('  {"grade": 3}\n')).toBe('{"grade": 3}');
  });
});
