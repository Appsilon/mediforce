import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OriginalDefinitionPanel } from '../original-definition-panel';

const searchParams = vi.hoisted(() => ({ view: null as string | null }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => searchParams.view }),
}));

const original = {
  name: 'legacy-wf',
  steps: [{ id: 'a', agent: { skill: 'summarize', skillsDir: 'skills/' } }],
  externalSkillsRepo: { url: 'https://github.com/acme/skills.git', commit: 'abc' },
};

describe('OriginalDefinitionPanel', () => {
  it('is collapsed until asked, then shows the original JSON with its retired fields', () => {
    searchParams.view = null;
    render(<OriginalDefinitionPanel original={original} />);
    expect(screen.queryByTestId('original-definition-json')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /View original definition/ }));
    const json = screen.getByTestId('original-definition-json').textContent ?? '';
    expect(json).toContain('"skillsDir": "skills/"');
    expect(json).toContain('"externalSkillsRepo"');
  });

  it('opens straight away when linked with ?view=original', () => {
    searchParams.view = 'original';
    render(<OriginalDefinitionPanel original={original} />);
    expect(screen.getByTestId('original-definition-json')).toBeTruthy();
  });
});
