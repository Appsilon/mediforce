import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices, getAppBaseUrl } from '@/lib/platform-services';
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

export async function POST(_req: NextRequest): Promise<NextResponse> {
  const { processRepo, cronTrigger, cronTriggerStateRepo } = getPlatformServices();
  const now = new Date();
  const triggered: TriggeredEntry[] = [];
  const skipped: SkippedEntry[] = [];

  try {
    const { definitions: definitionGroups } = await processRepo.listWorkflowDefinitions(false);

    // Flatten to latest version of each definition that has at least one cron trigger.
    // Archived WDs are already filtered at the repo layer (includeArchived=false).
    const cronDefinitions = definitionGroups
      .map((group) => group.versions.find((v) => v.version === group.latestVersion))
      .filter((def): def is WorkflowDefinition => def !== undefined)
      .filter((def: WorkflowDefinition) =>
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

        // Read last triggered time for this specific trigger.
        // When no state exists (first run), use the definition's createdAt so
        // gap-scanning catches any missed windows since the definition was created.
        // TODO: race condition — overlapping heartbeats can read the same lastTriggeredAt
        // and both fire the trigger. Not critical at current scale (single VPS cron),
        // but needs a Firestore transaction or distributed lock if we scale out.
        const state = await cronTriggerStateRepo.get(def.name, trigger.name);
        const lastTriggeredAt = state
          ? new Date(state.lastTriggeredAt)
          : def.createdAt
            ? new Date(def.createdAt)
            : undefined;

        if (!isDue(schedule, now, lastTriggeredAt)) {
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

        // Persist trigger state AFTER successful fire (at-least-once semantics)
        await cronTriggerStateRepo.set({
          definitionName: def.name,
          triggerName: trigger.name,
          lastTriggeredAt: now.toISOString(),
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

    // Worktrees are NOT swept. Full audit is the design goal: every run branch
    // AND its worktree persist indefinitely so an operator can `cd` in at any
    // later point and inspect what the agent produced. `disposeRunWorkspace`
    // stays available as a manual admin API; the heartbeat never calls it.
    return NextResponse.json({ triggered, skipped });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[cron-heartbeat] Error: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
