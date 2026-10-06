/**
 * Centralized route builder — the single source of truth for all app URLs.
 *
 * Inspired by Django's reverse() — every navigable route is constructed
 * through this module, so a missing namespace prefix is caught at the
 * call site, not at runtime in the browser.
 */

function encode(segment: string): string {
  return encodeURIComponent(segment);
}

/**
 * Admin pages are reachable from more than one section, so their entry point
 * travels in `?from=` and drives where the in-page back arrow returns to.
 */
export type AdminEntryPoint = 'tools' | 'settings';

type AdminPageParams = { from?: AdminEntryPoint; create?: boolean };

function withAdminParams(path: string, params: AdminPageParams | undefined): string {
  const query = new URLSearchParams();
  if (params?.from !== undefined) query.set('from', params.from);
  if (params?.create === true) query.set('new', '1');
  const qs = query.toString();
  return qs === '' ? path : `${path}?${qs}`;
}

export function adminBackHref(handle: string, from: string | null): string {
  return from === 'tools' ? routes.tools(handle) : routes.settings(handle);
}

export const routes = {
  // ── Top-level ──────────────────────────────────────────────────
  home: (handle: string) => `/${handle}`,

  // ── Workflows ──────────────────────────────────────────────────
  workflows: (handle: string) => `/${handle}/workflows`,
  /** Workspace home with the git importer already open — the authoring-paths
   *  popover offers import from pages that do not host the dialog. */
  importWorkflows: (handle: string) => `/${handle}?import=source`,
  workflow: (handle: string, name: string) => `/${handle}/workflows/${encode(name)}`,
  workflowDefinition: (handle: string, name: string, version: number | string) =>
    `/${handle}/workflows/${encode(name)}/definitions/${version}`,
  workflowRun: (handle: string, name: string, runId: string) =>
    `/${handle}/workflows/${encode(name)}/runs/${runId}`,
  workflowRunStep: (handle: string, name: string, runId: string, stepId: string) =>
    `/${handle}/workflows/${encode(name)}/runs/${runId}/steps/${stepId}`,
  workflowRunReport: (handle: string, name: string, runId: string) =>
    `/${handle}/workflows/${encode(name)}/runs/${runId}/report`,
  /** The Evaluation tab on one agent step of one workflow version. */
  workflowEvaluation: (handle: string, name: string, params: { version: number; step: string }) =>
    `/${handle}/workflows/${encode(name)}?tab=evaluation&version=${params.version}&step=${encode(params.step)}`,
  workflowEvalRun: (handle: string, name: string, evalRunId: string) =>
    `/${handle}/workflows/${encode(name)}/eval-runs/${evalRunId}`,
  workflowEvalTrial: (handle: string, name: string, evalRunId: string, trialId: string) =>
    `/${handle}/workflows/${encode(name)}/eval-runs/${evalRunId}/trials/${trialId}`,
  workflowNew: (handle: string) => `/${handle}/workflows/new`,

  // ── Runs ───────────────────────────────────────────────────────
  runs: (handle: string, params?: { workflow?: string }) => {
    const base = `/${handle}/runs`;
    if (params?.workflow) return `${base}?workflow=${encode(params.workflow)}`;
    return base;
  },

  // ── Co-work ────────────────────────────────────────────────────
  cowork: (handle: string, sessionId: string) => `/${handle}/cowork/${sessionId}`,

  // ── Tasks ──────────────────────────────────────────────────────
  tasks: (handle: string) => `/${handle}/tasks`,
  task: (handle: string, taskId: string) => `/${handle}/tasks/${taskId}`,

  // ── Agents ─────────────────────────────────────────────────────
  agents: (handle: string) => `/${handle}/agents`,
  agent: (handle: string, runId: string) => `/${handle}/agents/${runId}`,
  agentDefinition: (handle: string, definitionId: string) =>
    `/${handle}/agents/definitions/${definitionId}`,
  agentNew: (handle: string) => `/${handle}/agents/new`,

  // ── Configs ────────────────────────────────────────────────────
  configs: (handle: string) => `/${handle}/configs`,
  config: (handle: string, processName: string, configName: string, version: number | string) =>
    `/${handle}/configs/${encode(processName)}/${encode(configName)}/${version}`,
  configNew: (handle: string, params?: { process?: string; cloneConfig?: string; cloneVersion?: string }) => {
    const base = `/${handle}/configs/new`;
    const searchParams = new URLSearchParams();
    if (params?.process) searchParams.set('process', params.process);
    if (params?.cloneConfig) searchParams.set('cloneConfig', params.cloneConfig);
    if (params?.cloneVersion) searchParams.set('cloneVersion', params.cloneVersion);
    const qs = searchParams.toString();
    return qs ? `${base}?${qs}` : base;
  },

  // ── Tools ──────────────────────────────────────────────────────
  models: (handle: string) => `/${handle}/models`,
  tools: (handle: string) => `/${handle}/tools`,
  tool: (handle: string, toolId: string) => `/${handle}/tools/${encode(toolId)}`,

  // ── Skills ─────────────────────────────────────────────────────
  skills: (handle: string) => `/${handle}/skills`,
  skillNew: (handle: string) => `/${handle}/skills/new`,
  /** A Skill is keyed on its own workspace, which differs from `handle` for
   *  another workspace's public Skill. */
  skill: (handle: string, namespace: string, skillId: string) =>
    `/${handle}/skills/${encode(namespace)}/${encode(skillId)}`,

  // ── Images ─────────────────────────────────────────────────────
  images: (handle: string) => `/${handle}/images`,
  /** The Images view with one entry already open — how Infrastructure crosses
   *  from a raw daemon row to the entry that describes it. */
  image: (handle: string, entryId: string) => `/${handle}/images?entry=${encode(entryId)}`,

  // ── Catalog ────────────────────────────────────────────────────
  catalog: (handle: string) => `/${handle}/catalog`,

  // ── Processes (legacy) ─────────────────────────────────────────
  processes: (handle: string) => `/${handle}/processes`,

  // ── Monitoring ─────────────────────────────────────────────────
  monitoring: (handle: string) => `/${handle}/monitoring`,

  // ── Members ────────────────────────────────────────────────────
  members: (handle: string) => `/${handle}/members`,

  // ── Settings ───────────────────────────────────────────────────
  settings: (handle: string) => `/${handle}/settings`,

  // ── Admin ──────────────────────────────────────────────────────
  adminToolCatalog: (handle: string, params?: AdminPageParams) =>
    withAdminParams(`/${handle}/admin/tool-catalog`, params),
  adminOAuthProviders: (handle: string, params?: AdminPageParams) =>
    withAdminParams(`/${handle}/admin/oauth-providers`, params),
  adminInfrastructure: (handle: string) => `/${handle}/admin/infrastructure`,

  // ── Orgs ───────────────────────────────────────────────────────
  orgs: () => '/orgs',
  orgNew: () => '/orgs/new',
} as const;
