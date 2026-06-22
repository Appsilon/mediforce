import type { RunNameEntry } from '@mediforce/platform-core';
import type { ListRunNamesInput } from '../../contract/runs';
import { listAdapter } from '../_generic';

/**
 * Projected `{ id, definitionName }` list backing the UI run label map.
 * Namespace-gated via `scope.runs.listDefinitionNames` (out-of-scope → empty
 * list, not an error); see that interface method for the full rationale.
 */
export const listRunNames = listAdapter<ListRunNamesInput, RunNameEntry, 'runs'>('runs', async (input, scope) =>
  scope.runs.listDefinitionNames(input.namespace),
);
