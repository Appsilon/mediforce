import type { WorkflowStep } from '../schemas/workflow-definition';

/**
 * Build fields as they appear on either executor flavour. Derived from the step
 * schema rather than restated, so a field added there cannot silently go
 * missing here.
 */
export type StepContainerConfig = NonNullable<WorkflowStep['script'] | WorkflowStep['agent']>;

export function stepContainerConfig(step: WorkflowStep): Partial<StepContainerConfig> {
  return step.script ?? step.agent ?? {};
}

/**
 * Hosts a workflow's repository may be cloned from.
 *
 * A clone that carries `repoAuth` sends that secret to the host as basic auth,
 * so an unrestricted host is a way to read a secret you are only allowed to
 * write: point `repo` at a machine you own and collect the token. Deployments
 * that host their own forge extend this through `MEDIFORCE_REPO_HOSTS`.
 */
export const DEFAULT_REPO_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org'] as const;

export function allowedRepoHosts(configured?: string): string[] {
  const extra = (configured ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host !== '');
  return [...DEFAULT_REPO_HOSTS, ...extra];
}

/** The host a repository reference resolves to, or null for a shorthand like `org/repo`. */
export function repoHost(repoRef: string): string | null {
  const ssh = /^git@([^:]+):/.exec(repoRef);
  if (ssh !== null) return ssh[1].toLowerCase();
  if (repoRef.includes('://')) {
    try {
      return new URL(repoRef).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  // `org/repo` shorthand is normalised to GitHub by `normalizeRepoUrls`.
  return /^[\w.-]+\/[\w.-]+$/.test(repoRef) ? 'github.com' : null;
}
