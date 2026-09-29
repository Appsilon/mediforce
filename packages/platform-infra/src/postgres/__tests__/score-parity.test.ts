import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemoryScoreRepository } from '@mediforce/platform-core';
import type { Score, ScoreRepository } from '@mediforce/platform-core';
import { PostgresScoreRepository } from '../repositories/score-repository';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

function buildScore(overrides: Partial<Score> = {}): Score {
  return {
    id: randomUUID(),
    subject: { type: 'agent_run', id: randomUUID() },
    name: 'human_verdict',
    value: 1,
    label: 'approve',
    comment: 'Hy\'s Law criteria correctly flagged.',
    source: 'human',
    createdBy: 'user-reviewer',
    metadata: { verdictKey: 'approve', intent: 'success' },
    namespace: 'ws-1',
    processInstanceId: 'instance-1',
    stepId: 'review-safety',
    evaluatorId: null,
    supersedes: null,
    createdAt: '2026-09-23T08:00:00.000Z',
    ...overrides,
  };
}

function contract(name: string, factory: () => Promise<ScoreRepository>) {
  describe(`${name} — ScoreRepository contract`, () => {
    let repo: ScoreRepository;

    beforeEach(async () => {
      repo = await factory();
    });

    it('round-trips every field', async () => {
      const score = buildScore();
      expect(await repo.create(score)).toEqual(score);
      expect(await repo.list({ limit: 10 })).toEqual([score]);
    });

    it('filters by agent run, run, step and name, newest first', async () => {
      const agentRunId = randomUUID();
      const older = buildScore({ subject: { type: 'agent_run', id: agentRunId }, createdAt: '2026-09-23T08:00:00.000Z' });
      const newer = buildScore({ subject: { type: 'agent_run', id: agentRunId }, createdAt: '2026-09-23T09:00:00.000Z' });
      const otherStep = buildScore({ stepId: 'extract-ae' });
      const runLevel = buildScore({ subject: { type: 'workflow_run', id: 'instance-1' }, name: 'final_verdict' });
      for (const score of [older, newer, otherStep, runLevel]) await repo.create(score);

      expect((await repo.list({ agentRunId, limit: 10 })).map((score) => score.id)).toEqual([newer.id, older.id]);
      expect(await repo.list({ stepId: 'extract-ae', limit: 10 })).toEqual([otherStep]);
      expect(await repo.list({ name: 'final_verdict', limit: 10 })).toEqual([runLevel]);
      expect(await repo.list({ processInstanceId: 'instance-1', limit: 2 })).toHaveLength(2);
    });

    it('keeps a superseded Score and its correction side by side', async () => {
      const original = await repo.create(buildScore({ value: 0, label: 'reject' }));
      const correction = await repo.create(buildScore({
        supersedes: original.id,
        createdAt: '2026-09-23T10:00:00.000Z',
      }));

      expect((await repo.list({ limit: 10 })).map((score) => score.id)).toEqual([correction.id, original.id]);
    });

    it('scopes by workspace', async () => {
      await repo.create(buildScore({ namespace: 'ws-1' }));
      await repo.create(buildScore({ namespace: 'ws-2' }));

      expect(await repo.listInNamespaces(['ws-2'], { limit: 10 })).toHaveLength(1);
      expect(await repo.listInNamespaces(['ws-1'], { namespace: 'ws-2', limit: 10 })).toEqual([]);
      expect(await repo.listInNamespaces([], { limit: 10 })).toEqual([]);
    });
  });
}

contract('InMemoryScoreRepository', async () => new InMemoryScoreRepository());

describe.skipIf(skipPg)('PostgresScoreRepository (parity)', () => {
  const schemaName = `score_${randomBytes(8).toString('hex')}`;
  let adminClient: ReturnType<typeof postgres>;
  let testClient: ReturnType<typeof postgres>;

  beforeAll(async () => {
    adminClient = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
    await adminClient.unsafe(`CREATE SCHEMA "${schemaName}"`);
    testClient = postgres(DATABASE_URL!, {
      max: 4,
      onnotice: () => {},
      connection: { search_path: schemaName },
    });
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      await testClient.unsafe(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8'));
    }
    await testClient.unsafe(
      `INSERT INTO "${schemaName}"."workspaces" (handle, type, display_name) VALUES ('ws-1', 'organization', 'ws-1'), ('ws-2', 'organization', 'ws-2')`,
    );
  });

  afterAll(async () => {
    if (testClient) await testClient.end();
    if (adminClient) {
      await adminClient.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
      await adminClient.end();
    }
  });

  contract('PostgresScoreRepository', async () => {
    await testClient.unsafe(`TRUNCATE TABLE "${schemaName}"."scores"`);
    return new PostgresScoreRepository(drizzle(testClient, { schema }));
  });

  it('rejects a value outside 0–1 at the database', async () => {
    await expect(testClient.unsafe(
      `INSERT INTO "${schemaName}"."scores" (id, workspace, subject_type, subject_id, name, value, source) ` +
        `VALUES ($1, 'ws-1', 'agent_run', 'x', 'n', 1.5, 'human')`,
      [randomUUID()],
    )).rejects.toThrow(/scores_value_range/);
  });
});
