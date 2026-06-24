import {
  RegisterWorkflowInputSchema,
  type ImportWorkflowInput,
  type ImportWorkflowOutput,
} from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';
import { ValidationError, HandlerError } from '../../errors';
import { buildRawUrl, resolveCommitSha } from './_github';
import { registerWorkflow } from './register-workflow';

export async function importWorkflow(
  input: ImportWorkflowInput,
  scope: CallerScope,
): Promise<ImportWorkflowOutput> {
  // Resolve the requested ref to an immutable SHA first, then fetch the file at
  // that SHA — this pins the imported content to the commit we record, so a
  // moving branch can't desync the file from its provenance.
  const commit = await resolveCommitSha(input.repo, input.ref ?? 'main');
  const rawUrl = buildRawUrl(input.repo, commit, input.path);

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

  // Parse through the same schema `workflow register` uses: it strips the
  // server-managed `namespace` / `version` / `createdAt` keys, so a file that
  // declares a `namespace` imports cleanly (the import target wins) instead of
  // being rejected — keeping import and register behaviourally identical.
  const parsed = RegisterWorkflowInputSchema.safeParse(json);
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
      source: { url: input.repo, path: input.path, commit },
    },
    scope,
  );
}
