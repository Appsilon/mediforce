import { describe, it, expect } from 'vitest';
import { buildWorkflowAssistantSystemPrompt } from '../system-prompt';

describe('buildWorkflowAssistantSystemPrompt', () => {
  const prompt = buildWorkflowAssistantSystemPrompt();

  it('returns a non-empty string', () => {
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('mentions every canvas-mutation tool and the routing decision', () => {
    for (const term of ['add_step', 'update_step', 'remove_step', 'list_models', 'clarifying question']) {
      expect(prompt).toContain(term);
    }
  });

  it('does not reference any engine-only concepts from the deprecated full-artifact designer', () => {
    expect(prompt).not.toMatch(/update_artifact/);
    expect(prompt).not.toMatch(/render_workflow_diagram/);
  });

  it('warns against exposing internal schema codes (autonomy levels) to the user', () => {
    expect(prompt).toMatch(/L2/);
    expect(prompt).toMatch(/autonomy/i);
    expect(prompt).toMatch(/Default to \`L3\`/);
  });

  it('addresses the starter-template placeholder and step-ID grounding', () => {
    expect(prompt).toMatch(/placeholder/i);
    expect(prompt).toMatch(/clientId/);
    expect(prompt).toMatch(/canvas state/i);
  });

  it('pushes back on defaulting to agent for deterministic work, and allows inline scripts', () => {
    expect(prompt).toMatch(/deterministic/i);
    expect(prompt).toMatch(/inlineScript/);
    expect(prompt).toMatch(/no Docker image, repo, or commit needed/);
  });

  it('forbids narrating tool-call self-correction to the user or leaking it into step fields', () => {
    expect(prompt).toMatch(/Never narrate the correction/);
    expect(prompt).toMatch(/leak into a step's fields/);
  });

  it('forbids claiming a change happened in past tense without calling the tool for it in the same turn', () => {
    expect(prompt).toMatch(/past tense/i);
    expect(prompt).toMatch(/only changes when you call/i);
  });

  it('also forbids announcing an about-to-happen action (trailing colon) without a tool call in the same turn', () => {
    expect(prompt).toMatch(/announcing you're about to act/i);
    expect(prompt).toMatch(/trailing off with a colon/i);
  });

  it('requires closing the loop on missing parameters — infer them or ask a specific, understanding-based question, never leave one silently blank', () => {
    expect(prompt).toMatch(/close the loop/i);
    expect(prompt).toMatch(/never leave one silently missing/i);
    expect(prompt).toMatch(/blank "what should/i);
  });

  it('teaches the file-upload task body for file inputs, plus assignedTo and continueOnError', () => {
    expect(prompt).toMatch(/component: "file-upload"/);
    expect(prompt).toMatch(/\$\{steps\.<id>\.files\}/);
    expect(prompt).toMatch(/assignedTo/);
    expect(prompt).toMatch(/continueOnError/);
  });

  it('tells the model it cannot create triggers and to direct schedule/webhook requests to the Triggers tab', () => {
    expect(prompt).toMatch(/can't create triggers/i);
    expect(prompt).toMatch(/Triggers\*\* tab|Triggers tab|trigger-add/);
    expect(prompt).toMatch(/\$\{triggerPayload\./);
  });

  it('warns that the inline script runtime is stdlib-only and to prefer an agent step for third-party packages', () => {
    expect(prompt).toMatch(/standard-library-only/i);
    expect(prompt).toMatch(/ModuleNotFoundError/);
    expect(prompt).toMatch(/Prefer an `agent` step for anything needing third-party packages/);
  });

  it('tells the model a large build may span several turns and cut-off steps are kept', () => {
    expect(prompt).toMatch(/built across several turns/i);
    expect(prompt).toMatch(/cut off/i);
    expect(prompt).toMatch(/don't cram or cut a build short/i);
  });

  it('tells the model it cannot add or retype a step to terminal — the canvas manages the single terminal', () => {
    expect(prompt).toMatch(/cannot add or change a step to `type: "terminal"`/);
    expect(prompt).toMatch(/point that step's transition \(or a verdict target\) at the existing terminal/);
  });

  it('requires the decision type for verdict steps and treats review as deprecated', () => {
    expect(prompt).toMatch(/type.*must be.*decision.*with a `verdicts` map/);
    expect(prompt).toMatch(/review.*is a deprecated type/i);
    expect(prompt).toMatch(/never create a \*new\* step with `type: "review"`/);
  });

  it('teaches the correct ${steps.id} interpolation syntax for action configs and forbids {{...}} there', () => {
    expect(prompt).toMatch(/\$\{steps\.check-etymology\}/);
    expect(prompt).toMatch(/never `\{\{\.\.\.\}\}`/);
    expect(prompt).toMatch(/reserved for agent\/script step `env`\/secrets/);
  });

  it('requires secrets to be referenced with {{SECRET_NAME}} in a step env, not ${secrets.X}', () => {
    expect(prompt).toMatch(/referenced with `\{\{SECRET_NAME\}\}` in a step's `env` map — never `\$\{secrets\.NAME\}`/);
    expect(prompt).toMatch(/"HARVEST_API_KEY": "\{\{HARVEST_API_KEY\}\}"/);
  });

  it('says how a file crosses from one step to the next, since /output does not survive', () => {
    // The live failure: a reader step written as `pd.read_csv('/output/samples.csv')`,
    // which the producing step really did write, dies with FileNotFoundError
    // because /output is wiped between steps.
    expect(prompt).toMatch(/\/workspace\/\.mediforce\/output\//);
    expect(prompt).toMatch(/wiped|deleted|does not survive/i);
  });

  it('states the only route an MCP server has to a step: a saved agent the step names with agentId', () => {
    // `resolveMcpForStep` returns null when `agentId` is unset, so an inline
    // agent step reaches no MCP at all however the request was phrased. The
    // prompt has to say so, or "use the GitHub MCP" produces a step that
    // silently has none.
    expect(prompt).toMatch(/`agentId`/);
    expect(prompt).toMatch(/no MCP at all|reaches no MCP|gets no MCP/i);
    expect(prompt).toMatch(/list_tool_catalog/);
    expect(prompt).toMatch(/mcpRestrictions/);
  });

  it('documents that update_step can connect an already-existing step, and that every response is graph-checked before finishing', () => {
    expect(prompt).toMatch(/`update_step` also accepts `insertAfterId`\/`insertBeforeId`/);
    expect(prompt).toMatch(/checked for structural completeness/i);
    expect(prompt).toMatch(/no separate "add a transition" tool/i);
  });

  it('requires every verdict target to be a real step id or a clientId — never an invented value that merely sounds right', () => {
    expect(prompt).toMatch(/Every verdict's `target` must be a real step id/);
    expect(prompt).toMatch(/or in a verdict's `target`, within the same response/);
  });

  it('requires a params field on human input steps and explains how collected input flows downstream', () => {
    expect(prompt).toMatch(/needs a `params` array/);
  it('can schedule a saved workflow, and says out loud that an unsaved one cannot be', () => {
    expect(prompt).toMatch(/create_cron_trigger/);
    expect(prompt).toMatch(/never been saved/i);
    expect(prompt).toMatch(/saved at least once/i);
    expect(prompt).toMatch(/Webhooks you cannot create at all/);
    expect(prompt).not.toMatch(/you have no way to create triggers/i);
  });

  it('checks a role exists before leaning on it, and points at Settings for granting one', () => {
    expect(prompt).toMatch(/list_roles/);
    expect(prompt).toMatch(/Settings → Members/);
    expect(prompt).toMatch(/nobody holds it yet/i);
    expect(prompt).toMatch(/Access\*\* tab/);
  });

    expect(prompt).toMatch(/automatically receives the \*immediately preceding\* step's output/);
    expect(prompt).toMatch(/\$\{steps\.share-two-words\.words\}/);
  });

  it('warns that a producer step and a ${steps.x.key} reference must agree on the exact key (blank vs raw-JSON email failures)', () => {
    expect(prompt).toMatch(/producer and the reference MUST agree on the exact key/);
    expect(prompt).toMatch(/renders blank/);
    expect(prompt).toMatch(/dumps raw JSON/);
    expect(prompt).toMatch(/\$\{steps\.analyze\.analysis\}/);
  });

  it('states the physical /output/input.json → /output/result.json file contract for agent and script steps', () => {
    expect(prompt).toMatch(/\/output\/input\.json/);
    expect(prompt).toMatch(/\/output\/result\.json/);
    expect(prompt).toMatch(/step N's `\/output\/result\.json` becomes step N\+1's `\/output\/input\.json`/);
    expect(prompt).toMatch(/don't pretend an empty result is impossible/);
  });

  it('appends the embedded capability & authoring reference (all three docs) and scopes out what is genuinely out of reach', () => {
    expect(prompt).toMatch(/# Capability & authoring reference/);
    // The definition is in reach (update_workflow, set_transition_condition)
    // and so are the files it carries (write_workflow_file). What is left is
    // the platform setup around it.
    expect(prompt).toMatch(/write_workflow_file/);
    expect(prompt).toMatch(/\/artifacts\//);
    expect(prompt).toMatch(/list_secrets/);
    expect(prompt).toMatch(/never values/);
    expect(prompt).toMatch(/runs as the person you are helping/);
    expect(prompt).toMatch(/an admin can do it/);
    expect(prompt).toMatch(/update_workflow/);
    expect(prompt).toMatch(/set_transition_condition/);
    expect(prompt).toMatch(/Pick an authoring path/); // how-to-create-workflow.md
    expect(prompt).toMatch(/this is where fan-out lives/); // workflow-capabilities.md
    expect(prompt).toMatch(/Do \*\*not\*\* create new CM1\/L2/); // workflow-authoring-golden-rules.md
  });

});

// The authoring judgment the /design-workflow skill applies, in the assistant
// that replaces it: pushing back on the shape, not just building it correctly.
describe('buildWorkflowAssistantSystemPrompt — challenging the design', () => {
  const prompt = buildWorkflowAssistantSystemPrompt();

  it('says a workflow may be the wrong shape for the job', () => {
    expect(prompt).toMatch(/Does this need a workflow at all/);
    expect(prompt).toMatch(/one script step on a cron trigger/);
  });

  it('routes deterministic work away from agent steps, and side effects to actions', () => {
    // The most expensive authoring mistake: a model doing what a parser does,
    // once per run, forever.
    expect(prompt).toMatch(/Is that really an agent step/);
    expect(prompt).toMatch(/Deterministic parsing, validation, format conversion/);
    expect(prompt).toMatch(/judgment, synthesis, planning and language understanding/);
  });

  it('states where code lives, and what a Dockerfile costs', () => {
    expect(prompt).toMatch(/inline script .* is the default/);
    expect(prompt).toMatch(/minutes of build on the first run/);
  });

  it('lists what a finished design has to resolve', () => {
    expect(prompt).toMatch(/Cover the whole design/);
    expect(prompt).toMatch(/inputForNextRun/);
    expect(prompt).toMatch(/list_secrets.*list_agents.*list_tool_catalog.* are there to be called/);
  });

  it('forbids inventing a repository or a commit, which the older references still describe', () => {
    // The reference docs below the prompt taught the pinned-repo shape as the
    // only way to run a script file. A model following them writes a
    // github.com/user/... URL and forty zeros, and the workflow can never run.
    expect(prompt).toMatch(/Never invent a repository or a commit/);
    expect(prompt).toMatch(/placeholder SHA \(forty zeros\)/);
    expect(prompt).toMatch(/When a step needs a file, write the file/);
  });

  it('asks for a plan first on a large build, rather than a form', () => {
    expect(prompt).toMatch(/more than about five steps/);
    expect(prompt).toMatch(/Not a form to fill in/);
  });
});

// "A data manager reviews the report" produced `assignedTo:
// "data-manager@company.com"`, which resolves to no user: the task was created
// assigned to that literal string, the UI showed it claimed by someone who does
// not exist, and nobody — owner included — could complete the run.
describe('buildWorkflowAssistantSystemPrompt — who does a human step', () => {
  const prompt = buildWorkflowAssistantSystemPrompt();

  it('sends a job title to allowedRoles, not assignedTo', () => {
    expect(prompt).toMatch(/is a role, not a person/);
    expect(prompt).toMatch(/allowedRoles: \["data-manager"\]/);
  });

  it('says what assignedTo actually takes, and what happens when it is not that', () => {
    expect(prompt).toMatch(/pre-assigns to one specific \*user id\*/);
    expect(prompt).toMatch(/leaves such a task unassigned and records that the value named nobody/);
  });

  it('keeps assignedTo for an identity the run genuinely knows', () => {
    expect(prompt).toMatch(/triggerPayload\.userId/);
    expect(prompt).toMatch(/set the role and say which role you used/);
  });
});

// The loop a person watched: the canvas said `poll → done`, the batch spliced a
// step between them, and the condition on the old edge was refused — so it
// added the edge back, which spliced again.
describe('buildWorkflowAssistantSystemPrompt — conditions and splicing', () => {
  const prompt = buildWorkflowAssistantSystemPrompt();

  it('says inserting a step replaces the edge that joined the two', () => {
    expect(prompt).toMatch(/replaces the edge that joined them/);
  });

  it('says naming the old edge is fine when the step has one way out', () => {
    // The platform resolves that case rather than refusing it, and the prompt
    // has to agree or the model will second-guess a call that works.
    expect(prompt).toMatch(/fine when the step you condition has one way out/);
    expect(prompt).toMatch(/refused only when the step branches/);
  });

  it('tells it never to re-add an edge it just split', () => {
    expect(prompt).toMatch(/that splits the graph again/);
  });
});
