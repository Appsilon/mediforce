import type { AgentMcpBindingMap, ImageCommandCheck, StepMcpRestriction, ToolCatalogEntry } from '@mediforce/platform-core';

export interface McpServerCommand {
  /** The binding's name on the agent. */
  server: string;
  command: string;
}

export interface MissingCommandWarning {
  command: string;
  servers: string[];
}

/** What each stdio binding runs inside the step's image. An http binding runs
 *  nothing there, and one whose catalog entry is not loaded is skipped — a
 *  warning needs the command, and guessing one would be a false claim. A server
 *  the step's restrictions remove — disabled, or left with no allowed tool —
 *  is never started, so it is skipped too (as `resolveEffectiveMcp` does). */
export function stdioServerCommands(
  bindings: AgentMcpBindingMap,
  catalog: readonly ToolCatalogEntry[],
  restrictions: StepMcpRestriction = {},
): McpServerCommand[] {
  const commands: McpServerCommand[] = [];
  for (const [server, binding] of Object.entries(bindings)) {
    if (binding.type !== 'stdio') continue;
    const restriction = restrictions[server];
    if (restriction?.disable === true) continue;
    if (binding.allowedTools !== undefined) {
      const denied = new Set(restriction?.denyTools ?? []);
      if (binding.allowedTools.every((tool) => denied.has(tool))) continue;
    }
    const entry = catalog.find((candidate) => candidate.id === binding.catalogId);
    if (entry === undefined) continue;
    commands.push({ server, command: entry.command });
  }
  return commands;
}

/** One warning per command the image is known to lack. Unknown and unanswered
 *  never warn: nobody could answer, which is not the answer no (ADR-0022). */
export function missingCommandWarnings(
  servers: readonly McpServerCommand[],
  checks: Readonly<Record<string, ImageCommandCheck | undefined>>,
): MissingCommandWarning[] {
  const byCommand = new Map<string, string[]>();
  for (const { server, command } of servers) {
    const check = checks[command];
    if (check?.status !== 'known' || check.available === true) continue;
    byCommand.set(command, [...(byCommand.get(command) ?? []), server]);
  }
  return [...byCommand].map(([command, serverNames]) => ({ command, servers: serverNames }));
}
