import { Blocks, Sparkles, GitBranch, Terminal, type LucideIcon } from 'lucide-react';

export type AuthoringPath = {
  /** Stable identifier — React key and test hook. */
  id: string;
  label: string;
  /** Why you would pick this path over the other three, so the choice can be
   *  made without a checkout of docs/guides/create-workflow.md (#1185). */
  reason: string;
  /** The first move, spelled out — naming a path the reader cannot start is the
   *  same dead end as not naming it. */
  how: string;
  icon: LucideIcon;
};

/** The four ways to author a workflow, condensed from
 *  docs/guides/create-workflow.md § "Pick an authoring path". */
export const AUTHORING_PATHS: AuthoringPath[] = [
  {
    id: 'canvas',
    label: 'Blocks on the canvas',
    reason:
      'Place and wire steps by hand. Exact control over one block, when you already know the shape you want.',
    how: 'Add Block on the canvas, or the + on an edge to insert between two steps.',
    icon: Blocks,
  },
  {
    id: 'assistant',
    label: 'AI Assistant',
    reason:
      'Describe the workflow in plain language and it edits the canvas for you — a first draft, or a bulk edit across steps.',
    how: 'Type into the AI Assistant pane on the right. Needs the OPENROUTER_API_KEY workspace secret.',
    icon: Sparkles,
  },
  {
    id: 'import',
    label: 'Import from git',
    reason:
      'A one-time copy of a workflow package from a public GitHub repo — not a live link. Reach for it when the workflow already exists somewhere.',
    how: 'Open the importer and paste the repository URL.',
    icon: GitBranch,
  },
  {
    id: 'agent',
    label: '/design-workflow — the agent skill',
    reason:
      'Interview-driven authoring against a checkout of the source. It generates the whole package — scripts, Dockerfile, tests — which this canvas cannot: reach for it when the workflow needs code, not just steps.',
    how: 'git clone https://github.com/Appsilon/mediforce, open the checkout in Claude Code (or another agent that reads skills/), and type /design-workflow. It interviews you, writes the package, and hands you the mediforce workflow register command that publishes it here.',
    icon: Terminal,
  },
];
