import { readCommitFile } from '@mediforce/agent-runtime';
import type { EvalCaseInput, EvalCaseInputChange, WorkspaceFileChange } from '@mediforce/platform-core';
import { ValidationError } from '../../../errors';
import type { CaseSource } from './case-source';
import { resolveFileChanges } from './workspace-seed';

type Container = Record<string, unknown> | unknown[];

function isContainer(value: unknown): value is Container {
  return value !== null && typeof value === 'object';
}

function childOf(container: Container, key: string): unknown {
  if (Array.isArray(container)) return /^\d+$/.test(key) ? container[Number(key)] : undefined;
  return Object.hasOwn(container, key) ? container[key] : undefined;
}

/**
 * Applies input changes, in order, to a copy of a case input. A change whose
 * path runs through something that is not an object or array, or that removes
 * what is not there, is refused, naming the change.
 */
export function applyInputChanges(input: EvalCaseInput, changes: readonly EvalCaseInputChange[]): EvalCaseInput {
  const changed = structuredClone(input);
  for (const [index, change] of changes.entries()) {
    const where = `inputChanges[${index}] '${[change.part, ...change.path].join('.')}'`;
    if (change.part === 'previousRun' && changed.previousRun === undefined) changed.previousRun = {};
    let container: unknown = changed[change.part];
    for (const key of change.path.slice(0, -1)) {
      container = isContainer(container) ? childOf(container, key) : undefined;
    }
    if (isContainer(container) === false) throw new ValidationError(`${where}: its parent is not an object or array`);
    const last = change.path[change.path.length - 1]!;
    const isIndex = Array.isArray(container) && /^\d+$/.test(last);
    if (Array.isArray(container) && isIndex === false) throw new ValidationError(`${where}: '${last}' is not an array index`);

    if (change.op === 'set') {
      if (Array.isArray(container)) container[Number(last)] = change.value;
      else container[last] = change.value;
      continue;
    }
    if (childOf(container, last) === undefined) throw new ValidationError(`${where}: there is nothing there to remove`);
    if (Array.isArray(container)) container.splice(Number(last), 1);
    else delete container[last];
  }
  return changed;
}

/** The value an input change would address, or undefined when the path does not lead anywhere. */
export function inputValueAt(input: EvalCaseInput, part: EvalCaseInputChange['part'], path: readonly string[]): unknown {
  let value: unknown = input[part];
  for (const key of path) value = isContainer(value) ? childOf(value, key) : undefined;
  return value;
}

export interface PerturbedCase {
  readonly input: EvalCaseInput;
  /** The workspace the file changes apply to, and what each changed file ends up holding (null: deleted); null when no file changes. */
  readonly workspaceChange: {
    readonly bareRepoPath: string;
    readonly baseCommit: string;
    readonly contents: ReadonlyMap<string, string | null>;
  } | null;
}

/**
 * A production run's case input and workspace with a synthesized case's
 * changes applied — computed, not written, so the Evaluation Assistant's
 * proposal can be checked against the real run before a person sees it.
 */
export async function perturbCase(
  source: CaseSource,
  changes: { readonly inputChanges?: readonly EvalCaseInputChange[]; readonly fileChanges?: readonly WorkspaceFileChange[] },
): Promise<PerturbedCase> {
  const input = applyInputChanges(source.input, changes.inputChanges ?? []);
  const fileChanges = changes.fileChanges ?? [];
  if (fileChanges.length === 0) return { input, workspaceChange: null };
  const { bareRepoPath, workspaceSeedCommit } = source;
  if (bareRepoPath === null || workspaceSeedCommit === null) {
    throw new ValidationError(`Agent Run '${source.subject.agentRun.id}' has no workspace to change files in`);
  }
  const contents = await resolveFileChanges(
    (path) => readCommitFile(bareRepoPath, workspaceSeedCommit, path),
    fileChanges,
  );
  return { input, workspaceChange: { bareRepoPath, baseCommit: workspaceSeedCommit, contents } };
}
