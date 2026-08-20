import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { API_ERROR_EVENT } from '@/lib/api-error-events';

const toastMock = vi.fn();

vi.mock('../command-palette/toast-provider', () => ({
  useToast: () => ({ toast: toastMock }),
}));

const { ApiErrorToastListener } = await import('../api-error-toast-listener');

describe('ApiErrorToastListener', () => {
  it('turns a forbidden response into human-readable feedback', () => {
    render(<ApiErrorToastListener />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(API_ERROR_EVENT, {
          detail: { status: 403, message: 'Forbidden' },
        }),
      );
    });

    expect(toastMock).toHaveBeenCalledWith({
      title: 'Access denied',
      description: 'You do not have permission to do that in this workspace.',
      variant: 'error',
    });
  });
});
