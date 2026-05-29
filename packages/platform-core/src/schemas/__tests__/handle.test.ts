import { describe, it, expect } from 'vitest';
import { HandleSchema, HANDLE_MAX_LENGTH } from '../handle';

describe('HandleSchema', () => {
  it.each([
    ['a', 'single character'],
    ['marek', 'lowercase letters'],
    ['mediforce', 'longer handle'],
    ['team-1', 'with hyphen and digit'],
    ['a-b-c', 'multiple internal hyphens'],
    ['0abc', 'starting with digit'],
    ['abc0', 'ending with digit'],
  ])('accepts %s (%s)', (value) => {
    expect(() => HandleSchema.parse(value)).not.toThrow();
  });

  it.each([
    ['', 'empty'],
    ['-foo', 'leading hyphen'],
    ['foo-', 'trailing hyphen'],
    ['Foo', 'uppercase letter'],
    ['foo bar', 'space'],
    ['foo_bar', 'underscore'],
    ['foo.bar', 'dot'],
    ['foo/bar', 'slash'],
    ['foo@bar', 'at sign'],
  ])('rejects %s (%s)', (value) => {
    expect(() => HandleSchema.parse(value)).toThrow();
  });

  it('rejects handles longer than HANDLE_MAX_LENGTH', () => {
    const tooLong = 'a'.repeat(HANDLE_MAX_LENGTH + 1);
    expect(() => HandleSchema.parse(tooLong)).toThrow();
  });

  it('accepts handles exactly at HANDLE_MAX_LENGTH', () => {
    const atLimit = 'a'.repeat(HANDLE_MAX_LENGTH);
    expect(() => HandleSchema.parse(atLimit)).not.toThrow();
  });
});
