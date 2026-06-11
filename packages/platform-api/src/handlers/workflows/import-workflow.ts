import { parseWorkflowTemplate } from '@mediforce/platform-core';
import type { ImportWorkflowInput, ImportWorkflowOutput } from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';
import { ValidationError, HandlerError } from '../../errors';
import { buildRawUrl } from './_github';
import { registerWorkflow } from './register-workflow';

export async function importWorkflow(
  input: ImportWorkflowInput,
  scope: CallerScope,
): Promise<ImportWorkflowOutput> {
  const ref = input.ref ?? 'main';
  const rawUrl = buildRawUrl(input.repo, ref, input.path);

  let json: unknown;
  try {
    const res = await fetch(rawUrl);
    if (!res.ok) {
      throw new ValidationError(
        `Failed to fetch workflow definition: ${res.status} ${res.statusText} (${rawUrl})`,
      );
    }
    json = (await res.json()) as unknown;
  } catch (err) {
    if (err instanceof HandlerError) throw err;
    throw new ValidationError(`Failed to fetch workflow definition: ${String(err)}`);
  }

  const parsed = parseWorkflowTemplate(json);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((i) => i.message).join(', '),
      parsed.error.issues,
    );
  }

  return registerWorkflow(
    {
      ...parsed.data,
      namespace: input.namespace,
      source: { repo: input.repo, path: input.path, ref },
    },
    scope,
  );
}
