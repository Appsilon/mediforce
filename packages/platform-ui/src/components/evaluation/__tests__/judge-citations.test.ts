import { describe, expect, it } from 'vitest';
import { citationParts, citedEntries } from '../judge-citations';

describe('judge citations', () => {
  const log = new Set([3, 7]);

  it('splits a judge\'s text into text and the log entries it cites', () => {
    expect(citationParts('Grade 5 is in [3] but [7] omits it.', log)).toEqual([
      { text: 'Grade 5 is in ' }, { seq: 3 }, { text: ' but ' }, { seq: 7 }, { text: ' omits it.' },
    ]);
  });

  it('keeps an `[n]` that names no log entry as text', () => {
    expect(citationParts('findings[0] is empty; see [42].', log)).toEqual([{ text: 'findings[0] is empty; see [42].' }]);
  });

  it('lists every cited entry, and none for no text', () => {
    expect(citedEntries('[3], then [7] and [3] again')).toEqual([3, 7, 3]);
    expect(citedEntries(null)).toEqual([]);
  });
});
