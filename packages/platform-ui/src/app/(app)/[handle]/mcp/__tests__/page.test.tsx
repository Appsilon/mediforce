import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listToolCatalogMock = vi.fn();
const listAgentsMock = vi.fn();
const createToolCatalogMock = vi.fn();
const updateToolCatalogMock = vi.fn();
const deleteToolCatalogMock = vi.fn();
const routerReplaceMock = vi.fn();
let searchParams = new URLSearchParams();
let canAdmin = true;

vi.mock('@/lib/mediforce', () => ({
  mediforce: {
    agents: { list: (...args: unknown[]) => listAgentsMock(...args) },
    toolCatalog: {
      list: (...args: unknown[]) => listToolCatalogMock(...args),
      create: (...args: unknown[]) => createToolCatalogMock(...args),
      update: (...args: unknown[]) => updateToolCatalogMock(...args),
      delete: (...args: unknown[]) => deleteToolCatalogMock(...args),
    },
    oauthProviders: { list: () => Promise.resolve({ providers: [] }) },
    imageCatalog: { checkCommand: () => Promise.resolve({ status: 'unknown' }) },
  },
}));

vi.mock('@/hooks/use-namespace-role', () => ({
  useNamespaceRole: () => ({ role: canAdmin ? 'owner' : 'member', canAdmin, loading: false }),
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, loading: false }),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ handle: 'acme' }),
  useRouter: () => ({ replace: routerReplaceMock, push: vi.fn() }),
  useSearchParams: () => searchParams,
}));

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

vi.mock('@/components/admin/tool-catalog/command-availability', () => ({
  CommandAvailability: () => null,
}));

import McpPage from '../page';

const githubEntry = {
  id: 'github',
  type: 'http',
  url: 'https://api.githubcopilot.com/mcp/',
  auth: { type: 'headers', headers: { Authorization: 'Bearer {{SECRET:gh}}' } },
};
const filesystemEntry = { id: 'filesystem', type: 'stdio', command: 'npx', args: ['-y', 'fs-mcp'] };

beforeEach(() => {
  vi.clearAllMocks();
  searchParams = new URLSearchParams();
  canAdmin = true;
  listToolCatalogMock.mockResolvedValue({ entries: [] });
  listAgentsMock.mockResolvedValue({ agents: [] });
});

