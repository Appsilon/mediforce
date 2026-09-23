/**
 * `mediforce` CLI entrypoint.
 *
 * Subcommand dispatch via a nested map: `branch -> leaf -> CommandFn`. The
 * map drives both the help text (auto-generated from each `defineCommand`'s
 * meta) and execution. Leaves are citty-wrapped commands from
 * `./commands/*` — each already a `(input) => Promise<number>`.
 *
 * Exit codes:
 *   0 — success
 *   1 — operational failure (HTTP error, validation error, file not found)
 *   2 — usage error (unknown command, missing required flag)
 */

import { assistantAskCommand } from './commands/assistant-ask';
import { assistantInstructionsGetCommand } from './commands/assistant-instructions-get';
import { assistantInstructionsSetCommand } from './commands/assistant-instructions-set';
import { workflowRegisterCommand } from './commands/workflow-register';
import { workflowValidateCommand } from './commands/workflow-validate';
import { workflowSchemaCommand } from './commands/workflow-schema';
import { workflowImportCommand } from './commands/workflow-import';
import { workflowListCommand } from './commands/workflow-list';
import { workflowListVersionsCommand } from './commands/workflow-list-versions';
import { workflowGetCommand } from './commands/workflow-get';
import { runGetCommand } from './commands/run-get';
import { runListCommand } from './commands/run-list';
import { runFilesCommand } from './commands/run-files';
import { runDownloadCommand } from './commands/run-download';
import { runStartCommand } from './commands/run-start';
import { runCancelCommand } from './commands/run-cancel';
import { runArchiveCommand } from './commands/run-archive';
import { runBulkCancelCommand, runBulkArchiveCommand } from './commands/run-bulk';
import { runLogsCommand } from './commands/run-logs';
import { runWatchCommand } from './commands/run-watch';
import { workflowArchiveCommand } from './commands/workflow-archive';
import { workflowSetVisibilityCommand } from './commands/workflow-set-visibility';
import { workflowAccessCommand, workflowSetAccessCommand } from './commands/workflow-access';
import { workflowCopyCommand } from './commands/workflow-copy';
import { workflowDeleteCommand } from './commands/workflow-delete';
import {
  workflowTriggerListCommand,
  workflowTriggerAddCommand,
  workflowTriggerUpdateCommand,
  workflowTriggerStartCommand,
  workflowTriggerStopCommand,
  workflowTriggerRemoveCommand,
  workflowTriggerExportCommand,
  workflowTriggerImportCommand,
} from './commands/workflow-trigger';
import {
  systemStatusCommand,
  systemImagesCommand,
  systemDiskCommand,
  systemRmiCommand,
} from './commands/system-status';
import {
  imagesListCommand,
  imagesShowCommand,
  imagesCreateCommand,
  imagesUpdateCommand,
  imagesDeleteCommand,
  imagesBuildCommand,
  imagesPublishCommand,
  imagesPullCommand,
  imagesSeedCommand,
} from './commands/images';
import { emailStatusCommand } from './commands/email-status';
import { systemCreditsCommand } from './commands/system-credits';
import { agentListCommand } from './commands/agent-list';
import { toolCatalogListCommand } from './commands/tool-catalog-list';
import { toolCatalogAddCommand } from './commands/tool-catalog-add';
import { agentGetCommand } from './commands/agent-get';
import { agentDeleteCommand } from './commands/agent-delete';
import { agentSetVisibilityCommand } from './commands/agent-set-visibility';
import { agentCreateCommand } from './commands/agent-create';
import { modelListCommand } from './commands/model-list';
import { modelGetCommand } from './commands/model-get';
import { modelSyncCommand } from './commands/model-sync';
import { modelValidateCommand } from './commands/model-validate';
import { secretSetCommand } from './commands/secret-set';
import { secretListCommand } from './commands/secret-list';
import { secretDeleteCommand } from './commands/secret-delete';
import { taskListCommand } from './commands/task-list';
import { taskGetCommand } from './commands/task-get';
import { taskClaimCommand } from './commands/task-claim';
import { taskCompleteCommand } from './commands/task-complete';
import { coworkGetCommand } from './commands/cowork-get';
import { coworkGetByInstanceCommand } from './commands/cowork-get-by-instance';
import { coworkListCommand } from './commands/cowork-list';
import { coworkChatCommand } from './commands/cowork-chat';
import { usersMeCommand } from './commands/users-me';
import { usersClearMustChangePasswordCommand } from './commands/users-clear-must-change-password';
import { usersInviteCommand } from './commands/users-invite';
import { namespaceGetCommand } from './commands/namespace-get';
import { namespaceListMembersCommand } from './commands/namespace-list-members';
import { namespaceCreateCommand } from './commands/namespace-create';
import { agentRunListCommand } from './commands/agent-run-list';
import { agentRunGetCommand } from './commands/agent-run-get';
import { agentRunTrajectoryCommand } from './commands/agent-run-trajectory';
import { scoreListCommand } from './commands/score-list';
import { evalBriefGetCommand, evalBriefSetCommand } from './commands/eval-brief';
import {
  evalEvaluatorApproveCommand,
  evalEvaluatorArchiveCommand,
  evalEvaluatorCalibrateCommand,
  evalEvaluatorCreateCommand,
  evalEvaluatorLabelCommand,
  evalEvaluatorListCommand,
  evalEvaluatorPreviewCommand,
  evalEvaluatorVersionCommand,
} from './commands/eval-evaluators';
import {
  evalCaseAddCommand,
  evalCaseArchiveCommand,
  evalCaseFromRunCommand,
  evalCaseListCommand,
  evalDatasetFreezeCommand,
  evalDatasetListCommand,
  evalMcpPolicyGetCommand,
  evalMcpPolicySetCommand,
} from './commands/eval-cases';
import {
  evalRunCancelCommand,
  evalRunGetCommand,
  evalRunListCommand,
  evalRunPrepareCommand,
  evalRunStartCommand,
} from './commands/eval-runs';
import { namespaceUpdateCommand } from './commands/namespace-update';
import { namespaceDeleteCommand } from './commands/namespace-delete';
import { namespaceResetCommand } from './commands/namespace-reset';
import { namespaceLeaveCommand } from './commands/namespace-leave';
import { namespaceRemoveMemberCommand } from './commands/namespace-remove-member';
import { namespaceSetMemberRoleCommand } from './commands/namespace-set-member-role';
import { namespaceSetMemberRolesCommand } from './commands/namespace-set-member-roles';
import { namespaceCreateJoinLinkCommand } from './commands/namespace-create-join-link';
import { namespaceListJoinLinksCommand } from './commands/namespace-list-join-links';
import { namespaceRevokeJoinLinkCommand } from './commands/namespace-revoke-join-link';
import { processesAgentEventsCommand } from './commands/processes-agent-events';
import { configSetCommand } from './commands/config-set';
import { configGetCommand } from './commands/config-get';
import { configTestWebhookCommand } from './commands/config-test-webhook';
import { type CommandFn } from './define-command';
import { consoleOutput, type OutputSink } from './output';

