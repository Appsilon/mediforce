import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { render as renderDom, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SkillSummary } from '@mediforce/platform-core';

const list = vi.fn();
vi.mock('@/lib/mediforce', () => ({ mediforce: { skills: { list: (input: unknown) => list(input) } } }));

import { StepSkillsField } from '../step-skills-field';

const summary = (namespace: string, id: string, visibility: 'public' | 'private'): SkillSummary => ({
  namespace,
  id,
  name: id,
  description: `${id} description`,
  visibility,
  contentHash: 'hash',
  paths: ['SKILL.md'],
  size: 64,
  createdAt: '2026-10-06T00:00:00Z',
  updatedAt: '2026-10-06T00:00:00Z',
});

const render = (ui: ReactElement) =>
  renderDom(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const addOptions = () =>
  Array.from((screen.getByLabelText('Add skill') as HTMLSelectElement).options).map((option) => option.value).filter(Boolean);

describe('StepSkillsField', () => {
  beforeEach(() => {
    list.mockResolvedValue({
      skills: [
        summary('alpha', 'sdtm-mapping', 'private'),
        summary('alpha', 'define-xml', 'private'),
        summary('beta', 'meddra-coding', 'public'),
      ],
    });
  });

  it("shows the agent's skills as inherited, and offers the rest of the workflow's reach to add", async () => {
    render(
      <StepSkillsField
        namespace="alpha"
        workflowVisibility="private"
        agentName="Mapper"
        agentSkills={[{ namespace: 'alpha', id: 'sdtm-mapping' }]}
        selected={[]}
        onChange={() => {}}
      />,
    );
    await screen.findByRole('option', { name: /define-xml/ });
    expect(screen.getByText('sdtm-mapping')).toBeTruthy();
    expect(screen.getByText(/from Mapper/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove skill alpha/sdtm-mapping' })).toBeNull();
    expect(addOptions()).toEqual(['alpha/define-xml', 'beta/meddra-coding']);
  });

  it('adds a picked skill and removes an added one', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <StepSkillsField namespace="alpha" workflowVisibility="private" agentSkills={[]} selected={[]} onChange={onChange} />,
    );
    await screen.findByLabelText('Add skill');
    await screen.findByRole('option', { name: /define-xml/ });
    fireEvent.change(screen.getByLabelText('Add skill'), { target: { value: 'alpha/define-xml' } });
    expect(onChange).toHaveBeenLastCalledWith([{ namespace: 'alpha', id: 'define-xml' }]);

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <StepSkillsField
          namespace="alpha"
          workflowVisibility="private"
          agentSkills={[]}
          selected={[{ namespace: 'alpha', id: 'define-xml' }]}
          onChange={onChange}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Remove skill alpha/define-xml' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('offers a public workflow only public skills', async () => {
    render(<StepSkillsField namespace="alpha" workflowVisibility="public" agentSkills={[]} selected={[]} onChange={() => {}} />);
    await screen.findByRole('option', { name: /meddra-coding/ });
    expect(addOptions()).toEqual(['beta/meddra-coding']);
  });
});
