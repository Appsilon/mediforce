import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  AgentRunSchema,
  type AgentRun,
  type AgentRunRepository,
  type ProcessInstanceRepository,
} from '@mediforce/platform-core';
import type { Database } from '../client.js';
import { agentRuns } from '../schema/agent-run.js';

/**
 * Postgres-backed AgentRunRepository (ADR-0001 PR2, PLAN §1.2 agent_runs).
 *
 * Hybrid storage: query-worthy envelope fields (confidence, model,
 * duration_ms, prompt_tokens, completion_tokens, cost_usd) are extracted
 * as columns; the rest of the envelope (reasoning_summary, reasoning_chain,
 * annotations, gitMetadata, presentation, deliverableFile, result,
 * confidence_rationale, tokenUsage) lives in `envelope_payload` jsonb.
 *
 * The `workspace` column is derived at insert time from the parent
 * ProcessInstance — AgentRun itself carries no namespace, so we resolve it
 * via the injected `ProcessInstanceRepository`. Reads stay simple: rows
 * already carry `workspace`, so namespace-scoped variants filter with
 * `workspace = ANY($)` — no parent lookup needed on the read path.
 *
 * Validation matches the Firestore + in-memory backends: parse on every
 * read AND every write (ADR-0001 Implementation pattern 2).
 */
export class PostgresAgentRunRepository implements AgentRunRepository {
  constructor(
    private readonly db: Database,
    private readonly parents: ProcessInstanceRepository,
  ) {}

  async create(run: AgentRun): Promise<AgentRun> {
    const parsed = AgentRunSchema.parse(run);
    const parent = await this.parents.getById(parsed.processInstanceId);
    if (!parent || typeof parent.namespace !== 'string') {
      throw new Error(
        'PostgresAgentRunRepository.create: cannot resolve workspace — ' +
          `parent ProcessInstance ${parsed.processInstanceId} missing or has no namespace.`,
      );
    }
    const envelope = parsed.envelope;
    const { extracted, payload } = splitEnvelope(envelope);
    const [row] = await this.db
      .insert(agentRuns)
      .values({
        id: parsed.id,
        workspace: parent.namespace,
        processInstanceId: parsed.processInstanceId,
        stepId: parsed.stepId,
        pluginId: parsed.pluginId,
        autonomyLevel: parsed.autonomyLevel,
        status: parsed.status,
        fallbackReason: parsed.fallbackReason,
        confidence: extracted.confidence,
        model: extracted.model,
        durationMs: extracted.durationMs,
        promptTokens: extracted.promptTokens,
        completionTokens: extracted.completionTokens,
        costUsd: extracted.costUsd,
        envelopePayload: payload,
        executorType: parsed.executorType ?? null,
        reviewerType: parsed.reviewerType ?? null,
        startedAt: new Date(parsed.startedAt),
        completedAt: parsed.completedAt ? new Date(parsed.completedAt) : null,
      })
      .returning();
    return AgentRunSchema.parse(toAgentRun(row));
  }

  async getById(runId: string): Promise<AgentRun | null> {
    const rows = await this.db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId))
      .limit(1);
    const row = rows[0];
    return row ? AgentRunSchema.parse(toAgentRun(row)) : null;
  }

  async getByIdInNamespaces(
    runId: string,
    allowed: readonly string[],
  ): Promise<AgentRun | null> {
    if (allowed.length === 0) return null;
    const rows = await this.db
      .select()
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.id, runId),
          inArray(agentRuns.workspace, [...allowed]),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? AgentRunSchema.parse(toAgentRun(row)) : null;
  }

  async getByInstanceId(instanceId: string): Promise<AgentRun[]> {
    const rows = await this.db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.processInstanceId, instanceId))
      .orderBy(desc(agentRuns.startedAt));
    return rows.map((r) => AgentRunSchema.parse(toAgentRun(r)));
  }

  async getByInstanceIdInNamespaces(
    instanceId: string,
    allowed: readonly string[],
  ): Promise<AgentRun[]> {
    if (allowed.length === 0) return [];
    const rows = await this.db
      .select()
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.processInstanceId, instanceId),
          inArray(agentRuns.workspace, [...allowed]),
        ),
      )
      .orderBy(desc(agentRuns.startedAt));
    return rows.map((r) => AgentRunSchema.parse(toAgentRun(r)));
  }

  async getAll(limitN = 100): Promise<AgentRun[]> {
    const rows = await this.db
      .select()
      .from(agentRuns)
      .orderBy(desc(agentRuns.startedAt))
      .limit(limitN);
    return rows.map((r) => AgentRunSchema.parse(toAgentRun(r)));
  }
}

interface ExtractedEnvelopeColumns {
  confidence: string | null;
  model: string | null;
  durationMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: string | null;
}

interface SplitResult {
  extracted: ExtractedEnvelopeColumns;
  payload: Record<string, unknown> | null;
}

/**
 * Split an envelope into extracted query columns vs. the leftover jsonb
 * payload. `confidence` and `cost_usd` are stored as numeric → drizzle
 * returns/accepts strings. `cost_usd` lives inside the payload too (the
 * envelope schema doesn't carry it directly today) — leave for follow-up.
 */
function splitEnvelope(
  envelope: AgentRun['envelope'],
): SplitResult {
  if (envelope === null) {
    return {
      extracted: {
        confidence: null,
        model: null,
        durationMs: null,
        promptTokens: null,
        completionTokens: null,
        costUsd: null,
      },
      payload: null,
    };
  }
  const {
    confidence,
    model,
    duration_ms,
    tokenUsage,
    ...rest
  } = envelope;
  return {
    extracted: {
      confidence: confidence.toString(),
      model: model,
      durationMs: duration_ms,
      promptTokens: tokenUsage?.inputTokens ?? null,
      completionTokens: tokenUsage?.outputTokens ?? null,
      // cost_usd not on the envelope today — column reserved for follow-up.
      costUsd: null,
    },
    payload: rest as Record<string, unknown>,
  };
}

function toAgentRun(row: typeof agentRuns.$inferSelect): AgentRun {
  const payload = (row.envelopePayload ?? null) as Record<string, unknown> | null;
  const envelope = payload === null
    ? null
    : {
        ...payload,
        confidence: row.confidence === null ? 0 : Number(row.confidence),
        model: row.model,
        duration_ms: row.durationMs ?? 0,
        ...(row.promptTokens !== null && row.completionTokens !== null
          ? {
              tokenUsage: {
                inputTokens: row.promptTokens,
                outputTokens: row.completionTokens,
              },
            }
          : {}),
      };

  const out: Record<string, unknown> = {
    id: row.id,
    processInstanceId: row.processInstanceId,
    stepId: row.stepId,
    pluginId: row.pluginId,
    autonomyLevel: row.autonomyLevel,
    status: row.status,
    envelope,
    fallbackReason: row.fallbackReason,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
  if (row.executorType !== null) out.executorType = row.executorType;
  if (row.reviewerType !== null) out.reviewerType = row.reviewerType;
  return out as AgentRun;
}
