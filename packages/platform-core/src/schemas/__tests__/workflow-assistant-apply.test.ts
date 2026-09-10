import { describe, it, expect } from 'vitest';
import type { WorkflowStep, WorkflowDefinition } from '../workflow-definition';
import { applyWorkflowAssistantToolCalls } from '../workflow-assistant-apply';
import { UpdateWorkflowToolSchema } from '../workflow-assistant-tools';
import type { WorkflowAssistantToolCall } from '../workflow-assistant-tools';

type Transitions = WorkflowDefinition['transitions'];

function baseCanvas(): { steps: WorkflowStep[]; transitions: Transitions } {
  return {
    steps: [
      { id: 'draft', name: 'Draft', type: 'creation', executor: 'human' },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'draft', to: 'done' }],
  };
}

describe('applyWorkflowAssistantToolCalls', () => {
  it('defaults an agent step to L3 (matching the assistant prompt), not L2', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'add_step', arguments: { type: 'creation', executor: 'agent', name: 'AI Draft' } },
    ];
    const { steps } = applyWorkflowAssistantToolCalls(baseCanvas().steps, baseCanvas().transitions, calls);
    const added = steps.find((s) => s.id === 'ai-draft');
    expect(added?.autonomyLevel).toBe('L3');
  });

  it('passes ui / assignedTo / continueOnError through to the created step (parity with hand-editing)', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'add_step', arguments: {
        type: 'creation', executor: 'human', name: 'Upload Dataframe',
        ui: { component: 'file-upload', config: { minFiles: 1, maxFiles: 1 } },
        assignedTo: '${triggerPayload.userId}',
        continueOnError: true,
      } },
    ];
    const { steps } = applyWorkflowAssistantToolCalls(baseCanvas().steps, baseCanvas().transitions, calls);
    const added = steps.find((s) => s.id === 'upload-dataframe');
    expect(added?.ui).toEqual({ component: 'file-upload', config: { minFiles: 1, maxFiles: 1 } });
    expect(added?.assignedTo).toBe('${triggerPayload.userId}');
    expect(added?.continueOnError).toBe(true);
  });

  it('assigns a new step the slugified id of its name, not its clientId', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'add_step', arguments: { type: 'creation', executor: 'action', name: 'Send Results Email', clientId: 'email' } },
    ];
    const { steps, addedStepIds } = applyWorkflowAssistantToolCalls(baseCanvas().steps, baseCanvas().transitions, calls);
    expect(addedStepIds).toEqual(['send-results-email']);
    expect(steps.some((s) => s.id === 'send-results-email')).toBe(true);
    expect(steps.some((s) => s.id === 'email')).toBe(false);
  });

  it('falls back to a generated id when the step name has no slug characters', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'add_step', arguments: { type: 'creation', executor: 'human', name: '!!!' } },
    ];
    const { steps, addedStepIds } = applyWorkflowAssistantToolCalls(baseCanvas().steps, baseCanvas().transitions, calls);
    expect(addedStepIds).toEqual(['new-step-1']);
    expect(steps.some((step) => step.id === 'new-step-1')).toBe(true);
  });

  it('inserts a step with no explicit insertion point before the terminal and wires it in — never leaves it disconnected', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'add_step', arguments: { type: 'creation', executor: 'human', name: 'Approve' } },
    ];
    const { transitions } = applyWorkflowAssistantToolCalls(baseCanvas().steps, baseCanvas().transitions, calls);
    expect(transitions).toEqual(expect.arrayContaining([
      { from: 'draft', to: 'approve' },
      { from: 'approve', to: 'done' },
    ]));
    expect(transitions.some((t) => t.from === 'draft' && t.to === 'done')).toBe(false);
  });

  it('applies an update to a step ADDED EARLIER in the same batch — the exact stale-state bug that left steps missing', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'add_step', arguments: { type: 'creation', executor: 'human', name: 'Approve Email', clientId: 'approve' } },
      { tool: 'update_step', arguments: { stepId: 'approve', description: 'Review and approve.' } },
    ];
    const { steps, outcomes } = applyWorkflowAssistantToolCalls(baseCanvas().steps, baseCanvas().transitions, calls);
    expect(outcomes.every((o) => !o.error)).toBe(true);
    expect(steps.find((s) => s.id === 'approve-email')?.description).toBe('Review and approve.');
  });

  it('resolves a verdict target that references an earlier-added step by clientId to that step\'s real id', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'add_step', arguments: { type: 'creation', executor: 'action', name: 'Send Email', clientId: 'email', action: { kind: 'email', config: { to: 'a@b.com', subject: 's', body: 'b' } }, insertAfterId: 'draft', insertBeforeId: 'done' } },
      { tool: 'update_step', arguments: { stepId: 'draft', type: 'decision', verdicts: { approve: { target: 'email' }, reject: { target: 'done' } } } },
    ];
    const { steps } = applyWorkflowAssistantToolCalls(baseCanvas().steps, baseCanvas().transitions, calls);
    const draft = steps.find((s) => s.id === 'draft');
    expect(draft?.verdicts?.approve.target).toBe('send-email');
    expect(draft?.verdicts?.reject.target).toBe('done');
  });

  it('reports an outcome error (and does not throw) when updating a step removed earlier in the same batch', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'remove_step', arguments: { stepId: 'draft' } },
      { tool: 'update_step', arguments: { stepId: 'draft', description: 'x' } },
    ];
    const { outcomes } = applyWorkflowAssistantToolCalls(baseCanvas().steps, baseCanvas().transitions, calls);
    const updateOutcome = outcomes.find((o) => o.tool === 'update_step');
    expect(updateOutcome?.error).toMatch(/doesn't exist/);
  });
});

