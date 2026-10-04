import { describe, expect, it } from 'vitest';
import { citationParts, citedEntries } from '../judge-citations';

describe('judge citations', () => {
  const log = new Set([3, 6, 7, 8, 9, 10, 11, 12, 13, 17]);

  /** The text with each linked entry as `<n>`, so a case reads as the page shows it. */
  function linked(text: string): string {
    return citationParts(text, log).map((part) => ('text' in part ? part.text : `<${part.seq}>`)).join('');
  }

  it('splits a judge\'s text into text and the log entries it cites', () => {
    expect(citationParts('Grade 5 is in [3] but [7] omits it.', log)).toEqual([
      { text: 'Grade 5 is in [' }, { seq: 3 }, { text: '] but [' }, { seq: 7 }, { text: '] omits it.' },
    ]);
  });

  it('links every entry a citation names, in each form judges write it', () => {
    expect(linked('attempts [7, 13, 17].')).toBe('attempts [<7>, <13>, <17>].');
    expect(linked('looked up [7][8]')).toBe('looked up [<7>][<8>]');
    expect(linked('[entries 3, 10]')).toBe('[entries <3>, <10>]');
    expect(linked('[log entries 8-11]')).toBe('[log entries <8>-<11>]');
    expect(linked('(log entry [6]')).toBe('(log entry [<6>]');
    expect(linked('[log entry 7, 12]')).toBe('[log entry <7>, <12>]');
    expect(linked('[Entries 7 and 8]')).toBe('[Entries <7> and <8>]');
  });

  it('keeps brackets that are no citation, and numbers that name no log entry, as text', () => {
    expect(linked('findings[0] is empty; see [42].')).toBe('findings[0] is empty; see [42].');
    expect(linked('see [7, 42]')).toBe('see [<7>, 42]');
    expect(linked('Grade 2 [10-30% BSA], ALT [3x ULN]')).toBe('Grade 2 [10-30% BSA], ALT [3x ULN]');
  });

  it('lists every cited entry, a range\'s every entry included, and none for no text', () => {
    expect(citedEntries('[3], then [7] and [entries 3, 13] and [log entries 8-11]')).toEqual([3, 7, 3, 13, 8, 9, 10, 11]);
    expect(citedEntries(null)).toEqual([]);
  });
});