export interface RunCliInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output?: OutputSink;
}

interface LeafEntry {
  description: string;
  fn: CommandFn;
}

interface BranchEntry {
  description: string;
  leaves: Record<string, LeafEntry>;
}

export const TREE: Record<string, BranchEntry> = {
  assistant: {
    description: "Canvas-first workflow designer's AI Assistant (ADR-0011)",
    leaves: {
      ask: { description: 'Ask the assistant a question given the current canvas state', fn: assistantAskCommand },
      'instructions-get': {
        description: 'Show the standing instructions the assistant reads in a workspace',
        fn: assistantInstructionsGetCommand,
      },
      'instructions-set': {
        description: 'Replace them, usually from a file (--file)',
        fn: assistantInstructionsSetCommand,
      },
    },
  },
  workflow: {
    description: 'Workflow definitions (register, list, get, copy, archive, delete, visibility, access)',
    leaves: {
      register: { description: 'Register a workflow definition from a JSON file', fn: workflowRegisterCommand },
      validate: { description: 'Validate a workflow definition JSON file against the schema', fn: workflowValidateCommand },
      schema: { description: 'Fetch the live WorkflowDefinition JSON Schema from the platform', fn: workflowSchemaCommand },
      import: { description: 'Import a workflow from a GitHub repo (one-time copy)', fn: workflowImportCommand },
      list: { description: 'List registered workflow definitions', fn: workflowListCommand },
      'list-versions': {
        description: 'List metadata for every version of a workflow',
        fn: workflowListVersionsCommand,
      },
      get: { description: 'Fetch a workflow definition', fn: workflowGetCommand },
      'set-visibility': { description: 'Set workflow visibility (public|private)', fn: workflowSetVisibilityCommand },
      access: { description: 'Show who may run and who may edit a workflow', fn: workflowAccessCommand },
      'set-access': { description: 'Set who may run and who may edit a workflow', fn: workflowSetAccessCommand },
      copy: { description: 'Copy workflow to another namespace', fn: workflowCopyCommand },
      archive: { description: 'Archive/unarchive workflow versions', fn: workflowArchiveCommand },
      delete: { description: 'Soft-delete a workflow + cascade', fn: workflowDeleteCommand },
      'trigger-list': { description: 'List triggers attached to a workflow', fn: workflowTriggerListCommand },
      'trigger-add': { description: 'Add a trigger to a workflow (--type cron)', fn: workflowTriggerAddCommand },
      'trigger-update': { description: 'Change a cron trigger schedule', fn: workflowTriggerUpdateCommand },
      'trigger-start': { description: 'Start (enable) a trigger', fn: workflowTriggerStartCommand },
      'trigger-stop': { description: 'Stop (disable) a trigger', fn: workflowTriggerStopCommand },
      'trigger-remove': { description: 'Delete a trigger', fn: workflowTriggerRemoveCommand },
      'trigger-export': { description: 'Export a workflow\'s triggers to a portable file', fn: workflowTriggerExportCommand },
      'trigger-import': { description: 'Import triggers from a portable file (--replace to overwrite)', fn: workflowTriggerImportCommand },
    },
  },
  run: {
    description: 'Workflow runs (list, start, get, watch, logs, files, download, cancel, archive, bulk)',
    leaves: {
      list: { description: 'List recent runs', fn: runListCommand },
      start: { description: 'Start a new run (manual trigger)', fn: runStartCommand },
      get: { description: "Fetch a single run's status", fn: runGetCommand },
      watch: { description: 'Watch a run until terminal, streaming step events', fn: runWatchCommand },
      logs: { description: 'Show audit events and step executions for a run', fn: runLogsCommand },
      files: { description: "List a run's Output Files", fn: runFilesCommand },
      download: { description: "Download a run's Output Files (one or all)", fn: runDownloadCommand },
      cancel: { description: 'Cancel a running or paused run', fn: runCancelCommand },
      archive: { description: 'Soft-archive (or restore) a run', fn: runArchiveCommand },
      'bulk-cancel': { description: 'Cancel multiple runs in one call', fn: runBulkCancelCommand },
      'bulk-archive': { description: 'Archive multiple runs in one call', fn: runBulkArchiveCommand },
    },
  },
  task: {
    description: 'Human tasks (list, get, claim, complete)',
    leaves: {
      list: { description: 'List tasks by role or instance', fn: taskListCommand },
      get: { description: 'Fetch a single task', fn: taskGetCommand },
      claim: { description: 'Claim a pending task', fn: taskClaimCommand },
      complete: { description: 'Complete a human task with a payload', fn: taskCompleteCommand },
    },
  },
  cowork: {
    description: 'Cowork sessions (list, get, get-by-instance, chat)',
    leaves: {
      list: { description: 'List cowork sessions by role or caller scope', fn: coworkListCommand },
      get: { description: 'Fetch a single cowork session', fn: coworkGetCommand },
      'get-by-instance': {
        description: 'Fetch the active cowork session for a process instance',
        fn: coworkGetByInstanceCommand,
      },
      chat: { description: 'Send a chat message to a cowork session', fn: coworkChatCommand },
    },
  },
  agent: {
    description: 'Agent definitions (list, get, create, delete, visibility)',
    leaves: {
      list: { description: 'List agent definitions', fn: agentListCommand },
      get: { description: 'Fetch an agent definition', fn: agentGetCommand },
      create: { description: 'Create an agent from a JSON file', fn: agentCreateCommand },
      delete: { description: 'Delete an agent definition', fn: agentDeleteCommand },
      'set-visibility': { description: 'Set agent visibility (public|private)', fn: agentSetVisibilityCommand },
    },
  },
  'tool-catalog': {
    description: 'MCP servers an agent can bind to (list, add)',
    leaves: {
      list: { description: 'List a workspace Tool Catalog', fn: toolCatalogListCommand },
      add: { description: 'Add an MCP server from a JSON file (admin)', fn: toolCatalogAddCommand },
    },
  },
  'agent-run': {
    description: 'Agent runs (list, get, trajectory) — single agent invocations inside workflow runs',
    leaves: {
      list: { description: 'List recent agent runs', fn: agentRunListCommand },
      get: { description: 'Fetch a single agent run', fn: agentRunGetCommand },
      trajectory: { description: 'Print an agent run\'s tool calls and results', fn: agentRunTrajectoryCommand },
    },
  },
  score: {
    description: 'Scores — quality judgments on agent runs (list)',
    leaves: {
      list: { description: 'List Scores, newest first', fn: scoreListCommand },
    },
  },
  eval: {
    description: 'Step Evaluation (ADR-0023) — Briefs, Evaluators, Eval Cases, Datasets, MCP eval policy, Eval Runs',
    leaves: {
      'brief-get': { description: 'Print a step\'s Evaluation Brief', fn: evalBriefGetCommand },
      'brief-set': { description: 'Write a new Evaluation Brief version', fn: evalBriefSetCommand },
      'evaluator-list': { description: 'List a step\'s Evaluators', fn: evalEvaluatorListCommand },
      'evaluator-create': { description: 'Create an Evaluator from a JSON file', fn: evalEvaluatorCreateCommand },
      'evaluator-version': { description: 'Add an Evaluator version from a JSON file', fn: evalEvaluatorVersionCommand },
      'evaluator-approve': { description: 'Approve a code Evaluator\'s source', fn: evalEvaluatorApproveCommand },
      'evaluator-label': { description: 'Label an output pass/fail for an Evaluator', fn: evalEvaluatorLabelCommand },
      'evaluator-calibrate': { description: 'Calibrate an llm_judge against the labels', fn: evalEvaluatorCalibrateCommand },
      'evaluator-preview': { description: 'Run a draft check against recent outputs', fn: evalEvaluatorPreviewCommand },
      'evaluator-archive': { description: 'Archive or restore an Evaluator', fn: evalEvaluatorArchiveCommand },
      'case-list': { description: 'List a step\'s Eval Cases', fn: evalCaseListCommand },
      'case-add': { description: 'Add a hand-written Eval Case', fn: evalCaseAddCommand },
      'case-from-run': { description: 'Add a production Agent Run to the eval set', fn: evalCaseFromRunCommand },
      'case-archive': { description: 'Archive or restore an Eval Case', fn: evalCaseArchiveCommand },
      'dataset-list': { description: 'List frozen Eval Dataset versions', fn: evalDatasetListCommand },
      'dataset-freeze': { description: 'Freeze the live cases as a Dataset version', fn: evalDatasetFreezeCommand },
      'mcp-policy-get': { description: 'Show the step\'s MCP eval policy', fn: evalMcpPolicyGetCommand },
      'mcp-policy-set': { description: 'Replace the step\'s MCP eval policy', fn: evalMcpPolicySetCommand },
      'run-prepare': { description: 'Prepare an Eval Run and print its cost estimate', fn: evalRunPrepareCommand },
      'run-start': { description: 'Start a prepared Eval Run, confirming its budget', fn: evalRunStartCommand },
      'run-list': { description: 'List a step\'s Eval Runs', fn: evalRunListCommand },
      'run-cancel': { description: 'Cancel an Eval Run', fn: evalRunCancelCommand },
      report: { description: 'Print an Eval Run and its report', fn: evalRunGetCommand },
    },
  },
  model: {
    description: 'Foundation model registry (list, get, sync, validate)',
    leaves: {
      list: { description: 'List models in registry', fn: modelListCommand },
      get: { description: 'Fetch a model from registry', fn: modelGetCommand },
      sync: { description: 'Sync models from OpenRouter', fn: modelSyncCommand },
      validate: { description: 'Validate model IDs against registry', fn: modelValidateCommand },
    },
  },
  secret: {
    description: 'Workflow secrets (set, list, delete)',
    leaves: {
      set: { description: 'Set a secret', fn: secretSetCommand },
      list: { description: 'List secret keys', fn: secretListCommand },
      delete: { description: 'Delete a secret', fn: secretDeleteCommand },
    },
  },
  users: {
    description: 'User identity + workspace memberships',
    leaves: {
      me: { description: 'Show the signed-in user + their workspaces', fn: usersMeCommand },
      invite: { description: 'Invite someone to a workspace by email', fn: usersInviteCommand },
      'clear-must-change-password': {
        description: 'Acknowledge a forced password change',
        fn: usersClearMustChangePasswordCommand,
      },
    },
  },
  namespace: {
    description: 'Workspaces (get, create, update, delete, reset, leave, members)',
    leaves: {
      get: { description: 'Fetch a namespace + member list', fn: namespaceGetCommand },
      'list-members': { description: 'List members with their process roles (reviewer, PI, …)', fn: namespaceListMembersCommand },
      create: { description: 'Create an organization namespace', fn: namespaceCreateCommand },
      update: { description: 'Edit display name / bio / icon', fn: namespaceUpdateCommand },
      delete: { description: 'Delete a workspace (owner only, cascades members; not personal)', fn: namespaceDeleteCommand },
      reset: { description: 'Delete every workflow in a workspace, keep the workspace', fn: namespaceResetCommand },
      leave: { description: 'Leave a workspace (self-remove)', fn: namespaceLeaveCommand },
      'remove-member': { description: 'Remove a member from a workspace', fn: namespaceRemoveMemberCommand },
      'set-member-role': { description: 'Flip a member to admin|member (workspace membership)', fn: namespaceSetMemberRoleCommand },
      'set-member-roles': { description: 'Set a member\'s process roles (reviewer, PI, …)', fn: namespaceSetMemberRolesCommand },
      'create-join-link': { description: 'Mint a join link (printed once — the token is never recoverable)', fn: namespaceCreateJoinLinkCommand },
      'list-join-links': { description: 'List join links, live and spent', fn: namespaceListJoinLinksCommand },
      'revoke-join-link': { description: 'Revoke a join link (removes nobody who already joined)', fn: namespaceRevokeJoinLinkCommand },
    },
  },
  processes: {
    description: 'Process instances (read-only diagnostics)',
    leaves: {
      'agent-events': {
        description: 'Dump the agent-event feed for a process instance',
        fn: processesAgentEventsCommand,
      },
    },
  },
  system: {
    description: 'Docker infrastructure + OpenRouter credits',
    leaves: {
      status: { description: 'Full infrastructure status', fn: systemStatusCommand },
      images: { description: 'List raw Docker images on the host (ops view; see `mediforce images` for the catalog)', fn: systemImagesCommand },
      rmi: { description: 'Remove a Docker image by ID or name:tag', fn: systemRmiCommand },
      disk: { description: 'Docker disk usage breakdown', fn: systemDiskCommand },
      credits: { description: 'OpenRouter credit balance for a workspace', fn: systemCreditsCommand },
    },
  },
  images: {
    description: 'Image Catalog — the images a namespace offers for steps (ADR-0022)',
    leaves: {
      list: { description: 'List the entries a namespace offers', fn: imagesListCommand },
      show: { description: 'Show one entry and its versions on the daemon', fn: imagesShowCommand },
      create: { description: 'Catalogue an image (--repo, --reference or --workflow, plus --intent)', fn: imagesCreateCommand },
      update: {
        description: "Change an entry's name, intent or source (source re-keys it)",
        fn: imagesUpdateCommand,
      },
      delete: {
        description: 'Delete an entry and its images (admin/owner; blocked by live pins)',
        fn: imagesDeleteCommand,
      },
      build: { description: 'Build a version from --repo/--commit, no workflow run', fn: imagesBuildCommand },
      publish: { description: "Publish a workflow's carried image as an image of its own", fn: imagesPublishCommand },
      pull: { description: 'Pull a registry image onto the deployment and catalogue it', fn: imagesPullCommand },
      seed: {
        description: "Catalogue the images a step falls back to when it names none (idempotent)",
        fn: imagesSeedCommand,
      },
    },
  },
  email: {
    description: 'Email provider status',
    leaves: {
      status: { description: 'Show configured email provider', fn: emailStatusCommand },
    },
  },
  config: {
    description: 'Platform configuration',
    leaves: {
      set: { description: 'Set a config value', fn: configSetCommand },
      get: { description: 'Get a config value or all values matching a prefix', fn: configGetCommand },
      'test-webhook': { description: 'Send a test webhook notification', fn: configTestWebhookCommand },
    },
  },
};

