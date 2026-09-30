import type {
  AgentRunRepository,
  AgentRunTrace,
  ListScoresFilter,
  Score,
  ScoreRepository,
} from '@mediforce/platform-core';

/**
 * One-way Score export (ADR-0023, research § Langfuse): each Score of a traced
 * Agent Run is written next to its trace in Phoenix or Langfuse. Write-only —
 * nothing is ever read back — and off unless `MEDIFORCE_SCORE_EXPORT` names a
 * target.
 */
export interface ScoreExportTarget {
  readonly name: 'phoenix' | 'langfuse';
  send(score: Score, trace: AgentRunTrace): Promise<void>;
}

type FetchFn = typeof fetch;

interface ExportOptions {
  /** Send the judge's `comment` too. It can quote the output, so it follows `MEDIFORCE_OTEL_CAPTURE_CONTENT` (ADR-0007 D5). */
  readonly captureContent: boolean;
  readonly fetchFn?: FetchFn;
}

function exportedMetadata(score: Score): Record<string, unknown> {
  return {
    ...(score.metadata ?? {}),
    mediforceScoreId: score.id,
    source: score.source,
    ...(score.evaluatorId === null ? {} : { evaluatorId: score.evaluatorId }),
    ...(score.label === null ? {} : { label: score.label }),
  };
}

async function post(fetchFn: FetchFn, url: string, headers: Record<string, string>, body: unknown): Promise<void> {
  const response = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.ok === false) {
    throw new Error(`${url} answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
}

const PHOENIX_ANNOTATOR_KIND = { human: 'HUMAN', llm_judge: 'LLM', deterministic: 'CODE' } as const;

/**
 * Phoenix span annotations on the Agent Run's span. `sync=false` queues the
 * annotation, so one written while the span is still being exported is kept.
 * A newer Score of the same name on the span replaces the older one there,
 * as a superseding Score does.
 */
export function phoenixScoreExport(baseUrl: string, apiKey: string | undefined, options: ExportOptions): ScoreExportTarget {
  const fetchFn = options.fetchFn ?? fetch;
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/span_annotations?sync=false`;
  const headers: Record<string, string> = apiKey === undefined || apiKey === '' ? {} : { authorization: `Bearer ${apiKey}` };
  return {
    name: 'phoenix',
    send: (score, trace) => post(fetchFn, url, headers, {
      data: [{
        span_id: trace.spanId,
        name: score.name,
        annotator_kind: PHOENIX_ANNOTATOR_KIND[score.source],
        result: {
          score: score.value,
          label: score.label,
          explanation: options.captureContent ? score.comment : null,
        },
        metadata: exportedMetadata(score),
      }],
    }),
  };
}

/** Langfuse scores on the trace and the Agent Run's observation; the Score id makes a resend idempotent. */
export function langfuseScoreExport(
  baseUrl: string,
  publicKey: string,
  secretKey: string,
  options: ExportOptions,
): ScoreExportTarget {
  const fetchFn = options.fetchFn ?? fetch;
  const url = `${baseUrl.replace(/\/+$/, '')}/api/public/scores`;
  const headers = { authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}` };
  return {
    name: 'langfuse',
    send: (score, trace) => post(fetchFn, url, headers, {
      id: score.id,
      traceId: trace.traceId,
      observationId: trace.spanId,
      name: score.name,
      value: score.value,
      dataType: 'NUMERIC',
      ...(options.captureContent && score.comment !== null ? { comment: score.comment } : {}),
      metadata: exportedMetadata(score),
    }),
  };
}

type Env = Readonly<Record<string, string | undefined>>;

function present(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

/**
 * The target `MEDIFORCE_SCORE_EXPORT` names, or null. Unset is off. A target
 * missing its settings is logged and left off — never a failed boot.
 * Phoenix's URL defaults to `OTEL_EXPORTER_OTLP_ENDPOINT`, where it receives
 * the traces.
 */
export function scoreExportFromEnv(env: Env, fetchFn?: FetchFn): ScoreExportTarget | null {
  const target = env.MEDIFORCE_SCORE_EXPORT;
  if (present(target) === false) return null;
  const options = { captureContent: env.MEDIFORCE_OTEL_CAPTURE_CONTENT === 'true', fetchFn };
  if (target === 'phoenix') {
    const baseUrl = present(env.PHOENIX_BASE_URL) ? env.PHOENIX_BASE_URL : env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (present(baseUrl)) return phoenixScoreExport(baseUrl, env.PHOENIX_API_KEY, options);
    console.warn('[score-export] MEDIFORCE_SCORE_EXPORT=phoenix needs PHOENIX_BASE_URL or OTEL_EXPORTER_OTLP_ENDPOINT; Scores are not exported');
    return null;
  }
  if (target === 'langfuse') {
    const { LANGFUSE_BASE_URL: baseUrl, LANGFUSE_PUBLIC_KEY: publicKey, LANGFUSE_SECRET_KEY: secretKey } = env;
    if (present(baseUrl) && present(publicKey) && present(secretKey)) {
      return langfuseScoreExport(baseUrl, publicKey, secretKey, options);
    }
    console.warn('[score-export] MEDIFORCE_SCORE_EXPORT=langfuse needs LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY; Scores are not exported');
    return null;
  }
  console.warn(`[score-export] unknown MEDIFORCE_SCORE_EXPORT '${target}' (phoenix | langfuse); Scores are not exported`);
  return null;
}

/**
 * Stores the Score, then sends it to the target in the background. Only a
 * Score of an Agent Run recorded with its trace is sent; an export that fails
 * is logged and never fails or delays the write.
 */
export class ExportingScoreRepository implements ScoreRepository {
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly inner: ScoreRepository,
    private readonly agentRuns: AgentRunRepository,
    private readonly target: ScoreExportTarget,
  ) {}

  async create(score: Score): Promise<Score> {
    const created = await this.inner.create(score);
    const sending = this.send(created).finally(() => this.inFlight.delete(sending));
    this.inFlight.add(sending);
    return created;
  }

  list(filter: ListScoresFilter): Promise<Score[]> {
    return this.inner.list(filter);
  }

  listInNamespaces(allowed: readonly string[], filter: ListScoresFilter): Promise<Score[]> {
    return this.inner.listInNamespaces(allowed, filter);
  }

  /** Waits for the exports started so far. */
  async flush(): Promise<void> {
    await Promise.all([...this.inFlight]);
  }

  private async send(score: Score): Promise<void> {
    try {
      if (score.subject.type !== 'agent_run') return;
      const trace = (await this.agentRuns.getById(score.subject.id))?.trace ?? null;
      if (trace === null) return;
      await this.target.send(score, trace);
    } catch (err) {
      console.warn(`[score-export] Score ${score.id} was not exported to ${this.target.name}:`, err instanceof Error ? err.message : err);
    }
  }
}

/** The Score repository, exporting when `MEDIFORCE_SCORE_EXPORT` is configured. */
export function withScoreExport(inner: ScoreRepository, agentRuns: AgentRunRepository, env: Env): ScoreRepository {
  const target = scoreExportFromEnv(env);
  if (target === null) return inner;
  console.log(`[score-export] Scores are exported to ${target.name}`);
  return new ExportingScoreRepository(inner, agentRuns, target);
}
