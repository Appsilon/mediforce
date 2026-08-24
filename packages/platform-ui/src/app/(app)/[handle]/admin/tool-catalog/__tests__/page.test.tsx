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

vi.mock('next/navigation', () => ({
  useParams: () => ({ handle: 'acme' }),
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import AdminToolCatalogPage from '../page';

beforeEach(() => {
  listToolCatalogMock.mockResolvedValue({ entries: [] });
  apiFetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ agents: [] }),
  });
});

describe('AdminToolCatalogPage', () => {
  it('renders one New catalog entry button when the catalog is empty', async () => {
    render(<AdminToolCatalogPage />);

    expect(await screen.findByText('No catalog entries yet.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New catalog entry' })).toHaveLength(1);
  });

  it('explains what a catalog entry is before offering to create one', async () => {
    render(<AdminToolCatalogPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'What is a catalog entry?' }));

    expect(
      await screen.findByText(/A catalog entry is a stdio MCP server you have approved for/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/cannot spell out a command of their own/),
    ).toBeInTheDocument();
  });
});