// The assistant could only ever reach step-level fields: its three tools are
// all step-scoped and the reducer took only (steps, transitions). Everything at
// the workflow level — the input contract, the agent preamble, env — was
// unreachable by prompt no matter how the request was phrased.
describe('applyWorkflowAssistantToolCalls — the workflow level', () => {
  it('sets the input contract the whole workflow validates against', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'update_workflow', arguments: {
        triggerInput: [{ name: 'studyId', type: 'string', required: true }],
      } },
    ];
    const { settings } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps, baseCanvas().transitions, calls,
    );
    expect(settings.triggerInput).toEqual([{ name: 'studyId', type: 'string', required: true }]);
  });

  it('patches rather than replaces, so setting one field keeps the rest', () => {
    const { settings } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps,
      baseCanvas().transitions,
      [{ tool: 'update_workflow', arguments: { preamble: 'House rules.' } }],
      { env: { STUDY_ID: 'CDISCPILOT01' } },
    );
    expect(settings.preamble).toBe('House rules.');
    expect(settings.env).toEqual({ STUDY_ID: 'CDISCPILOT01' });
  });

  it('cannot touch visibility, which has its own control', () => {
    // Its editor on the workflow page PATCHes every version at once; a register
    // writes only the new one, so two controls would disagree.
    expect('visibility' in UpdateWorkflowToolSchema.shape).toBe(false);
  });

  it('merges env and metadata rather than replacing them', () => {
    // "add STUDY_ID to env" must not drop the other variables, and setting a
    // metadata key must not wipe the display name.
    const { settings } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps,
      baseCanvas().transitions,
      [{ tool: 'update_workflow', arguments: { env: { STUDY_ID: 'X' }, metadata: { category: 'safety' } } }],
      { env: { LAKE_PATH: '/output/lake' }, metadata: { displayName: 'Landing Zone' } },
    );
    expect(settings.env).toEqual({ LAKE_PATH: '/output/lake', STUDY_ID: 'X' });
    expect(settings.metadata).toEqual({ displayName: 'Landing Zone', category: 'safety' });
  });

  it('reports which fields it changed, so the pane can summarise the edit', () => {
    const { outcomes } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps,
      baseCanvas().transitions,
      [{ tool: 'update_workflow', arguments: { preamble: 'x', url: 'https://example.com' } }],
    );
    const outcome = outcomes.find((o) => o.tool === 'update_workflow');
    expect(outcome?.error).toBeUndefined();
    expect(outcome?.stepId).toContain('preamble');
  });
});

describe('applyWorkflowAssistantToolCalls — transition conditions', () => {
  it('sets a when expression on an existing edge', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'set_transition_condition', arguments: { from: 'draft', to: 'done', when: 'output.ready == true' } },
    ];
    const { transitions } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps, baseCanvas().transitions, calls,
    );
    expect(transitions).toEqual([{ from: 'draft', to: 'done', when: 'output.ready == true' }]);
  });

  it('clears the condition when given no expression', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'set_transition_condition', arguments: { from: 'draft', to: 'done' } },
    ];
    const { transitions } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps,
      [{ from: 'draft', to: 'done', when: 'output.ready == true' }],
      calls,
    );
    expect(transitions).toEqual([{ from: 'draft', to: 'done' }]);
  });

  it('refuses an edge that does not exist rather than inventing one', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'set_transition_condition', arguments: { from: 'draft', to: 'nowhere', when: 'x == 1' } },
    ];
    const { transitions, outcomes } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps, baseCanvas().transitions, calls,
    );
    expect(transitions).toEqual(baseCanvas().transitions);
    expect(outcomes.find((o) => o.tool === 'set_transition_condition')?.error).toContain('nowhere');
  });
});

