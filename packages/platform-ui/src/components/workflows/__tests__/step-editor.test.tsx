import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_AGENT_IMAGE } from '@mediforce/platform-core';
import type { WorkflowStep } from '@mediforce/platform-core';
import type { DockerImageInfo } from '@mediforce/platform-api/contract';

// ---- Mocks (must be before component import) ----

// Mutable so a test can register plugin metadata; reset to empty in beforeEach.
const pluginState = vi.hoisted(() => ({
  plugins: [] as { name: string; metadata?: Record<string, unknown> }[],
}));

vi.mock('@/hooks/use-plugins', () => ({
  usePlugins: () => ({ plugins: pluginState.plugins }),
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ handle: 'test' }),
}));

vi.mock('@/app/actions/workflow-secrets', () => ({
  getWorkflowSecretKeys: () => Promise.resolve([]),
}));

// The role controls read the workspace vocabulary and roster. Mutable so a test
// can hand the editor a specific set of grants; reset in beforeEach.
const rolesState = vi.hoisted(() => ({
  workspaceRoles: { roles: [], workflowNames: [], heldRoles: null, loading: false, error: null } as {
    roles: string[];
    workflowNames: string[];
    heldRoles: string[] | null;
    loading: boolean;
    error: Error | null;
  },
  members: [] as { uid: string; displayName: string | null }[],
}));

vi.mock('@/hooks/use-workspace-roles', () => ({
  useWorkspaceRoles: () => rolesState.workspaceRoles,
}));

vi.mock('@/hooks/use-namespace-members', () => ({
  useNamespaceMembers: () => ({ members: rolesState.members, loading: false, resolved: true }),
}));

import { StepEditor } from '../workflow-editor/step-editor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id: 'step-1',
    name: 'Test Step',
    type: 'creation',
    executor: 'human',
    ...overrides,
  };
}

const noop = () => {};

