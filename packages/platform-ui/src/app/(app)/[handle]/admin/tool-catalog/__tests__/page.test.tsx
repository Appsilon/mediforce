import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

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
});