function renderTopHelp(): string {
  const lines: string[] = ['Usage: mediforce <command> <subcommand> [options]', '', 'Commands:'];
  for (const [branch, def] of Object.entries(TREE)) {
    lines.push(`  ${branch.padEnd(10)} ${def.description}`);
  }
  lines.push('');
  lines.push('Common flags:');
  lines.push('  --base-url <url>   API base URL (default: http://localhost:9003,');
  lines.push('                     or MEDIFORCE_BASE_URL env var)');
  lines.push('  --json             Emit JSON instead of human-readable output');
  lines.push('  --help, -h         Show this help text');
  lines.push('');
  lines.push('Authentication:');
  lines.push('  Set MEDIFORCE_API_KEY (or PLATFORM_API_KEY) in the environment.');
  lines.push('');
  lines.push('Run `mediforce <command> --help` for subcommands of a group.');
  lines.push('Run `mediforce <command> <subcommand> --help` for command-specific flags.');
  return lines.join('\n');
}

function renderBranchHelp(branch: string, def: BranchEntry): string {
  const lines: string[] = [`Usage: mediforce ${branch} <subcommand> [options]`, '', def.description, '', 'Subcommands:'];
  const width = Math.max(...Object.keys(def.leaves).map((n) => n.length));
  for (const [name, leaf] of Object.entries(def.leaves)) {
    lines.push(`  ${name.padEnd(width)}  ${leaf.description}`);
  }
  lines.push('');
  lines.push(`Run \`mediforce ${branch} <subcommand> --help\` for command-specific flags.`);
  return lines.join('\n');
}

