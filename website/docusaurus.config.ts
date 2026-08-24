import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import { themes as prismThemes } from 'prism-react-renderer';

// The pill in the navbar states which Mediforce this documentation describes, so
// it reads from the package version rather than a second copy of the number.
// Single-version docs on purpose: one Mediforce is deployed per environment, so
// there is no older release to browse.
const { version } = require('./package.json') as { version: string };

const config: Config = {
  title: 'Mediforce Docs',
  tagline: 'Workflow and agent orchestration for pharma',
  favicon: 'img/favicon.ico',

  // Set for the eventual host; a wrong value only affects absolute URLs in
  // sitemap/canonical tags, not local development.
  url: 'https://docs.mediforce.ai',
  baseUrl: '/',

  organizationName: 'Appsilon',
  projectName: 'mediforce',

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  markdown: { hooks: { onBrokenMarkdownLinks: 'throw' } },

  future: { v4: true },

  // Offline search: the index ships with the build, so it needs no Algolia
  // account and works on whichever host we settle on — including a preview
  // deploy that DocSearch's crawler would never see.
  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        indexBlog: false,
        docsRouteBasePath: '/',
        highlightSearchTermsOnTargetPage: true,
        searchResultLimits: 8,
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
          editUrl: 'https://github.com/Appsilon/mediforce/tree/main/website/',
          showLastUpdateTime: true,
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: { defaultMode: 'light', respectPrefersColorScheme: true },
    image: 'img/logo.png',
    navbar: {
      title: 'Mediforce',
      logo: { alt: 'Mediforce', src: 'img/logo.png' },
      items: [
        { type: 'docSidebar', sidebarId: 'docsSidebar', position: 'left', label: 'Docs' },
        { href: 'https://mediforce.ai', label: 'mediforce.ai', position: 'right' },
        { href: 'https://github.com/Appsilon/mediforce', label: 'GitHub', position: 'right' },
        {
          type: 'html',
          position: 'right',
          value: `<span class="version-pill" title="Documentation for Mediforce v${version}">v${version}</span>`,
        },
      ],
    },
    footer: {
      style: 'light',
      // Four even columns matching the routing table's own grouping, so the
      // footer is a map of the site rather than two stubs.
      links: [
        {
          title: 'Documentation',
          items: [
            { label: 'Home', to: '/' },
            { label: 'Where to go', to: '/#where-to-go' },
            { label: 'Concepts', to: '/concepts/theme-check' },
          ],
        },
        {
          title: 'Product',
          items: [
            { label: 'mediforce.ai', href: 'https://mediforce.ai' },
            { label: 'Security', href: 'https://mediforce.ai/security.html' },
            { label: 'Validated AI', href: 'https://mediforce.ai/validated-ai.html' },
            { label: 'FDA principles', href: 'https://mediforce.ai/fda-principles.html' },
          ],
        },
        {
          title: 'Project',
          items: [
            { label: 'GitHub', href: 'https://github.com/Appsilon/mediforce' },
            { label: 'Issues', href: 'https://github.com/Appsilon/mediforce/issues' },
            { label: 'Changelog', href: 'https://github.com/Appsilon/mediforce/blob/main/CHANGELOG.md' },
            { label: 'Appsilon', href: 'https://appsilon.com' },
          ],
        },
      ],
      copyright: `© ${new Date().getFullYear()} Appsilon · Mediforce v${version}`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'yaml', 'typescript'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
