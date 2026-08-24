import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

/**
 * Product documentation, ordered the way a reader meets Mediforce: install it,
 * run something, build something, run it properly, add agents, then the traps.
 * The repository's own `docs/` is engineering documentation and is not here.
 *
 * One-page sections are plain entries — a category wrapping a single item of the
 * same name is a box around a box.
 */
const sidebars: SidebarsConfig = {
  docsSidebar: [
    'index',
    'install/index',
    'first-run/index',
    'build/index',
    {
      type: 'category',
      label: 'Running workflows',
      collapsed: false,
      link: { type: 'doc', id: 'run/index' },
      items: ['run/verify', 'run/triggers'],
    },
    'agents/index',
    'workspace/index',
    'gotchas/index',
    {
      type: 'category',
      label: 'Reference',
      collapsed: false,
      items: ['reference/cli', 'reference/capabilities'],
    },
  ],
};

export default sidebars;
