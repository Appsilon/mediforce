---
name: add-changelog-entry
description: Draft the CHANGELOG.md section for a Mediforce release from the PRs merged since the last tag. Developer-triggered only, at release time, via /add-changelog-entry <version>. Never run it on your own initiative.
disable-model-invocation: true
allowed-tools: Bash, Read, Edit
metadata:
  author: Mediforce
  version: "3.0"
  domain: development
  complexity: basic
  tags: changelog, keep-a-changelog, release
---

# Add Changelog Entry

The changelog is human-driven. A developer runs this when cutting a release, reads the draft, and rewrites whatever doesn't sound right. The developer owns the result, not the skill.

`CHANGELOG.md` holds released versions, newest first, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) form. `## [Unreleased]` sits on top and stays empty unless a developer jots something there by hand. Nothing fills it automatically, and there is no per-PR entry. Pushing a `vX.Y.Z` tag makes [`release.yml`](../../.github/workflows/release.yml) publish that version's section as the GitHub release, word for word.

## Usage

```
/add-changelog-entry 1.3.0
```

## Procedure

### 1. Find what shipped

```bash
previous=$(git describe --tags --abbrev=0 origin/main)
since=$(git log -1 --format=%cI "$previous")
gh pr list --state merged --base main --search "merged:>$since" --limit 200 \
  --json number,title,body,labels
```

### 2. Keep only what a user sees

Someone using Mediforce, or running it, must be able to notice the change. Leave out refactors, tests, CI, dependency bumps, internal docs, the marketing site, and anything they couldn't find in the app, the CLI, or their `.env`. Several PRs that make up one feature become one bullet.

### 3. Write the section

Insert it directly below `## [Unreleased]`, above the previous version. Fold in any bullets a developer left under `[Unreleased]`, then leave that heading empty. Categories appear in this order and only when they have entries: Added, Changed, Deprecated, Removed, Fixed, Security.

```markdown
## [1.3.0] - 2026-10-12

### Added

- **Join Links:** Invite a whole room with one link, or show it as a QR code on a slide ([#1329](https://github.com/Appsilon/mediforce/pull/1329), [#1354](https://github.com/Appsilon/mediforce/pull/1354)).

### Fixed

- Agent steps no longer stall when the queue is under load ([#1371](https://github.com/Appsilon/mediforce/pull/1371)).
```

Rules:

- Added and Changed bullets open with a bold Title Case label and a colon. Fixed bullets are plain sentences.
- Say what someone can now do or will notice. Never the mechanism.
- End every bullet with the merged PRs that delivered it, hyperlinked, before the full stop: `([#1329](https://github.com/Appsilon/mediforce/pull/1329), [#1354](https://github.com/Appsilon/mediforce/pull/1354))`. A bare `#1329` doesn't link in the rendered `CHANGELOG.md`. Check each number with `gh pr view` before writing it.
- No handler, table, migration or ADR names in the prose. Name a setting or env var only when the user has to touch it.
- No em dashes.
- A change that needs action on upgrade starts with `**Breaking:**` and says what to do.

| Don't | Do |
|---|---|
| `DELETE /api/namespaces/:handle` now rejects a personal workspace with 409 | **Reset Workspace:** A personal workspace offers Reset instead of Delete, since it would come straight back ([#1142](https://github.com/Appsilon/mediforce/pull/1142)). |
| The execution log is reworked: logs stream live instead of arriving in a lump | **Live Logs:** Step logs stream as they happen instead of arriving when the step ends ([#1383](https://github.com/Appsilon/mediforce/pull/1383)). |

### 4. Hand it over

Show the developer the section. Don't commit, push or tag unless they ask.

## Releasing

1. In one release PR, bump `version` in the root `package.json` and add the section.
2. Merge it.
3. Tag the merge commit: `git tag vX.Y.Z && git push origin vX.Y.Z`.

A tag without a matching section fails the release job, so the notes can't be skipped.
