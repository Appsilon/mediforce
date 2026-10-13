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
  // step naming one of them is pointed at the imported copy whatever namespace
  // the file wrote, so a package imports into any workspace.
  const workflowPath = [source.pathPrefix, input.path].filter(Boolean).join('/');
  const skillsDir = packageSkillsDir(workflowPath);
  const folders = await readSkillFolders({ repo: source.repo, commit: source.commit, dir: skillsDir }, scope);
  const skills = await upsertSkills(
    input.namespace,
    folders,
    `Skill imported with workflow ${source.repo}@${source.commit} (${workflowPath})`,
    scope,
  );
  const shipped = new Set(skills.map((skill) => skill.id));
  const steps = parsed.data.steps.map((step) => {
    if (step.agent?.skills === undefined) return step;
    const refs = step.agent.skills.map((ref) => (shipped.has(ref.id) ? { namespace: input.namespace, id: ref.id } : ref));
    return { ...step, agent: { ...step.agent, skills: refs } };
  });

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