// Files a workflow carries. One tool per file rather than the whole set through
// `update_workflow`: a model that has to resend every file to change one will
// eventually drop one, and these are the files a run executes.
describe('applyWorkflowAssistantToolCalls — workflow files', () => {
  const apply = (calls: WorkflowAssistantToolCall[], settings = {}) =>
    applyWorkflowAssistantToolCalls(baseCanvas().steps, baseCanvas().transitions, calls, settings);

  it('writes a file the workflow did not have', () => {
    const { settings } = apply([
      { tool: 'write_workflow_file', arguments: { path: 'scripts/poll.py', contents: 'print("poll")\n' } },
    ]);
    expect(settings.artifacts).toEqual([{ path: 'scripts/poll.py', contents: 'print("poll")\n' }]);
  });

  it('replaces a file at a path it already holds, in place', () => {
    const { settings } = apply(
      [{ tool: 'write_workflow_file', arguments: { path: 'a.py', contents: 'new' } }],
      { artifacts: [{ path: 'z.py', contents: 'z' }, { path: 'a.py', contents: 'old' }] },
    );
    expect(settings.artifacts).toEqual([
      { path: 'z.py', contents: 'z' },
      { path: 'a.py', contents: 'new' },
    ]);
  });

  it('leaves the files it was not asked about alone', () => {
    const { settings } = apply(
      [{ tool: 'write_workflow_file', arguments: { path: 'b.py', contents: 'b' } }],
      { artifacts: [{ path: 'a.py', contents: 'a' }] },
    );
    expect(settings.artifacts).toEqual([
      { path: 'a.py', contents: 'a' },
      { path: 'b.py', contents: 'b' },
    ]);
  });

  it('removes a file', () => {
    const { settings } = apply(
      [{ tool: 'remove_workflow_file', arguments: { path: 'a.py' } }],
      { artifacts: [{ path: 'a.py', contents: 'a' }, { path: 'b.py', contents: 'b' }] },
    );
    expect(settings.artifacts).toEqual([{ path: 'b.py', contents: 'b' }]);
  });

  it('says so rather than reporting a removal that removed nothing', () => {
    const { settings, outcomes } = apply(
      [{ tool: 'remove_workflow_file', arguments: { path: 'nope.py' } }],
      { artifacts: [{ path: 'a.py', contents: 'a' }] },
    );
    expect(settings.artifacts).toEqual([{ path: 'a.py', contents: 'a' }]);
    expect(outcomes.find((o) => o.tool === 'remove_workflow_file')?.error).toContain('nope.py');
  });

  it('drops the list once its last file is removed, rather than leaving it empty', () => {
    const { settings } = apply(
      [{ tool: 'remove_workflow_file', arguments: { path: 'a.py' } }],
      { artifacts: [{ path: 'a.py', contents: 'a' }] },
    );
    expect(settings.artifacts).toBeUndefined();
  });

  it('applies a batch of files in order, which is how a whole package arrives', () => {
    const { settings } = apply([
      { tool: 'write_workflow_file', arguments: { path: 'Dockerfile', contents: 'FROM python:3.12-slim\n' } },
      { tool: 'write_workflow_file', arguments: { path: 'scripts/poll.py', contents: 'print(1)\n' } },
      { tool: 'write_workflow_file', arguments: { path: 'scripts/poll.py', contents: 'print(2)\n' } },
    ]);
    expect(settings.artifacts).toEqual([
      { path: 'Dockerfile', contents: 'FROM python:3.12-slim\n' },
      { path: 'scripts/poll.py', contents: 'print(2)\n' },
    ]);
  });
});

