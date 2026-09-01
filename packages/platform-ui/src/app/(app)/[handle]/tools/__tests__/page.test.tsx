import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listToolCatalogMock = vi.fn();
const apiFetchMock = vi.fn();

vi.mock('@/lib/mediforce', () => ({
  mediforce: {
    toolCatalog: {
      list: (...args: unknown[]) => listToolCatalogMock(...args),
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
});
