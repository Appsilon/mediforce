import { z } from 'zod';
import { WORKFLOW_ASSISTANT_PLATFORM_TOOLS, type WorkflowAssistantPlatformToolName } from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import { runPlatformTool as runAssistantPlatformTool } from '../../../assistant-core';
import { createAgent } from '../../agents/create-agent';
import { createToolCatalogEntry } from '../../tool-catalog/create-entry';
import { createTrigger } from '../../triggers/manage-triggers';
import { listNamespaceMembers } from '../../users/list-members';

/**
 * Runs one of the workflow assistant's platform tools as the person who asked;
 * validation and refusal-as-result come from the shared assistant core.
 */
export async function runPlatformTool(
  toolName: string,
  rawArguments: unknown,
  scope: CallerScope,
  namespace: string,
  // The saved workflow the canvas is a version of.
  workflowName?: string,
): Promise<unknown> {
  return runAssistantPlatformTool({
    toolName,
    rawArguments,
    tools: WORKFLOW_ASSISTANT_PLATFORM_TOOLS,
    execute: (name, args) => executeWorkflowPlatformTool(name, args, scope, namespace, workflowName),
  });
}

async function executeWorkflowPlatformTool(
  toolName: WorkflowAssistantPlatformToolName,
  args: unknown,
  scope: CallerScope,
  namespace: string,
  workflowName: string | undefined,
): Promise<unknown> {
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
        agents: agents.map((agent) => {
          // The MCP servers each agent is bound to, named by what a binding points at: a catalog id for stdio, the URL for http.
          const bindings = Object.entries(agent.mcpServers ?? {}).map(
            ([name, binding]) => [name, binding.type === 'stdio' ? binding.catalogId : binding.url] as const,
          );
          return {
            id: agent.id,
            name: agent.name,
            description: agent.description,
            foundationModel: agent.foundationModel,
            ...(bindings.length === 0 ? {} : { mcpServers: Object.fromEntries(bindings) }),
          };
        }),
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
      const input = args as z.infer<typeof WORKFLOW_ASSISTANT_PLATFORM_TOOLS['create_agent']>;
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
    case 'list_roles': {
      // Read from the roster rather than a role table: a role exists in this workspace exactly when somebody has been granted it.
      const { members } = await listNamespaceMembers({ namespace }, scope);
      const holders = new Map<string, number>();
      for (const member of members) {
        for (const grant of member.grants) {
          holders.set(grant.role, (holders.get(grant.role) ?? 0) + 1);
        }
      }
      return {
        roles: [...holders.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([role, heldBy]) => ({ role, heldBy })),
      };
    }
    case 'create_cron_trigger': {
      const input = args as z.infer<typeof WORKFLOW_ASSISTANT_PLATFORM_TOOLS['create_cron_trigger']>;
      if (workflowName === undefined) {
        // A trigger attaches to a registered workflow, and this canvas has never been saved.
        return {
          error: 'A schedule attaches to a saved workflow, and this one has never been saved. Tell them plainly: the schedule cannot be attached yet and will not take effect until the workflow is saved at least once, and you will add it as soon as they save.',
          needsSave: true,
        };
      }
      const { trigger } = await createTrigger({
        namespace,
        definitionName: workflowName,
        triggerName: input.name ?? 'schedule',
        type: 'cron',
        schedule: input.schedule,
        enabled: true,
        ...(input.payload === undefined ? {} : { payload: input.payload }),
      }, scope);
      return { created: { name: trigger.name, schedule: input.schedule } };
    }
    case 'create_tool_catalog_entry': {
      const input = args as z.infer<typeof WORKFLOW_ASSISTANT_PLATFORM_TOOLS['create_tool_catalog_entry']>;
      const { entry } = await createToolCatalogEntry({ ...input, namespace }, scope);
      return { created: { id: entry.id } };
    }
  }
}
