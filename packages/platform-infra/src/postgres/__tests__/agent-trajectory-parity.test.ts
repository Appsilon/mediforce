import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  InMemoryAgentRunRepository,
  InMemoryAgentTrajectoryRepository,
  InMemoryProcessInstanceRepository,
  buildAgentRun,
  buildProcessInstance,
} from '@mediforce/platform-core';
import type { AgentTrajectoryRepository } from '@mediforce/platform-core';
import { PostgresAgentTrajectoryRepository } from '../repositories/agent-trajectory-repository';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

const toolCall = { ts: '2026-09-23T08:00:00.000Z', type: 'assistant', subtype: 'tool_call', tool: 'Read', input: { file_path: '/data/ae.csv' } };
const toolResult = { ts: '2026-09-23T08:00:01.000Z', type: 'user', subtype: 'tool_result', tool_use_id: 'toolu_1', content: 'USUBJID,AETERM' };

/**
 * Shared contract for AgentTrajectoryRepository. `createAgentRun` makes an
 * Agent Run in `namespace` and returns its id — the parent every read checks.
 */
function contract(
  name: string,
  factory: () => Promise<{
    repo: AgentTrajectoryRepository;
    createAgentRun: (namespace: string) => Promise<string>;
  }>,
) {
  describe(`${name} — AgentTrajectoryRepository contract`, () => {
    let repo: AgentTrajectoryRepository;
    let createAgentRun: (namespace: string) => Promise<string>;

    beforeEach(async () => {
      ({ repo, createAgentRun } = await factory());
    });

    it('returns appended entries in seq order, extra keys intact', async () => {
      const agentRunId = await createAgentRun('ws-1');
      await repo.append(agentRunId, [{ ...toolResult, seq: 1 }]);
      await repo.append(agentRunId, [{ ...toolCall, seq: 0, cost: 0.02 }]);

      expect(await repo.list(agentRunId)).toEqual([
        { ...toolCall, seq: 0, cost: 0.02 },
        { ...toolResult, seq: 1 },
      ]);
    });

    it('ignores a repeated seq instead of duplicating it', async () => {
      const agentRunId = await createAgentRun('ws-1');
      await repo.append(agentRunId, [{ ...toolCall, seq: 0 }]);
      await repo.append(agentRunId, [{ ...toolResult, seq: 0 }]);

      expect(await repo.list(agentRunId)).toEqual([{ ...toolCall, seq: 0 }]);
    });

    it('is [] for a run that recorded nothing and null for an unknown run', async () => {
      const agentRunId = await createAgentRun('ws-1');

      expect(await repo.list(agentRunId)).toEqual([]);
      expect(await repo.list(randomUUID())).toBeNull();
    });

    it('scopes reads to the run\'s workspace', async () => {
      const agentRunId = await createAgentRun('ws-1');
      await repo.append(agentRunId, [{ ...toolCall, seq: 0 }]);

      expect(await repo.listInNamespaces(agentRunId, ['ws-1'])).toHaveLength(1);
      expect(await repo.listInNamespaces(agentRunId, ['ws-2'])).toBeNull();
      expect(await repo.listInNamespaces(agentRunId, [])).toBeNull();
    });
  });
}

contract('InMemoryAgentTrajectoryRepository', async () => {
  const instances = new InMemoryProcessInstanceRepository();
  const agentRuns = new InMemoryAgentRunRepository(instances);
  return {
    repo: new InMemoryAgentTrajectoryRepository(agentRuns),
    createAgentRun: async (namespace) => {
      const instance = await instances.create(buildProcessInstance({ id: randomUUID(), namespace }));
      const agentRun = await agentRuns.create(buildAgentRun({ id: randomUUID(), processInstanceId: instance.id }));
      return agentRun.id;
    },
  };
});

describe.skipIf(skipPg)('PostgresAgentTrajectoryRepository (parity)', () => {
  const schemaName = `agent_trajectory_${randomBytes(8).toString('hex')}`;
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
  });

  afterAll(async () => {
    if (testClient) await testClient.end();
    if (adminClient) {
      await adminClient.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
      await adminClient.end();
    }
  });

  contract('PostgresAgentTrajectoryRepository', async () => {
    const db = drizzle(testClient, { schema });
    return {
      repo: new PostgresAgentTrajectoryRepository(db),
      createAgentRun: async (namespace) => {
        const instanceId = randomUUID();
        const agentRunId = randomUUID();
        await testClient.unsafe(
          `INSERT INTO "${schemaName}"."workspaces" (handle, type, display_name) VALUES ($1, 'organization', $1) ON CONFLICT DO NOTHING`,
          [namespace],
        );
        await testClient.unsafe(
          `INSERT INTO "${schemaName}"."process_instances" ` +
            `(id, workspace, definition_name, definition_version, status, variables, trigger_type, trigger_payload) ` +
            `VALUES ($1, $2, 'stub-def', '1', 'running', '{}'::jsonb, 'manual', '{}'::jsonb)`,
          [instanceId, namespace],
        );
        await testClient.unsafe(
          `INSERT INTO "${schemaName}"."agent_runs" ` +
            `(id, workspace, process_instance_id, step_id, plugin_id, autonomy_level, status, started_at) ` +
            `VALUES ($1, $2, $3, 'extract', 'claude-code-agent', 'L2', 'running', now())`,
          [agentRunId, namespace, instanceId],
        );
        return agentRunId;
      },
    };
  });
});
