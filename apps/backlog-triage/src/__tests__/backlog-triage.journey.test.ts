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

    it('drives the WD from fetch → check-tags (pass) → propose → assign → dispatch → report', async () => {
      const instance = await engine.createInstance(
        'appsilon', 'backlog-triage', 1, 'user-1', 'manual',
        { repo: 'owner/repo' },
      );
      await engine.startInstance(instance.id);

      // fetch-backlog → check-tags
      await engine.advanceStep(
        instance.id,
        { options: fakeIssues, repo: 'owner/repo' },
        triagerActor,
      );
      let state = await instanceRepo.getById(instance.id);
      expect(state?.currentStepId).toBe('check-tags');

      // check-tags → propose-assignments (all tagged)
      await engine.advanceStep(
        instance.id,
        { needsTagging: false, options: fakeIssues, repo: 'owner/repo' },
        triagerActor,
      );
      state = await instanceRepo.getById(instance.id);
      expect(state?.currentStepId).toBe('propose-assignments');

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

      const assignments = [
        { itemId: '101', assigneeId: 'filip', assigneeKind: 'human', priority: 'P0', note: 'auto', raw: { issueNumber: 101 } },
        { itemId: '102', assigneeId: 'fullstack-on-issue', assigneeKind: 'agent', priority: 'P2', raw: { issueNumber: 102 } },
      ];
      await instanceRepo.update(instance.id, { status: 'running', pauseReason: null });
      await engine.advanceStep(instance.id, { assignments }, triagerActor);

      state = await instanceRepo.getById(instance.id);
      expect(state?.currentStepId).toBe('dispatch');

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
      await engine.advanceStep(instance.id, { needsTagging: false, options: fakeIssues, repo: 'owner/repo' }, triagerActor);
      await engine.advanceStep(instance.id, { options: enrichedIssues, repo: 'owner/repo' }, triagerActor);

      const assignments = [
        { itemId: '101', assigneeId: 'filip', assigneeKind: 'human', priority: 'P1', raw: { issueNumber: 101 } },
      ];
      await instanceRepo.update(instance.id, { status: 'running', pauseReason: null });
      await engine.advanceStep(instance.id, { assignments }, triagerActor);

      const state = await instanceRepo.getById(instance.id);
      expect(state?.variables?.assign).toEqual({ assignments });
    });

    it('routes needsTagging=true → tag-issues (table-editor) → apply-tags → loops to fetch-backlog', async () => {
      const instance = await engine.createInstance(
        'appsilon', 'backlog-triage', 1, 'user-1', 'manual',
        { repo: 'owner/repo' },
      );
      await engine.startInstance(instance.id);

      // fetch-backlog → check-tags
      await engine.advanceStep(instance.id, { options: fakeIssues, repo: 'owner/repo' }, triagerActor);

      // check-tags reports untagged AND carries the untagged issues forward as options
      const untagged = [fakeIssues[0], fakeIssues[1]];
      await engine.advanceStep(
        instance.id,
        { needsTagging: true, untaggedCount: 2, options: untagged, repo: 'owner/repo' },
        triagerActor,
      );

      let state = await instanceRepo.getById(instance.id);
      expect(state?.currentStepId).toBe('tag-issues');
      expect(state?.status).toBe('paused');

      const tasks = humanTaskRepo.getAll();
      expect(tasks).toHaveLength(1);
      const tagTask = tasks[0];
      expect(tagTask.stepId).toBe('tag-issues');
      expect(tagTask.ui?.component).toBe('table-editor');
      // engine copies prevOutput.options onto the human task so the table has rows
      expect(tagTask.options).toHaveLength(2);
      const config = tagTask.ui?.config as Record<string, unknown>;
      const columns = config.columns as Array<{ id: string; kind: string; allowEmpty?: boolean }>;
      expect(columns.find((c) => c.id === 'category')?.allowEmpty).toBe(false);
      expect(columns.some((c) => c.id === 'priority')).toBe(true);

      // Reviewer submits the table → engine routes to apply-tags (no verdict).
      await instanceRepo.update(instance.id, { status: 'running', pauseReason: null });
      await engine.advanceStep(
        instance.id,
        {
          rows: [
            { itemId: '101', values: { category: 'bug', priority: 'P1' } },
            { itemId: '102', values: { category: 'enhancement', priority: 'P2' } },
          ],
        },
        triagerActor,
      );
      state = await instanceRepo.getById(instance.id);
      expect(state?.currentStepId).toBe('apply-tags');

      // apply-tags output loops back to fetch-backlog for a fresh re-check.
      await engine.advanceStep(
        instance.id,
        { applied: [{ itemId: '101', labels: ['bug', 'priority/P1'] }], errors: [], repo: 'owner/repo' },
        triagerActor,
      );
      state = await instanceRepo.getById(instance.id);
      expect(state?.currentStepId).toBe('fetch-backlog');
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

    interface InlineScriptResult {
      result: Record<string, unknown>;
      exitCode: number;
      files: Record<string, string>;
    }

    async function runInlineScriptFull(
      script: string,
      inputJson: Record<string, unknown>,
      env: Record<string, string>,
    ): Promise<InlineScriptResult> {
      const files: Record<string, string> = {};
      let exitCode = 0;
      const captureWrite = (path: string, content: string): void => {
        files[String(path).replace(/^.*\//, '')] = content;
      };
      const stripImports = script.replace(/^import\s+\{[^}]+\}\s+from\s+'fs';?\s*\n?/m, '');
      const wrapped = `return (async () => {\n${stripImports}\n})();`;
      const fn = new Function('readFileSync', 'writeFileSync', 'process', 'fetch', wrapped);
      try {
        await fn(
          () => JSON.stringify(inputJson),
          captureWrite,
          { env, exit: (code: number) => { throw new ScriptExit(code); } },
          mockFetch,
        );
      } catch (err) {
        if (err instanceof ScriptExit) exitCode = err.code;
        else throw err;
      }
      const result = files['result.json'] !== undefined
        ? (JSON.parse(files['result.json']) as Record<string, unknown>)
        : {};
      return { result, exitCode, files };
    }

    async function runInlineScript(
      script: string,
      inputJson: Record<string, unknown>,
      env: Record<string, string>,
    ): Promise<Record<string, unknown>> {
      return (await runInlineScriptFull(script, inputJson, env)).result;
    }

    it('check-tags carries the untagged issues forward as options (no presentation file)', async () => {
      const step = wd.steps.find((s) => s.id === 'check-tags')!;
      const script = step.agent!.inlineScript!;
      const result = await runInlineScript(
        script,
        {
          repo: 'owner/repo',
          options: [
            { id: '101', label: '#101 No labels', href: 'https://github.com/owner/repo/issues/101', badges: [] },
            { id: '102', label: '#102 Has bug label', href: 'https://github.com/owner/repo/issues/102', badges: ['bug'] },
            { id: '103', label: '#103 Random tag', href: 'https://github.com/owner/repo/issues/103', badges: ['triage'] },
          ],
        },
        {},
      );

      expect(result.needsTagging).toBe(true);
      expect(result.untaggedCount).toBe(2); // #101 and #103
      const options = result.options as Array<Record<string, unknown>>;
      expect(options.map((o) => o.id)).toEqual(['101', '103']);
    });

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

    it('fetch-backlog paginates past PRs to collect up to `limit` real issues', async () => {
      const step = wd.steps.find((s) => s.id === 'fetch-backlog')!;
      const script = step.agent!.inlineScript!;
      // Page 1: 100 items — 60 issues + 40 PRs (PRs eat the per_page budget). Page 2: 1 more issue.
      const page1 = Array.from({ length: 100 }, (_, k) =>
        k < 60
          ? { number: 1000 + k, title: `Issue ${k}`, labels: [], html_url: `https://gh/${k}`, assignee: null }
          : { number: 2000 + k, title: `PR ${k}`, pull_request: {}, labels: [], html_url: `https://gh/pr${k}` },
      );
      const page2 = [{ number: 3001, title: 'Oldest in window', labels: [], html_url: 'https://gh/3001', assignee: null }];
      mockFetch
        .mockResolvedValueOnce(new Response(JSON.stringify(page1), { status: 200, headers: { 'content-type': 'application/json' } }))
        .mockResolvedValueOnce(new Response(JSON.stringify(page2), { status: 200, headers: { 'content-type': 'application/json' } }));

      const result = await runInlineScript(script, { repo: 'owner/repo', limit: 70 }, { GITHUB_TOKEN: 'ghp_xxx' });

      // 60 issues on page 1 (< limit 70) → fetch page 2 → 61 issues total; page 2 short-circuits the loop.
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect((mockFetch.mock.calls[0][0] as URL).searchParams.get('page')).toBe('1');
      expect((mockFetch.mock.calls[0][0] as URL).searchParams.get('per_page')).toBe('100');
      expect((mockFetch.mock.calls[1][0] as URL).searchParams.get('page')).toBe('2');
      const options = result.options as Array<Record<string, unknown>>;
      expect(options).toHaveLength(61);
      expect(options.every((o) => !String(o.label).includes('PR'))).toBe(true);
    });

    it('dispatch PATCHes GitHub for human assignments and POSTs Mediforce for agent assignments', async () => {
      const step = wd.steps.find((s) => s.id === 'dispatch')!;
      const script = step.agent!.inlineScript!;
      mockFetch
        .mockResolvedValueOnce(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })) // GitHub POST /labels
        .mockResolvedValueOnce(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) // GitHub POST /assignees
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

      expect(mockFetch).toHaveBeenCalledTimes(3);

      const [labelsUrl, labelsInit] = mockFetch.mock.calls[0];
      expect(labelsUrl).toBe('https://api.github.com/repos/owner/repo/issues/101/labels');
      expect((labelsInit as { method: string }).method).toBe('POST');
      expect((labelsInit as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer ghp_xxx');
      expect(JSON.parse((labelsInit as { body: string }).body)).toEqual({ labels: ['priority/P0'] });

      const [assigneesUrl, assigneesInit] = mockFetch.mock.calls[1];
      expect(assigneesUrl).toBe('https://api.github.com/repos/owner/repo/issues/101/assignees');
      expect((assigneesInit as { method: string }).method).toBe('POST');
      expect(JSON.parse((assigneesInit as { body: string }).body)).toEqual({ assignees: ['filip'] });

      const [postUrl, postInit] = mockFetch.mock.calls[2];
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

    it('dispatch rejects an invalid repo format early', async () => {
      const step = wd.steps.find((s) => s.id === 'dispatch')!;
      const script = step.agent!.inlineScript!;

      await expect(
        runInlineScript(
          script,
          { repo: 'not a repo with spaces', assignments: [] },
          { GITHUB_TOKEN: 'ghp_xxx', PLATFORM_API_KEY: 'mf_yyy', APP_BASE_URL: 'https://mediforce.test' },
        ),
      ).resolves.toEqual({});
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('dispatch records per-assignment errors but continues', async () => {
      const step = wd.steps.find((s) => s.id === 'dispatch')!;
      const script = step.agent!.inlineScript!;
      mockFetch
        .mockResolvedValueOnce(new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } })) // GitHub POST /labels fails — script skips /assignees for this row
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

    it('apply-tags create-if-missing then POSTs the category + priority labels to the issue', async () => {
      const step = wd.steps.find((s) => s.id === 'apply-tags')!;
      const script = step.agent!.inlineScript!;
      mockFetch
        .mockResolvedValueOnce(new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } })) // create 'ux'
        .mockResolvedValueOnce(new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } })) // create 'priority/P1'
        .mockResolvedValueOnce(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })); // apply to issue

      const result = await runInlineScript(
        script,
        { repo: 'owner/repo', rows: [{ itemId: '101', values: { category: 'ux', priority: 'P1' } }] },
        { GITHUB_TOKEN: 'ghp_xxx' },
      );

      expect(mockFetch).toHaveBeenCalledTimes(3);
      const [createUrl, createInit] = mockFetch.mock.calls[0];
      expect(createUrl).toBe('https://api.github.com/repos/owner/repo/labels');
      expect((createInit as { method: string }).method).toBe('POST');
      expect(JSON.parse((createInit as { body: string }).body)).toEqual({ name: 'ux', color: 'ededed' });

      const [applyUrl, applyInit] = mockFetch.mock.calls[2];
      expect(applyUrl).toBe('https://api.github.com/repos/owner/repo/issues/101/labels');
      expect((applyInit as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer ghp_xxx');
      expect(JSON.parse((applyInit as { body: string }).body)).toEqual({ labels: ['ux', 'priority/P1'] });

      expect(result.applied).toEqual([{ itemId: '101', labels: ['ux', 'priority/P1'] }]);
      expect(result.errors).toEqual([]);
    });

    it('apply-tags treats a 422 on label creation as already-exists and still applies', async () => {
      const step = wd.steps.find((s) => s.id === 'apply-tags')!;
      const script = step.agent!.inlineScript!;
      mockFetch
        .mockResolvedValueOnce(new Response('{"message":"already_exists"}', { status: 422, headers: { 'content-type': 'application/json' } })) // create 'security' → exists
        .mockResolvedValueOnce(new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } })) // create 'priority/P0'
        .mockResolvedValueOnce(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })); // apply

      const result = await runInlineScript(
        script,
        { repo: 'owner/repo', rows: [{ itemId: '7', values: { category: 'security', priority: 'P0' } }] },
        { GITHUB_TOKEN: 'ghp_xxx' },
      );

      expect(result.errors).toEqual([]);
      expect(result.applied).toEqual([{ itemId: '7', labels: ['security', 'priority/P0'] }]);
    });

    it('apply-tags records a per-row error on apply failure but continues (partial = non-fatal, still surfaced)', async () => {
      const step = wd.steps.find((s) => s.id === 'apply-tags')!;
      const script = step.agent!.inlineScript!;
      mockFetch
        .mockResolvedValueOnce(new Response('{}', { status: 201 })) // create 'ux' (row 101)
        .mockResolvedValueOnce(new Response('{}', { status: 201 })) // create 'priority/P1' (row 101)
        .mockResolvedValueOnce(new Response('nope', { status: 404, headers: { 'content-type': 'text/plain' } })) // apply 101 → fails
        .mockResolvedValueOnce(new Response('{}', { status: 201 })) // create 'tech-debt' (row 102)
        .mockResolvedValueOnce(new Response('{}', { status: 201 })) // create 'priority/P2' (row 102)
        .mockResolvedValueOnce(new Response('[]', { status: 200 })); // apply 102 → ok

      const { result, exitCode, files } = await runInlineScriptFull(
        script,
        {
          repo: 'owner/repo',
          rows: [
            { itemId: '101', values: { category: 'ux', priority: 'P1' } },
            { itemId: '102', values: { category: 'tech-debt', priority: 'P2' } },
          ],
        },
        { GITHUB_TOKEN: 'ghp_xxx' },
      );

      const errors = result.errors as Array<Record<string, unknown>>;
      expect(errors).toHaveLength(1);
      expect(errors[0].itemId).toBe('101');
      expect(result.applied).toEqual([{ itemId: '102', labels: ['tech-debt', 'priority/P2'] }]);
      // Partial failure: step still succeeds, but the failure is surfaced in a presentation.
      expect(exitCode).toBe(0);
      expect(files['presentation.md']).toMatch(/1 applied, 1 failed/);
    });

    it('apply-tags fails the step (exit 1) and writes a presentation when every row fails', async () => {
      const step = wd.steps.find((s) => s.id === 'apply-tags')!;
      const script = step.agent!.inlineScript!;
      // The create POST fails 403 → add-labels never attempted → the only row errors → total failure.
      mockFetch.mockResolvedValueOnce(new Response('forbidden', { status: 403, headers: { 'content-type': 'text/plain' } }));

      const { result, exitCode, files } = await runInlineScriptFull(
        script,
        { repo: 'owner/repo', rows: [{ itemId: '9', values: { category: 'workflow', priority: 'P1' } }] },
        { GITHUB_TOKEN: 'ghp_xxx' },
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe('https://api.github.com/repos/owner/repo/labels');
      const errors = result.errors as Array<Record<string, unknown>>;
      expect(errors).toHaveLength(1);
      expect(errors[0].step).toBe('create-label');
      expect(result.applied).toEqual([]);
      // Total failure → the step exits non-zero (red run, loop stops). The runner surfaces the
      // first error from the log; it does NOT render a presentation on the failure path, so the
      // script must not waste one there.
      expect(exitCode).toBe(1);
      expect(files['presentation.md']).toBeUndefined();
    });
  });
});

class ScriptExit extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}
