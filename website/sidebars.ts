import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

/**
 * Mirrors the routing table in docs/README.md: the same sections, in the same
 * order, so a reader who knows the repo layout is not relearning it here.
 * Sections land as the docs are ported; this is the scaffold's subset.
 */
const sidebars: SidebarsConfig = {
  docsSidebar: [
    'index',
    {
      type: 'category',
      label: 'Concepts',
      collapsed: false,
      items: ['concepts/theme-check', 'concepts/pagination-check'],
    },
  ],
};

export default sidebars;
