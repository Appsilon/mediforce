#!/usr/bin/env tsx
/**
 * Platform MCP server — exposes Mediforce platform utilities as MCP tools.
 *
 * Tools:
 *   render_workflow_diagram — HTML diagram from a WorkflowDefinition
 *   dry_run_workflow        — register definition + start a dry run
 *   get_run_status          — poll run status + step progress
 *   list_run_tasks          — pending human tasks for a run
 *   complete_task           — complete a human task with payload
 *   get_run_logs            — audit events + step executions
 *   list_models             — query the model registry
 *   list_docker_images      — available Docker images on the platform
 *   list_workflow_examples  — CI-tested workflow examples + anti-patterns
 *
 * API tools require APP_BASE_URL + PLATFORM_API_KEY env vars.
 * Runs via stdio transport.
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  renderWorkflowDiagram,
  RenderWorkflowDiagramInputSchema,
} from '@mediforce/platform-api/handlers';
import { Mediforce } from '@mediforce/platform-api/client';
import { loadWorkflowExamples } from '@mediforce/platform-core/workflow-examples';

const server = new McpServer({
  name: 'mediforce-mcp',
  version: '0.2.0',
});

// --- Lazy API client (only created when API tools are called) ---------------

let _client: Mediforce | undefined;

function getClient(): Mediforce {
  if (_client) return _client;
  const baseUrl = process.env.APP_BASE_URL;
  const apiKey = process.env.PLATFORM_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error(
      'mediforce-mcp: APP_BASE_URL and PLATFORM_API_KEY env vars are required for API tools.',
    );
  }
  _client = new Mediforce({ apiKey, baseUrl });
  return _client;
}

function mcpText(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function mcpJson(data: unknown) {
  return mcpText(JSON.stringify(data, null, 2));
}

// --- render_workflow_diagram ------------------------------------------------

const defSchema = RenderWorkflowDiagramInputSchema.shape.definition;

server.registerTool(
  'render_workflow_diagram',
  {
    description:
      'Render a WorkflowDefinition as an HTML diagram. Pass the full definition object ' +
      '(with steps, transitions, triggers). Returns HTML that can be used with update_presentation.',
    inputSchema: { definition: defSchema },
  },
  async (args) => {
    const parsed = RenderWorkflowDiagramInputSchema.parse(args);
    const html = renderWorkflowDiagram(parsed);
    return mcpText(html);
  },
);

// --- dry_run_workflow -------------------------------------------------------

server.registerTool(
  'dry_run_workflow',
  {
    description:
      'Register the current workflow definition and start a dry run. ' +
      'Returns the run ID for subsequent polling. ' +
      'Pass the complete WorkflowDefinition as `definition`, the `namespace` (workspace handle), and optional `triggerInput` for trigger payload.',
    inputSchema: {
      definition: z.record(z.string(), z.unknown()).describe(
        'Complete WorkflowDefinition object (name, version, steps, transitions, triggers)',
      ),
      namespace: z.string().optional().describe(
        'Workspace namespace/handle (auto-detected from session context if omitted)',
      ),
      triggerInput: z.record(z.string(), z.unknown()).optional().describe(
        'Optional trigger input payload (key-value pairs for triggerInput fields)',
      ),
    },
  },
  async (args) => {
    try {
      const client = getClient();
      const namespace = (args.namespace as string | undefined) ?? process.env.MEDIFORCE_NAMESPACE;
      if (!namespace) {
        return mcpText('Error: namespace not provided and MEDIFORCE_NAMESPACE env var not set.');
      }
      const definition = args.definition as Record<string, unknown>;
      const triggerInput = args.triggerInput as Record<string, unknown> | undefined;

      console.error(`[mediforce-mcp] dry_run_workflow: namespace=${namespace} baseUrl=${process.env.APP_BASE_URL} apiKey=${process.env.PLATFORM_API_KEY ? '***set***' : '***MISSING***'}`);
      const registered = await client.workflows.register(
        definition,
        { namespace },
      );
      console.error(`[mediforce-mcp] registered: ${registered.name} v${registered.version}`);

      const startResult = await client.runs.start({
        namespace,
        definitionName: registered.name,
        definitionVersion: registered.version,
        triggerName: 'manual',
        triggeredBy: 'workflow-designer-dry-run',
        payload: triggerInput,
        dryRun: true,
      });
      console.error(`[mediforce-mcp] dry run started: ${startResult.run.id}`);

      return mcpJson({
        runId: startResult.run.id,
        definitionName: registered.name,
        definitionVersion: registered.version,
        status: startResult.run.status,
        ...(registered.warnings?.length ? { warnings: registered.warnings } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const details = (err as { body?: unknown }).body ?? '';
      console.error(`[mediforce-mcp] dry_run_workflow FAILED: ${message}`, details);
      return mcpText(`Error starting dry run: ${message}`);
    }
  },
);

// --- get_run_status ---------------------------------------------------------

server.registerTool(
  'get_run_status',
  {
    description:
      'Get the current status of a run including per-step progress. ' +
      'Use this to poll a dry run after starting it.',
    inputSchema: {
      runId: z.string().min(1).describe('Run/instance ID'),
    },
  },
  async (args) => {
    try {
      const client = getClient();
      const runId = args.runId as string;

      const [run, stepsResult, tasksResult] = await Promise.all([
        client.runs.get({ runId }),
        client.processes.getSteps({ instanceId: runId }),
        client.tasks.list({ instanceId: runId }),
      ]);

      const steps = stepsResult.steps.map((s) => ({
        stepId: s.stepId,
        name: s.name,
        type: s.type,
        executorType: s.executorType,
        status: s.status,
        ...(s.execution?.error ? { error: s.execution.error } : {}),
        ...(s.execution?.startedAt && s.execution?.completedAt
          ? {
              durationSec: Math.round(
                (new Date(s.execution.completedAt).getTime() -
                  new Date(s.execution.startedAt).getTime()) /
                  1000,
              ),
            }
          : {}),
      }));

      const pendingTasks = tasksResult.tasks
        .filter((t) => t.status === 'pending' || t.status === 'claimed')
        .map((t) => ({
          taskId: t.id,
          stepId: t.stepId,
          role: t.assignedRole,
          status: t.status,
          params: t.params,
          verdicts: t.verdicts,
        }));

      return mcpJson({
        runId: run.runId,
        status: run.status,
        currentStepId: run.currentStepId,
        dryRun: run.dryRun,
        error: run.error,
        steps,
        pendingTasks,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return mcpText(`Error getting run status for '${args.runId}': ${message}`);
    }
  },
);

// --- list_run_tasks ---------------------------------------------------------

server.registerTool(
  'list_run_tasks',
  {
    description:
      'List pending human tasks for a run. Returns tasks that need completion ' +
      'to advance the run. Each task has an ID, step ID, role, and status.',
    inputSchema: {
      runId: z.string().min(1).describe('Run/instance ID'),
    },
  },
  async (args) => {
    try {
      const client = getClient();
      const result = await client.tasks.list({
        instanceId: args.runId as string,
      });

      const tasks = result.tasks
        .filter((t) => t.status === 'pending' || t.status === 'claimed')
        .map((t) => ({
          taskId: t.id,
          stepId: t.stepId,
          role: t.assignedRole,
          status: t.status,
          params: t.params,
          verdicts: t.verdicts,
        }));

      return mcpJson({ runId: args.runId, tasks });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return mcpText(`Error listing tasks for run '${args.runId}': ${message}`);
    }
  },
);

// --- complete_task ----------------------------------------------------------

server.registerTool(
  'complete_task',
  {
    description:
      'Complete a human task with a JSON payload. The payload must match the task type. ' +
      'Common payload shapes: ' +
      '{"kind":"params","paramValues":{...}} for form steps, ' +
      '{"kind":"verdict","verdict":"approve"} for review steps, ' +
      '{"kind":"verdict-with-params","verdict":"approve","paramValues":{...}} for review+form steps.',
    inputSchema: {
      taskId: z.string().min(1).describe('Task ID to complete (UUID from list_run_tasks)'),
      payload: z.record(z.string(), z.unknown()).describe(
        'Task completion payload (must include "kind" field)',
      ),
    },
  },
  async (args) => {
    try {
      const client = getClient();
      const result = await client.tasks.complete({
        taskId: args.taskId as string,
        payload: args.payload as Parameters<typeof client.tasks.complete>[0]['payload'],
      });

      return mcpJson({
        taskId: result.task.id,
        taskStatus: result.task.status,
        runId: result.run.id,
        runStatus: result.run.status,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return mcpText(`Error completing task '${args.taskId}': ${message}`);
    }
  },
);

// --- get_run_logs -----------------------------------------------------------

server.registerTool(
  'get_run_logs',
  {
    description:
      'Get audit events and step execution details for a run. ' +
      'Use after a dry run completes or fails to analyze what happened.',
    inputSchema: {
      runId: z.string().min(1).describe('Run/instance ID'),
    },
  },
  async (args) => {
    try {
      const client = getClient();
      const runId = args.runId as string;

      const [auditResult, stepsResult] = await Promise.all([
        client.processes.listAuditEvents({ instanceId: runId }),
        client.processes.getSteps({ instanceId: runId }),
      ]);

      const steps = stepsResult.steps.map((s) => ({
        stepId: s.stepId,
        name: s.name,
        type: s.type,
        executorType: s.executorType,
        status: s.status,
        input: s.input,
        output: s.output,
        ...(s.execution
          ? {
              execution: {
                status: s.execution.status,
                error: s.execution.error,
                startedAt: s.execution.startedAt,
                completedAt: s.execution.completedAt,
                verdict: s.execution.verdict,
              },
            }
          : {}),
      }));

      const events = auditResult.events.map((e) => ({
        timestamp: e.timestamp,
        action: e.action,
        description: e.description,
      }));

      return mcpJson({
        runId,
        instanceStatus: stepsResult.instanceStatus,
        instanceError: stepsResult.instanceError ?? null,
        currentStepId: stepsResult.currentStepId,
        steps,
        auditEvents: events,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return mcpText(`Error getting logs for run '${args.runId}': ${message}`);
    }
  },
);

// --- list_models ------------------------------------------------------------

server.registerTool(
  'list_models',
  {
    description:
      'List available models in the Mediforce model registry. ' +
      'Use this to find valid model IDs for agent steps (e.g. "anthropic/claude-sonnet-4"). ' +
      'Optionally filter by provider or capability.',
    inputSchema: {
      provider: z.string().optional().describe(
        'Filter by provider prefix (e.g. "anthropic", "openai", "google")',
      ),
      supportsTools: z.boolean().optional().describe(
        'Filter to models that support tool use',
      ),
    },
  },
  async (args) => {
    try {
      const client = getClient();
      const result = await client.models.list({
        provider: args.provider as string | undefined,
        supportsTools: args.supportsTools as boolean | undefined,
      });

      const models = result.models.map((m) => ({
        id: m.id,
        contextLength: m.contextLength,
        inputPrice: m.inputPrice,
        outputPrice: m.outputPrice,
        supportsTools: m.supportsTools,
        supportsVision: m.supportsVision,
      }));

      return mcpJson({ count: models.length, models });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return mcpText(`Error listing models: ${message}`);
    }
  },
);

// --- list_docker_images -----------------------------------------------------

server.registerTool(
  'list_docker_images',
  {
    description:
      'List Docker images available on the platform. ' +
      'Use this to find valid image references for agent steps (e.g. "mediforce-golden-image:latest"). ' +
      'Returns repository:tag pairs that can be used in step.agent.image.',
    inputSchema: {},
  },
  async () => {
    try {
      const client = getClient();
      const result = await client.system.dockerInfo();
      if (!result.available) {
        return mcpText('Docker is not available on this platform instance.');
      }
      const images = result.images.map((img) => ({
        repository: img.repository,
        tag: img.tag,
        ref: img.tag && img.tag !== '<none>' ? `${img.repository}:${img.tag}` : img.repository,
        id: img.id,
        size: img.size,
      }));
      return mcpJson({ count: images.length, images });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return mcpText(`Error listing Docker images: ${message}`);
    }
  },
);

// --- list_workflow_examples --------------------------------------------------

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

server.registerTool(
  'list_workflow_examples',
  {
    description:
      'Get CI-tested workflow examples and anti-patterns. ' +
      'Examples show correct schema for every executor type, trigger, and pattern. ' +
      'Anti-patterns show common mistakes with explanation of why they fail and how to fix them. ' +
      'Call this BEFORE designing a workflow to learn the correct definition format.',
    inputSchema: {},
  },
  async () => {
    const { examples, antiPatterns } = loadWorkflowExamples(repoRoot);
    return mcpJson({
      count: examples.length,
      examples: examples.map(e => ({
        name: e.name,
        title: e.title,
        description: e.description,
        definition: e.definition,
      })),
      antiPatterns: antiPatterns.map(a => ({
        name: a.name,
        description: a.description,
        why: a.why,
        fix: a.fix,
        definition: a.definition,
      })),
    });
  },
);

// --- Start ------------------------------------------------------------------

void (async () => {
  await server.connect(new StdioServerTransport());
})();
