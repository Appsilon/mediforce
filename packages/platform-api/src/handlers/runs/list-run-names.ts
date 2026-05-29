import type { RunNameEntry } from '@mediforce/platform-core';
import type { ListRunNamesInput } from '../../contract/runs';
import { listAdapter } from '../_generic';

/**
 * Projected `{ id, definitionName }` list for one workspace. Backs the UI run
 * label map (`useProcessNameMap`) — only those two fields, no full
 * `ProcessInstance`, so the workspace map stays cheap (issue #588).
 *
 * Namespace-gated by `scope.runs.listDefinitionNames`: system actors see every
 * run in the namespace, user callers see it only if they're a member
 * (out-of-scope → empty list, not an error).
 */
export const listRunNames = listAdapter<ListRunNamesInput, RunNameEntry, 'runs'>(
  'runs',
  async (input, scope) => scope.runs.listDefinitionNames(input.namespace),
);
