import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DeleteProviderDialog } from '../delete-provider-dialog';

describe('DeleteProviderDialog', () => {
  it('renders title and description with provider id', () => {
    render(
      <DeleteProviderDialog
        providerId="github"
        providerName="GitHub"
        referenceCount={0}
        open={true}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText(/Delete OAuth provider/i)).toBeInTheDocument();
    expect(screen.getByText('github')).toBeInTheDocument();
    expect(screen.getByText(/GitHub/)).toBeInTheDocument();
  });

  it('does not render reference count warning when count is zero', () => {
    render(
      <DeleteProviderDialog
        providerId="github"
        providerName="GitHub"
        referenceCount={0}
        open={true}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.queryByText(/binding references/i)).not.toBeInTheDocument();
  });

  it('renders reference count warning when at least one binding references the provider', () => {
    render(
      <DeleteProviderDialog
        providerId="github"
        providerName="GitHub"
        referenceCount={3}
        open={true}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText(/3 agent bindings reference/i)).toBeInTheDocument();
  });

  it('uses singular form when referenceCount is exactly 1', () => {
    render(
      <DeleteProviderDialog
        providerId="github"
        providerName="GitHub"
        referenceCount={1}
        open={true}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText(/1 agent binding references/i)).toBeInTheDocument();
  });

  it('closes dialog BEFORE awaiting onConfirm (Radix deadlock rule)', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    let confirmResolve: ((value: void) => void) | null = null;
    const confirmPromise = new Promise<void>((resolve) => {
      confirmResolve = resolve;
    });
    const onConfirm = vi.fn().mockReturnValue(confirmPromise);

    render(
      <DeleteProviderDialog
        providerId="github"
        providerName="GitHub"
        referenceCount={0}
        open={true}
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^Delete$/i }));

    // Dialog should be closed BEFORE the confirm promise resolves.
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    confirmResolve!();
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });

  it('calls onOpenChange(false) when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <DeleteProviderDialog
        providerId="github"
        providerName="GitHub"
        referenceCount={0}
        open={true}
        onOpenChange={onOpenChange}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows error message when onConfirm throws', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockRejectedValue(new Error('Delete boom'));
    // After the dialog closes from handleConfirm, we keep it rendered with
    // open=true to observe the error. The dialog doesn't unmount itself —
    // that's handled by parent through onOpenChange. Here we mock parent as
    // no-op to keep the error visible inside the dialog for the test.
    const onOpenChange = vi.fn();

    render(
      <DeleteProviderDialog
        providerId="github"
        providerName="GitHub"
        referenceCount={0}
        open={true}
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^Delete$/i }));

    await waitFor(() => {
      expect(screen.getByText(/Delete boom/)).toBeInTheDocument();
    });
  });
});
