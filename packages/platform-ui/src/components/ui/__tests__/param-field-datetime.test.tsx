import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ParamField } from '../param-field';

describe('ParamField datetime type', () => {
  it('onChange emits a UTC ISO string representing the same instant as the entered local time', () => {
    const onChange = vi.fn();
    render(<ParamField param={{ name: 'scheduled_at', type: 'datetime' }} value="" onChange={onChange} />);

    const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-06-18T11:15' } });

    const emitted = onChange.mock.calls[0]?.[0] as string;
    // Must be a UTC ISO string (format check)
    expect(emitted).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // Semantic check: same instant as the local time the user entered.
    // new Date("...THH:MM") is spec-defined to parse as local time; comparing
    // epoch ms verifies the UTC conversion is correct in any timezone.
    const localInstant = new Date('2026-06-18T11:15');
    expect(new Date(emitted).getTime()).toBe(localInstant.getTime());
  });

  it('displays a stored UTC ISO string as the local equivalent (round-trip)', () => {
    const stored = '2026-06-18T09:00:00.000Z';
    render(<ParamField param={{ name: 'scheduled_at', type: 'datetime' }} value={stored} onChange={vi.fn()} />);

    const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    // The input value (no TZ) parsed as local time must represent the same instant
    // as the stored UTC string — timezone-agnostic round-trip assertion.
    expect(new Date(input.value).getTime()).toBe(new Date(stored).getTime());
  });

  it('emits an empty string when the input is cleared', () => {
    const onChange = vi.fn();
    render(
      <ParamField
        param={{ name: 'scheduled_at', type: 'datetime' }}
        value="2026-06-18T09:00:00.000Z"
        onChange={onChange}
      />,
    );

    const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('');
  });
});
