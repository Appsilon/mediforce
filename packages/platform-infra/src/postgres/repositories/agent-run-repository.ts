import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import {
  AgentRunSchema,
  parseRow,
  decodeAgentRunCursor,
  encodeAgentRunCursor,
  type AgentRun,
  type AgentRunRepository,
  type ListAgentRunsOptions,
  type ListAgentRunsPage,
  type ProcessInstanceRepository,
} from '@mediforce/platform-core';
import type { Database } from '../client';
import { agentRuns } from '../schema/agent-run';

/**
 * Postgres-backed AgentRunRepository (ADR-0001, PLAN §1.2 agent_runs).
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
    const values = {
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
    };
    // AgentRunner writes the same id twice — once at start (status 'running')
    // and once at the terminal transition (completed/escalated/error). The
    // Firestore + in-memory backends implement create() as an upsert
    // (.set() / Map.set), so we mirror that here to preserve parity; a plain
    // insert throws on the second write (agent_runs_pkey).
    // TODO(#617): replace this implicit upsert with an explicit create()/update()
    // split across all repository backends and fix the callers in agent-runner.ts.
    const { id: _, ...mutable } = values;
    const [row] = await this.db
      .insert(agentRuns)
      .values(values)
      .onConflictDoUpdate({ target: agentRuns.id, set: mutable })
      .returning();
    return toAgentRun(row);
  }

  async update(runId: string, updates: Partial<AgentRun>): Promise<void> {
    const current = await this.getById(runId);
    if (current === null) {
      throw new Error(`AgentRun not found: ${runId}`);
    }
    const parsed = AgentRunSchema.parse({
      ...current,
      ...updates,
      id: runId,
      processInstanceId: current.processInstanceId,
    });
    const parent = await this.parents.getById(parsed.processInstanceId);
    if (!parent || typeof parent.namespace !== 'string') {
      throw new Error(
        'PostgresAgentRunRepository.update: cannot resolve workspace — ' +
          `parent ProcessInstance ${parsed.processInstanceId} missing or has no namespace.`,
      );
    }
    const { extracted, payload } = splitEnvelope(parsed.envelope);
    await this.db
      .update(agentRuns)
      .set({
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
      .where(eq(agentRuns.id, runId));
  }

  async getById(runId: string): Promise<AgentRun | null> {
    const rows = await this.db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId))
      .limit(1);
    const row = rows[0];
    return row ? toAgentRun(row) : null;
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
    return row ? toAgentRun(row) : null;
  }

  async getByInstanceId(instanceId: string): Promise<AgentRun[]> {
    const rows = await this.db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.processInstanceId, instanceId))
      .orderBy(desc(agentRuns.startedAt));
    return rows.map((r) => toAgentRun(r));
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
    return rows.map((r) => toAgentRun(r));
  }

  async getAll(limitN = 100): Promise<AgentRun[]> {
    const rows = await this.db
      .select()
      .from(agentRuns)
      .orderBy(desc(agentRuns.startedAt))
      .limit(limitN);
    return rows.map((r) => toAgentRun(r));
  }

  async list(opts: ListAgentRunsOptions): Promise<ListAgentRunsPage> {
    return this.listImpl(opts, undefined);
  }

  async listInNamespaces(
    allowed: readonly string[],
    opts: ListAgentRunsOptions,
  ): Promise<ListAgentRunsPage> {
    if (allowed.length === 0) return { items: [] };
    return this.listImpl(opts, [...allowed]);
  }

  private async listImpl(
    opts: ListAgentRunsOptions,
    allowed: readonly string[] | undefined,
  ): Promise<ListAgentRunsPage> {
    const conditions = [];
    if (allowed !== undefined) {
      conditions.push(inArray(agentRuns.workspace, [...allowed]));
    }
    if (opts.namespace !== undefined) {
      conditions.push(eq(agentRuns.workspace, opts.namespace));
    }
    if (opts.runId !== undefined) {
      conditions.push(eq(agentRuns.processInstanceId, opts.runId));
    }
    if (opts.stepId !== undefined) {
      conditions.push(eq(agentRuns.stepId, opts.stepId));
    }
    if (opts.cursor !== undefined) {
      const after = decodeAgentRunCursor(opts.cursor);
      if (after !== null) {
        // Keyset (startedAt, id) DESC: emit rows strictly past the cursor.
        conditions.push(
          or(
            lt(agentRuns.startedAt, new Date(after.startedAt)),
            and(
              eq(agentRuns.startedAt, new Date(after.startedAt)),
              sql`${agentRuns.id} < ${after.id}`,
            ),
          ),
        );
      }
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await this.db
      .select()
      .from(agentRuns)
      .where(whereClause)
      .orderBy(desc(agentRuns.startedAt), desc(agentRuns.id))
      .limit(opts.limit + 1);
    const hasMore = rows.length > opts.limit;
    const pageRows = hasMore ? rows.slice(0, opts.limit) : rows;
    const items = pageRows.map((r) => toAgentRun(r));
    const last = pageRows[pageRows.length - 1];
    if (hasMore && last !== undefined) {
      return {
        items,
        nextCursor: encodeAgentRunCursor(last.startedAt.toISOString(), last.id),
      };
    }
    return { items };
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
  const restPayload = rest as Record<string, unknown>;
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
    // Never persist an empty object: the read path decodes '{}' as a null
    // envelope, so writing it would round-trip a present envelope to null.
    // Store SQL NULL instead to keep read/write symmetric (#534).
    payload: Object.keys(restPayload).length === 0 ? null : restPayload,
  };
}

function toAgentRun(row: typeof agentRuns.$inferSelect): AgentRun {
  const payload = (row.envelopePayload ?? null) as Record<string, unknown> | null;
  // A null envelope is the canonical form (running runs, non-LLM steps).
  // Legacy rows (pre-#534) persisted it as the jsonb literal '{}' instead of
  // SQL NULL; treat an empty object the same as NULL so those rows decode
  // without tripping the required AgentOutputEnvelopeSchema fields.
  const isNullEnvelope = payload === null || Object.keys(payload).length === 0;
  const envelope = isNullEnvelope
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

  return parseRow(AgentRunSchema, {
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
    executorType: row.executorType ?? undefined,
    reviewerType: row.reviewerType ?? undefined,
  });
}
