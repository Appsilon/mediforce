import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  InMemoryProcessRepository,
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
  InMemoryHumanTaskRepository,
  WorkflowDefinitionSchema,
  type WorkflowDefinition,
} from '@mediforce/platform-core';
import { WorkflowEngine } from '@mediforce/workflow-engine';

const appDir = resolve(import.meta.dirname, '../..');

function loadWorkflowDefinition(): WorkflowDefinition {
  const raw = JSON.parse(
    readFileSync(resolve(appDir, 'src/backlog-triage.wd.json'), 'utf8'),
  );
  const parsed = WorkflowDefinitionSchema.safeParse({ ...raw, version: 1 });
  if (!parsed.success) {
    throw new Error(`WD invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

const triagerActor = { id: 'user-1', role: 'triager' } as const;

const fakeIssues = [
  { id: '101', label: '#101 Fix login bug', sublabel: 'bug', href: 'https://github.com/owner/repo/issues/101', badges: ['bug'], raw: { issueNumber: 101, title: 'Fix login bug', body: '...', labels: ['bug'] } },
  { id: '102', label: '#102 Add CSV export', sublabel: 'enhancement', href: 'https://github.com/owner/repo/issues/102', badges: ['enhancement'], raw: { issueNumber: 102, title: 'Add CSV export', body: '...', labels: ['enhancement'] } },
  { id: '103', label: '#103 Spike: refactor auth', sublabel: 'tech-debt', href: 'https://github.com/owner/repo/issues/103', badges: ['tech-debt'], raw: { issueNumber: 103, title: 'Spike: refactor auth', body: '...', labels: ['tech-debt'] } },
];

const enrichedIssues = fakeIssues.map((issue, idx) => ({
  ...issue,
  suggestion: {
    assigneeId: idx === 0 ? 'filip' : idx === 1 ? 'fullstack-on-issue' : 'marcin',
    priority: idx === 0 ? 'P0' : idx === 1 ? 'P2' : 'P3',
    note: `auto: ${issue.sublabel}`,
  },
}));

describe('backlog-triage journey', () => {
  describe('engine flow', () => {
    let processRepo: InMemoryProcessRepository;
    let instanceRepo: InMemoryProcessInstanceRepository;
    let auditRepo: InMemoryAuditRepository;
    let humanTaskRepo: InMemoryHumanTaskRepository;
    let engine: WorkflowEngine;
    let wd: WorkflowDefinition;

    beforeEach(async () => {
      processRepo = new InMemoryProcessRepository();
      instanceRepo = new InMemoryProcessInstanceRepository();
      auditRepo = new InMemoryAuditRepository();
      humanTaskRepo = new InMemoryHumanTaskRepository();
      engine = new WorkflowEngine(
        processRepo, instanceRepo, auditRepo,
        undefined, undefined, undefined,
        humanTaskRepo,
      );
      wd = loadWorkflowDefinition();
      await processRepo.saveWorkflowDefinition(wd);
    });

    it('drives the WD from fetch → propose → assign → dispatch → report', async () => {
      const instance = await engine.createInstance(
        'appsilon', 'backlog-triage', 1, 'user-1', 'manual',
        { repo: 'owner/repo' },
      );
      await engine.startInstance(instance.id);

      // fetch-backlog → propose-assignments
      await engine.advanceStep(
        instance.id,
        { options: fakeIssues, repo: 'owner/repo' },
        triagerActor,
      );
      let state = await instanceRepo.getById(instance.id);
      expect(state?.currentStepId).toBe('propose-assignments');
      expect(state?.status).toBe('running');

      // propose-assignments → assign (human, creates task)
      await engine.advanceStep(
        instance.id,
        { options: enrichedIssues, repo: 'owner/repo' },
        triagerActor,
      );
      state = await instanceRepo.getById(instance.id);
      expect(state?.currentStepId).toBe('assign');
      expect(state?.status).toBe('paused');
      expect(state?.pauseReason).toBe('waiting_for_human');

      const tasks = humanTaskRepo.getAll();
      expect(tasks).toHaveLength(1);
      const task = tasks[0];
      expect(task.stepId).toBe('assign');
      expect(task.ui?.component).toBe('assignment-table');
      expect(task.options).toHaveLength(3);
      const config = task.ui?.config as Record<string, unknown>;
      const assignees = config.assignees as Array<{ id: string; kind: string }>;
      expect(assignees.some((a) => a.id === 'filip' && a.kind === 'human')).toBe(true);
      expect(assignees.some((a) => a.id === 'fullstack-on-issue' && a.kind === 'agent')).toBe(true);

      // Resume + advance with assignments (one human, one agent, one skipped via omission)
      const assignments = [
        { itemId: '101', assigneeId: 'filip', assigneeKind: 'human', priority: 'P0', note: 'auto', raw: { issueNumber: 101 } },
        { itemId: '102', assigneeId: 'fullstack-on-issue', assigneeKind: 'agent', priority: 'P2', raw: { issueNumber: 102 } },
      ];
      await instanceRepo.update(instance.id, { status: 'running', pauseReason: null });
      await engine.advanceStep(instance.id, { assignments }, triagerActor);

      state = await instanceRepo.getById(instance.id);
      expect(state?.currentStepId).toBe('dispatch');

      // dispatch → report (terminal)
      await engine.advanceStep(
        instance.id,
        {
          humanAssignments: [{ issueNumber: 101, assignee: 'filip', priority: 'P0' }],
          agentRuns: [{ issueNumber: 102, workflowId: 'fullstack-on-issue', runId: 'run-abc', url: '...' }],
          errors: [],
        },
        triagerActor,
      );

      state = await instanceRepo.getById(instance.id);
      expect(state?.status).toBe('completed');
      expect(state?.currentStepId).toBeNull();
    });

    it('engine carries the assignments output forward to the dispatch step variables', async () => {
      const instance = await engine.createInstance(
        'appsilon', 'backlog-triage', 1, 'user-1', 'manual',
        { repo: 'owner/repo' },
      );
      await engine.startInstance(instance.id);
      await engine.advanceStep(instance.id, { options: fakeIssues, repo: 'owner/repo' }, triagerActor);
      await engine.advanceStep(instance.id, { options: enrichedIssues, repo: 'owner/repo' }, triagerActor);

      const assignments = [
        { itemId: '101', assigneeId: 'filip', assigneeKind: 'human', priority: 'P1', raw: { issueNumber: 101 } },
      ];
      await instanceRepo.update(instance.id, { status: 'running', pauseReason: null });
      await engine.advanceStep(instance.id, { assignments }, triagerActor);

      const state = await instanceRepo.getById(instance.id);
      expect(state?.variables?.assign).toEqual({ assignments });
    });
  });

  describe('inline scripts (HTTP shape)', () => {
    let wd: WorkflowDefinition;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      wd = loadWorkflowDefinition();
      mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    async function runInlineScript(
      script: string,
      inputJson: Record<string, unknown>,
      env: Record<string, string>,
    ): Promise<Record<string, unknown>> {
      const fakeFs = {
        readFileSync: () => JSON.stringify(inputJson),
      };
      let resultPayload: Record<string, unknown> = {};
      const captureWrite = (_path: string, content: string): void => {
        resultPayload = JSON.parse(content);
      };
      const stripImports = script.replace(/^import\s+\{[^}]+\}\s+from\s+'fs';?\s*\n?/m, '');
      const wrapped = `return (async () => {\n${stripImports}\n})();`;
      const fn = new Function('readFileSync', 'writeFileSync', 'process', 'fetch', wrapped);
      try {
        await fn(
          fakeFs.readFileSync,
          captureWrite,
          { env, exit: (code: number) => { throw new ScriptExit(code); } },
          mockFetch,
        );
      } catch (err) {
        if (!(err instanceof ScriptExit)) throw err;
      }
      return resultPayload;
    }

    it('fetch-backlog GETs the repo issues endpoint with the auth header', async () => {
      const step = wd.steps.find((s) => s.id === 'fetch-backlog')!;
      const script = step.agent!.inlineScript!;
      mockFetch.mockResolvedValue(new Response(JSON.stringify([
        { number: 101, title: 'A', body: 'b', labels: [{ name: 'bug' }], html_url: 'https://github.com/owner/repo/issues/101', assignee: null },
      ]), { status: 200, headers: { 'content-type': 'application/json' } }));

      const result = await runInlineScript(
        script,
        { repo: 'owner/repo', labelFilter: 'bug' },
        { GITHUB_TOKEN: 'ghp_xxx' },
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0][0] as URL;
      expect(calledUrl.toString()).toContain('https://api.github.com/repos/owner/repo/issues');
      expect(calledUrl.searchParams.get('state')).toBe('open');
      expect(calledUrl.searchParams.get('labels')).toBe('bug');
      const init = mockFetch.mock.calls[0][1] as { headers: Record<string, string> };
      expect(init.headers.Authorization).toBe('Bearer ghp_xxx');
      const options = result.options as Array<Record<string, unknown>>;
      expect(options).toHaveLength(1);
      expect(options[0].id).toBe('101');
      expect(options[0].label).toBe('#101 A');
    });

    it('dispatch PATCHes GitHub for human assignments and POSTs Mediforce for agent assignments', async () => {
      const step = wd.steps.find((s) => s.id === 'dispatch')!;
      const script = step.agent!.inlineScript!;
      mockFetch
        .mockResolvedValueOnce(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) // GitHub PATCH
        .mockResolvedValueOnce(new Response(JSON.stringify({ instanceId: 'run-abc', status: 'running' }), { status: 200, headers: { 'content-type': 'application/json' } })); // Mediforce POST

      const result = await runInlineScript(
        script,
        {
          repo: 'owner/repo',
          assignments: [
            { itemId: '101', assigneeId: 'filip', assigneeKind: 'human', priority: 'P0', raw: { issueNumber: 101 } },
            { itemId: '102', assigneeId: 'fullstack-on-issue', assigneeKind: 'agent', priority: 'P2', raw: { issueNumber: 102 } },
          ],
        },
        {
          GITHUB_TOKEN: 'ghp_xxx',
          PLATFORM_API_KEY: 'mf_yyy',
          APP_BASE_URL: 'https://mediforce.test',
        },
      );

      expect(mockFetch).toHaveBeenCalledTimes(2);

      const [patchUrl, patchInit] = mockFetch.mock.calls[0];
      expect(patchUrl).toBe('https://api.github.com/repos/owner/repo/issues/101');
      expect((patchInit as { method: string }).method).toBe('PATCH');
      expect((patchInit as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer ghp_xxx');
      const patchBody = JSON.parse((patchInit as { body: string }).body);
      expect(patchBody.assignees).toEqual(['filip']);
      expect(patchBody.labels).toEqual(['priority/P0']);

      const [postUrl, postInit] = mockFetch.mock.calls[1];
      expect(postUrl).toBe('https://mediforce.test/api/processes');
      expect((postInit as { method: string }).method).toBe('POST');
      expect((postInit as { headers: Record<string, string> }).headers['X-Api-Key']).toBe('mf_yyy');
      const postBody = JSON.parse((postInit as { body: string }).body);
      expect(postBody.definitionName).toBe('fullstack-on-issue');
      expect(postBody.triggerName).toBe('manual');
      expect(postBody.payload).toEqual({ issueNumber: 102 });

      expect(result.humanAssignments).toEqual([{ issueNumber: 101, assignee: 'filip', priority: 'P0' }]);
      expect(result.agentRuns).toEqual([
        { issueNumber: 102, workflowId: 'fullstack-on-issue', runId: 'run-abc', url: 'https://mediforce.test/runs/run-abc' },
      ]);
      expect(result.errors).toEqual([]);
    });

    it('dispatch records per-assignment errors but continues', async () => {
      const step = wd.steps.find((s) => s.id === 'dispatch')!;
      const script = step.agent!.inlineScript!;
      mockFetch
        .mockResolvedValueOnce(new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } })) // GitHub PATCH fails
        .mockResolvedValueOnce(new Response(JSON.stringify({ instanceId: 'run-zzz', status: 'running' }), { status: 200, headers: { 'content-type': 'application/json' } }));

      const result = await runInlineScript(
        script,
        {
          repo: 'owner/repo',
          assignments: [
            { itemId: '101', assigneeId: 'filip', assigneeKind: 'human', priority: 'P0', raw: { issueNumber: 101 } },
            { itemId: '102', assigneeId: 'fullstack-on-issue', assigneeKind: 'agent', priority: 'P2', raw: { issueNumber: 102 } },
          ],
        },
        {
          GITHUB_TOKEN: 'ghp_xxx',
          PLATFORM_API_KEY: 'mf_yyy',
          APP_BASE_URL: 'https://mediforce.test',
        },
      );

      const errors = result.errors as Array<Record<string, unknown>>;
      expect(errors).toHaveLength(1);
      expect(errors[0].itemId).toBe('101');
      expect(errors[0].kind).toBe('human');
      const agentRuns = result.agentRuns as Array<Record<string, unknown>>;
      expect(agentRuns).toHaveLength(1);
    });
  });
});

class ScriptExit extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}
