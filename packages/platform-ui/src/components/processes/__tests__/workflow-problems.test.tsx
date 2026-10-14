import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import { WorkflowProblems } from '../workflow-problems';

vi.mock('@/hooks/use-docker-images', () => ({
  useDockerImages: () => ({ images: [], isAvailable: false, isLoading: false }),
}));
vi.mock('@/hooks/use-namespace-role', () => ({
  useNamespaceRole: () => ({ canAdmin: true }),
}));
vi.mock('@/hooks/use-workflow-secret-keys', () => ({
  useWorkflowSecretKeysContext: () => null,
}));

describe('WorkflowProblems — retired file skills', () => {
  it('lists the step and links to the Skills page and the original definition', () => {
    const wd = buildWorkflowDefinition({ name: 'legacy-wf', namespace: 'acme', version: 2 });
    wd.steps[0].executor = 'agent';
    wd.steps[0].agent = { prompt: 'Go.', retiredFileSkill: 'skills/summarize' };
    wd.legacyDefinition = { steps: [] };

    render(<WorkflowProblems handle="acme" latestDocs={new Map([['legacy-wf', wd]])} loading={false} />);

    expect(screen.getByText(/workflow-file skill 'skills\/summarize'/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Import skills' }).getAttribute('href')).toBe('/acme/skills');
    expect(screen.getByRole('link', { name: 'View original definition' }).getAttribute('href'))
      .toBe('/acme/workflows/legacy-wf/definitions/2?view=original');
  });
});
