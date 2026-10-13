import { skillManifest } from '@mediforce/platform-core';
import {
  RegisterWorkflowInputSchema,
  type ImportWorkflowInput,
  type ImportWorkflowOutput,
} from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';
import { ValidationError } from '../../errors';
import { normalizeRepoDir, readSkillFolders, upsertSkills } from '../skills/import-skills';
import { buildRawUrl, fetchJsonOrThrow, resolveGitHubSource } from './_github';
import { registerWorkflow } from './register-workflow';
import { validateWorkflow } from './validate-workflow';

/** Where a package keeps its Skills: `skills/` in the package folder, which is
 *  the folder of the `.wd.json`, or its parent when that is `src/` (the
 *  canonical `<workflow>/src/<workflow>.wd.json` layout). */
export function packageSkillsDir(workflowPath: string): string {
  const folder = workflowPath.split('/').slice(0, -1);
  const packageFolder = folder.at(-1) === 'src' ? folder.slice(0, -1) : folder;
  return normalizeRepoDir([...packageFolder, 'skills'].join('/'));
}

export async function importWorkflow(
  input: ImportWorkflowInput,
  scope: CallerScope,
): Promise<ImportWorkflowOutput> {
  // Resolve the requested ref to an immutable SHA first, then fetch the file at
  // that SHA — this pins the imported content to the commit we record, so a
  // moving branch can't desync the file from its provenance.
  const source = await resolveGitHubSource(input.repo, input.ref);
  const rawUrl = buildRawUrl(source.repo, source.commit, input.path, source.pathPrefix);

  const json = await fetchJsonOrThrow(rawUrl, 'workflow definition');

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

  // The package's Skills become the importing workspace's before the workflow
  // is registered, since registering checks that every step Skill exists. A
  // step naming one of them in the file's own namespace (or in none, when the
  // file declares none) is pointed at the imported copy, so a package imports
  // into any workspace; a reference to another namespace is left alone.
  const workflowPath = [source.pathPrefix, input.path].filter(Boolean).join('/');
  const folders = await readSkillFolders(
    { repo: source.repo, commit: source.commit, dir: packageSkillsDir(workflowPath) },
    scope,
  );
  const shipped = new Set(folders.map((files) => skillManifest(files).name));
  const fileNamespace = typeof (json as { namespace?: unknown }).namespace === 'string'
    ? (json as { namespace: string }).namespace
    : undefined;
  const steps = parsed.data.steps.map((step) => {
    if (step.agent?.skills === undefined) return step;
    const refs = step.agent.skills.map((ref) =>
      shipped.has(ref.id) && (fileNamespace === undefined || ref.namespace === fileNamespace)
        ? { namespace: input.namespace, id: ref.id }
        : ref);
    return { ...step, agent: { ...step.agent, skills: refs } };
  });

  // Everything registration checks without the Skills is checked before one is
  // written, so a definition that cannot register leaves the workspace as it was.
  const checked = await validateWorkflow({ ...parsed.data, steps }, scope);
  if (checked.valid === false) {
    throw new ValidationError(checked.errors.map((error) => error.message).join(', '), checked.errors);
  }
  const skills = await upsertSkills(
    input.namespace,
    folders,
    `Skill imported with workflow ${source.repo}@${source.commit} (${workflowPath})`,
    scope,
  );

  const registered = await registerWorkflow(
    {
      ...parsed.data,
      steps,
      namespace: input.namespace,
      // Provenance is recorded against the canonical repo and a repo-root-relative
      // path, so `url` + `path` + `commit` locates the file forever — the tree URL
      // the user pasted carries a mutable ref and a directory its `path` is
      // relative to, neither of which survives the branch moving.
      source: {
        url: source.repo,
        path: workflowPath,
        commit: source.commit,
      },
    },
    scope,
  );
  return skills.length === 0 ? registered : { ...registered, skills };
}
