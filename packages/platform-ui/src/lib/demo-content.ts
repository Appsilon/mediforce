import type { DemoScenario } from './demo';

/**
 * Three scenarios, in the order a process actually lives: someone builds it,
 * someone runs it and reads back what happened, and someone decides on it.
 * Each is narrated over the real app — nothing is seeded and nothing is
 * clicked for you, so what a scenario shows is whatever this workspace
 * genuinely has.
 */
export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  {
    id: 'build',
    title: 'Build a workflow',
    blurb: 'Describe a process in words, then shape it into steps.',
    minutes: 4,
    steps: [
      {
        id: 'premise',
        title: 'A workflow is the process, written down',
        body: 'Not a document describing how the work should go — the thing that actually runs it. Each step is done by an agent or by a person, and you decide which per step.',
        route: '/:handle',
        target: 'workflow-list',
        action: 'Open New Workflow',
      },
      {
        id: 'identity',
        title: 'Name it, and it names itself',
        body: 'The name becomes the id, lower-cased and hyphenated — watch the slug form beneath it. The display name can change later; the id is what every run and every trigger refers to.',
        route: '/:handle/workflows/new',
        target: 'wf-new-identity',
        action: 'Type a name and a description',
      },
      {
        id: 'assistant',
        title: 'Describe the process and let it plan',
        body: 'The assistant states what it is about to build and asks only what it cannot infer, each question prefilled with the answer it would have assumed. Agreeing is one click; disagreeing costs you a sentence rather than a rebuilt workflow.',
        target: 'editor-toolbar',
        action: 'Tell the assistant what the process does',
      },
      {
        id: 'blocks',
        title: 'Or place the steps yourself',
        body: 'The picker offers ready-made blocks grouped as People, Communicate, Data, AI and Control. Underneath, every block answers two questions: does this step produce a result or decide a branch, and who runs it.',
        target: 'editor-controls',
        action: 'Add a block',
      },
      {
        id: 'control-mode',
        title: 'Each step sets its own autonomy',
        body: 'Cowork puts a person and an agent on the same problem. Human review stops for sign-off before the result counts. Autonomous proceeds alone. This is per step, so one workflow can be strict where it matters and quick everywhere else.',
        target: 'step-editor',
      },
      {
        id: 'save',
        title: 'Saving publishes a version',
        body: 'Never an edit in place. Version 1 gets a title you choose, and everything that runs from now on names the version it ran — which is what makes a later change safe.',
        target: 'wf-new-actions',
        action: 'Save the workflow',
      },
    ],
  },
  {
    id: 'run',
    title: 'Run it and explore',
    blurb: 'Start a run, follow it live, then read it back as the record.',
    minutes: 5,
    steps: [
      {
        id: 'triggers',
        title: 'Something has to be allowed to start it',
        body: 'Manual is the Start Run button itself. A schedule runs it on a cron, a webhook gives it an endpoint, and Input above them is the contract every one of them is checked against.',
        route: '/:handle/workflows/:name?tab=triggers',
        target: 'workflow-tab-triggers',
      },
      {
        id: 'preflight',
        route: '/:handle/workflows/:name?tab=runs',
        title: 'It refuses to start badly',
        body: 'Before anything runs, Mediforce checks the images exist, the secrets are set, the files are present and the models are reachable — and names what is missing instead of failing three steps in.',
        target: 'workflow-tab-runs',
        action: 'Press Start Run',
      },
      {
        id: 'dry-run',
        route: '/:handle/workflows/:name?tab=runs',
        title: 'A dry run proves it without doing it',
        body: 'Step execution is mocked, but the image is really built. It answers "will this run at all" without touching anything real, which is why dry runs are listed apart from the record.',
        target: 'workflow-tab-runs',
      },
      {
        id: 'history',
        route: '/:handle/workflows/:name/runs/:runId',
        title: 'The run tells you where it is',
        body: 'Every step that has executed, in order, with who or what ran it and how long it took. Steps that have not started are absent — this is what happened, not the plan.',
        target: 'run-history',
      },
      {
        id: 'log',
        route: '/:handle/workflows/:name/runs/:runId',
        title: 'The log streams as the agent works',
        body: 'One collapsible section per step, with the tool calls and their results as they arrive. No reloading, and no waiting for the step to finish before you learn what it is doing.',
        target: 'run-pull-log',
        action: 'Open the Log pull',
      },
      {
        id: 'audit',
        route: '/:handle/workflows/:name/runs/:runId',
        title: 'Decisions are separated from bookkeeping',
        body: 'A run records hundreds of events. The ones where somebody or something chose are kept apart from the routine trail, so a reviewer reads the decisions first and the rest only when they need it.',
        target: 'run-pull-audit',
        action: 'Open the Audit pull',
      },
      {
        id: 'attribution',
        route: '/:handle/workflows/:name/runs/:runId',
        title: 'Every record names its actor',
        body: 'A person, an agent, or the system — with the time it happened and the evidence it acted on. An agent decision is attributed as plainly as a human one, which is the point.',
        target: 'run-pull-audit',
      },
      {
        id: 'report',
        route: '/:handle/workflows/:name/runs/:runId',
        title: 'The report is the run, written up',
        body: 'Once a run finishes it can be read as a document rather than a timeline, and printed as the record — not as a screenshot of a screen.',
        target: 'run-pull-report',
        action: 'Open the Report pull',
      },
    ],
  },
  {
    id: 'decide',
    title: 'Decide on it',
    blurb: 'Pick up the step that needs a person and record the call.',
    minutes: 3,
    steps: [
      {
        id: 'waiting',
        title: 'A run stops when it needs a human',
        body: 'It does not guess and it does not proceed. The step waits, and it waits for whoever holds the role it named — not for whoever happens to be looking.',
        route: '/:handle/tasks',
        target: 'tasks-header',
      },
      {
        id: 'scope',
        title: 'Yours, or everyone’s',
        body: 'For me narrows to what is assigned to you or open to a role you hold. All in workspace is how you find work nobody has picked up — the queue that is quietly growing.',
        target: 'tasks-scope',
      },
      {
        id: 'verdict',
        title: 'A decision is a verdict, not a checkbox',
        body: 'Approve, reject, send back for revision — each one routes the run down its own branch, and a verdict can be made to require a comment before it counts.',
        target: 'tasks-list',
        action: 'Open an action and record a verdict',
      },
      {
        id: 'continue',
        title: 'The run picks up where it stopped',
        body: 'Your verdict chooses the next step, and the agent work resumes from there. The pause was part of the process, not an interruption to it.',
        target: 'tasks-list',
      },
    ],
  },
];
