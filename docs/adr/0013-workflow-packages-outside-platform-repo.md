---
status: proposed
---

# Workflow packages live outside the platform repo

Production Workflow packages move out of `apps/` in the platform repo into a
separate repository. The platform repo keeps only the tutorial examples under
`docs/workflow-examples/` (already the sole content of `workflows-index.json`)
plus `apps/golden-standard-workflow` as the reference package. Extracted
packages reach a Deployment by **CLI registration from their own CI**
(`mediforce workflow register`), and their container images are built by the
platform from `repo` + `commit` on the step, not from images pre-built on the
Deployment host.

**Driver:** the platform repo is what a customer's engineer reads to decide
whether to trust the platform, and what an Appsilon engineer reads to learn how
to build a workflow. Fifteen directories of half-live customer work sitting
next to the engine makes both jobs harder, and couples every Deployment's
runtime to the platform's release.

## Considered options

### Getting the definition into a Deployment

- **Git import (status quo mechanism).** Rejected as the *primary* path.
  `packages/platform-api/src/handlers/workflows/_github.ts` issues every request
  unauthenticated — plain `fetch(url)` for raw content, and `fetch(apiUrl, {
  headers: { Accept: 'application/vnd.github.sha' } })` for ref resolution. No
  `Authorization` header exists in the file. A private extracted repo returns
  404. It is additionally hardcoded to `github.com` (`url.hostname !==
  GITHUB_HOST` throws) and subject to the unauthenticated GitHub API limit of 60
  requests/hour **per server IP**, shared across every user of the Deployment —
  the handler already carries a dedicated 403 branch for it.
- **Make the extracted repo public so import works.** Rejected: that is a
  security posture chosen to route around a missing feature. Production
  Workflow packages for Appsilon and for customers carry process detail that
  has no reason to be public.
- **CLI registration from the extracted repo's CI (chosen).** A CI job runs
  `mediforce workflow register --file … --namespace …` against the target
  Deployment with an API key. Requires no platform change, works against a
  private repo today, works against any git host, and is what AGENTS.md §4
  already mandates ("any operation the CLI covers MUST go through it").
- **Authenticated git import (chosen as a follow-up, not a prerequisite).**
  A per-Namespace token on the import path, lifting both the private-repo and
  rate-limit constraints. This is the right long-term shape — a pharma
  customer's Workflow packages will live in a private, often non-GitHub repo —
  but it is a feature, and blocking the extraction on it would re-expand scope.
  Tracked separately.

### Getting the container image onto the Deployment

This is the part that makes the extraction a regression if it is skipped.

- **Status quo (implicit, breaks on extraction).** Not one app Workflow
  declares a build source: every step references a bare, unqualified local tag
  (`mediforce-golden-image:latest`, `mediforce-agent:protocol-to-tfl`,
  `mediforce-landing-zone:latest`, `mediforce-agent:tealflow`) with
  `repo`/`commit` unset. Those images exist on a Deployment **only because
  `apps/` rides along in the repo cloned to the host**: `scripts/deploy.sh`
  runs `scripts/rebuild-docker-images.sh`, which builds them from hardcoded
  `$REPO_ROOT/apps/*/container/` paths. CI publishes only three images —
  `platform-ui`, `migrate`, `container-worker` — never app images. Extract
  `apps/` without addressing this and definitions import cleanly while every
  Run dies at its first `script` or `agent` step with `Unable to find image
  '...' locally`.
- **Publish app images to a registry and pin fully-qualified tags.** Rejected:
  adds a registry, credentials, and a publish pipeline per package, and pins
  each Deployment to image tags an operator must keep in sync by hand.
- **Keep building on the Deployment host from a second clone.** Rejected:
  couples every Deployment's deploy script to a second repository and keeps the
  build on the production host.
- **Build from `repo` + `commit` on the step (chosen).** The platform already
  does this: `docker-image-builder.ts` builds an image from a repo at a pinned
  commit, and `container-plugin.ts` resolves a `repoToken` from the step's env
  / Secrets before cloning, with `git-clone.ts` supporting SSH and HTTPS and
  redacting credentials from logs. It works against a **private** repo today,
  needs no registry, and requires no change to `deploy.sh`. The existing error
  message already names it as the intended fix.

## Consequences

- **`rebuild-docker-images.sh` loses its `apps/` build steps**, and with them
  the instruction in `GETTING-STARTED.md` telling every new developer to run it
  before a `script` step will work. The local-dev story for extracted packages
  becomes "the platform builds the image from the pinned commit", which is a
  first run that is slower and needs network.
- **`pnpm-workspace.yaml` (`apps/*`, `apps/examples/*`) and `vitest.config.ts`
  (`apps/*/vitest.config.ts`) shed their `apps/` entries.** CI references
  `apps/` nowhere, so there is no pipeline change.
- **A pinned `commit` becomes load-bearing rather than advisory.** The
  `design-workflow` skill already fills each `commit` with an all-zeros
  sentinel until a real SHA exists; after this ADR an unpinned package cannot
  run at all, which is the intended forcing function.
- **The platform loses its in-repo integration surface for real workflows.**
  `apps/golden-standard-workflow` stays precisely so that one end-to-end
  production-shaped package remains testable inside this repo.
- **Recorded asymmetry:** the platform can clone a *private* repo to build a
  container image (`repoToken`, SSH + HTTPS, any host) but cannot read a
  `.wd.json` from that same repo (unauthenticated, `github.com` only). That gap
  is not a design decision, and it is the concrete argument for the
  authenticated-import follow-up above.
