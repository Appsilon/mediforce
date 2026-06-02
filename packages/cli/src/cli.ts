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

import { workflowRegisterCommand } from './commands/workflow-register';
import { workflowListCommand } from './commands/workflow-list';
import { workflowListVersionsCommand } from './commands/workflow-list-versions';
import { workflowGetCommand } from './commands/workflow-get';
import { runGetCommand } from './commands/run-get';
import { runListCommand } from './commands/run-list';
import { runStartCommand } from './commands/run-start';
import { runCancelCommand } from './commands/run-cancel';
import { runArchiveCommand } from './commands/run-archive';
import { runBulkCancelCommand, runBulkArchiveCommand } from './commands/run-bulk';
import { workflowArchiveCommand } from './commands/workflow-archive';
import { workflowSetVisibilityCommand } from './commands/workflow-set-visibility';
import { workflowCopyCommand } from './commands/workflow-copy';
import { workflowDeleteCommand } from './commands/workflow-delete';
import {
  systemStatusCommand,
  systemImagesCommand,
  systemDiskCommand,
  systemRmiCommand,
} from './commands/system-status';
import { systemCreditsCommand } from './commands/system-credits';
import { agentListCommand } from './commands/agent-list';
import { agentGetCommand } from './commands/agent-get';
import { agentDeleteCommand } from './commands/agent-delete';
import { agentSetVisibilityCommand } from './commands/agent-set-visibility';
import { agentCreateCommand } from './commands/agent-create';
import { modelListCommand } from './commands/model-list';
import { modelGetCommand } from './commands/model-get';
import { modelSyncCommand } from './commands/model-sync';
import { secretSetCommand } from './commands/secret-set';
import { secretListCommand } from './commands/secret-list';
import { secretDeleteCommand } from './commands/secret-delete';
import { taskListCommand } from './commands/task-list';
import { taskGetCommand } from './commands/task-get';
import { taskClaimCommand } from './commands/task-claim';
import { coworkGetCommand } from './commands/cowork-get';
import { coworkGetByInstanceCommand } from './commands/cowork-get-by-instance';
import { coworkListCommand } from './commands/cowork-list';
import { coworkChatCommand } from './commands/cowork-chat';
import { usersMeCommand } from './commands/users-me';
import { usersClearMustChangePasswordCommand } from './commands/users-clear-must-change-password';
import { namespaceGetCommand } from './commands/namespace-get';
import { namespaceCreateCommand } from './commands/namespace-create';
import { agentRunListCommand } from './commands/agent-run-list';
import { agentRunGetCommand } from './commands/agent-run-get';
import { namespaceUpdateCommand } from './commands/namespace-update';
import { namespaceDeleteCommand } from './commands/namespace-delete';
import { namespaceLeaveCommand } from './commands/namespace-leave';
import { namespaceRemoveMemberCommand } from './commands/namespace-remove-member';
import { namespaceSetMemberRoleCommand } from './commands/namespace-set-member-role';
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
  workflow: {
    description: 'Workflow definitions (register, list, get, copy, archive, delete, visibility)',
    leaves: {
      register: { description: 'Register a workflow definition from a JSON file', fn: workflowRegisterCommand },
      list: { description: 'List registered workflow definitions', fn: workflowListCommand },
      'list-versions': {
        description: 'List metadata for every version of a workflow',
        fn: workflowListVersionsCommand,
      },
      get: { description: 'Fetch a workflow definition', fn: workflowGetCommand },
      'set-visibility': { description: 'Set workflow visibility (public|private)', fn: workflowSetVisibilityCommand },
      copy: { description: 'Copy workflow to another namespace', fn: workflowCopyCommand },
      archive: { description: 'Archive/unarchive workflow versions', fn: workflowArchiveCommand },
      delete: { description: 'Soft-delete a workflow + cascade', fn: workflowDeleteCommand },
    },
  },
  run: {
    description: 'Workflow runs (list, start, get, cancel, archive, bulk)',
    leaves: {
      list: { description: 'List recent runs', fn: runListCommand },
      start: { description: 'Start a new run (manual trigger)', fn: runStartCommand },
      get: { description: "Fetch a single run's status", fn: runGetCommand },
      cancel: { description: 'Cancel a running or paused run', fn: runCancelCommand },
      archive: { description: 'Soft-archive (or restore) a run', fn: runArchiveCommand },
      'bulk-cancel': { description: 'Cancel multiple runs in one call', fn: runBulkCancelCommand },
      'bulk-archive': { description: 'Archive multiple runs in one call', fn: runBulkArchiveCommand },
    },
  },
  task: {
    description: 'Human tasks (list, get, claim)',
    leaves: {
      list: { description: 'List tasks by role or instance', fn: taskListCommand },
      get: { description: 'Fetch a single task', fn: taskGetCommand },
      claim: { description: 'Claim a pending task', fn: taskClaimCommand },
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
  'agent-run': {
    description: 'Agent runs (list, get) — single agent invocations inside workflow runs',
    leaves: {
      list: { description: 'List recent agent runs', fn: agentRunListCommand },
      get: { description: 'Fetch a single agent run', fn: agentRunGetCommand },
    },
  },
  model: {
    description: 'Foundation model registry (list, get, sync)',
    leaves: {
      list: { description: 'List models in registry', fn: modelListCommand },
      get: { description: 'Fetch a model from registry', fn: modelGetCommand },
      sync: { description: 'Sync models from OpenRouter', fn: modelSyncCommand },
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
      'clear-must-change-password': {
        description: 'Acknowledge a forced password change',
        fn: usersClearMustChangePasswordCommand,
      },
    },
  },
  namespace: {
    description: 'Workspaces (get, create, update, delete, leave, members)',
    leaves: {
      get: { description: 'Fetch a namespace + member list', fn: namespaceGetCommand },
      create: { description: 'Create an organization namespace', fn: namespaceCreateCommand },
      update: { description: 'Edit display name / bio / icon', fn: namespaceUpdateCommand },
      delete: { description: 'Delete a workspace (owner only, cascades members)', fn: namespaceDeleteCommand },
      leave: { description: 'Leave a workspace (self-remove)', fn: namespaceLeaveCommand },
      'remove-member': { description: 'Remove a member from a workspace', fn: namespaceRemoveMemberCommand },
      'set-member-role': { description: 'Flip a member to admin|member', fn: namespaceSetMemberRoleCommand },
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
      images: { description: 'List Docker images on the host', fn: systemImagesCommand },
      rmi: { description: 'Remove a Docker image by ID or name:tag', fn: systemRmiCommand },
      disk: { description: 'Docker disk usage breakdown', fn: systemDiskCommand },
      credits: { description: 'OpenRouter credit balance for a workspace', fn: systemCreditsCommand },
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