describe('applyWorkflowAssistantToolCalls — a condition on an edge added in the same batch', () => {
  it('resolves a clientId the way every other tool does', () => {
    // Steps and their conditions arrive together: "add a check step and only
    // escalate when severity is high" is one request. Without resolution the
    // condition lands on nothing, because the step it names has no real id yet.
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'add_step', arguments: { clientId: 'check', type: 'creation', executor: 'script', name: 'Check severity', insertAfterId: 'draft', insertBeforeId: 'done' } },
      { tool: 'set_transition_condition', arguments: { from: 'check', to: 'done', when: 'output.severity == "high"' } },
    ];
    const { transitions, outcomes } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps, baseCanvas().transitions, calls,
    );
    expect(outcomes.find((o) => o.tool === 'set_transition_condition')?.error).toBeUndefined();
    expect(transitions).toContainEqual(
      expect.objectContaining({ to: 'done', when: 'output.severity == "high"' }),
    );
  });

  it('still refuses an edge that genuinely does not exist', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'set_transition_condition', arguments: { from: 'draft', to: 'nowhere', when: 'x == 1' } },
    ];
    const { outcomes } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps, baseCanvas().transitions, calls,
    );
    expect(outcomes.find((o) => o.tool === 'set_transition_condition')?.error).toContain('nowhere');
  });
});

describe('applyWorkflowAssistantToolCalls — carry-over between runs', () => {
  it('sets inputForNextRun, which no tool could reach before', () => {
    // "Remember the file listing so the next run can diff against it" is the
    // whole point of a polling workflow, and it had no tool at all.
    const { inputForNextRun } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps, baseCanvas().transitions,
      [{ tool: 'update_workflow', arguments: { inputForNextRun: [{ stepId: 'draft', output: 'listing', as: 'previousListing' }] } }],
    );
    expect(inputForNextRun).toEqual([{ stepId: 'draft', output: 'listing', as: 'previousListing' }]);
  });

  it('resolves a clientId in the step it carries from', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'add_step', arguments: { clientId: 'poll', type: 'creation', executor: 'script', name: 'Poll', insertAfterId: 'draft', insertBeforeId: 'done' } },
      { tool: 'update_workflow', arguments: { inputForNextRun: [{ stepId: 'poll', output: 'listing', as: 'previousListing' }] } },
    ];
    const { inputForNextRun, steps } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps, baseCanvas().transitions, calls,
    );
    const added = steps.find((s) => s.name === 'Poll');
    expect(inputForNextRun?.[0]?.stepId).toBe(added?.id);
  });

  it('leaves carry-over alone when the call does not mention it', () => {
    const { inputForNextRun } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps, baseCanvas().transitions,
      [{ tool: 'update_workflow', arguments: { preamble: 'House rules.' } }],
      {},
      [{ stepId: 'draft', output: 'listing', as: 'previousListing' }],
    );
    expect(inputForNextRun).toEqual([{ stepId: 'draft', output: 'listing', as: 'previousListing' }]);
  });
});

describe('applyWorkflowAssistantToolCalls — a Dockerfile an imported workflow builds from git', () => {
  it('keeps it on a step that pins repo and commit, which is where that file lives', () => {
    const canvas = baseCanvas();
    const withGitBuild: typeof canvas.steps = canvas.steps.map((step) => (step.id === 'draft'
      ? {
        ...step,
        executor: 'script' as const,
        plugin: 'script-container',
        script: {
          command: 'python3 validate.py',
          dockerfile: 'container/Dockerfile',
          repo: 'https://github.com/acme/pipelines.git',
          commit: 'a'.repeat(40),
        },
      }
      : step));
    const { steps } = applyWorkflowAssistantToolCalls(
      withGitBuild, canvas.transitions,
      [{ tool: 'update_step', arguments: { stepId: 'draft', name: 'Validate the extract' } }],
    );
    const draft = steps.find((step) => step.id === 'draft');
    expect(draft?.executor === 'script' ? draft.script?.dockerfile : undefined).toBe('container/Dockerfile');
  });

  it('keeps it when the workflow takes its files from an external repo', () => {
    const canvas = baseCanvas();
    const withRepoFiles: typeof canvas.steps = canvas.steps.map((step) => (step.id === 'draft'
      ? { ...step, executor: 'agent' as const, plugin: 'claude-code-agent', agent: { dockerfile: 'container/Dockerfile' } }
      : step));
    const { steps } = applyWorkflowAssistantToolCalls(
      withRepoFiles, canvas.transitions,
      [{ tool: 'update_step', arguments: { stepId: 'draft', name: 'Interpret' } }],
      { externalSkillsRepo: { url: 'https://github.com/acme/pipelines.git', commit: 'b'.repeat(40) } },
    );
    const draft = steps.find((step) => step.id === 'draft');
    expect(draft?.executor === 'agent' ? draft.agent?.dockerfile : undefined).toBe('container/Dockerfile');
  });
});

