'use server';

import { stringify as yamlStringify } from 'yaml';
import { getPlatformServices } from '@/lib/platform-services';
import { parseProcessDefinition, WorkflowDefinitionSchema } from '@mediforce/platform-core';
import type { ProcessDefinition, ProcessConfig, WorkflowDefinition } from '@mediforce/platform-core';
import { DefinitionVersionAlreadyExistsError, WorkflowDefinitionVersionAlreadyExistsError } from '@mediforce/platform-infra';

export type SaveDefinitionResult =
  | { success: true; name: string; version: string }
  | { success: false; error: string };

export async function definitionToYaml(definition: Record<string, unknown>): Promise<string> {
  const { id, ...def } = definition;
  void id;
  return yamlStringify(def, { indent: 2 });
}

/**
 * Build a default "all-human" ProcessConfig from a definition.
 * Every non-terminal step gets executorType: "human" — the safest default.
 * Users must explicitly configure agent executors + plugins via the config editor.
 */
function buildAllHumanConfig(definition: ProcessDefinition): ProcessConfig {
  return {
    processName: definition.name,
    configName: 'all-human',
    configVersion: '1',
    stepConfigs: definition.steps
      .filter((s) => s.type !== 'terminal')
      .map((s) => ({ stepId: s.id, executorType: 'human' as const })),
  };
}

export async function saveDefinition(yaml: string): Promise<SaveDefinitionResult> {
  if (!yaml.trim()) {
    return { success: false, error: 'YAML content is required.' };
  }

  const result = parseProcessDefinition(yaml);
  if (!result.success) {
    return { success: false, error: result.error };
  }

  const { processRepo } = getPlatformServices();

  try {
    await processRepo.saveProcessDefinition(result.data);

    // Auto-create "all-human" default config if none exists yet
    const existing = await processRepo.getProcessConfig(result.data.name, 'all-human', 'v1');
    if (!existing) {
      await processRepo.saveProcessConfig(buildAllHumanConfig(result.data));
    }

    return { success: true, name: result.data.name, version: result.data.version };
  } catch (e) {
    if (e instanceof DefinitionVersionAlreadyExistsError) {
      return {
        success: false,
        error: `Version ${result.data.version} already exists for "${result.data.name}". Bump the version in your YAML.`,
      };
    }
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

export type SaveWorkflowDefinitionResult =
  | { success: true; name: string; version: number }
  | { success: false; error: string };

export async function saveWorkflowDefinition(
  input: Omit<WorkflowDefinition, 'version' | 'createdAt'>,
): Promise<SaveWorkflowDefinitionResult> {
  const parsed = WorkflowDefinitionSchema.omit({ version: true, createdAt: true }).safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const { processRepo } = getPlatformServices();

  try {
    const latestVersion = await processRepo.getLatestWorkflowVersion(parsed.data.name);
    const nextVersion = latestVersion + 1;

    const definition: WorkflowDefinition = {
      ...parsed.data,
      version: nextVersion,
      createdAt: new Date().toISOString(),
    };

    await processRepo.saveWorkflowDefinition(definition);
    return { success: true, name: definition.name, version: definition.version };
  } catch (e) {
    if (e instanceof WorkflowDefinitionVersionAlreadyExistsError) {
      return { success: false, error: 'Version conflict — please retry.' };
    }
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

export type MigrateResult =
  | { success: true; migrated: number }
  | { success: false; error: string };

/**
 * Migrate a legacy ProcessDefinition + ProcessConfig into a unified WorkflowDefinition.
 * Merges the latest ProcessDefinition with its latest ProcessConfig (if any).
 */
export async function migrateToWorkflowDefinition(
  processName: string,
): Promise<MigrateResult> {
  const { processRepo } = getPlatformServices();

  try {
    const { valid: legacyDefs } = await processRepo.listProcessDefinitions();
    const matchingDefs = legacyDefs.filter((d: ProcessDefinition) => d.name === processName);
    if (matchingDefs.length === 0) {
      return { success: false, error: `No legacy definitions found for "${processName}".` };
    }

    const configs = await processRepo.listProcessConfigs(processName);
    const latestConfig = configs[0] ?? null;

    let migrated = 0;

    for (const legacyDef of matchingDefs) {
      const existingVersion = await processRepo.getLatestWorkflowVersion(processName);
      const nextVersion = existingVersion + 1;

      const steps = legacyDef.steps.map((step: ProcessDefinition['steps'][number]) => {
        const stepConfig = latestConfig?.stepConfigs?.find(
          (sc: { stepId: string }) => sc.stepId === step.id,
        );

        return {
          ...step,
          executor: (stepConfig?.executorType ?? 'human') as 'human' | 'agent' | 'script',
          autonomyLevel: stepConfig?.autonomyLevel,
          plugin: stepConfig?.plugin,
          allowedRoles: stepConfig?.allowedRoles,
          agent: stepConfig?.agentConfig ? {
            model: stepConfig.model,
            skill: stepConfig.agentConfig.skill,
            prompt: stepConfig.agentConfig.prompt,
            skillsDir: stepConfig.agentConfig.skillsDir,
            timeoutMs: stepConfig.agentConfig.timeoutMs,
            command: stepConfig.agentConfig.command,
            inlineScript: stepConfig.agentConfig.inlineScript,
            runtime: stepConfig.agentConfig.runtime,
            image: stepConfig.agentConfig.image,
            repo: stepConfig.agentConfig.repo,
            commit: stepConfig.agentConfig.commit,
            timeoutMinutes: stepConfig.timeoutMinutes,
            confidenceThreshold: stepConfig.confidenceThreshold,
            fallbackBehavior: stepConfig.fallbackBehavior,
          } : undefined,
          review: stepConfig?.reviewerType && stepConfig.reviewerType !== 'none' ? {
            type: stepConfig.reviewerType,
            plugin: stepConfig.reviewerPlugin,
            maxIterations: stepConfig.reviewConstraints?.maxIterations,
            timeBoxDays: stepConfig.reviewConstraints?.timeBoxDays,
          } : undefined,
          stepParams: stepConfig?.params,
          env: stepConfig?.env,
        };
      });

      const workflowDef: WorkflowDefinition = {
        name: legacyDef.name,
        version: nextVersion,
        description: legacyDef.description,
        repo: legacyDef.repo,
        url: legacyDef.url,
        roles: latestConfig?.roles,
        env: latestConfig?.env,
        notifications: latestConfig?.notifications,
        steps,
        transitions: legacyDef.transitions,
        triggers: legacyDef.triggers,
        metadata: legacyDef.metadata,
        createdAt: new Date().toISOString(),
      };

      await processRepo.saveWorkflowDefinition(workflowDef);
      migrated++;
    }

    return { success: true, migrated };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

export type ArchiveResult = { success: true } | { success: false; error: string };

export async function setProcessArchived(
  processName: string,
  archived: boolean,
): Promise<ArchiveResult> {
  const { processRepo } = getPlatformServices();
  try {
    await processRepo.setProcessArchived(processName, archived);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

export async function setConfigArchived(
  processName: string,
  configName: string,
  configVersion: string,
  archived: boolean,
): Promise<ArchiveResult> {
  const { processRepo } = getPlatformServices();
  try {
    await processRepo.setConfigArchived(processName, configName, configVersion, archived);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

export async function setDefinitionVersionArchived(
  name: string,
  version: string,
  archived: boolean,
): Promise<ArchiveResult> {
  const { processRepo } = getPlatformServices();
  try {
    await processRepo.setDefinitionVersionArchived(name, version, archived);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}
