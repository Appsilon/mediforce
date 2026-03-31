import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices, validateApiKey, getAppBaseUrl } from '@/lib/platform-services';
import { validateCronSchedule, isDue } from '@mediforce/workflow-engine';
import type { WorkflowDefinition, Trigger } from '@mediforce/platform-core';

interface TriggeredEntry {
  definitionName: string;
  definitionVersion: number;
  triggerName: string;
  instanceId: string;
}

interface SkippedEntry {
  definitionName: string;
  definitionVersion: number;
  triggerName: string;
  reason: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { processRepo, cronTrigger } = getPlatformServices();
  const now = new Date();
  const triggered: TriggeredEntry[] = [];
  const skipped: SkippedEntry[] = [];

  try {
    const { definitions: definitionGroups } = await processRepo.listWorkflowDefinitions();

    // Flatten to latest version of each definition that has at least one cron trigger
    const cronDefinitions = definitionGroups
      .map((group) => group.versions.find((v) => v.version === (group.publishedVersion ?? group.latestVersion)))
      .filter((def): def is WorkflowDefinition => def !== undefined)
      .filter(
        (def: WorkflowDefinition) =>
          def.archived !== true &&
          def.triggers.some((t: Trigger) => t.type === 'cron'),
      );

    for (const def of cronDefinitions) {
      const cronTriggers = def.triggers.filter((t: Trigger) => t.type === 'cron');

      for (const trigger of cronTriggers) {
        const schedule = trigger.schedule;
        if (!schedule) {
          skipped.push({
            definitionName: def.name,
            definitionVersion: def.version,
            triggerName: trigger.name,
            reason: 'No schedule defined',
          });
          continue;
        }

        const validation = validateCronSchedule(schedule);
        if (!validation.valid) {
          skipped.push({
            definitionName: def.name,
            definitionVersion: def.version,
            triggerName: trigger.name,
            reason: `Invalid schedule: ${validation.error}`,
          });
          continue;
        }

        if (!isDue(schedule, now)) {
          skipped.push({
            definitionName: def.name,
            definitionVersion: def.version,
            triggerName: trigger.name,
            reason: 'Not due',
          });
          continue;
        }

        // Fire the cron trigger to create and start an instance
        const result = await cronTrigger.fireWorkflow({
          definitionName: def.name,
          definitionVersion: def.version,
          triggerName: trigger.name,
          triggeredBy: 'cron-heartbeat',
          payload: { schedule, firedAt: now.toISOString() },
        });

        // Kick off the run loop by calling the run endpoint
        const baseUrl = getAppBaseUrl();
        await fetch(`${baseUrl}/api/processes/${result.instanceId}/run`, {
          method: 'POST',
          headers: { 'X-Api-Key': process.env.PLATFORM_API_KEY ?? '' },
        });

        triggered.push({
          definitionName: def.name,
          definitionVersion: def.version,
          triggerName: trigger.name,
          instanceId: result.instanceId,
        });
      }
    }

    return NextResponse.json({ triggered, skipped });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[cron-heartbeat] Error: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
