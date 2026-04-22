import type { FirestoreAgentDefinitionRepository } from '@mediforce/platform-infra';

const BUILTIN_AGENTS = [
  {
    kind: 'plugin' as const,
    runtimeId: 'supply-intelligence/driver-agent',
    name: 'Driver Agent',
    iconName: 'Chart',
    description:
      'Orchestrates multi-step supply chain review workflows by coordinating data collection, analysis, and reporting agents.',
    inputDescription: 'Workflow trigger payload with study identifiers',
    outputDescription: 'Completed workflow result with step summaries',
    foundationModel: 'anthropic/claude-sonnet-4',
    systemPrompt: '',
    skillFileNames: [] as string[],
  },
  {
    kind: 'plugin' as const,
    runtimeId: 'supply-intelligence/risk-detection',
    name: 'Risk Detection',
    iconName: 'Chart',
    description:
      'Analyzes vendor submissions and supply chain data to identify potential risks, anomalies, and compliance issues.',
    inputDescription: 'Vendor submission records and historical data',
    outputDescription: 'Risk scores, flagged issues, and recommendations',
    foundationModel: 'anthropic/claude-sonnet-4',
    systemPrompt: '',
    skillFileNames: [] as string[],
  },
  {
    kind: 'plugin' as const,
    runtimeId: 'claude-code-agent',
    name: 'Claude Code Agent',
    iconName: 'Bot',
    description:
      "Executes code generation, analysis, and automated software tasks using Claude's advanced coding capabilities.",
    inputDescription: 'Task description and relevant code context',
    outputDescription: 'Generated code, analysis results, or task completion report',
    foundationModel: 'anthropic/claude-sonnet-4',
    systemPrompt: '',
    skillFileNames: [] as string[],
  },
  {
    kind: 'plugin' as const,
    runtimeId: 'opencode-agent',
    name: 'OpenCode Agent',
    iconName: 'Cpu',
    description:
      'Open-source code execution agent powered by DeepSeek for cost-efficient automated development tasks.',
    inputDescription: 'Code task description and project context',
    outputDescription: 'Implemented code changes and execution results',
    foundationModel: 'deepseek/deepseek-chat',
    systemPrompt: '',
    skillFileNames: [] as string[],
  },
  {
    kind: 'plugin' as const,
    runtimeId: 'script-container',
    name: 'Script Container',
    iconName: 'Terminal',
    description:
      'Sandboxed execution environment for running custom scripts, data transformations, and automation tasks.',
    inputDescription: 'Script definition and input parameters',
    outputDescription: 'Script execution output and exit status',
    foundationModel: 'anthropic/claude-sonnet-4',
    systemPrompt: '',
    skillFileNames: [] as string[],
  },
];

export async function seedBuiltinAgentDefinitions(
  repo: FirestoreAgentDefinitionRepository,
): Promise<void> {
  const existing = await repo.list();
  const existingByRuntimeId = new Map(
    existing.filter((a) => a.runtimeId !== undefined).map((a) => [a.runtimeId!, a]),
  );

  await Promise.all(
    BUILTIN_AGENTS.map(async (agent) => {
      const existingAgent = existingByRuntimeId.get(agent.runtimeId);
      if (existingAgent === undefined) {
        await repo.create(agent);
      }
    }),
  );
}
