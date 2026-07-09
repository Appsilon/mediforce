import { describe, it, expect } from 'vitest';
import { printKv } from '../output';
import { captureOutput } from './test-helpers';

describe('printKv', () => {
  it('pads labels to the max label width across rows', () => {
    const output = captureOutput();
    printKv(output, [
      ['status', 'claimed'],
      ['assignedUser', 'alice'],
    ]);
    expect(output.stdoutLines).toEqual([
      '  status:        claimed',
      '  assignedUser:  alice',
    ]);
  });

  it('renders null as the nullDisplay (default `(none)`)', () => {
    const output = captureOutput();
    printKv(output, [
      ['status', 'cancelled'],
      ['reason', null],
    ]);
    expect(output.stdoutLines).toEqual([
      '  status:  cancelled',
      '  reason:  (none)',
    ]);
  });

  it('skips undefined rows unless nullDisplay is set', () => {
    const skipping = captureOutput();
    printKv(skipping, [
      ['status', 'done'],
      ['completed', undefined],
    ]);
    expect(skipping.stdoutLines).toEqual(['  status:  done']);

    const showing = captureOutput();
    printKv(showing, [
      ['status', 'done'],
      ['completed', undefined],
    ], { nullDisplay: '(missing)' });
    expect(showing.stdoutLines).toEqual([
      '  status:     done',
      '  completed:  (missing)',
    ]);
  });
});
