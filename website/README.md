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
`features/` and `images/` back live URLs, and so does every `.md` in it, which
Jekyll renders (`docs/README.md` is live at `mediforce.ai/README`).
`scripts/check_doc_links.py` fails the build on a doc unreachable from the
routing table in `docs/README.md`, so the routing table and that checker move
with the content or the build breaks.

**The version pill is derived, not typed.** The navbar pill reads `version` from
the **repository root** [`package.json`](../package.json) — the platform's own
version, not this site's, which is why `website/package.json` carries no
`version` field to bump. It states which Mediforce the docs describe. Bump it at
the root; never write the number into a page or the config.

**Single-version docs on purpose.** One Mediforce is registered per deployment
(ADR-0013), so there is no older release to browse and no versioned-docs
directory to maintain.

## Where it is served

`mediforce.ai/docs` — a path on the marketing site, not a `docs.` subdomain. A
repository gets one GitHub Pages site and mediforce.ai already holds it, so
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) composes both
into one artifact: Jekyll builds the root `docs/` folder to the site root, this
build is copied in at `/docs`, and the pair deploy together. That is what
`baseUrl: '/docs/'` in the config is for — change one without the other and
every asset path 404s.

Two consequences worth knowing. A broken build here blocks a marketing-site
deploy, because they publish as one artifact. And on a pull request that
workflow builds the site without deploying it, which is the only thing that
type-checks this package — the root `tsc -b` has no `website` reference.

## Theming

`src/css/custom.css` copies the app's tokens from
`packages/platform-ui/src/app/globals.css` and `tailwind.config.ts` — the
primary green, `#fafafa` ground, card white, border, `0.5rem` radius, Inter body
and Space Grotesk headings. The page is the workflow canvas: a dotted ground at
`gap: 24 / size: 1`, the same values as `<Background variant={Dots} />` in
`workflow-diagram.tsx`, with articles and the previous/next cards drawn as white
step nodes floating on it. Change a colour in the app and change it here too, or
the two drift.

## Link checking

`pnpm check:docs` link-checks these pages along with the rest of the repo, and
resolves their targets the way Docusaurus does: an extensionless target such as
`../run/verify` and a bare directory both work here and nowhere else in the
repo. Nothing under `website/docs/` has to declare the `status` / `audience` /
`last_reviewed` frontmatter `docs/` requires, and none of it is walked for
reachability from `docs/README.md` — this sidebar routes a reader here.

Search is `@easyops-cn/docusaurus-search-local`: the index ships inside the
build, so it needs no Algolia account and works on preview deploys.
