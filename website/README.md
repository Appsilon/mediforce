# `@mediforce/website`

The Mediforce documentation site: a Docusaurus build of the engineering and
workflow-authoring docs, themed to look like the product.

```bash
pnpm --filter @mediforce/website start    # dev server, hot reload
pnpm --filter @mediforce/website build    # production build into website/build
pnpm --filter @mediforce/website serve    # serve the built site
```

## What you must not do to it

**Do not move `docs/` at the repository root into here without moving its
guards.** That folder also serves **mediforce.ai** from GitHub Pages — the
`.html` files, `nav.js`, `CNAME`, `setup/`, `case-studies/`, `preview/`,
`features/` and `images/` back live URLs. `scripts/check_doc_links.py` fails the
build on a doc unreachable from the routing table in `docs/README.md`, so the
routing table and that checker move with the content or the build breaks.

**The version pill is derived, not typed.** The navbar pill reads `version` from
this package's `package.json`, and states which Mediforce the docs describe.
Bump it there; never write the number into a page or the config.

**Single-version docs on purpose.** One Mediforce is registered per deployment
(ADR-0013), so there is no older release to browse and no versioned-docs
directory to maintain.

## Theming

`src/css/custom.css` copies the app's tokens from
`packages/platform-ui/src/app/globals.css` and `tailwind.config.ts` — the
primary green, `#fafafa` ground, card white, border, `0.5rem` radius, Inter body
and Space Grotesk headings. The page is the workflow canvas: a dotted ground at
`gap: 24 / size: 1`, the same values as `<Background variant={Dots} />` in
`workflow-diagram.tsx`, with articles and the previous/next cards drawn as white
step nodes floating on it. Change a colour in the app and change it here too, or
the two drift.

Search is `@easyops-cn/docusaurus-search-local`: the index ships inside the
build, so it needs no Algolia account and works on preview deploys.
