import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

/**
 * Product documentation: what a reader does with Mediforce, in the order they
 * do it — install, first run, build, run, agents, then what bites them. The
 * repository's own `docs/` is engineering documentation and does not appear here.
 */
const sidebars: SidebarsConfig = {
  docsSidebar: [
    'index',
    { type: 'category', label: 'Install', collapsed: false, items: ['install/index'] },
  ],
};

export default sidebars;
