import type { TourChapter } from './tour';

/**
 * The guide: whichever route you are on, it explains what is in front of you
 * and does not move you off the page, so starting it never costs you your
 * place. Chapters are matched by route, most specific first, with a wildcard
 * chapter so no page is left without one.
 */

export const GUIDE_CHAPTERS: readonly TourChapter[] = [
  {
    id: 'workspace-home',
    title: 'This workspace',
    match: '/:handle',
    steps: [
      {
        id: 'workflows',
        title: 'Your workflows live here',
        body: 'Each card is a workflow — a sequence of steps, some run by agents and some needing a person. Open one for its versions, its triggers and its runs.',
        target: 'workflow-list',
      },
      {
        id: 'problems',
        title: 'Anything blocking a run surfaces above the list',
        body: 'A missing image, a secret nothing has set, a model this workspace cannot reach. They are shown here rather than at the moment a run fails on them.',
        target: 'workflow-list',
      },
      {
        id: 'new',
        title: 'Two ways to add one',
        body: 'Build it here, or import from a git repository that already carries a workflow.yaml — in which case the repository stays the source of truth.',
        target: 'workflow-actions',
      },
      {
        id: 'display',
        title: 'The list hides what is finished',
        body: 'Completed and archived workflows are out of the way by default. The display control brings either back without changing anything.',
        target: 'workflow-actions',
      },
      {
        id: 'switcher',
        title: 'You can belong to several workspaces',
        body: 'Switch between your own profile and the organizations you are a member of. Workflows, agents, images and runs are all scoped to the one you are in.',
        target: 'workspace-switcher',
      },
    ],
  },
  {
    id: 'agents',
    title: 'Agents',
    match: '/:handle/agents',
    steps: [
      {
        id: 'what',
        title: 'An agent is a reusable step configuration',
        body: 'A system prompt plus the tool servers that step is allowed to reach, called by id. Many workflow steps can share one.',
        target: 'agents-header',
      },
      {
        id: 'unversioned',
        title: 'Agents are not versioned',
        body: 'Editing one changes every step already referencing it, immediately and everywhere. That is the trade for having a single definition instead of a copy per step.',
        target: 'agents-header',
      },
      {
        id: 'cards',
        title: 'Each card states its contract',
        body: 'The model it runs on, what it expects as input, and what it produces. A step calling the agent can override the model; it cannot widen the tools.',
        target: 'agents-grid',
      },
      {
        id: 'configure',
        title: 'Tools are bound on the agent, not here',
        body: 'Configure on a card is where you attach MCP servers and, for one behind OAuth, complete the connection. A new agent starts with none.',
        target: 'agents-grid',
      },
      {
        id: 'models',
        title: 'Models are a separate list',
        body: 'The registry is synced metadata — context window, price, whether it supports tools. The API keys themselves live in workspace secrets, not here.',
        target: 'nav-models',
      },
    ],
  },
  {
    id: 'tasks',
    title: 'Human actions',
    match: '/:handle/tasks',
    steps: [
      {
        id: 'what',
        title: 'Everything waiting on a person',
        body: 'A workflow pauses here whenever a step needs a human — a review, an approval, a file, a decision. Clearing an item is what lets the run continue.',
        target: 'tasks-header',
      },
      {
        id: 'scope',
        title: 'Yours, or the whole workspace',
        body: 'For me narrows to what is assigned to you or open to a role you hold. All in workspace shows everything, which is how you find work nobody has picked up.',
        target: 'tasks-scope',
      },
      {
        id: 'filters',
        title: 'Narrow by workspace, and group the list',
        body: 'This page spans every workspace you belong to, so the filter beside the toggle picks which ones count. The display control groups by workflow or by action.',
        target: 'tasks-filters',
      },
      {
        id: 'list',
        title: 'Cowork sessions sit alongside tasks',
        body: 'A cowork step is a person and an agent working the same problem rather than a form to fill in, so it appears here as something to join rather than to answer.',
        target: 'tasks-list',
      },
      {
        id: 'done',
        title: 'Finished items stay in the list',
        body: 'Completed actions are kept rather than cleared, because what you decided and when is part of the record. Hide completed takes them out of view without removing them.',
        target: 'tasks-list',
      },
    ],
  },
  {
    id: 'run-detail',
    title: 'This run',
    match: '/:handle/workflows/:name/runs/:runId',
    steps: [
      {
        id: 'history',
        title: 'What has happened so far',
        body: 'Every step that has run, in order, with who or what executed it and how long it took. Steps that have not started are not listed — the history is what happened, not the plan.',
        target: 'run-history',
      },
      {
        id: 'executor',
        title: 'Each row says who ran it',
        body: 'An agent and its plugin, a script, or a person and the role they acted under. The control mode beside it is how much the step was allowed to decide on its own.',
        target: 'run-history',
      },
      {
        id: 'panels',
        title: 'The detail is in the side panels',
        body: 'The pulls on the right edge open the execution log, the audit trail, the workflow diagram and — once the run finishes — the report.',
      },
      {
        id: 'log',
        title: 'The log streams while the step runs',
        body: 'One collapsible section per step, with the agent\u2019s tool calls and their results. You do not need to reload to see it move.',
      },
      {
        id: 'audit',
        title: 'The audit trail is the regulated record',
        body: 'Who decided what, when, and on what evidence. Decisions are kept apart from routine bookkeeping, and it prints as the record rather than as a screenshot.',
      },
    ],
  },
  {
    id: 'workflow-new',
    title: 'New workflow',
    match: '/:handle/workflows/new',
    steps: [
      {
        id: 'name',
        title: 'Name and description are both required',
        body: 'The name you type becomes the workflow id, lower-cased and hyphenated — you can see the slug forming next to it. The display name can change later; the id cannot.',
        target: 'wf-new-identity',
      },
      {
        id: 'namespace',
        title: 'Choose which workspace owns it',
        body: 'It defaults to the workspace you came from, and lists every other one you can write to. Ownership decides who can see and run it.',
        target: 'wf-new-namespace',
      },
      {
        id: 'canvas',
        title: 'You start from a three-step skeleton',
        body: 'A human step that drafts, an agent step that reviews, and a terminal step. Delete what you do not need — it is there so the canvas is never a blank page.',
        target: 'editor-controls',
      },
      {
        id: 'blocks',
        title: 'Add a step from the block picker',
        body: 'Simple offers ready-made blocks grouped as People, Communicate, Data, AI and Control. Full asks the two questions underneath: does this step produce a result or decide a branch, and who runs it — a person, a script, an action, or an agent.',
        target: 'editor-controls',
      },
      {
        id: 'executor',
        title: 'An agent step also picks how much it may decide',
        body: 'Cowork works alongside a person, Human review stops for sign-off before it counts, Autonomous proceeds on its own. This is the control mode, and it is per step, not per workflow.',
        target: 'step-editor',
      },
      {
        id: 'toolbar',
        title: 'Files, secrets and a preamble travel with the workflow',
        body: 'Files adds scripts, a Dockerfile or skills that a run reads from /artifacts — no repository needed. Secrets holds keys the steps reference. Advanced sets a preamble prepended to every agent prompt here.',
        target: 'editor-toolbar',
      },
      {
        id: 'assistant',
        title: 'Or describe it and let the assistant build it',
        body: 'It plans first — saying what it will do and asking only what it cannot infer — then applies the steps to this canvas. You edit the result like anything else you drew by hand.',
        target: 'editor-toolbar',
      },
      {
        id: 'save',
        title: 'Saving publishes version 1',
        body: 'Every save is a new version with a title you give it, never an edit in place. Save & Dry Run mocks the step execution but really builds the image; Save & Start Run does the real thing.',
        target: 'wf-new-actions',
      },
    ],
  },
  {
    id: 'workflow-editor',
    title: 'Workflow editor',
    match: '/:handle/workflows/:name/definitions/:version',
    steps: [
      {
        id: 'version',
        title: 'You are editing one version, and saving makes the next',
        body: 'Nothing here changes the version that is live. If you opened an older one, saving still lands at the head rather than replacing what you opened, and the dialog tells you so.',
        target: 'editor-version',
      },
      {
        id: 'canvas',
        title: 'The graph is the workflow',
        body: 'Click a node to edit that step. Hover one for delete and reorder. The plus between two nodes inserts a step on that edge and repoints everything that pointed through it.',
        target: 'editor-controls',
      },
      {
        id: 'step',
        title: 'A step opens as four cards',
        body: 'Basics names it. The second card is its real configuration — prompt and model, script, task setup. Routing appears when the step has verdicts. Advanced holds its id, roles, environment and whether a failure stops the run.',
        target: 'step-editor',
      },
      {
        id: 'dataflow',
        title: 'Steps read each other by name',
        body: 'Each step says what it receives and what later steps can read from it. That is how a result travels — nothing is passed implicitly.',
        target: 'step-editor',
      },
      {
        id: 'toolbar',
        title: 'What the whole workflow carries',
        body: 'Files ship with the version and mount at /artifacts. Secrets are referenced from step environments. Advanced sets the agent preamble. Notifications say which roles hear about assignments and escalations. The source button shows the definition as JSON, and you can paste one back.',
        target: 'editor-toolbar',
      },
      {
        id: 'entry',
        title: 'The first step is the one nothing points at',
        body: 'Mediforce works out the entry step from the graph rather than asking you to mark one, and reorders the definition to match on save.',
        target: 'editor-controls',
      },
      {
        id: 'save',
        title: 'Save names the version, and can make it the default',
        body: 'A title is required — it is what the run list shows. Ticking default makes triggers resolve to this version; otherwise the newest live version wins.',
        target: 'editor-actions',
      },
    ],
  },
  {
    id: 'agent-models',
    title: 'Models',
    match: '/:handle/agents/models',
    steps: [
      {
        id: 'what',
        title: 'Metadata, synced — not credentials',
        body: 'Context window, price per million tokens, popularity, and whether a model supports tools or vision. Sync Now re-reads it from the provider.',
        target: 'models-header',
      },
      {
        id: 'picking',
        title: 'Filter down to what a step can actually use',
        body: 'An agent that calls tools needs a model that supports them, so the Tools filter is the one that matters most. Top picks narrows to the models people actually run.',
        target: 'models-filters',
      },
      {
        id: 'keys',
        title: 'The key is not here',
        body: 'This list is metadata only. The provider API key lives in workspace secrets, and a run fails at the model call if it is missing.',
        target: 'models-table',
      },
    ],
  },
  {
    id: 'agent-new',
    title: 'New agent',
    match: '/:handle/agents/new',
    steps: [
      {
        id: 'required',
        title: 'Only a name and a model are required',
        body: 'Description, input and output are for the people who will pick this agent later from the catalog — they are what the card shows.',
        target: 'agent-new-form',
      },
      {
        id: 'prompt',
        title: 'The system prompt is what the agent is for',
        body: 'It applies to every step that calls this agent. A step can add to it through the workflow preamble and its own prompt, but it cannot replace this.',
        target: 'agent-new-model',
      },
      {
        id: 'next',
        title: 'Tools come after it exists',
        body: 'Saving takes you straight to Configure, because a binding needs something to bind to. A new agent can reach nothing until you add one there.',
        target: 'agent-new-save',
      },
    ],
  },
  {
    id: 'workflow-detail',
    title: 'This workflow',
    match: '/:handle/workflows/:name',
    steps: [
      {
        id: 'header',
        title: 'Private, or shared by link',
        body: 'Private is the default. Sharing by link lets anyone holding it view and copy the workflow — it never exposes your runs, and it never lists the workflow in anyone else\u2019s workspace.',
        target: 'workflow-header',
      },
      {
        id: 'meta',
        title: 'The line underneath is the workflow at a glance',
        body: 'Who owns it, which version is current, how many steps and runs, what can start it, and where it came from if it was copied.',
        target: 'workflow-meta',
      },
      {
        id: 'runs',
        title: 'Runs, and starting one',
        body: 'Start Run picks the version to run. A dry run mocks each step but really builds the image, so the first one can be slow and the rest are not. Before either, Mediforce checks for missing images, secrets, files and model credits and tells you what is absent.',
        target: 'workflow-tab-runs',
      },
      {
        id: 'definitions',
        title: 'Definitions is the version history',
        body: 'Every saved version, with its title and step count. One of them is the default — the one triggers resolve to. You can archive an old version, but not the default one.',
        target: 'workflow-tab-definitions',
      },
      {
        id: 'triggers',
        title: 'Triggers decide what can start it',
        body: 'Manual is the Start Run button itself, and stopping it disables starting everywhere. A schedule runs it on a cron. A webhook gives it an HTTP endpoint. Input above them is the contract every trigger is checked against.',
        target: 'workflow-tab-triggers',
      },
      {
        id: 'access',
        title: 'Running it and changing it are separate permissions',
        body: 'Each can be restricted to named roles, and an empty list means any member. Registering a version, archiving, deleting and transferring all count as changing it.',
        target: 'workflow-tab-access',
      },
    ],
  },
  {
    id: 'runs-list',
    title: 'All runs',
    match: '/:handle/runs',
    steps: [
      {
        id: 'what',
        title: 'Every execution in this workspace',
        body: 'Across all workflows, newest first. Arriving from a workflow filters to that one, and clearing the filter widens it again.',
        target: 'runs-header',
      },
      {
        id: 'dry',
        title: 'Dry runs are listed apart from real ones',
        body: 'A dry run mocks the step execution while really building the image, so it proves a workflow is runnable without doing the work. Filter them out when you want the record.',
        target: 'runs-dry-filter',
      },
      {
        id: 'archived',
        title: 'Archived runs are hidden, not deleted',
        body: 'Archiving takes a run out of the day-to-day list. It keeps its steps, its log and its audit trail, and the toggle brings it back.',
        target: 'runs-archived',
      },
    ],
  },
  {
    id: 'tools',
    title: 'Tools',
    match: '/:handle/tools',
    steps: [
      {
        id: 'what',
        title: 'A tool is an MCP server, not a single function',
        body: 'One server exposes many callable tools. An agent reaches only the servers bound to it, and a workflow step can narrow that set further — never widen it.',
        target: 'tools-header',
      },
      {
        id: 'transports',
        title: 'Two kinds, owned differently',
        body: 'A stdio server is a command the platform launches next to the agent, curated by an admin in the catalog. It is referenced by id and only an admin adds one.',
        target: 'tools-stdio',
      },
      {
        id: 'badges',
        title: 'An HTTP server is bound, not catalogued',
        body: 'It is a remote endpoint that lives on the agent using it, which is why this list is assembled by scanning every agent. The badges are worked out the same way: whether a binding narrows the tool list, and whether its values are secret references.',
        target: 'tools-http',
      },
      {
        id: 'readonly',
        title: 'Nothing is added from this page',
        body: 'It is the inventory. Catalog entries are added by an admin, and an HTTP server is bound from the agent that uses it.',
        target: 'tools-header',
      },
    ],
  },
  {
    id: 'images',
    title: 'Images',
    match: '/:handle/images',
    steps: [
      {
        id: 'what',
        title: 'The container a step runs inside',
        body: 'Every step executes in a catalogued image, so the environment is pinned rather than whatever the host happened to have.',
        target: 'images-header',
      },
      {
        id: 'keyed',
        title: 'An entry is a recipe, not a build',
        body: 'It is keyed on the repository and Dockerfile it comes from, not on the commit — so rebuilding adds a version to the same row rather than making a new one.',
        target: 'images-header',
      },
      {
        id: 'add',
        title: 'Four ways in',
        body: 'Catalogue a git repository and build it here, upload a folder, pull from a registry, or adopt an image the daemon already holds. Which one you used decides whether the entry can be rebuilt later.',
        target: 'images-add',
      },
      {
        id: 'capabilities',
        title: 'Not every image can run an agent',
        body: 'Expanding an entry probes it and labels it agent-capable or script only. An agent step on a script-only image fails at container start, so this is worth reading before pinning one.',
        target: 'images-list',
      },
      {
        id: 'versions',
        title: 'Versions say what is safe to touch',
        body: 'Current is what a new pin picks; superseded is still running wherever a workflow pinned it; unused means no step points at it. Used by lists the workflows across the deployment that do.',
        target: 'images-list',
      },
    ],
  },
  {
    id: 'monitoring',
    title: 'Monitoring',
    match: '/:handle/monitoring',
    steps: [
      {
        id: 'workflows',
        title: 'Runs, counted by what they are waiting on',
        body: 'In progress, waiting for a human, errored, completed. Each card filters the table beneath it, and the counts follow the table\u2019s own dry-run and archived toggles rather than reporting a different total.',
        target: 'monitoring-workflows',
      },
      {
        id: 'agents',
        title: 'How the agent steps are ending',
        body: 'Running, completed, errored, and flagged or escalated — the last one being the agent handing a decision back to a person rather than failing.',
        target: 'monitoring-agents',
      },
      {
        id: 'users',
        title: 'An activity log, not a directory',
        body: 'Who signed in, who started a run, who cancelled one, who completed a task — each event with its time and details.',
        target: 'monitoring-users',
      },
      {
        id: 'tasks',
        title: 'Task activity, and what is overdue',
        body: 'Every view, claim, completion and attachment against a task, with the workflow it belongs to. Overdue items are listed separately, above the log.',
        target: 'monitoring-tasks',
      },
      {
        id: 'integrations',
        title: 'The outside services this deployment uses',
        body: 'Each one with what it is for and where it is used — model routing shows the credit balance it has left, which is the usual reason a run stops at its first agent step.',
        target: 'monitoring-integrations',
      },
    ],
  },
  {
    id: 'settings',
    title: 'Workspace settings',
    match: '/:handle/settings',
    steps: [
      {
        id: 'profile',
        title: 'Name, description and branding',
        body: 'An organization can also set a logo and two brand colours, which replace the defaults in the sidebar, the workspace header and the picker.',
        target: 'settings-profile',
      },
      {
        id: 'members',
        title: 'Membership is who administers the workspace',
        body: 'Owner, admin or member. Invite someone by email and they are sent a sign-in link; an owner is the only one who can change somebody else\u2019s membership.',
        target: 'settings-members',
      },
      {
        id: 'roles',
        title: 'A role is what somebody does in a process',
        body: 'Reviewer, PI, approver — separate from membership above. A grant can be narrowed to particular workflows, and the vocabulary is open, so a role no workflow declares yet still assigns.',
        target: 'settings-roles',
      },
      {
        id: 'join-links',
        title: 'A join link is not an invite and not a sign-in',
        body: 'Anyone holding it joins as a member by entering their email, then gets their own sign-in link — so the link is safe on a slide. Only its hash is stored, so it and its QR code are shown exactly once.',
        target: 'settings-join-links',
      },
      {
        id: 'secrets',
        title: 'Secrets are write-only',
        body: 'Shared across every workflow here, referenced from step environments, and never readable again once saved. A workflow can override one with its own. Model provider keys live here.',
        target: 'settings-secrets',
      },
      {
        id: 'admin',
        title: 'Administration is the deployment underneath',
        body: 'The raw Docker inventory and disk usage, the MCP catalog agents draw on, OAuth providers, and whether this deployment can send email.',
        target: 'settings-admin',
      },
    ],
  },
  {
    id: 'anywhere',
    title: 'Getting around',
    match: '/*',
    steps: [
      {
        id: 'nav',
        title: 'Everything hangs off the sidebar',
        body: 'Workflows are what you run. Agents, Tools and Images are what the steps use. Human actions is what is waiting on you, and Monitoring is what is happening right now.',
        target: 'sidebar-nav',
      },
      {
        id: 'workspace',
        title: 'You are always inside one workspace',
        body: 'Everything in the sidebar is scoped to it. Your own profile is a workspace too, which is where anything you build alone lives.',
        target: 'workspace-switcher',
      },
      {
        id: 'breadcrumbs',
        title: 'Know where you are',
        body: 'The trail across the top is clickable — each level takes you back up, from a single step to its run to the workflow.',
        target: 'breadcrumbs',
      },
      {
        id: 'ticket',
        title: 'Something wrong?',
        body: 'File a ticket without leaving the page; it carries the URL you were on. Press \u2318K anywhere for the full command palette.',
        target: 'ticket',
      },
    ],
  },
];
