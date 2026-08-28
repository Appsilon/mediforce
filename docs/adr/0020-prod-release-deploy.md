---
status: proposed
audience: engineers
last_reviewed: 2026-08-20
---

# 0020 — Production deploy via GitHub Releases + pinned image tags

- **Status:** Proposed (2026-07-29)
- **Authors:** Marek Rogala (@marekrogala)
- **Coordinates with:** the self-hosted docker-compose deployment
  (`deploy@<prod-host>` + `scripts/deploy.sh` + `docker-compose.prod.yml`) and
  `.github/workflows/build-images.yml` / `deploy-production.yml`.

## Context

Production (a self-hosted docker-compose deployment) had no correspondence
between *a version* and *what actually runs*, because the deploy mechanism was
half-wired:

- **Images were `:latest`-only in practice.** `build-images.yml` does stamp
  `:latest` **and** `:${{ github.sha }}` on every `main` build, but
  `docker-compose.prod.yml` hardcodes `image: …:latest`, so the box only ever
  pulls `:latest`. The per-SHA tags exist but nothing targets them, and they are
  **pruned within ~2.5 weeks** — so there is no image to roll back to.
- **`deploy.sh` followed the box's git branch**, not a version:
  `git reset --hard origin/$BRANCH` + `docker compose pull` (`:latest`) with a
  silent **local-build fallback**. What runs = whatever `:latest` last built =
  `main`, regardless of intent.
- **The `production` branch trigger was ignored.** `deploy-production.yml` fires
  on `push: branches: [production]`, but `deploy.sh` deploys `origin/main` +
  `:latest`. `production` had even diverged from `main` (not an ancestor). The
  trigger branch and the deployed code were decoupled.

Net effects: you could not deploy a chosen version, could not roll back to a
specific one (no retained image), and a stray push or `deploy.sh` run would pull
current `main` — a loaded gun next to a production with live external users.

## Decision

Deploy production from **immutable, pinned images promoted through moving tags**,
triggered by **GitHub Releases**. The git ref stops determining what runs; the
image does.

1. **Version identity = the git commit SHA.** Every build already publishes
   `:<sha>`; that is the deployable primitive. A **semver GitHub Release** is the
   human-facing *record* (title, notes, changelog, `Latest`), not the runtime
   pointer. Release build additionally stamps the image `:vX.Y.Z`.

2. **The prod box tracks a stable pointer tag, `:prod-current`.**
   `docker-compose.prod.yml` references `image: …:prod-current`. The box never
   edits image refs per deploy — it always pulls `prod-current`. `prod-current`
   is the honest answer to "what is on prod right now?"

3. **Promote = a retag, not a rebuild.** On deploy: `prod-previous ←` (old
   `prod-current`), then `prod-current ←` the target `:<sha>`. Both pins are
   guaranteed to exist regardless of registry pruning, so **rollback is a tag
   swap** (`prod-current ← prod-previous`) — instant, no pre-deploy image
   snapshot. This replaces the manual `pre-nextauth` snapshot hack from
   RUNBOOK-0002.

4. **Trigger = publishing a GitHub Release (prod only).** One workflow on
   `release: types: [published]` runs **`build` → `deploy` (`needs: build`)** so
   the deploy job can never run before the image exists (a naive setup would fire
   build and deploy in parallel on the tag push and race). A **`production`
   GitHub Environment protection rule** pauses the deploy job for a one-click
   required-reviewer approval before it touches the box.

5. **Manual escape hatch: `workflow_dispatch(ref)`** on the same workflow, for
   the two cases a Release cannot serve:
   - **Rollback** — look up the SHA currently behind `:prod-previous` in ghcr
     (`docker manifest inspect`/the package's tag list) and dispatch that SHA
     (`workflow_dispatch(ref)` resolves a git SHA or tag, not a docker tag). Its
     image already exists, so the run **skips build** and just retags + pulls.
   - **Deliberate SHA at a chosen moment** — e.g. a migration that must run
     *before* the code lands. Dispatch the exact SHA after the pre-step, gated by
     the same Environment approval.

6. **`deploy.sh` becomes dumb and pull-only.** It takes the ref (release tag or
   SHA), `git checkout`s it **only** for the compose file + migration SQL, then
   `docker compose pull` (**fail-loud** — no `--ignore-pull-failures`, no local
   build) + `up -d --remove-orphans`. The image bakes its own `NEXT_PUBLIC_GIT_SHA`.
   If the pinned image is missing, the deploy **stops** instead of improvising.

7. **Staging is unchanged** — auto-deploy from `main` (`:latest`), fast, no
   release ceremony. Releases are a **production-only** concept. The diverged
   `deploy-staging.sh` is unified into the single tag-driven `deploy.sh`.

**Removed as part of this decision:** the `production` branch and its push
trigger; `deploy.sh`'s branch-follow git dance; the `:latest` pull on prod; the
on-box local-build + silent fallback; the `build:` blocks in
`docker-compose.prod.yml` (prod is pull-only); `export NEXT_PUBLIC_GIT_SHA` from
git at deploy time; the separate `deploy-staging.sh`; and the manual rollback
image snapshot.

## Considered alternatives

- **GitOps: `production` branch HEAD = what's deployed.** Coherent, but the box
  is moving to *pull a prebuilt image*, so a git branch would point at code while
  the image is the real artifact — an impedance mismatch — and rollback becomes a
  branch force-move. Since rollback here is fundamentally an *image* operation,
  the image tag is the more truthful pointer. Keeping both the branch and the
  `prod-current` tag would mean two drifting sources of truth. Rejected; the
  `production` branch is retired.
- **`workflow_dispatch(sha)` only, no Releases (bare).** Lightest machinery, no
  tags. Rejected as the *normal* path because it produces no shipped-history /
  changelog record; kept as the **escape hatch** (§5).
- **Plain git-tag push trigger (no Release).** Same tag cost as a Release but
  without notes / `Latest` marker / UI. A Release is strictly the richer version
  of the same mechanism.
- **ghcr keep-last-N retention for rollback.** Useful but insufficient alone —
  any pin older than the window ages out (exactly today's failure). The
  `prod-current`/`prod-previous` pins guarantee the deploy-critical pair
  unconditionally, so explicit retention is not required.

## Consequences

- Deterministic: the deployed version is a named Release; `prod-current` says
  what runs; rollback is one tag swap to `prod-previous`.
- The loaded gun is defused — no path implicitly pulls `:latest` onto prod.
- Prod deploy is a deliberate, approved, audited act with a changelog.
- Image rollback is **not** a schema rollback — DB migrations are additive and
  forward-only; a rolled-back image must still be compatible with the migrated
  schema (true for our additive migrations, but a constraint to respect).
- One-time bootstrap gap: this mechanism is not present in older commits, and the
  first pinned image must exist in ghcr. A one-off manual local build is needed
  to reach a pre-existing SHA whose image was already pruned.

## Out of scope

- The Firebase Auth → NextAuth cutover (ADR-0002) is executed on the **current**
  manual mechanism and does **not** depend on this redesign landing.
- Multi-environment promotion beyond staging/prod, blue-green, and canary
  deploys.
