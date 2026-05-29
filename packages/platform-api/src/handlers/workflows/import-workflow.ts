import { githubRawBase, parseWorkflowTemplate } from '@mediforce/platform-core';
import type { ImportWorkflowInput, ImportWorkflowOutput } from '../../contract/workflows.js';
import type { CallerScope } from '../../repositories/index.js';
import { ValidationError } from '../../errors.js';
import { registerWorkflow } from './register-workflow.js';

interface ImportScopedInput extends ImportWorkflowInput {
  namespace: string;
}

export async function importWorkflow(
  input: ImportScopedInput,
  scope: CallerScope,
): Promise<ImportWorkflowOutput> {
  const rawBase = githubRawBase(input.repo, input.ref);
  if (rawBase === null) {
    throw new ValidationError(`Only GitHub URLs are supported. Got: ${input.repo}`);
  }

  const fileUrl = `${rawBase}/${input.path}`;
  let raw: unknown;
  try {
    const res = await fetch(fileUrl);
    if (!res.ok) {
      throw new ValidationError(`Failed to fetch workflow from ${fileUrl}: HTTP ${String(res.status)}`);
    }
    const rawJson = await res.json() as Record<string, unknown>;
    const { namespace: _ns, ...rawStripped } = rawJson;
    raw = rawStripped;
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError(`Failed to fetch workflow file: ${String(err)}`);
  }

  const parsed = parseWorkflowTemplate(raw);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((i) => i.message).join(', '),
      parsed.error.issues,
    );
  }

  const registered = await registerWorkflow(
    {
      ...parsed.data,
      namespace: input.namespace,
      source: { repo: input.repo, path: input.path, ref: input.ref },
    },
    scope,
  );

  return {
    success: true as const,
    name: registered.name,
    version: registered.version,
    source: { repo: input.repo, path: input.path, ref: input.ref },
  };
}
