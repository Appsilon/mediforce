import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OAuthProviderConfig } from '@mediforce/platform-core';

import { ProviderForm } from '../provider-form';

async function openAdvanced(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: /Advanced/i }));
}

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

  it('pre-fills GitHub App preset fields (advanced section reveals URLs/scopes)', async () => {
    const user = userEvent.setup();
    render(
      <ProviderForm
        provider={null}
        preset="github"
        onSubmit={vi.fn()}
      />,
    );

    expect((screen.getByLabelText(/^Id$/i) as HTMLInputElement).value).toBe('github');
    expect((screen.getByLabelText(/^Name$/i) as HTMLInputElement).value).toBe('GitHub');

    // URL/scope inputs are hidden until the advanced section is opened
    expect(screen.queryByLabelText(/^Authorize URL$/i)).toBeNull();

    await openAdvanced(user);

    // GitHub App preset starts with a placeholder authorize URL — the slug
    // field rewrites it on type.
    expect((screen.getByLabelText(/^Authorize URL$/i) as HTMLInputElement).value).toBe(
      'https://github.com/apps/your-app-slug/installations/new',
    );
    expect((screen.getByLabelText(/^Token URL$/i) as HTMLInputElement).value).toBe(
      'https://github.com/login/oauth/access_token',
    );
    expect((screen.getByLabelText(/^User info URL$/i) as HTMLInputElement).value).toBe(
      'https://api.github.com/user',
    );
    expect((screen.getByLabelText(/^Scopes$/i) as HTMLTextAreaElement).value).toBe('read:user');
  });

  it('renders the GitHub App setup guide and slug field for github preset', () => {
    render(
      <ProviderForm
        provider={null}
        preset="github"
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText(/Setting up a GitHub App/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^GitHub App slug$/i)).toBeInTheDocument();
  });

  it('synthesises Authorize URL from the GitHub App slug as the admin types', async () => {
    const user = userEvent.setup();
    render(
      <ProviderForm
        provider={null}
        preset="github"
        onSubmit={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText(/^GitHub App slug$/i), 'mediforce-staging');

    await openAdvanced(user);

    expect((screen.getByLabelText(/^Authorize URL$/i) as HTMLInputElement).value).toBe(
      'https://github.com/apps/mediforce-staging/installations/new',
    );
  });

  it('blocks submit when the App slug placeholder is left untouched', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <ProviderForm
        provider={null}
        preset="github"
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByLabelText(/^Client id$/i), 'cid');
    await user.type(screen.getByLabelText(/^Client secret$/i), 'csecret');
    await user.click(screen.getByRole('button', { name: /^Create$/i }));

    await waitFor(() => {
      expect(screen.getByText(/Fill in your GitHub App slug/i)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('pre-fills Google preset fields including revokeUrl', async () => {
    const user = userEvent.setup();
    render(
      <ProviderForm
        provider={null}
        preset="google"
        onSubmit={vi.fn()}
      />,
    );

    expect((screen.getByLabelText(/^Id$/i) as HTMLInputElement).value).toBe('google');
    expect((screen.getByLabelText(/^Name$/i) as HTMLInputElement).value).toBe('Google');

    await openAdvanced(user);

    expect((screen.getByLabelText(/^Revoke URL$/i) as HTMLInputElement).value).toBe(
      'https://oauth2.googleapis.com/revoke',
    );
    expect((screen.getByLabelText(/^Scopes$/i) as HTMLTextAreaElement).value).toBe(
      'openid email profile',
    );
  });

  it('hides advanced section by default in preset mode and shows it on demand', async () => {
    const user = userEvent.setup();
    render(
      <ProviderForm
        provider={null}
        preset="github"
        onSubmit={vi.fn()}
      />,
    );

    // Visible from the start
    expect(screen.getByLabelText(/^Id$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Client id$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Client secret$/i)).toBeInTheDocument();

    // Hidden behind the toggle
    expect(screen.queryByLabelText(/^Authorize URL$/i)).toBeNull();
    expect(screen.queryByLabelText(/^Token URL$/i)).toBeNull();
    expect(screen.queryByLabelText(/^Scopes$/i)).toBeNull();

    const toggle = screen.getByRole('button', { name: /Advanced/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    await user.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText(/^Authorize URL$/i)).toBeInTheDocument();
  });

  it('opens advanced section by default for custom create and edit modes', () => {
    const { unmount } = render(
      <ProviderForm
        provider={null}
        preset={null}
        onSubmit={vi.fn()}
      />,
    );

    // Custom create — advanced open
    expect(screen.getByLabelText(/^Authorize URL$/i)).toBeInTheDocument();
    unmount();

    // Edit mode (provider set, preset null) — advanced open
    render(
      <ProviderForm
        provider={makeProvider({ id: 'acme', name: 'Acme' })}
        preset={null}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/^Authorize URL$/i)).toBeInTheDocument();
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

  it('submits a GitHub App preset payload with synthesised authorizeUrl', async () => {
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
    await user.type(screen.getByLabelText(/^GitHub App slug$/i), 'mediforce-prod');
    await user.click(screen.getByRole('button', { name: /^Create$/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const payload = onSubmit.mock.calls[0][0];
    expect(payload.id).toBe('github');
    expect(payload.name).toBe('GitHub');
    expect(payload.clientId).toBe('test-client-id');
    expect(payload.clientSecret).toBe('test-secret');
    expect(payload.authorizeUrl).toBe(
      'https://github.com/apps/mediforce-prod/installations/new',
    );
    expect(payload.scopes).toEqual(['read:user']);
    expect(payload.revokeUrl).toBeUndefined();
    expect(payload.iconUrl).toBe('https://github.githubassets.com/favicons/favicon.svg');
    expect(payload.appSlug).toBeUndefined();
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

    await user.type(screen.getByLabelText(/^GitHub App slug$/i), 'demo-app');
    await openAdvanced(user);
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

    // Clear scopes to trigger min-length failure (slug filled to isolate the
    // scope-validation path from the App-slug placeholder check).
    await user.type(screen.getByLabelText(/^GitHub App slug$/i), 'demo-app');
    await openAdvanced(user);
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
