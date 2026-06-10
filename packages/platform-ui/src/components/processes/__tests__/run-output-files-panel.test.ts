import { describe, it, expect } from 'vitest';
import type { Step } from '@mediforce/platform-core';
import type { RunOutputFileEntry } from '@mediforce/platform-api/contract';
import { groupOutputFilesByStep } from '../run-output-files-panel';

function step(id: string, name: string): Step {
  return { id, name, type: 'creation' };
}

function file(stepId: string, name: string, size = 100): RunOutputFileEntry {
  return { stepId, name, path: `.mediforce/output/${stepId}/${name}`, size };
}

describe('groupOutputFilesByStep', () => {
  const definitionSteps = [
    step('intake', 'Intake'),
    step('analyze-data', 'Analyze Data'),
    step('report', 'Final Report'),
  ];

  it('returns no groups for an empty listing', () => {
    expect(groupOutputFilesByStep([], definitionSteps)).toEqual([]);
  });

  it('groups files by step in workflow definition order', () => {
    const grouped = groupOutputFilesByStep(
      [file('report', 'summary.pdf'), file('intake', 'manifest.json'), file('report', 'tables.csv')],
      definitionSteps,
    );
    expect(grouped.map((group) => group.stepId)).toEqual(['intake', 'report']);
    expect(grouped[1].files.map((entry) => entry.name)).toEqual(['summary.pdf', 'tables.csv']);
  });

  it('resolves group headers from the definition step name', () => {
    const grouped = groupOutputFilesByStep([file('analyze-data', 'stats.csv')], definitionSteps);
    expect(grouped[0].stepName).toBe('Analyze Data');
  });

  it('appends unknown step IDs after definition steps with a title-cased fallback name', () => {
    const grouped = groupOutputFilesByStep(
      [file('removed-step', 'orphan.txt'), file('intake', 'manifest.json')],
      definitionSteps,
    );
    expect(grouped.map((group) => group.stepId)).toEqual(['intake', 'removed-step']);
    expect(grouped[1].stepName).toBe('Removed Step');
  });

  it('sorts files within a group by name', () => {
    const grouped = groupOutputFilesByStep(
      [file('intake', 'zeta.csv'), file('intake', 'alpha.csv')],
      definitionSteps,
    );
    expect(grouped[0].files.map((entry) => entry.name)).toEqual(['alpha.csv', 'zeta.csv']);
  });
});
