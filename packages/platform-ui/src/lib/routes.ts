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

export const routes = {
  // ── Top-level ──────────────────────────────────────────────────
  home: (handle: string) => `/${handle}`,

  // ── Workflows ──────────────────────────────────────────────────
  workflows: (handle: string) => `/${handle}/workflows`,
  workflow: (handle: string, name: string) => `/${handle}/workflows/${encode(name)}`,
  workflowDefinition: (handle: string, name: string, version: number | string) =>
    `/${handle}/workflows/${encode(name)}/definitions/${version}`,
  workflowRun: (handle: string, name: string, runId: string) =>
    `/${handle}/workflows/${encode(name)}/runs/${runId}`,
  workflowRunStep: (handle: string, name: string, runId: string, stepId: string) =>
    `/${handle}/workflows/${encode(name)}/runs/${runId}/steps/${stepId}`,
  workflowRunReport: (handle: string, name: string, runId: string) =>
    `/${handle}/workflows/${encode(name)}/runs/${runId}/report`,
  workflowNew: (handle: string) => `/${handle}/workflows/new`,

  // ── Runs ───────────────────────────────────────────────────────
  runs: (handle: string, params?: { workflow?: string }) => {
    const base = `/${handle}/runs`;
    if (params?.workflow) return `${base}?workflow=${encode(params.workflow)}`;
    return base;
  },

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
  tools: (handle: string) => `/${handle}/tools`,
  tool: (handle: string, toolId: string) => `/${handle}/tools/${encode(toolId)}`,

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

  // ── Orgs ───────────────────────────────────────────────────────
  orgs: () => '/orgs',
  orgNew: () => '/orgs/new',
} as const;