export async function runCli(input: RunCliInput): Promise<number> {
  const output = input.output ?? consoleOutput;
  const args = input.argv;

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    output.stdout(renderTopHelp());
    return 0;
  }

  const [branch, leaf, ...rest] = args;
  const branchDef = branch !== undefined ? TREE[branch] : undefined;

  if (branchDef === undefined) {
    output.stderr(`Unknown command: ${branch ?? ''}`);
    output.stderr('');
    output.stderr(renderTopHelp());
    return 2;
  }

  // `mediforce <branch> --help` → render the branch help on stdout, exit 0.
  if (leaf === '--help' || leaf === '-h') {
    output.stdout(renderBranchHelp(branch!, branchDef));
    return 0;
  }

  // `mediforce <branch>` with no leaf → render branch help on stderr, exit 2.
  if (leaf === undefined) {
    output.stderr(`mediforce ${branch!}: missing subcommand`);
    output.stderr('');
    output.stderr(renderBranchHelp(branch!, branchDef));
    return 2;
  }

  const leafDef = branchDef.leaves[leaf];
  if (leafDef === undefined) {
    output.stderr(`Unknown command: ${branch!} ${leaf}`);
    output.stderr('');
    output.stderr(renderBranchHelp(branch!, branchDef));
    return 2;
  }

  return leafDef.fn({ argv: rest, env: input.env, output });
}
