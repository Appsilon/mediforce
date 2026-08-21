import type { AgentRun } from '@mediforce/platform-core';

const DOCKER_CHAIN_PREFIX = 'Docker container: ';
const LOCAL_CHAIN_ENTRY = 'Local execution (no Docker)';

/**
 * Whether a run executed inside Docker (and which image) isn't a persisted
 * field — it's recorded as a free-text `reasoning_chain` entry emitted by
 * BaseContainerAgentPlugin's result event (shared by claude-code-agent and
 * opencode-agent). "no data" covers everything that never went through that
 * code path (e.g. a reaped timeout, a custom plugin).
 */
export function formatAgentRunContainer(run: AgentRun): string {
  const chain = run.envelope?.reasoning_chain ?? [];
  const dockerEntry = chain.find((line) => line.startsWith(DOCKER_CHAIN_PREFIX));
  if (dockerEntry !== undefined) return dockerEntry.slice(DOCKER_CHAIN_PREFIX.length);
  if (chain.includes(LOCAL_CHAIN_ENTRY)) return 'No container (ran locally)';
  return 'no data';
}
