import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/lib/mediforce', () => ({ mediforce: { tasks: { complete: vi.fn() } } }));
vi.mock('@/hooks/use-handle-from-path', () => ({ useHandleFromPath: () => 'test-ns' }));

import { SelectionForm } from '../selection-form';

const submit = () => screen.getByRole('button', { name: 'Submit revision request' }) as HTMLButtonElement;

describe('SelectionForm revise comment', () => {
  it('needs a comment by default', () => {
    render(<SelectionForm taskId="t1" options={[{ name: 'a' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    expect(submit().disabled).toBe(true);
  });

  it('submits without one when the step does not require it', () => {
    render(<SelectionForm taskId="t1" options={[{ name: 'a' }]} reviseRequiresComment={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    expect(submit().disabled).toBe(false);
  });
});
