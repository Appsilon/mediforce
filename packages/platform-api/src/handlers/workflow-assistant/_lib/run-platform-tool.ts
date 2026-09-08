import { z } from 'zod';
import { WORKFLOW_ASSISTANT_PLATFORM_TOOLS, isPlatformToolName } from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import { HandlerError } from '../../../errors';
import { createAgent } from '../../agents/create-agent';
import { createToolCatalogEntry } from '../../tool-catalog/create-entry';

/**
 * Runs one platform tool for the assistant, as the person who asked.
 *
 * Everything here goes through `scope`, which is the caller's own authorization
 * — there is no service account and no elevated path. A refusal therefore comes
 * back as a *result*, not an exception: the turn continues and the model tells
 * the person that this needs an admin, which is the honest answer, rather than
 * the conversation dying or the assistant finding a way around the gate.
 */
export async function runPlatformTool(
  toolName: string,
  rawArguments: unknown,
  scope: CallerScope,
  namespace: string,
): Promise<unknown> {
  if (!isPlatformToolName(toolName)) {
    const valid = Object.keys(WORKFLOW_ASSISTANT_PLATFORM_TOOLS).join(', ');
    return { error: `Unknown tool '${toolName}'. Platform tools: ${valid}.` };
  }

  const schema: z.ZodType = WORKFLOW_ASSISTANT_PLATFORM_TOOLS[toolName];
  const parsed = schema.safeParse(rawArguments);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return { error: `Invalid arguments for '${toolName}': ${issues}` };
  }

  try {
    switch (toolName) {
      case 'list_secrets': {
        // Names only. A value in the conversation is a value handed to the
        // model, the provider and the transcript.
        const secrets = await scope.workspaceSecrets.getSecrets(namespace);
        return { keys: Object.keys(secrets).sort() };
      }
      case 'list_agents': {
        const agents = await scope.agentDefinitions.list(namespace);
        return {
          agents: agents.map((agent) => ({
            id: agent.id,
            name: agent.name,
            description: agent.description,
            foundationModel: agent.foundationModel,
          })),
        };
      }
      case 'list_tool_catalog': {
        const entries = await scope.toolCatalog.list(namespace);
        return {
          servers: entries.map((entry) => ({
            id: entry.id,
            ...(entry.description === undefined ? {} : { description: entry.description }),
          })),
        };
      }
      case 'create_agent': {
        const input = parsed.data as z.infer<typeof WORKFLOW_ASSISTANT_PLATFORM_TOOLS['create_agent']>;
        // Through the handler the Agents page uses, so an agent the assistant
        // made is validated the same way and lands in the audit trail the same
        // way — an agent that appeared from nowhere is worse than no agent.
        const { agent } = await createAgent({
          ...input,
          namespace,
          // The platform's own defaults, not the model's to choose: a container
          // agent, private to the workspace it was made in, with the icon the
          // Agents list falls back to.
          kind: 'plugin',
          visibility: 'private',
          iconName: 'bot',
        }, scope);
        return { created: { id: agent.id, name: agent.name } };
      }
      case 'create_tool_catalog_entry': {
        const input = parsed.data as z.infer<typeof WORKFLOW_ASSISTANT_PLATFORM_TOOLS['create_tool_catalog_entry']>;
        const { entry } = await createToolCatalogEntry({ ...input, namespace }, scope);
        return { created: { id: entry.id } };
      }
    }
  } catch (err) {
    if (err instanceof HandlerError && err.code === 'forbidden') {
      return { error: err.message, needsAdmin: true };
    }
    return { error: err instanceof Error ? err.message : 'The platform refused that.' };
  }
}
