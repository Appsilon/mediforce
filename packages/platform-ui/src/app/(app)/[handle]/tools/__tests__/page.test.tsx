import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listToolCatalogMock = vi.fn();
const apiFetchMock = vi.fn();
const deleteToolCatalogMock = vi.fn();

vi.mock('@/lib/mediforce', () => ({
  mediforce: {
    toolCatalog: {
      list: (...args: unknown[]) => listToolCatalogMock(...args),
      delete: (...args: unknown[]) => deleteToolCatalogMock(...args),
    },
  },
}));

vi.mock('@/lib/api-fetch', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

vi.mock('@/hooks/use-namespace-role', () => ({
  useNamespaceRole: () => ({ role: 'owner', canAdmin: true, loading: false }),
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, loading: false }),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ handle: 'acme' }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import ToolsPage from '../page';

beforeEach(() => {
  listToolCatalogMock.mockResolvedValue({ entries: [] });
  apiFetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ agents: [] }),
  });
});

describe('ToolsPage', () => {
  it('explains what a tool is before offering to configure one', async () => {
    render(<ToolsPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'What is a tool?' }));

    expect(
      await screen.findByText(/A tool is an MCP server/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/a workflow step can narrow that set further — never/),
    ).toBeInTheDocument();
  });

  it('offers Add MCP and Add OAuth provider, and no catalog management or agent binding shortcuts', async () => {
    render(<ToolsPage />);

    expect(await screen.findByRole('link', { name: /Add MCP/ })).toHaveAttribute(
      'href',
      '/acme/admin/tool-catalog?from=tools&new=1',
    );
    expect(screen.getByRole('link', { name: /Add OAuth provider/ })).toHaveAttribute(
      'href',
      '/acme/admin/oauth-providers?from=tools&new=1',
    );
    expect(screen.queryByText('Manage catalog')).not.toBeInTheDocument();
    expect(screen.queryByText('Bind to an agent')).not.toBeInTheDocument();
  });

  it('edits and removes a catalog MCP server from its card', async () => {
    listToolCatalogMock.mockResolvedValue({
      entries: [{ id: 'filesystem', command: 'npx', args: [] }],
    });
    deleteToolCatalogMock.mockResolvedValue(undefined);
    render(<ToolsPage />);

    expect(await screen.findByRole('link', { name: /Edit/ })).toHaveAttribute(
      'href',
      '/acme/admin/tool-catalog?from=tools&id=filesystem',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove filesystem' }));
    await userEvent.click(await screen.findByRole('button', { name: /^Delete/ }));

    expect(deleteToolCatalogMock).toHaveBeenCalledWith({ namespace: 'acme', id: 'filesystem' });
  });
});
