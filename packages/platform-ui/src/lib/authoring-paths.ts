import { Blocks, Sparkles, GitBranch, type LucideIcon } from 'lucide-react';

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

// The three ways to author a workflow, condensed from docs/guides/create-workflow.md § "Pick an authoring path".
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
      'Describe the workflow in plain language and it builds it: steps, routing conditions, the workflow-level settings, and the files it needs — a script, a Dockerfile, a skill. It challenges the shape rather than transcribing it. A first draft, or a bulk edit.',
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
];
