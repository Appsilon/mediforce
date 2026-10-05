import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InMemoryAgentRunRepository,
  InMemoryScoreRepository,
  buildAgentRun,
  type Score,
} from '@mediforce/platform-core';
import { ExportingScoreRepository, scoreExportFromEnv, withScoreExport } from '../score-export';

const TRACE = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) };

function buildScore(agentRunId: string, overrides: Partial<Score> = {}): Score {
  return {
    id: randomUUID(),
    subject: { type: 'agent_run', id: agentRunId },
    name: 'grade-5-is-fatal',
    value: 0,
    label: 'fail',
    comment: 'Grade 5 adverse event recorded as non-fatal for subject 1042',
    source: 'llm_judge',
    createdBy: null,
    metadata: { production: true, evaluatorVersion: 2 },
    namespace: 'acme',
    processInstanceId: 'instance-1',
    stepId: 'extract-ae',
    evaluatorId: 'evaluator-1',
    supersedes: null,
    createdAt: '2026-09-25T10:00:00.000Z',
    ...overrides,
  };
}

function recordingFetch(status = 202) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    return new Response('{}', { status });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

describe('Score export', () => {
  let agentRuns: InMemoryAgentRunRepository;
  let scores: InMemoryScoreRepository;

  beforeEach(async () => {
    agentRuns = new InMemoryAgentRunRepository();
    scores = new InMemoryScoreRepository();
    await agentRuns.create(buildAgentRun({ id: 'traced-run', trace: TRACE }));
    await agentRuns.create(buildAgentRun({ id: 'untraced-run', trace: null }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('is off unless MEDIFORCE_SCORE_EXPORT names a target, and off when that target is not configured', () => {
    const inner = new InMemoryScoreRepository();
    expect(withScoreExport(inner, agentRuns, {})).toBe(inner);
    expect(scoreExportFromEnv({ MEDIFORCE_SCORE_EXPORT: '' })).toBeNull();
    expect(scoreExportFromEnv({ MEDIFORCE_SCORE_EXPORT: 'phoenix' })).toBeNull();
    expect(scoreExportFromEnv({ MEDIFORCE_SCORE_EXPORT: 'langfuse', LANGFUSE_BASE_URL: 'http://langfuse:3000' })).toBeNull();
    expect(scoreExportFromEnv({ MEDIFORCE_SCORE_EXPORT: 'datadog' })).toBeNull();
  });

  it('annotates the Agent Run span in Phoenix, at the OTLP endpoint by default, without the comment unless content capture is on', async () => {
    const { calls, fetchFn } = recordingFetch();
    const target = scoreExportFromEnv({ MEDIFORCE_SCORE_EXPORT: 'phoenix', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://phoenix:6006/' }, fetchFn)!;
    const repo = new ExportingScoreRepository(scores, agentRuns, target);

    const score = await repo.create(buildScore('traced-run'));
    await repo.flush();

    expect(await scores.list({ limit: 10 })).toEqual([score]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://phoenix:6006/v1/span_annotations?sync=false');
    expect(calls[0]!.body).toEqual({
      data: [{
        span_id: TRACE.spanId,
        name: 'grade-5-is-fatal',
        annotator_kind: 'LLM',
        result: { score: 0, label: 'fail', explanation: null },
        metadata: {
          production: true,
          evaluatorVersion: 2,
          mediforceScoreId: score.id,
          source: 'llm_judge',
          evaluatorId: 'evaluator-1',
          label: 'fail',
        },
      }],
    });
  });

  it('writes a Langfuse score on the trace and observation, with the comment when content capture is on', async () => {
    const { calls, fetchFn } = recordingFetch(200);
    const target = scoreExportFromEnv({
      MEDIFORCE_SCORE_EXPORT: 'langfuse',
      LANGFUSE_BASE_URL: 'http://langfuse:3000',
      LANGFUSE_PUBLIC_KEY: 'pk-lf',
      LANGFUSE_SECRET_KEY: 'sk-lf',
      MEDIFORCE_OTEL_CAPTURE_CONTENT: 'true',
    }, fetchFn)!;
    const repo = new ExportingScoreRepository(scores, agentRuns, target);

    const score = await repo.create(buildScore('traced-run', { source: 'deterministic', value: 1, label: null }));
    await repo.flush();

    expect(calls[0]!.url).toBe('http://langfuse:3000/api/public/scores');
    expect(calls[0]!.headers.authorization).toBe(`Basic ${Buffer.from('pk-lf:sk-lf').toString('base64')}`);
    expect(calls[0]!.body).toMatchObject({
      id: score.id,
      traceId: TRACE.traceId,
      observationId: TRACE.spanId,
      name: 'grade-5-is-fatal',
      value: 1,
      dataType: 'NUMERIC',
      comment: 'Grade 5 adverse event recorded as non-fatal for subject 1042',
    });
  });

  it('skips Scores with no trace to sit next to', async () => {
    const { calls, fetchFn } = recordingFetch();
    const repo = new ExportingScoreRepository(scores, agentRuns, scoreExportFromEnv({ MEDIFORCE_SCORE_EXPORT: 'phoenix', PHOENIX_BASE_URL: 'http://phoenix:6006' }, fetchFn)!);

    await repo.create(buildScore('untraced-run'));
    await repo.create(buildScore('missing-run'));
    await repo.create(buildScore('traced-run', { subject: { type: 'workflow_run', id: 'instance-1' } }));
    await repo.flush();

    expect(calls).toEqual([]);
    expect(await scores.list({ limit: 10 })).toHaveLength(3);
  });

  it('keeps the Score when the target refuses it', async () => {
    const { fetchFn } = recordingFetch(500);
    const repo = new ExportingScoreRepository(scores, agentRuns, scoreExportFromEnv({ MEDIFORCE_SCORE_EXPORT: 'phoenix', PHOENIX_BASE_URL: 'http://phoenix:6006' }, fetchFn)!);

    const score = await repo.create(buildScore('traced-run'));
    await repo.flush();

    expect(await scores.list({ limit: 10 })).toEqual([score]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('was not exported to phoenix'), expect.stringContaining('500'));
  });
});