describe('applyWorkflowAssistantToolCalls — removing a transition', () => {
  it('drops the edge it names', () => {
    const canvas = baseCanvas();
    const { transitions, outcomes } = applyWorkflowAssistantToolCalls(
      canvas.steps,
      [...canvas.transitions, { from: 'draft', to: 'done', when: 'output.ok == true' }],
      [{ tool: 'remove_transition', arguments: { from: 'draft', to: 'done', when: 'output.ok == true' } }],
    );
    expect(transitions).toEqual(canvas.transitions);
    expect(outcomes.find((outcome) => outcome.tool === 'remove_transition')?.stepId).toBe('draft → done');
  });

  it('removes every edge between the two steps when no condition is named', () => {
    const canvas = baseCanvas();
    const { transitions } = applyWorkflowAssistantToolCalls(
      canvas.steps,
      [{ from: 'draft', to: 'done' }, { from: 'draft', to: 'done', when: 'else' }],
      [{ tool: 'remove_transition', arguments: { from: 'draft', to: 'done' } }],
    );
    expect(transitions.filter((t) => t.from === 'draft' && t.to === 'done')).toEqual([]);
  });

  it('reports an edge that is not there rather than pretending', () => {
    const canvas = baseCanvas();
    const { outcomes } = applyWorkflowAssistantToolCalls(
      canvas.steps, canvas.transitions,
      [{ tool: 'remove_transition', arguments: { from: 'done', to: 'draft' } }],
    );
    expect(outcomes.find((outcome) => outcome.tool === 'remove_transition')?.error)
      .toMatch(/no transition/i);
  });
});

describe('applyWorkflowAssistantToolCalls — an agent step bound to an MCP server', () => {
  it('keeps the agentId and the step restrictions, which is the only route an MCP has to a step', () => {
    const { steps } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps, baseCanvas().transitions,
      [{
        tool: 'add_step',
        arguments: {
          type: 'creation', executor: 'agent', name: 'File the issue',
          agentId: 'issue-filer',
          mcpRestrictions: { github: { denyTools: ['delete_repository'] } },
          insertAfterId: 'draft', insertBeforeId: 'done',
        },
      }],
    );
    const added = steps.find((step) => step.name === 'File the issue');
    expect(added?.agentId).toBe('issue-filer');
    expect(added?.mcpRestrictions).toEqual({ github: { denyTools: ['delete_repository'] } });
  });
});

describe('applyWorkflowAssistantToolCalls — a Dockerfile the workflow does not carry', () => {
  it('keeps it when the file arrives later in the same batch', () => {
    const { steps, outcomes } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps, baseCanvas().transitions,
      [
        {
          tool: 'add_step',
          arguments: {
            type: 'creation', executor: 'script', name: 'Validate',
            insertAfterId: 'draft', insertBeforeId: 'done',
            script: { command: 'python3 /artifacts/scripts/validate.py', dockerfile: 'container/Dockerfile' },
          },
        },
        { tool: 'write_workflow_file', arguments: { path: 'container/Dockerfile', contents: 'FROM python:3.12-slim\n' } },
      ],
    );
    expect(outcomes.every((outcome) => outcome.error === undefined)).toBe(true);
    const added = steps.find((step) => step.name === 'Validate');
    expect(added?.executor === 'script' ? added.script?.dockerfile : undefined).toBe('container/Dockerfile');
  });

  it('drops the dockerfile rather than refusing the step nothing carries a file for', () => {
    const { steps, outcomes } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps, baseCanvas().transitions,
      [{
        tool: 'add_step',
        arguments: {
          type: 'creation', executor: 'script', name: 'Validate',
          insertAfterId: 'draft', insertBeforeId: 'done',
          script: { command: 'python3 /artifacts/scripts/validate.py', dockerfile: 'container/Dockerfile' },
        },
      }],
    );
    expect(outcomes.every((outcome) => outcome.error === undefined)).toBe(true);
    const added = steps.find((step) => step.name === 'Validate');
    expect(added?.executor === 'script' ? added.script?.dockerfile : undefined).toBeUndefined();
    expect(added?.executor === 'script' ? added.script?.command : undefined)
      .toBe('python3 /artifacts/scripts/validate.py');
  });

  it('leaves the step alone when the workflow carries the file', () => {
    const { steps, outcomes } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps, baseCanvas().transitions,
      [{
        tool: 'add_step',
        arguments: {
          type: 'creation', executor: 'script', name: 'Validate',
          insertAfterId: 'draft', insertBeforeId: 'done',
          script: { command: 'python3 /artifacts/run.py', dockerfile: 'Dockerfile' },
        },
      }],
      { artifacts: [{ path: 'Dockerfile', contents: 'FROM python:3.12-slim\n' }] },
    );
    expect(outcomes.find((outcome) => outcome.tool === 'add_step')?.error).toBeUndefined();
    const added = steps.find((step) => step.name === 'Validate');
    expect(added?.executor === 'script' ? added.script?.dockerfile : undefined).toBe('Dockerfile');
  });

  it('leaves a step the batch never touched alone', () => {
    const canvas = baseCanvas();
    const withBuild: typeof canvas.steps = canvas.steps.map((step) => (step.id === 'draft'
      ? { ...step, executor: 'script' as const, plugin: 'script-container', script: { command: 'python3 run.py', dockerfile: 'container/Dockerfile' } }
      : step));
    const { steps } = applyWorkflowAssistantToolCalls(
      withBuild, canvas.transitions,
      [{ tool: 'update_workflow', arguments: { preamble: 'House rules.' } }],
    );
    const draft = steps.find((step) => step.id === 'draft');
    expect(draft?.executor === 'script' ? draft.script?.dockerfile : undefined).toBe('container/Dockerfile');
  });
});

