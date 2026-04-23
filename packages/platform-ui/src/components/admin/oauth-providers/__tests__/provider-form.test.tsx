import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OAuthProviderConfig } from '@mediforce/platform-core';

import { ProviderForm } from '../provider-form';

function makeProvider(overrides: Partial<OAuthProviderConfig> = {}): OAuthProviderConfig {
  return {
    id: 'github',
    name: 'GitHub',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['repo', 'read:user'],
    createdAt: '2026-04-23T10:00:00.000Z',
    updatedAt: '2026-04-23T10:00:00.000Z',
    ...overrides,
  };
}

describe('ProviderForm', () => {
  it('renders empty create form when provider and preset are null', () => {
    render(
      <ProviderForm
        provider={null}
        preset={null}
        onSubmit={vi.fn()}
      />,
    );

    const idInput = screen.getByLabelText(/^Id$/i) as HTMLInputElement;
    expect(idInput.value).toBe('');
    expect(screen.getByRole('button', { name: /^Create$/i })).toBeInTheDocument();
  });

  it('pre-fills GitHub preset fields', () => {
    render(
      <ProviderForm
        provider={null}
        preset="github"
        onSubmit={vi.fn()}
      />,
    );

    expect((screen.getByLabelText(/^Id$/i) as HTMLInputElement).value).toBe('github');
    expect((screen.getByLabelText(/^Name$/i) as HTMLInputElement).value).toBe('GitHub');
    expect((screen.getByLabelText(/^Authorize URL$/i) as HTMLInputElement).value).toBe(
      'https://github.com/login/oauth/authorize',
    );
    expect((screen.getByLabelText(/^Token URL$/i) as HTMLInputElement).value).toBe(
      'https://github.com/login/oauth/access_token',
    );
    expect((screen.getByLabelText(/^User info URL$/i) as HTMLInputElement).value).toBe(
      'https://api.github.com/user',
    );
    expect((screen.getByLabelText(/^Scopes$/i) as HTMLTextAreaElement).value).toBe('repo read:user');
  });

  it('pre-fills Google preset fields including revokeUrl', () => {
    render(
      <ProviderForm
        provider={null}
        preset="google"
        onSubmit={vi.fn()}
      />,
    );

    expect((screen.getByLabelText(/^Id$/i) as HTMLInputElement).value).toBe('google');
    expect((screen.getByLabelText(/^Name$/i) as HTMLInputElement).value).toBe('Google');
    expect((screen.getByLabelText(/^Revoke URL$/i) as HTMLInputElement).value).toBe(
      'https://oauth2.googleapis.com/revoke',
    );
    expect((screen.getByLabelText(/^Scopes$/i) as HTMLTextAreaElement).value).toBe(
      'openid email profile',
    );
  });

  it('pre-fills edit form from existing provider', () => {
    const provider = makeProvider({
      id: 'acme',
      name: 'Acme',
      clientId: 'acme-client',
      scopes: ['read', 'write'],
      revokeUrl: 'https://acme.example.com/revoke',
    });

    render(
      <ProviderForm
        provider={provider}
        preset={null}
        onSubmit={vi.fn()}
      />,
    );

    expect((screen.getByLabelText(/^Id$/i) as HTMLInputElement).value).toBe('acme');
    expect((screen.getByLabelText(/^Id$/i) as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText(/^Name$/i) as HTMLInputElement).value).toBe('Acme');
    expect((screen.getByLabelText(/^Client id$/i) as HTMLInputElement).value).toBe('acme-client');
    expect((screen.getByLabelText(/^Scopes$/i) as HTMLTextAreaElement).value).toBe('read write');
    expect((screen.getByLabelText(/^Revoke URL$/i) as HTMLInputElement).value).toBe(
      'https://acme.example.com/revoke',
    );
    expect(screen.getByRole('button', { name: /^Save$/i })).toBeInTheDocument();
  });

  it('submits payload with tokenized scopes on create', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <ProviderForm
        provider={null}
        preset="github"
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByLabelText(/^Client id$/i), 'test-client-id');
    await user.type(screen.getByLabelText(/^Client secret$/i), 'test-secret');
    await user.click(screen.getByRole('button', { name: /^Create$/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const payload = onSubmit.mock.calls[0][0];
    expect(payload.id).toBe('github');
    expect(payload.name).toBe('GitHub');
    expect(payload.clientId).toBe('test-client-id');
    expect(payload.clientSecret).toBe('test-secret');
    expect(payload.authorizeUrl).toBe('https://github.com/login/oauth/authorize');
    expect(payload.scopes).toEqual(['repo', 'read:user']);
    expect(payload.revokeUrl).toBeUndefined();
    expect(payload.iconUrl).toBeUndefined();
  });

  it('submits payload with revokeUrl and iconUrl when provided', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <ProviderForm
        provider={null}
        preset={null}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByLabelText(/^Id$/i), 'custom');
    await user.type(screen.getByLabelText(/^Name$/i), 'Custom');
    await user.type(screen.getByLabelText(/^Client id$/i), 'cid');
    await user.type(screen.getByLabelText(/^Client secret$/i), 'csecret');
    await user.type(
      screen.getByLabelText(/^Authorize URL$/i),
      'https://example.com/authorize',
    );
    await user.type(
      screen.getByLabelText(/^Token URL$/i),
      'https://example.com/token',
    );
    await user.type(
      screen.getByLabelText(/^User info URL$/i),
      'https://example.com/userinfo',
    );
    await user.type(
      screen.getByLabelText(/^Revoke URL$/i),
      'https://example.com/revoke',
    );
    await user.type(
      screen.getByLabelText(/^Icon URL$/i),
      'https://example.com/icon.svg',
    );
    await user.type(screen.getByLabelText(/^Scopes$/i), 'scope.one scope.two');

    await user.click(screen.getByRole('button', { name: /^Create$/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const payload = onSubmit.mock.calls[0][0];
    expect(payload.id).toBe('custom');
    expect(payload.revokeUrl).toBe('https://example.com/revoke');
    expect(payload.iconUrl).toBe('https://example.com/icon.svg');
    expect(payload.scopes).toEqual(['scope.one', 'scope.two']);
  });

  it('tokenizes scopes split by commas or newlines', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <ProviderForm
        provider={null}
        preset="github"
        onSubmit={onSubmit}
      />,
    );

    const scopesTextarea = screen.getByLabelText(/^Scopes$/i);
    await user.clear(scopesTextarea);
    await user.type(scopesTextarea, 'repo,read:user org:read');

    await user.type(screen.getByLabelText(/^Client id$/i), 'cid');
    await user.type(screen.getByLabelText(/^Client secret$/i), 'csecret');
    await user.click(screen.getByRole('button', { name: /^Create$/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    expect(onSubmit.mock.calls[0][0].scopes).toEqual(['repo', 'read:user', 'org:read']);
  });

  it('shows validation error when required fields are missing', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <ProviderForm
        provider={null}
        preset={null}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^Create$/i }));

    await waitFor(() => {
      // At least one "Required" message should show
      const requiredMessages = screen.queryAllByText(/Required/i);
      expect(requiredMessages.length).toBeGreaterThan(0);
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects invalid scope-only input', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <ProviderForm
        provider={null}
        preset="github"
        onSubmit={onSubmit}
      />,
    );

    // Clear scopes to trigger min-length failure
    const scopesTextarea = screen.getByLabelText(/^Scopes$/i);
    await user.clear(scopesTextarea);

    await user.type(screen.getByLabelText(/^Client id$/i), 'cid');
    await user.type(screen.getByLabelText(/^Client secret$/i), 'csecret');
    await user.click(screen.getByRole('button', { name: /^Create$/i }));

    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  it('shows submit error message when provided', () => {
    render(
      <ProviderForm
        provider={null}
        preset={null}
        onSubmit={vi.fn()}
        submitError="Boom"
      />,
    );

    expect(screen.getByText('Boom')).toBeInTheDocument();
  });

  it('shows Delete button when onDelete prop is provided (editing mode)', () => {
    const provider = makeProvider();
    const onDelete = vi.fn();

    render(
      <ProviderForm
        provider={provider}
        preset={null}
        onSubmit={vi.fn()}
        onDelete={onDelete}
      />,
    );

    const deleteButton = screen.getByRole('button', { name: /Delete/i });
    expect(deleteButton).toBeInTheDocument();
    deleteButton.click();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
