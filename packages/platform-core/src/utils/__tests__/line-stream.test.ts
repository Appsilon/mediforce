import { describe, it, expect, vi } from 'vitest';
import { createLineStreamReader } from '../line-stream';

describe('createLineStreamReader', () => {
  it('[DATA] emits each complete line as it arrives', () => {
    const onLine = vi.fn();
    const reader = createLineStreamReader(onLine);

    reader.push('line one\nline two\n');

    expect(onLine).toHaveBeenCalledTimes(2);
    expect(onLine).toHaveBeenNthCalledWith(1, 'line one');
    expect(onLine).toHaveBeenNthCalledWith(2, 'line two');
  });

  it('[DATA] holds a partial trailing line until the next push', () => {
    const onLine = vi.fn();
    const reader = createLineStreamReader(onLine);

    reader.push('hello ');
    expect(onLine).not.toHaveBeenCalled();

    reader.push('world\n');
    expect(onLine).toHaveBeenCalledTimes(1);
    expect(onLine).toHaveBeenCalledWith('hello world');
  });

  it('[DATA] handles chunks that split a single line across pushes', () => {
    const onLine = vi.fn();
    const reader = createLineStreamReader(onLine);

    reader.push('one\ntw');
    reader.push('o\nthree\n');

    expect(onLine.mock.calls.map((c) => c[0])).toEqual(['one', 'two', 'three']);
  });

  it('[DATA] skips empty lines (consecutive newlines)', () => {
    const onLine = vi.fn();
    const reader = createLineStreamReader(onLine);

    reader.push('a\n\nb\n');

    expect(onLine.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
  });

  it('[DATA] flush emits a non-empty trailing partial line', () => {
    const onLine = vi.fn();
    const reader = createLineStreamReader(onLine);

    reader.push('done');
    reader.flush();

    expect(onLine).toHaveBeenCalledTimes(1);
    expect(onLine).toHaveBeenCalledWith('done');
  });

  it('[DATA] flush is a no-op when buffer is empty', () => {
    const onLine = vi.fn();
    const reader = createLineStreamReader(onLine);

    reader.push('x\n');
    onLine.mockClear();
    reader.flush();

    expect(onLine).not.toHaveBeenCalled();
  });

  it('[DATA] accepts Buffer input and decodes as UTF-8', () => {
    const onLine = vi.fn();
    const reader = createLineStreamReader(onLine);

    reader.push(Buffer.from('héllo\nwörld\n', 'utf-8'));

    expect(onLine.mock.calls.map((c) => c[0])).toEqual(['héllo', 'wörld']);
  });
});
