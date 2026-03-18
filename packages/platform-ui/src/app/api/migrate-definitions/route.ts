import { NextResponse } from 'next/server';
import type { ProcessDefinition, ProcessConfig, WorkflowDefinition } from '@mediforce/platform-core';
import { getPlatformServices, validateApiKey } from '@/lib/platform-services';

function mergeDefinitionAndConfig(
  legacyDef: ProcessDefinition,
  config: ProcessConfig | null,
  version: number,
): WorkflowDefinition {
  const steps = legacyDef.steps.map((step) => {
    const stepConfig = config?.stepConfigs?.find((sc) => sc.stepId === step.id);

    return {
      ...step,
      executor: (stepConfig?.executorType ?? 'human') as 'human' | 'agent' | 'script',
      autonomyLevel: stepConfig?.autonomyLevel,
      plugin: stepConfig?.plugin,
      allowedRoles: stepConfig?.allowedRoles,
      agent: stepConfig?.agentConfig
        ? {
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
          }
        : undefined,
      review:
        stepConfig?.reviewerType && stepConfig.reviewerType !== 'none'
          ? {
              type: stepConfig.reviewerType as 'human' | 'agent' | 'none',
              plugin: stepConfig.reviewerPlugin,
              maxIterations: stepConfig.reviewConstraints?.maxIterations,
              timeBoxDays: stepConfig.reviewConstraints?.timeBoxDays,
            }
          : undefined,
      stepParams: stepConfig?.params,
      env: stepConfig?.env,
    };
  });

  return {
    name: legacyDef.name,
    version,
    description: legacyDef.description,
    repo: legacyDef.repo,
    url: legacyDef.url,
    roles: config?.roles,
    env: config?.env,
    notifications: config?.notifications,
    steps,
    transitions: legacyDef.transitions,
    triggers: legacyDef.triggers,
    metadata: legacyDef.metadata,
    createdAt: new Date().toISOString(),
  };
}

/**
 * POST /api/migrate-definitions
 *
 * One-shot migration: reads all legacy ProcessDefinitions, merges each with
 * the latest ProcessConfig (if any), and saves as WorkflowDefinition v1.
 *
 * Dry-run by default — pass ?commit=true to actually write.
 *
 * Usage:
 *   curl -s -X POST -H "X-Api-Key: $MEDIFORCE_API_KEY" "http://localhost:9003/api/migrate-definitions"
 *   curl -s -X POST -H "X-Api-Key: $MEDIFORCE_API_KEY" "http://localhost:9003/api/migrate-definitions?commit=true"
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!validateApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const commit = url.searchParams.get('commit') === 'true';

  const { processRepo } = getPlatformServices();

  const { valid: legacyDefs } = await processRepo.listProcessDefinitions();

  if (legacyDefs.length === 0) {
    return NextResponse.json({ message: 'No legacy definitions found.', migrated: [] });
  }

  // Group legacy defs by name, pick latest version per name
  const byName = new Map<string, ProcessDefinition>();
  for (const def of legacyDefs) {
    const existing = byName.get(def.name);
    if (!existing || def.version > existing.version) {
      byName.set(def.name, def);
    }
  }

  const results: Array<{
    name: string;
    legacyVersion: string;
    configUsed: string | null;
    newVersion: number;
    status: 'ok' | 'skipped' | 'error';
    error?: string;
  }> = [];

  for (const [name, latestDef] of byName) {
    // Check if already migrated
    const existingVersion = await processRepo.getLatestWorkflowVersion(name);
    if (existingVersion > 0) {
      results.push({
        name,
        legacyVersion: latestDef.version,
        configUsed: null,
        newVersion: existingVersion,
        status: 'skipped',
        error: `Already has WorkflowDefinition v${existingVersion}`,
      });
      continue;
    }

    // Find best config: prefer non-all-human, then highest version
    const configs = await processRepo.listProcessConfigs(name);
    const nonAllHuman = configs.filter((c) => c.configName !== 'all-human');
    const pool = nonAllHuman.length > 0 ? nonAllHuman : configs;
    // Sort by configVersion descending — strip leading 'v' for numeric comparison
    const parseVer = (v: string) => parseFloat(v.replace(/^v/, '')) || 0;
    const latestConfig = pool.length > 0
      ? pool.sort((a, b) => parseVer(b.configVersion) - parseVer(a.configVersion))[0]
      : null;

    const merged = mergeDefinitionAndConfig(latestDef, latestConfig, 1);

    if (commit) {
      try {
        await processRepo.saveWorkflowDefinition(merged);
        results.push({
          name,
          legacyVersion: latestDef.version,
          configUsed: latestConfig ? `${latestConfig.configName}:${latestConfig.configVersion}` : null,
          newVersion: 1,
          status: 'ok',
        });
      } catch (e) {
        results.push({
          name,
          legacyVersion: latestDef.version,
          configUsed: latestConfig ? `${latestConfig.configName}:${latestConfig.configVersion}` : null,
          newVersion: 1,
          status: 'error',
          error: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    } else {
      results.push({
        name,
        legacyVersion: latestDef.version,
        configUsed: latestConfig ? `${latestConfig.configName}:${latestConfig.configVersion}` : null,
        newVersion: 1,
        status: 'ok',
      });
    }
  }

  return NextResponse.json({
    mode: commit ? 'committed' : 'dry-run (add ?commit=true to write)',
    total: results.length,
    migrated: results.filter((r) => r.status === 'ok').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    errors: results.filter((r) => r.status === 'error').length,
    results,
  });
}
