import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiFetchMock = vi.fn();

vi.mock('@/lib/api-fetch', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ handle: 'acme' }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import AgentsPage from '../page';

beforeEach(() => {
  apiFetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ agents: [] }),
  });
});

describe('AgentsPage', () => {
  it('explains what an agent is before offering to create one', async () => {
    render(<AgentsPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'What is an agent?' }));

    expect(
      await screen.findByText(/An agent is a reusable configuration a workflow step calls by id/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/model a run uses is chosen per step in the workflow definition/),
    ).toBeInTheDocument();
  });
});
