import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownContent } from '../agent-output-display';

const DUPLICATE_KEY_PATTERN = /Encountered two children with the same key/;

describe('MarkdownContent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders mixed blocks without React duplicate-key warnings', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const content = [
      '# Heading One',
      '',
      'A paragraph of text.',
      '',
      '- list item one',
      '- list item two',
      '',
      '| col a | col b |',
      '| --- | --- |',
      '| v1   | v2   |',
      '',
      '---',
      '',
      'Another paragraph.',
    ].join('\n');

    render(<MarkdownContent content={content} />);

    const duplicateKeyCalls = consoleError.mock.calls.filter((args) =>
      args.some((arg) => typeof arg === 'string' && DUPLICATE_KEY_PATTERN.test(arg)),
    );
    expect(duplicateKeyCalls).toEqual([]);
  });

  it('handles paragraph immediately followed by heading (same line index) without key collisions', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Adjacent blocks that, with the old `key={index}`-after-increment scheme,
    // both ended up emitting `key={2}` for distinct elements.
    const content = ['paragraph', '## Heading', 'paragraph again', '## Another'].join('\n');

    render(<MarkdownContent content={content} />);

    const duplicateKeyCalls = consoleError.mock.calls.filter((args) =>
      args.some((arg) => typeof arg === 'string' && DUPLICATE_KEY_PATTERN.test(arg)),
    );
    expect(duplicateKeyCalls).toEqual([]);
  });
});
