import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listAgentsMock = vi.fn();

vi.mock('@/lib/mediforce', () => ({
  mediforce: { agents: { list: (...args: unknown[]) => listAgentsMock(...args) } },
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
  listAgentsMock.mockResolvedValue({ agents: [] });
});

describe('AgentsPage', () => {
  it('explains what an agent is before offering to create one', async () => {
    render(<AgentsPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'What is an agent?' }));

    expect(
      await screen.findByText(/An agent is a reusable configuration a workflow step calls by id/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/run uses the agent's foundation model unless the workflow step/),
    ).toBeInTheDocument();
  });

  it('requests only the agents of the workspace', async () => {
    render(<AgentsPage />);

    await screen.findByRole('button', { name: 'What is an agent?' });

    expect(listAgentsMock).toHaveBeenCalledWith({ namespace: 'acme' });
  });
});
