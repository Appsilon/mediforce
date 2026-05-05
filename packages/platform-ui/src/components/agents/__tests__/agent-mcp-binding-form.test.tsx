import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OAuthProviderConfig } from '@mediforce/platform-core';

const githubProvider: OAuthProviderConfig = {
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
};

vi.mock('@/lib/oauth-admin-client', () => ({
  listOAuthProviders: vi.fn(async () => [githubProvider]),
}));

import { AgentMcpBindingForm } from '../agent-mcp-binding-form';

describe('AgentMcpBindingForm — github-mcp preset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pre-fills name, transport, URL, and OAuth provider for GitHub MCP preset', async () => {
    render(
      <AgentMcpBindingForm
        existing={null}
        existingNames={[]}
        catalogEntries={[]}
        agentId="agent-1"
        namespace="appsilon"
        preset="github-mcp"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Server name input — selected by its placeholder which is unique on the form
    const nameInput = screen.getByPlaceholderText('filesystem') as HTMLInputElement;
    expect(nameInput.value).toBe('github');

    // HTTP transport selected by preset (selected by value to avoid label-text collisions)
    const transportRadios = screen.getAllByRole('radio');
    const httpRadio = transportRadios.find(
      (r) => (r as HTMLInputElement).value === 'http',
    ) as HTMLInputElement;
    expect(httpRadio.checked).toBe(true);

    const urlInput = screen.getByPlaceholderText(/api.example.com\/mcp/i) as HTMLInputElement;
    expect(urlInput.value).toBe('https://api.githubcopilot.com/mcp/');

    // OAuth auth mode selected
    const oauthAuthRadio = transportRadios.find(
      (r) => (r as HTMLInputElement).value === 'oauth',
    ) as HTMLInputElement;
    expect(oauthAuthRadio.checked).toBe(true);

    // Wait for providers to load and verify github is selected
    await waitFor(() => {
      const providerSelect = screen.getByLabelText(/OAuth provider/i) as HTMLSelectElement;
      expect(providerSelect.value).toBe('github');
    });
  });

  it('submits a github-mcp preset binding with HTTP + OAuth (provider=github)', async () => {
    const onSubmit = vi.fn(async () => {});
    const user = userEvent.setup();

    render(
      <AgentMcpBindingForm
        existing={null}
        existingNames={[]}
        catalogEntries={[]}
        agentId="agent-1"
        namespace="appsilon"
        preset="github-mcp"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    // Wait for the OAuth provider list to load before submitting,
    // otherwise the selected provider value is empty.
    await waitFor(() => {
      const providerSelect = screen.getByLabelText(/OAuth provider/i) as HTMLSelectElement;
      expect(providerSelect.value).toBe('github');
    });

    await user.click(screen.getByRole('button', { name: /Create binding/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const [name, binding] = onSubmit.mock.calls[0];
    expect(name).toBe('github');
    expect(binding).toEqual({
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      auth: {
        type: 'oauth',
        provider: 'github',
        headerName: 'Authorization',
        headerValueTemplate: 'Bearer {token}',
      },
    });
  });

  it('lets the user switch to PAT (static headers) instead of OAuth', async () => {
    const onSubmit = vi.fn(async () => {});
    const user = userEvent.setup();

    render(
      <AgentMcpBindingForm
        existing={null}
        existingNames={[]}
        catalogEntries={[]}
        agentId="agent-1"
        namespace="appsilon"
        preset="github-mcp"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    // Switch from OAuth → static headers (PAT path). Pick the radio by value
    // since "OAuth" / "Static headers" labels can collide with other text.
    const allRadios = screen.getAllByRole('radio');
    const headersRadio = allRadios.find(
      (r) => (r as HTMLInputElement).value === 'headers',
    ) as HTMLInputElement;
    await user.click(headersRadio);

    // Add a header carrying the GITHUB_TOKEN secret template.
    // userEvent treats { as keyboard syntax; doubled-up braces produce a literal {.
    await user.click(screen.getByRole('button', { name: /Add header/i }));
    await user.type(screen.getByLabelText(/Header key 1/i), 'Authorization');
    // user-event treats { as keyboard syntax; doubled-up `{{` produces a literal `{`.
    // `}` has no escape semantics, so type it once for each `}` we want.
    await user.type(
      screen.getByLabelText(/Header value 1/i),
      'Bearer {{{{SECRET:GITHUB_TOKEN}}',
    );

    await user.click(screen.getByRole('button', { name: /Create binding/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const [name, binding] = onSubmit.mock.calls[0];
    expect(name).toBe('github');
    expect(binding).toEqual({
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      auth: {
        type: 'headers',
        headers: { Authorization: 'Bearer {{SECRET:GITHUB_TOKEN}}' },
      },
    });
  });
});
