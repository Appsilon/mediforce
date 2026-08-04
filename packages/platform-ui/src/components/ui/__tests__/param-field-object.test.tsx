import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ParamField } from '../param-field';

describe('ParamField object type', () => {
  it('renders a textarea instead of a single-line text input', () => {
    render(
      <ParamField
        param={{ name: 'body', type: 'object' }}
        value=""
        onChange={vi.fn()}
      />,
    );

    expect(document.querySelector('textarea')).not.toBeNull();
    expect(document.querySelector('input[type="text"]')).toBeNull();
  });

  it('shows an object value as pretty-printed JSON', () => {
    render(
      <ParamField
        param={{ name: 'body', type: 'object', default: { patient: { id: 'P-1' } } }}
        value={{ patient: { id: 'P-1' } }}
        onChange={vi.fn()}
      />,
    );

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe(JSON.stringify({ patient: { id: 'P-1' } }, null, 2));
  });

  it('passes the raw textarea text through onChange', () => {
    const onChange = vi.fn();
    render(
      <ParamField
        param={{ name: 'body', type: 'object' }}
        value=""
        onChange={onChange}
      />,
    );

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '{"a": 1}' } });
    expect(onChange).toHaveBeenCalledWith('{"a": 1}');
  });

  it('hints that the text is not a JSON object while it does not parse', () => {
    const { container } = render(
      <ParamField
        param={{ name: 'body', type: 'object' }}
        value={'{"a": '}
        onChange={vi.fn()}
      />,
    );

    expect(container.textContent).toContain('Must be a JSON object');
  });

  it('hints for a JSON array — the payload validator rejects non-object bodies', () => {
    const { container } = render(
      <ParamField
        param={{ name: 'body', type: 'object' }}
        value="[1, 2]"
        onChange={vi.fn()}
      />,
    );

    expect(container.textContent).toContain('Must be a JSON object');
  });

  it('shows no hint for empty text or valid JSON objects', () => {
    const { container: empty } = render(
      <ParamField param={{ name: 'body', type: 'object' }} value="" onChange={vi.fn()} />,
    );
    expect(empty.textContent).not.toContain('Must be a JSON object');

    const { container: valid } = render(
      <ParamField param={{ name: 'body', type: 'object' }} value='{"a": 1}' onChange={vi.fn()} />,
    );
    expect(valid.textContent).not.toContain('Must be a JSON object');
  });
});
