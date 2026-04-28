'use server';

import { stringify as yamlStringify, parse as parseYaml } from 'yaml';
import { getPlatformServices } from '@/lib/platform-services';
import {
  parseProcessDefinition,
  parseWorkflowDefinitionForCreation,
} from '@mediforce/platform-core';
import type { ProcessDefinition, ProcessConfig, WorkflowDefinition } from '@mediforce/platform-core';
import { DefinitionVersionAlreadyExistsError, WorkflowDefinitionVersionAlreadyExistsError, getAdminFirestore } from '@mediforce/platform-infra';

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
 * @deprecated Legacy — use WorkflowDefinition instead.
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

/** @deprecated Legacy — saves ProcessDefinition + auto-creates all-human config. */
export async function saveDefinition(yaml: string, namespace?: string): Promise<SaveDefinitionResult> {
  if (!yaml.trim()) {
    return { success: false, error: 'YAML content is required.' };
  }

  // Parse YAML once so we can inspect the version field type.
  let raw: unknown;
  try {
    raw = parseYaml(yaml);
  } catch (err) {
    return { success: false, error: `YAML syntax error: ${(err as Error).message}` };
  }
  if (raw == null) {
    return { success: false, error: 'YAML document is empty or contains only comments.' };
  }

  // WorkflowDefinition uses an integer version; ProcessDefinition uses a semver string.
  // Route to the correct collection based on the version field type.
  if (typeof (raw as Record<string, unknown>).version === 'number') {
    const { version: _v, createdAt: _c, ...rest } = raw as Record<string, unknown>;
    const input: unknown = {
      ...rest,
      namespace: namespace ?? (rest.namespace as string | undefined),
    };
    const result = await saveWorkflowDefinition(input);
    if (!result.success) return result;
    return { success: true, name: result.name, version: String(result.version) };
  }

  // Legacy ProcessDefinition path (semver version string).
  const result = parseProcessDefinition(yaml);
  if (!result.success) {
    return { success: false, error: result.error };
  }

  if (namespace) {
    (result.data as Record<string, unknown>).namespace = namespace;
  }

  const { processRepo } = getPlatformServices();

  try {
    await processRepo.saveProcessDefinition(result.data);
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

// ---------------------------------------------------------------------------
// WorkflowDefinition (new unified schema)
// ---------------------------------------------------------------------------

export type ValidationIssue = { path: (string | number)[]; message: string };

export type SaveWorkflowDefinitionResult =
  | { success: true; name: string; version: number }
  | { success: false; error: string; issues?: ValidationIssue[] };

export async function saveWorkflowDefinition(
  input: unknown,
): Promise<SaveWorkflowDefinitionResult> {
  const parsed = parseWorkflowDefinitionForCreation(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(', '),
      issues: parsed.error.issues.map((i) => ({ path: [...i.path] as (string | number)[], message: i.message })),
    };
  }

  const { processRepo } = getPlatformServices();

  try {
    const isDeleted = await processRepo.isWorkflowNameDeleted(parsed.data.name);
    if (isDeleted) {
      return {
        success: false,
        error: `The name "${parsed.data.name}" was previously used by a deleted workflow. Please choose a different name.`,
      };
    }

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

// ---------------------------------------------------------------------------
// Workflow repository (workspace.remote / workspace.remoteAuth)
// ---------------------------------------------------------------------------

export type SaveWorkflowRepositoryResult =
  | { success: true; name: string; version: number }
  | { success: false; error: string };

export async function saveWorkflowRepository(
  name: string,
  workspace: { remote?: string; remoteAuth?: string },
): Promise<SaveWorkflowRepositoryResult> {
  if (!name.trim()) return { success: false, error: 'Workflow name is required.' };

  const { processRepo } = getPlatformServices();

  try {
    const latestVersion = await processRepo.getLatestWorkflowVersion(name);
    if (latestVersion === 0) {
      return { success: false, error: `Workflow "${name}" not found or has no versions yet.` };
    }
    const latest = await processRepo.getWorkflowDefinition(name, latestVersion);
    if (!latest) {
      return { success: false, error: `Latest version ${latestVersion} of "${name}" not found.` };
    }

    const cleanedWorkspace: { remote?: string; remoteAuth?: string } = {};
    const remote = workspace.remote?.trim();
    const remoteAuth = workspace.remoteAuth?.trim();
    if (remote) cleanedWorkspace.remote = remote;
    if (remoteAuth) cleanedWorkspace.remoteAuth = remoteAuth;

    const { version: _v, createdAt: _c, ...rest } = latest as WorkflowDefinition & {
      createdAt?: string;
    };

    const input: Record<string, unknown> = { ...rest };
    if (Object.keys(cleanedWorkspace).length > 0) {
      input.workspace = cleanedWorkspace;
    } else {
      delete input.workspace;
    }
    delete (input as Record<string, unknown>).id;

    const saved = await saveWorkflowDefinition(input);
    if (!saved.success) {
      return { success: false, error: saved.error };
    }
    await processRepo.setDefaultWorkflowVersion(name, saved.version);
    return { success: true, name: saved.name, version: saved.version };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// ---------------------------------------------------------------------------
// Default version
// ---------------------------------------------------------------------------

export type SetDefaultVersionResult = { success: true } | { success: false; error: string };

export async function setDefaultWorkflowVersion(
  name: string,
  version: number,
): Promise<SetDefaultVersionResult> {
  const { processRepo } = getPlatformServices();
  try {
    // Verify version exists
    const def = await processRepo.getWorkflowDefinition(name, version);
    if (!def) {
      return { success: false, error: `Version ${version} not found` };
    }
    await processRepo.setDefaultWorkflowVersion(name, version);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// ---------------------------------------------------------------------------
// Archive helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Delete helpers (soft-delete)
// ---------------------------------------------------------------------------

export type DeleteResult = { success: true; deletedRuns: number } | { success: false; error: string };

export async function getWorkflowRunCount(workflowName: string): Promise<number> {
  const { processRepo } = getPlatformServices();
  return processRepo.countInstancesByDefinitionName(workflowName);
}

export async function deleteWorkflow(
  workflowName: string,
  expectedRunCount: number,
): Promise<DeleteResult> {
  const { processRepo, instanceRepo, auditRepo, humanTaskRepo } = getPlatformServices();

  try {
    // Verify run count still matches to prevent stale confirmations
    const actualRunCount = await processRepo.countInstancesByDefinitionName(workflowName);
    if (actualRunCount !== expectedRunCount) {
      return {
        success: false,
        error: `Run count changed (expected ${expectedRunCount}, found ${actualRunCount}). Please try again.`,
      };
    }

    // Create audit event before soft-deleting
    await auditRepo.append({
      actorId: 'system',
      actorType: 'system',
      actorRole: 'admin',
      action: 'workflow.delete',
      description: `Workflow "${workflowName}" soft-deleted with ${actualRunCount} associated runs`,
      timestamp: new Date().toISOString(),
      inputSnapshot: { workflowName, runCount: actualRunCount },
      outputSnapshot: {},
      basis: 'User-initiated workflow deletion',
      entityType: 'workflow_definition',
      entityId: workflowName,
    });

    // Soft-delete workflow definitions (all versions + meta)
    await processRepo.setWorkflowDeleted(workflowName, true);

    // Soft-delete all associated process instances and their human tasks
    if (actualRunCount > 0) {
      const instanceIds = await instanceRepo.getIdsByDefinitionName(workflowName);
      await instanceRepo.setDeletedByDefinitionName(workflowName, true);
      await humanTaskRepo.setDeletedByInstanceIds(instanceIds, true);
    }

    return { success: true, deletedRuns: actualRunCount };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// ---------------------------------------------------------------------------
// Transfer workflow namespace
// ---------------------------------------------------------------------------

export type TransferNamespaceResult = { success: true } | { success: false; error: string };

export async function transferWorkflowNamespace(
  workflowName: string,
  newNamespace: string,
): Promise<TransferNamespaceResult> {
  if (!workflowName.trim() || !newNamespace.trim()) {
    return { success: false, error: 'Workflow name and namespace are required.' };
  }

  try {
    // Ensure platform services are initialized (this also initializes Firebase)
    getPlatformServices();
    const db = getAdminFirestore();

    // Query all versions of this workflow
    const snapshot = await db
      .collection('workflowDefinitions')
      .where('name', '==', workflowName)
      .get();

    if (snapshot.empty) {
      return { success: false, error: `No workflow found with name "${workflowName}".` };
    }

    // Update each version with the new namespace
    for (const docSnap of snapshot.docs) {
      await db.collection('workflowDefinitions').doc(docSnap.id).update({ namespace: newNamespace });
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}