// The step editor is a single-open accordion with only "Basics" open by default;
// executor config lives in the (collapsed) primary/Advanced cards. Click a card
// header to expand it before asserting its contents.
function expandCard(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

const dockerImages: DockerImageInfo[] = [
  { repository: 'mediforce/golden-image', tag: 'latest', id: 'abc', size: '1GB', created: '1d ago' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StepEditor', () => {
  beforeEach(() => {
    pluginState.plugins = [];
    rolesState.workspaceRoles = {
      roles: [], workflowNames: [], heldRoles: null, loading: false, error: null,
    };
    rolesState.members = [];
  });

  it('[REGRESSION #1025] does not change a new step id while its name is being typed', () => {
    const onChange = vi.fn();

    render(
      <StepEditor
        step={buildStep({ id: 'new-step-1', name: '' })}
        allSteps={[buildStep({ id: 'new-step-1', name: '' }), buildStep({ id: 'input-text', name: 'Input Text' })]}
        onChange={onChange}
      />,
    );

    const nameInput = screen.getByTestId('step-editor').querySelector('input') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'input' } });

    expect(onChange).toHaveBeenLastCalledWith({ name: 'input' });
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'input' }));
  });

  it('[REGRESSION #1025] finalizes a unique generated id on blur', () => {
    const onChange = vi.fn();

    function ControlledStepEditor() {
      const [step, setStep] = React.useState(buildStep({ id: 'new-step-1', name: '' }));
      const existingStep = buildStep({ id: 'input-text', name: 'Input Text' });
      return (
        <StepEditor
          step={step}
          allSteps={[step, existingStep]}
          onChange={(patch) => {
            onChange(patch);
            setStep((current) => ({ ...current, ...patch }));
          }}
        />
      );
    }

    render(<ControlledStepEditor />);
    const nameInput = screen.getByTestId('step-editor').querySelector('input') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'input text' } });
    expect(onChange).toHaveBeenLastCalledWith({ name: 'input text' });

    fireEvent.blur(nameInput);

    expect(onChange).toHaveBeenLastCalledWith({ id: 'input-text-2' });
  });

  it('[RENDER] step type badge visible without expanding details', () => {
    render(
      <StepEditor
        step={buildStep({ type: 'creation' })}
        allSteps={[buildStep({ type: 'creation' })]}
        onChange={noop}
      />,
    );

    // "Creation" appears in both the header icon bar and the locked type field
    const matches = screen.getAllByText('Creation');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('[RENDER] step type label shows Creation not Input', () => {
    render(
      <StepEditor
        step={buildStep({ type: 'creation' })}
        allSteps={[buildStep({ type: 'creation' })]}
        onChange={noop}
      />,
    );

    expect(screen.getAllByText('Creation').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Input')).not.toBeInTheDocument();
  });

  it('[RENDER] no step type change buttons exist', () => {
    render(
      <StepEditor
        step={buildStep({ type: 'creation' })}
        allSteps={[buildStep({ type: 'creation' })]}
        onChange={noop}
      />,
    );

    // There should be no buttons that allow changing the step type
    const allButtons = screen.getAllByRole('button');
    const typeChangeLabels = ['Creation', 'Review', 'Decision', 'End'];
    for (const label of typeChangeLabels) {
      const matchingButtons = allButtons.filter(
        (btn) => btn.textContent?.trim() === label,
      );
      expect(matchingButtons).toHaveLength(0);
    }
  });

  it('[RENDER] terminal step type shows End label', () => {
    render(
      <StepEditor
        step={buildStep({ type: 'terminal', name: 'Complete' })}
        allSteps={[buildStep({ type: 'terminal', name: 'Complete' })]}
        onChange={noop}
      />,
    );

    // "End" appears in both the header icon bar and the locked type field
    expect(screen.getAllByText('End').length).toBeGreaterThanOrEqual(1);
  });

  it('[RENDER] lock icon present on step type badge', () => {
    render(
      <StepEditor
        step={buildStep({ type: 'creation' })}
        allSteps={[buildStep({ type: 'creation' })]}
        onChange={noop}
      />,
    );

    const badge = screen.getByTitle(
      'Step type is set at creation. To change, remove this step and add a new one.',
    );
    expect(badge).toBeInTheDocument();
  });

  // ── New: icon header ──────────────────────────────────────────────────────

  it('[RENDER] header shows step name prominently', () => {
    render(
      <StepEditor
        step={buildStep({ name: 'My Agent Step', executor: 'agent', type: 'creation' })}
        allSteps={[]}
        onChange={noop}
      />,
    );

    // Step name appears in the header
    expect(screen.getByText('My Agent Step')).toBeInTheDocument();
  });

  it('[RENDER] header shows Agent label for assist agent step (L2)', () => {
    render(
      <StepEditor
        step={buildStep({ executor: 'agent', autonomyLevel: 'L2', type: 'creation' })}
        allSteps={[]}
        onChange={noop}
      />,
    );

    expect(screen.getAllByText('Agent').length).toBeGreaterThanOrEqual(1);
  });

  it('[RENDER] header shows Human executor label for human step', () => {
    render(
      <StepEditor
        step={buildStep({ executor: 'human', type: 'creation' })}
        allSteps={[]}
        onChange={noop}
      />,
    );

    expect(screen.getAllByText('Human').length).toBeGreaterThanOrEqual(1);
  });

  it('[RENDER] header shows Script executor label for script step', () => {
    render(
      <StepEditor
        step={buildStep({ executor: 'script', type: 'creation' })}
        allSteps={[]}
        onChange={noop}
      />,
    );

    expect(screen.getAllByText('Script').length).toBeGreaterThanOrEqual(1);
  });

  it('[RENDER] header shows Review type label for review step', () => {
    render(
      <StepEditor
        step={buildStep({ type: 'review', executor: 'human' })}
        allSteps={[]}
        onChange={noop}
      />,
    );

    expect(screen.getAllByText('Review').length).toBeGreaterThanOrEqual(1);
  });

  // ── New: tooltip info icons ───────────────────────────────────────────────

  it('[RENDER] tooltip info icons are present on identity fields', () => {
    render(
      <StepEditor
        step={buildStep()}
        allSteps={[]}
        onChange={noop}
      />,
    );

    // Identity fields (name, id, description, type, executor) all have tooltips.
    // FieldTooltip renders with data-testid="field-tooltip-trigger".
    const tooltipTriggers = document.querySelectorAll('[data-testid="field-tooltip-trigger"]');
    expect(tooltipTriggers.length).toBeGreaterThan(0);
  });

  it('[RENDER] agent config fields are shown for agent executor', () => {
    render(
      <StepEditor
        step={buildStep({ executor: 'agent' })}
        allSteps={[]}
        onChange={noop}
      />,
    );

    expandCard('Prompt & model');
    // Agent-specific labels should be visible (rendered via humanizeToken)
    expect(screen.getAllByText('Autonomy Level').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Agent ID')).toBeInTheDocument();
    expect(screen.getByText('Agent Model')).toBeInTheDocument();
    expect(screen.getByText('Agent Prompt')).toBeInTheDocument();
  });

  it('[RENDER] script config fields are shown for script executor', () => {
    render(
      <StepEditor
        step={buildStep({ executor: 'script' })}
        allSteps={[]}
        onChange={noop}
      />,
    );

    expandCard('Script');
    expect(screen.getByText('Script Runtime')).toBeInTheDocument();
    expect(screen.getByText('Script Command')).toBeInTheDocument();
    expect(screen.getByText('Script Inline Script')).toBeInTheDocument();
  });

  it('[RENDER] human config shows allowedRoles field', () => {
    render(
      <StepEditor
        step={buildStep({ executor: 'human' })}
        allSteps={[]}
        onChange={noop}
      />,
    );

    expandCard('Advanced');
    expect(screen.getByText('Allowed Roles')).toBeInTheDocument();
  });

  it('[RENDER] no placeholder text on regular inputs', () => {
    render(
      <StepEditor
        step={buildStep({ executor: 'agent' })}
        allSteps={[]}
        onChange={noop}
      />,
    );

    // Regular inputs (not textareas) should have no placeholder text
    const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
    const inputsWithPlaceholder = Array.from(inputs).filter(
      (el) => el.getAttribute('placeholder') !== null && el.getAttribute('placeholder') !== '',
    );
    expect(inputsWithPlaceholder).toHaveLength(0);
  });

  it('[REGRESSION] allows custom agent image entry when Docker images are discovered', () => {
    const onChange = vi.fn();
    render(
      <StepEditor
        step={buildStep({ executor: 'agent' })}
        allSteps={[]}
        onChange={onChange}
        dockerImages={dockerImages}
      />,
    );

    expandCard('Prompt & model');
    fireEvent.change(screen.getByLabelText('Custom Docker image'), {
      target: { value: 'python:3.11-slim' },
    });

    expect(onChange).toHaveBeenCalledWith({ agent: { image: 'python:3.11-slim' } });
  });

  // Picking a minimal base image for an agent step fails at container start —
  // it carries no agent CLI. The picker offers every discovered image equally,
  // so it must at least say which one works and what leaving it blank does.
  describe('agent image picker', () => {
    const mixedImages: DockerImageInfo[] = [
      { repository: 'alpine', tag: '3.24', id: 'a1', size: '8MB', created: '1d ago' },
      { repository: 'mediforce-golden-image', tag: 'latest', id: 'g1', size: '1GB', created: '1d ago' },
    ];

    function renderAgentStep(
      step: Partial<WorkflowStep> = {},
      workflowExternalSkillsRepo?: { url: string; commit: string },
    ) {
      render(
        <StepEditor
          step={buildStep({ executor: 'agent', ...step })}
          allSteps={[]}
          onChange={noop}
          dockerImages={mixedImages}
          workflowExternalSkillsRepo={workflowExternalSkillsRepo}
        />,
      );
      expandCard('Prompt & model');
      return screen.getByLabelText('Known Docker image') as HTMLSelectElement;
    }

    it('[RENDER] the blank option names the image the platform falls back to', () => {
      const select = renderAgentStep();
      expect(select.options[0].textContent).toContain('mediforce-golden-image');
    });

    it('[RENDER] marks the golden image as recommended and lists it first', () => {
      const select = renderAgentStep();
      const listed = Array.from(select.options).slice(1).map((o) => o.textContent ?? '');
      expect(listed[0]).toBe('★ mediforce-golden-image:latest');
      expect(listed).toContain('alpine:3.24');
    });

    it('[RENDER] a build-mode step reports its build source instead of the default', () => {
      const select = renderAgentStep({
        agent: { repo: 'https://github.com/acme/wf.git', commit: 'abc1234', dockerfile: 'Dockerfile' },
      });
      expect(select.options[0].textContent).not.toContain('mediforce-golden-image');
      expect(select.options[0].textContent).toContain('agent.repo');
    });

    it('[RENDER] a workflow-level build source is reflected in the blank option', () => {
      const select = renderAgentStep(
        { agent: { dockerfile: 'Dockerfile' } },
        { url: 'https://github.com/acme/wf.git', commit: 'abc1234' },
      );
      expect(select.options[0].textContent).not.toContain(DEFAULT_AGENT_IMAGE);
      expect(select.options[0].textContent).toContain('workflow');
    });

    it('[REGRESSION] treats the untagged persisted default as the discovered latest image', () => {
      const select = renderAgentStep({ agent: { image: DEFAULT_AGENT_IMAGE } });
      const matchingOptions = Array.from(select.options).filter(
        (option) => option.value === DEFAULT_AGENT_IMAGE || option.value === `${DEFAULT_AGENT_IMAGE}:latest`,
      );
      expect(matchingOptions).toHaveLength(1);
      expect(select.value).toBe(DEFAULT_AGENT_IMAGE);
    });

    it('[RENDER] the script picker keeps a neutral blank option — no agent default applies', () => {
      render(
        <StepEditor
          step={buildStep({ executor: 'script' })}
          allSteps={[]}
          onChange={noop}
          dockerImages={mixedImages}
        />,
      );
      expandCard('Script');
      const select = screen.getByLabelText('Known Docker image') as HTMLSelectElement;
      expect(select.options[0].textContent).not.toContain('mediforce-golden-image');
    });
  });

  describe('parameters — issue #1031 (unnamed parameters)', () => {
    it('[RENDER] flags a parameter with a blank name', () => {
      render(
        <StepEditor
          step={buildStep({ params: [{ name: '', type: 'string', required: false }] })}
          allSteps={[]}
          onChange={noop}
        />,
      );
      expandCard('Task setup');
      expect(screen.getByText('This field cannot be empty.')).toBeInTheDocument();
    });

    it('[RENDER] flags duplicate parameter names on the same step', () => {
      render(
        <StepEditor
          step={buildStep({
            params: [
              { name: 'amount', type: 'string', required: false },
              { name: 'amount', type: 'string', required: false },
            ],
          })}
          allSteps={[]}
          onChange={noop}
        />,
      );
      expandCard('Task setup');
      expect(screen.getAllByText('Duplicate parameter name.')).toHaveLength(2);
    });

    it('[RENDER] does not flag a uniquely named parameter', () => {
      render(
        <StepEditor
          step={buildStep({ params: [{ name: 'amount', type: 'string', required: false }] })}
          allSteps={[]}
          onChange={noop}
        />,
      );
      expandCard('Task setup');
      expect(screen.queryByText('This field cannot be empty.')).not.toBeInTheDocument();
      expect(screen.queryByText('Duplicate parameter name.')).not.toBeInTheDocument();
    });
  });

  // Nothing in the editor said how a step's output reaches the next step, and
  // the `/output/result.json` contract a script must honour was knowledge you
  // could only get from the docs.
  describe('data flow guidance — issue #1029', () => {
    function dataFlowText(): string {
      return screen.getByTestId('step-data-flow').textContent ?? '';
    }

    it('[RENDER] a script step spells out the /output file contract', () => {
      render(
        <StepEditor
          step={buildStep({ executor: 'script', plugin: 'script-container' })}
          allSteps={[]}
          onChange={noop}
        />,
      );

      expandCard('Script');
      const text = dataFlowText();
      expect(text).toContain('/output/input.json');
      expect(text).toContain('/output/result.json');
    });

    it('[RENDER] a script step shows the neutral read/write tip', () => {
      render(
        <StepEditor
          step={buildStep({ executor: 'script', script: { runtime: 'python' } })}
          allSteps={[]}
          onChange={noop}
        />,
      );

      expandCard('Script');
      const text = dataFlowText();
      expect(text).toContain('Your script should read');
      expect(text).toContain('json.load');
    });

    it('[RENDER] names the reference downstream steps use, with this step id', () => {
      render(
        <StepEditor
          step={buildStep({ id: 'extract-data', executor: 'script' })}
          allSteps={[]}
          onChange={noop}
        />,
      );

      expandCard('Script');
      expect(dataFlowText()).toContain('${steps.extract-data.');
    });

    it('[RENDER] a human step says its parameter values become the step output', () => {
      render(
        <StepEditor
          step={buildStep({ executor: 'human', params: [{ name: 'amount', type: 'string', required: true }] })}
          allSteps={[]}
          onChange={noop}
        />,
      );

      expandCard('Task setup');
      const text = dataFlowText();
      expect(text).toContain('Parameters');
      expect(text).toContain('${steps.step-1.');
    });

    it('[RENDER] a review step with both params and verdicts says the verdict rides along with the params', () => {
      render(
        <StepEditor
          step={buildStep({
            type: 'review',
            executor: 'human',
            params: [{ name: 'amount', type: 'string', required: true }],
            verdicts: { approve: { target: 'done' } },
          })}
          allSteps={[]}
          onChange={noop}
        />,
      );

      expandCard('Task setup');
      expect(dataFlowText()).toContain('plus the selected verdict');
    });

    it('[RENDER] a decision step explains verdicts route via their own target, not a transition', () => {
      render(
        <StepEditor
          step={buildStep({ type: 'decision', executor: 'human', verdicts: { approve: { target: 'done' } } })}
          allSteps={[]}
          onChange={noop}
        />,
      );

      expandCard('Task setup');
      const text = dataFlowText();
      expect(text).toContain('its own target');
      expect(text).not.toContain('verdict ==');
    });

    it('[RENDER] an http action step points at the parsed JSON body, not the envelope', () => {
      render(
        <StepEditor
          step={buildStep({ executor: 'action', action: { kind: 'http', config: { method: 'GET', url: 'https://example.com' } } })}
          allSteps={[]}
          onChange={noop}
        />,
      );

      expandCard('Action');
      expect(dataFlowText()).toContain('${steps.step-1.body.json.');
    });

    it('[RENDER] a file-upload human step points at its files, not the Parameters form', () => {
      render(
        <StepEditor
          step={buildStep({ executor: 'human', ui: { component: 'file-upload' } })}
          allSteps={[]}
          onChange={noop}
        />,
      );

      expandCard('Task setup');
      const text = dataFlowText();
      expect(text).toContain('{ files }');
      expect(text).toContain('${steps.step-1.files}');
    });

    it('[RENDER] a verdict-only human step (no params) says its output is the verdict', () => {
      render(
        <StepEditor
          step={buildStep({ executor: 'human' })}
          allSteps={[]}
          onChange={noop}
        />,
      );

      expandCard('Task setup');
      const text = dataFlowText();
      expect(text).toContain('{ verdict }');
      expect(text).toContain('${steps.step-1.verdict}');
    });

    it('[RENDER] a registered plugin describes its own contract instead of the fallback', () => {
      pluginState.plugins = [{
        name: 'databricks-job',
        metadata: {
          inputDescription: 'step.databricks: jobId + optional notebookParams.',
          outputDescription: 'JSON object the notebook exits with.',
        },
      }];

      render(
        <StepEditor
          step={buildStep({ executor: 'script', plugin: 'databricks-job' })}
          allSteps={[]}
          onChange={noop}
        />,
      );

      expandCard('Script');
      const text = dataFlowText();
      expect(text).toContain('JSON object the notebook exits with.');
      expect(text).not.toContain('/output/result.json');
    });

    // step.params only reach a task on the engine's human-executor branch.
    it('[RENDER] warns that parameters on a non-human step are never collected', () => {
      render(
        <StepEditor
          step={buildStep({ executor: 'agent' })}
          allSteps={[]}
          onChange={noop}
        />,
      );

      expandCard('Advanced');
      expect(screen.getByText(/only collected on human steps/i)).toBeInTheDocument();
    });

    it('[RENDER] a human step gets no such warning — its parameters are the form', () => {
      render(
        <StepEditor
          step={buildStep({ executor: 'human' })}
          allSteps={[]}
          onChange={noop}
        />,
      );

      expandCard('Task setup');
      expect(screen.queryByText(/only collected on human steps/i)).not.toBeInTheDocument();
    });

    it('[RENDER] terminal steps get no data flow panel — nothing reads them', () => {
      render(
        <StepEditor
          step={buildStep({ type: 'terminal', executor: 'human' })}
          allSteps={[]}
          onChange={noop}
        />,
      );

      expect(screen.queryByTestId('step-data-flow')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Human step: allowedRoles picker and assignedTo combobox (#1252)
  // -------------------------------------------------------------------------

  describe('human step roles', () => {
    /** Renders a human step's Advanced card, where both role controls live. */
    function renderRoles(step: Partial<WorkflowStep> = {}, workflowName = 'tealflow') {
      const onChange = vi.fn();
      render(
        <StepEditor
          step={buildStep({ executor: 'human', ...step })}
          allSteps={[]}
          workflowName={workflowName}
          onChange={onChange}
        />,
      );
      expandCard('Advanced');
      return { onChange };
    }

    function addRole(text: string) {
      const input = screen.getByLabelText('Add an allowed role');
      fireEvent.change(input, { target: { value: text } });
      fireEvent.keyDown(input, { key: 'Enter' });
    }

    it('renders each authored role as its own chip rather than a comma-joined string', () => {
      renderRoles({ allowedRoles: ['reviewer', 'approver'] });

      expect(screen.getByText('reviewer')).toBeInTheDocument();
      expect(screen.getByText('approver')).toBeInTheDocument();
    });

    it('round-trips a picked role into allowedRoles', () => {
      rolesState.workspaceRoles = {
        roles: ['approver', 'reviewer'], workflowNames: ['tealflow'],
        heldRoles: ['approver', 'reviewer'], loading: false, error: null,
      };
      const { onChange } = renderRoles({ allowedRoles: ['reviewer'] });

      addRole('approver');

      expect(onChange).toHaveBeenCalledWith({ allowedRoles: ['reviewer', 'approver'] });
    });

    it('accepts a role nobody holds yet — the vocabulary is a pick-list, not a validator', () => {
      rolesState.workspaceRoles = {
        roles: ['reviewer'], workflowNames: ['tealflow'], heldRoles: ['reviewer'],
        loading: false, error: null,
      };
      const { onChange } = renderRoles();

      addRole('principal-investigator');

      expect(onChange).toHaveBeenCalledWith({ allowedRoles: ['principal-investigator'] });
    });

    it('offers the workspace vocabulary as suggestions', () => {
      rolesState.workspaceRoles = {
        roles: ['approver', 'reviewer'], workflowNames: ['tealflow'],
        heldRoles: ['approver'], loading: false, error: null,
      };
      renderRoles();

      const listId = screen.getByLabelText('Add an allowed role').getAttribute('list');
      const options = document.querySelectorAll(`#${listId} option`);
      expect([...options].map((option) => option.getAttribute('value'))).toEqual(['approver', 'reviewer']);
    });

    it('drops allowedRoles entirely when the last chip is removed', () => {
      const { onChange } = renderRoles({ allowedRoles: ['reviewer'] });

      fireEvent.click(screen.getByLabelText('Remove role reviewer'));

      expect(onChange).toHaveBeenCalledWith({ allowedRoles: undefined });
    });

    it('warns about a role nobody holds, without blocking the edit', () => {
      rolesState.workspaceRoles = {
        roles: ['reviewer'], workflowNames: ['tealflow'], heldRoles: [],
        loading: false, error: null,
      };
      const { onChange } = renderRoles({ allowedRoles: ['reviewer'] });

      expect(screen.getByText(/no one holds/i)).toHaveTextContent('reviewer');

      // Authoring a role before granting it is legitimate, so the warning has
      // to leave the field writable — including for a second unheld role.
      addRole('approver');
      expect(onChange).toHaveBeenCalledWith({ allowedRoles: ['reviewer', 'approver'] });
    });

    it('says the step is blocked only when no listed role is held', () => {
      // ADR-0020 seeds every new human step with `reviewer, workflow-manager`,
      // and most workspaces have no reviewer — so on the common step the
      // warning has to name what is missing without claiming a stall that the
      // held role prevents.
      rolesState.workspaceRoles = {
        roles: ['reviewer', 'workflow-manager'],
        workflowNames: ['tealflow'],
        heldRoles: ['workflow-manager'],
        loading: false,
        error: null,
      };
      renderRoles({ allowedRoles: ['reviewer', 'workflow-manager'] });

      const warning = screen.getByText(/no one holds/i);
      expect(warning).toHaveTextContent('reviewer');
      expect(warning).toHaveTextContent('only "workflow-manager" can act on this step');
      expect(warning).not.toHaveTextContent('will block');
    });

    it('[REGRESSION #1252] a holder scoped to another workflow does not silence the warning', () => {
      // `heldRoles` is already scoped to this workflow by the hook, so a grant
      // narrowed to `otherflow` never reaches it.
      rolesState.workspaceRoles = {
        roles: ['reviewer'], workflowNames: ['otherflow', 'tealflow'], heldRoles: [],
        loading: false, error: null,
      };
      renderRoles({ allowedRoles: ['reviewer'] });

      expect(screen.getByText(/no one holds/i)).toBeInTheDocument();
    });

    it('stays quiet when somebody does hold the role here', () => {
      rolesState.workspaceRoles = {
        roles: ['reviewer'], workflowNames: ['tealflow'], heldRoles: ['reviewer'],
        loading: false, error: null,
      };
      renderRoles({ allowedRoles: ['reviewer'] });

      expect(screen.queryByText(/no one holds/i)).not.toBeInTheDocument();
    });

    it('stays quiet while the roster is still unknown — absence of an answer is not a "no"', () => {
      rolesState.workspaceRoles = {
        roles: [], workflowNames: [], heldRoles: null, loading: true, error: null,
      };
      renderRoles({ allowedRoles: ['reviewer'] });

      expect(screen.queryByText(/no one holds/i)).not.toBeInTheDocument();
    });

    it('keeps an interpolation template in assignedTo through an edit', () => {
      rolesState.members = [{ uid: 'uid-alice', displayName: 'Alice' }];
      const { onChange } = renderRoles({ assignedTo: '${triggerPayload.userId}' });

      const input = screen.getByLabelText('Assign this task to') as HTMLInputElement;
      expect(input.value).toBe('${triggerPayload.userId}');

      fireEvent.change(input, { target: { value: '${triggerPayload.reviewerId}' } });
      expect(onChange).toHaveBeenCalledWith({ assignedTo: '${triggerPayload.reviewerId}' });
    });

    it('offers workspace members as assignee suggestions', () => {
      rolesState.members = [
        { uid: 'uid-alice', displayName: 'Alice' },
        { uid: 'uid-bob', displayName: null },
      ];
      renderRoles();

      const listId = screen.getByLabelText('Assign this task to').getAttribute('list');
      const options = document.querySelectorAll(`#${listId} option`);
      expect([...options].map((option) => option.getAttribute('value'))).toEqual(['uid-alice', 'uid-bob']);
    });
  });
});