describe('applyWorkflowAssistantToolCalls — a condition on an edge the batch replaced', () => {
  it('puts the condition on the edge that replaced it, rather than refusing', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'add_step', arguments: { clientId: 'validate', type: 'creation', executor: 'script', name: 'Validate', insertAfterId: 'draft', insertBeforeId: 'done' } },
      { tool: 'set_transition_condition', arguments: { from: 'draft', to: 'done', when: 'output.newFiles > 0' } },
    ];
    const { transitions, outcomes } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps, baseCanvas().transitions, calls,
    );
    const outcome = outcomes.find((o) => o.tool === 'set_transition_condition');
    expect(outcome?.error).toBeUndefined();
    expect(transitions).toContainEqual({ from: 'draft', to: 'validate', when: 'output.newFiles > 0' });
    expect(outcome?.stepId).toBe('draft → validate');
  });

  it('refuses when the step branches, because then it would be a guess', () => {
    const canvas = {
      steps: [
        { id: 'draft', name: 'Draft', type: 'creation' as const, executor: 'human' as const },
        { id: 'left', name: 'Left', type: 'creation' as const, executor: 'human' as const },
        { id: 'right', name: 'Right', type: 'creation' as const, executor: 'human' as const },
        { id: 'done', name: 'Done', type: 'terminal' as const, executor: 'human' as const },
      ],
      transitions: [
        { from: 'draft', to: 'left' },
        { from: 'draft', to: 'right' },
        { from: 'left', to: 'done' },
        { from: 'right', to: 'done' },
      ],
    };
    const { outcomes } = applyWorkflowAssistantToolCalls(canvas.steps, canvas.transitions, [
      { tool: 'set_transition_condition', arguments: { from: 'draft', to: 'done', when: 'x == 1' } },
    ]);
    const error = outcomes.find((o) => o.tool === 'set_transition_condition')?.error;
    expect(error).toContain('draft → left');
    expect(error).toContain('draft → right');
  });

  it('says so plainly when the step has no outgoing edge at all', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'set_transition_condition', arguments: { from: 'done', to: 'draft', when: 'x == 1' } },
    ];
    const { outcomes } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps, baseCanvas().transitions, calls,
    );
    expect(outcomes.find((o) => o.tool === 'set_transition_condition')?.error)
      .toContain('nothing leaves "done"');
  });

  it('still names an unknown step as unknown', () => {
    const calls: WorkflowAssistantToolCall[] = [
      { tool: 'set_transition_condition', arguments: { from: 'ghost', to: 'done', when: 'x == 1' } },
    ];
    const { outcomes } = applyWorkflowAssistantToolCalls(
      baseCanvas().steps, baseCanvas().transitions, calls,
    );
    expect(outcomes.find((o) => o.tool === 'set_transition_condition')?.error)
      .toContain('"ghost" is not a step');
  });
});
