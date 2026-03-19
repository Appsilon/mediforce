import type { FirestoreAgentDefinitionRepository } from '@mediforce/platform-infra';

const BUILTIN_AGENTS = [
  {
    name: 'Driver Agent',
    iconName: 'Chart',
    description:
      'Orchestrates multi-step supply chain review workflows by coordinating data collection, analysis, and reporting agents.',
    inputDescription: 'Workflow trigger payload with study identifiers',
    outputDescription: 'Completed workflow result with step summaries',
    foundationModel: 'claude-sonnet-4.6',
    systemPrompt: '',
    skillFileNames: [] as string[],
  },
  {
    name: 'Risk Detection',
    iconName: 'Chart',
    description:
      'Analyzes vendor submissions and supply chain data to identify potential risks, anomalies, and compliance issues.',
    inputDescription: 'Vendor submission records and historical data',
    outputDescription: 'Risk scores, flagged issues, and recommendations',
    foundationModel: 'claude-sonnet-4.6',
    systemPrompt: '',
    skillFileNames: [] as string[],
  },
  {
    name: 'Claude Code Agent',
    iconName: 'Bot',
    description:
      "Executes code generation, analysis, and automated software tasks using Claude's advanced coding capabilities.",
    inputDescription: 'Task description and relevant code context',
    outputDescription: 'Generated code, analysis results, or task completion report',
    foundationModel: 'claude-sonnet-4.6',
    systemPrompt: '',
    skillFileNames: [] as string[],
  },
  {
    name: 'OpenCode Agent',
    iconName: 'Cpu',
    description:
      'Open-source code execution agent powered by DeepSeek for cost-efficient automated development tasks.',
    inputDescription: 'Code task description and project context',
    outputDescription: 'Implemented code changes and execution results',
    foundationModel: 'deepseek/deepseek-chat-v3.2',
    systemPrompt: '',
    skillFileNames: [] as string[],
  },
  {
    name: 'Script Container',
    iconName: 'Terminal',
    description:
      'Sandboxed execution environment for running custom scripts, data transformations, and automation tasks.',
    inputDescription: 'Script definition and input parameters',
    outputDescription: 'Script execution output and exit status',
    foundationModel: 'claude-sonnet-4.6',
    systemPrompt: '',
    skillFileNames: [] as string[],
  },
];

const EXPECTED_MODEL_BY_NAME = new Map(
  BUILTIN_AGENTS.map((a) => [a.name, a.foundationModel]),
);

export async function seedBuiltinAgentDefinitions(
  repo: FirestoreAgentDefinitionRepository,
): Promise<void> {
  const existing = await repo.list();

  if (existing.length === 0) {
    await Promise.all(BUILTIN_AGENTS.map((agent) => repo.create(agent)));
    return;
  }

  // Migrate model IDs for existing agents whose foundationModel is out of date.
  const stale = existing.filter((agent) => {
    const expected = EXPECTED_MODEL_BY_NAME.get(agent.name);
    return expected !== undefined && agent.foundationModel !== expected;
  });

  await Promise.all(
    stale.map((agent) =>
      repo.update(agent.id, { foundationModel: EXPECTED_MODEL_BY_NAME.get(agent.name)! }),
    ),
  );
}
