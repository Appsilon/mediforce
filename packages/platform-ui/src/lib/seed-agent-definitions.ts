import type { FirestoreAgentDefinitionRepository } from '@mediforce/platform-infra';
import type { CreateAgentDefinitionInput } from '@mediforce/platform-core';

/** Deterministic slug → AgentDefinition body. Slug doubles as Firestore
 *  doc id so wd.json files can reference it via step.agentId without
 *  fear of IDs shifting between environments. */
const BUILTIN_AGENTS: Record<string, CreateAgentDefinitionInput> = {
  'supply-intelligence-driver-agent': {
    kind: 'plugin',
    runtimeId: 'supply-intelligence/driver-agent',
    name: 'Driver Agent',
    iconName: 'Chart',
    description:
      'Orchestrates multi-step supply chain review workflows by coordinating data collection, analysis, and reporting agents.',
    inputDescription: 'Workflow trigger payload with study identifiers',
    outputDescription: 'Completed workflow result with step summaries',
    foundationModel: 'anthropic/claude-sonnet-4',
    systemPrompt: '',
    skillFileNames: [],
  },
  'supply-intelligence-risk-detection': {
    kind: 'plugin',
    runtimeId: 'supply-intelligence/risk-detection',
    name: 'Risk Detection',
    iconName: 'Chart',
    description:
      'Analyzes vendor submissions and supply chain data to identify potential risks, anomalies, and compliance issues.',
    inputDescription: 'Vendor submission records and historical data',
    outputDescription: 'Risk scores, flagged issues, and recommendations',
    foundationModel: 'anthropic/claude-sonnet-4',
    systemPrompt: '',
    skillFileNames: [],
  },
  'claude-code-agent': {
    kind: 'plugin',
    runtimeId: 'claude-code-agent',
    name: 'Claude Code Agent',
    iconName: 'Bot',
    description:
      "Executes code generation, analysis, and automated software tasks using Claude's advanced coding capabilities.",
    inputDescription: 'Task description and relevant code context',
    outputDescription: 'Generated code, analysis results, or task completion report',
    foundationModel: 'anthropic/claude-sonnet-4',
    systemPrompt: '',
    skillFileNames: [],
  },
  'opencode-agent': {
    kind: 'plugin',
    runtimeId: 'opencode-agent',
    name: 'OpenCode Agent',
    iconName: 'Cpu',
    description:
      'Open-source code execution agent powered by DeepSeek for cost-efficient automated development tasks.',
    inputDescription: 'Code task description and project context',
    outputDescription: 'Implemented code changes and execution results',
    foundationModel: 'deepseek/deepseek-chat',
    systemPrompt: '',
    skillFileNames: [],
  },
  'script-container': {
    kind: 'plugin',
    runtimeId: 'script-container',
    name: 'Script Container',
    iconName: 'Terminal',
    description:
      'Sandboxed execution environment for running custom scripts, data transformations, and automation tasks.',
    inputDescription: 'Script definition and input parameters',
    outputDescription: 'Script execution output and exit status',
    foundationModel: 'anthropic/claude-sonnet-4',
    systemPrompt: '',
    skillFileNames: [],
  },
};

export async function seedBuiltinAgentDefinitions(
  repo: FirestoreAgentDefinitionRepository,
): Promise<void> {
  await Promise.all(
    Object.entries(BUILTIN_AGENTS).map(([id, body]) => repo.upsert(id, body)),
  );
}