describe('McpPage', () => {
  it('explains what an MCP server is', async () => {
    render(<McpPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'What is an MCP server?' }));

    expect(await screen.findByText(/An MCP server is an external tool host/)).toBeInTheDocument();
    expect(screen.getByText(/a workflow step can narrow that set further — never/)).toBeInTheDocument();
  });

  it('lists stdio and HTTP servers from the catalog, with how many agents use each', async () => {
    listToolCatalogMock.mockResolvedValue({ entries: [filesystemEntry, githubEntry] });
    listAgentsMock.mockResolvedValue({
      agents: [{ id: 'a1', name: 'Reviewer', mcpServers: { gh: { type: 'http', catalogId: 'github' } } }],
    });
    render(<McpPage />);

    const githubCard = await screen.findByRole('button', { name: 'Edit github' });
    expect(within(githubCard).getByText('api.githubcopilot.com')).toBeInTheDocument();
    expect(within(githubCard).getByText('Used by 1 agent')).toBeInTheDocument();
    expect(within(githubCard).getByText('Secrets required')).toBeInTheDocument();
    expect(screen.getByText('HTTP servers')).toBeInTheDocument();
    expect(screen.getByText('Stdio servers')).toBeInTheDocument();
  });

  it('opens the edit dialog through the URL when a card is clicked', async () => {
    listToolCatalogMock.mockResolvedValue({ entries: [githubEntry] });
    render(<McpPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Edit github' }));

    expect(routerReplaceMock).toHaveBeenCalledWith('/acme/mcp?id=github');
  });

  it('edits an HTTP server in a dialog and shows the agents using it', async () => {
    searchParams = new URLSearchParams('id=github');
    listToolCatalogMock.mockResolvedValue({ entries: [githubEntry] });
    listAgentsMock.mockResolvedValue({
      agents: [{ id: 'a1', name: 'Reviewer', mcpServers: { gh: { type: 'http', catalogId: 'github', allowedTools: ['search'] } } }],
    });
    updateToolCatalogMock.mockResolvedValue({ entry: githubEntry });
    render(<McpPage />);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Reviewer')).toBeInTheDocument();
    const url = within(dialog).getByLabelText('URL');
    await userEvent.clear(url);
    await userEvent.type(url, 'https://example.com/mcp');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(updateToolCatalogMock).toHaveBeenCalledWith({
      namespace: 'acme',
      id: 'github',
      auth: { type: 'headers', headers: { Authorization: 'Bearer {{SECRET:gh}}' } },
      description: null,
      url: 'https://example.com/mcp',
    });
    expect(routerReplaceMock).toHaveBeenCalledWith('/acme/mcp');
  });

  it('warns that an edit changes the server for every agent using it', async () => {
    searchParams = new URLSearchParams('id=github');
    listToolCatalogMock.mockResolvedValue({ entries: [githubEntry] });
    listAgentsMock.mockResolvedValue({
      agents: [
        { id: 'a1', name: 'Reviewer', mcpServers: { gh: { type: 'http', catalogId: 'github' } } },
        { id: 'a2', name: 'Writer', mcpServers: { github: { type: 'http', catalogId: 'github' } } },
      ],
    });
    render(<McpPage />);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Saving changes this server for every agent that uses it (2).')).toBeInTheDocument();
  });

  it('says when the server in the URL does not exist', async () => {
    searchParams = new URLSearchParams('id=gone');
    listToolCatalogMock.mockResolvedValue({ entries: [githubEntry] });
    render(<McpPage />);

    expect(await screen.findByText('MCP server “gone” not found in @acme.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lets a member add an HTTP server with the transport switch', async () => {
    canAdmin = false;
    searchParams = new URLSearchParams('new=1');
    createToolCatalogMock.mockResolvedValue({ entry: githubEntry });
    render(<McpPage />);

    expect(screen.queryByRole('link', { name: /Add OAuth provider/ })).not.toBeInTheDocument();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'HTTP' }));
    await userEvent.type(within(dialog).getByLabelText('Id'), 'github');
    await userEvent.type(within(dialog).getByLabelText('URL'), 'https://api.githubcopilot.com/mcp/');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(createToolCatalogMock).toHaveBeenCalledWith({
      namespace: 'acme',
      id: 'github',
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
    });
  });

  it('returns to settings when opened from there, keeping that through the dialog', async () => {
    searchParams = new URLSearchParams('from=settings');
    listToolCatalogMock.mockResolvedValue({ entries: [githubEntry] });
    render(<McpPage />);

    expect(await screen.findByRole('link', { name: 'Back' })).toHaveAttribute('href', '/acme/settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit github' }));
    expect(routerReplaceMock).toHaveBeenCalledWith('/acme/mcp?id=github&from=settings');
  });

  it('has no back arrow when reached from the sidebar', async () => {
    render(<McpPage />);

    await screen.findByText(/No MCP servers configured yet/);
    expect(screen.queryByRole('link', { name: 'Back' })).not.toBeInTheDocument();
  });

  it('opens the add dialog from the Add MCP button', async () => {
    render(<McpPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Add MCP/ }));

    expect(routerReplaceMock).toHaveBeenCalledWith('/acme/mcp?new=1');
  });

  it('deletes a server from its edit dialog', async () => {
    searchParams = new URLSearchParams('id=filesystem');
    listToolCatalogMock.mockResolvedValue({ entries: [filesystemEntry] });
    deleteToolCatalogMock.mockResolvedValue({ success: true });
    render(<McpPage />);

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Delete/ }));
    const confirm = await screen.findAllByRole('button', { name: /^Delete/ });
    await userEvent.click(confirm[confirm.length - 1]!);

    expect(deleteToolCatalogMock).toHaveBeenCalledWith({ namespace: 'acme', id: 'filesystem' });
  });
});
