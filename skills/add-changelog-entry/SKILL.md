---
name: add-changelog-entry
description: Append a one-line entry for a merged (or about-to-merge) PR under the `[Unreleased]` section in CHANGELOG.md. Use after merging a non-trivial PR, when batching multiple PRs covering one feature, or when updating a Keep-a-Changelog entry. Triggers: "add to changelog", "log this change", "update CHANGELOG", "release notes".
allowed-tools: Bash, Read, Edit
metadata:
  author: Mediforce
  version: "2.1"
  domain: development
  complexity: basic
  tags: changelog, keep-a-changelog
---

# Add Release Notes

`CHANGELOG.md` at repo root follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). Every non-trivial PR appends a bullet under `## [Unreleased]`. Weekly cut is automated (Monday 09:00 CET, [`changelog-cut.yml`](../../.github/workflows/changelog-cut.yml)) — this skill **never** edits dated weekly sections.

## Usage

```
/add-changelog-entry                  # infer from latest merged PR on main
/add-changelog-entry 408              # specific PR number
/add-changelog-entry 402 408          # group multiple PRs as one item
```

## When to add

For PRs that ship user-visible behavior, new capability, infra/schema change, workflow or app addition. **Skip** trivial: typos, single-line config, comment-only diffs. Renovate bumps go under `### Dependencies`.

## Procedure

### 1. Resolve PR(s)

```bash
gh pr view <num> --json number,title,url,mergedAt,body,author
```

No number given → latest merged PR on `main`:

```bash
gh pr list --state merged --base main --limit 1 --json number,title,url,mergedAt
```

### 2. Pick a Keep-a-Changelog category

Always one of, in this order:

- **Added** — new features, endpoints, commands, workflows.
- **Changed** — modified existing behavior, UI rewrites, refactors users notice.
- **Deprecated** — soon-to-be-removed features (still works).
- **Removed** — gone for good.
- **Fixed** — bug fixes.
- **Security** — vuln fixes, auth hardening, privilege scoping.
- **Dependencies** — Renovate/dep bumps (Mediforce extension to spec).

Pick the strongest verb. New endpoint that fixes a missing feature = **Added**, not **Fixed**.

### 3. Locate or create the section under `## [Unreleased]`

```markdown
## [Unreleased]

### Added
- …

### Fixed
- …
```

If subsection missing, insert in the canonical order above. Never reorder existing dated sections.

### 4. Write the line

One sentence. Active voice. Plain engineer-to-engineer English. End with inline markdown link — text `#NNN`, target `https://github.com/Appsilon/mediforce/pull/NNN`. No parens around it, no reference-style footnote. (Bare `#NNN` does NOT auto-link in GitHub's markdown blob view — only inside issue/PR comments and commits.)

Single PR:
```
- Short description of behavior change [#408](https://github.com/Appsilon/mediforce/pull/408).
```

Multiple PRs covering one thing — inline list:
```
- Headline sentence: sub-point [#402](https://github.com/Appsilon/mediforce/pull/402), sub-point [#408](https://github.com/Appsilon/mediforce/pull/408).
```

Or nested when each sub-point needs its own context:
```
- Headline sentence:
  - Sub-point [#402](https://github.com/Appsilon/mediforce/pull/402)
  - Sub-point [#408](https://github.com/Appsilon/mediforce/pull/408)
```

### 5. Commit

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): #<num> <short title>"
```

Don't push unless asked.

## Conflict handling

`CHANGELOG.md` is marked `merge=union` in [.gitattributes](../../.gitattributes) — git keeps lines from both sides on merge, no conflict marker. Just append the bullet on your branch and let git handle parallel PRs. Order may interleave; the weekly cut PR is a good moment to re-order if needed.

Only edge case: if both branches add a new `### Subsection` header that didn't previously exist, you'll get duplicates after merge. The skill checks for the subsection before inserting, so this is rare.

## Weekly cut — DO NOT do manually

Automated. [`changelog-cut.yml`](../../.github/workflows/changelog-cut.yml) opens a PR each Monday that:
1. Renames `## [Unreleased]` → `## [YYYY-MM-DD]` (Sunday's date).
2. Inserts fresh empty `## [Unreleased]` on top.
3. Asks a human to merge.

If the auto-cut PR is open, add new bullets to `[Unreleased]` as usual — they go into next week's cut.

## Tone

Engineer-to-engineer. State the **essence** of the change — the outcome a teammate cares about — not a restated commit title.

Test: if you removed the PR link, would someone skimming a year later understand why the change mattered? If no, rewrite. Capture the *why* or the *now possible / now fixed* effect, not the mechanic.

- Bad (restated title): "Cowork: load OpenRouter key from workspace secrets."
- Better (states the effect): "Cowork is now per-workspace billed — OpenRouter key read from workspace secrets instead of a global env var."

- Bad (vague): "Improved the cowork experience with several enhancements."
- Bad (mechanic): "Refactored `AgentOutputDisplay` into shared component."
- Good (effect): "Agent output now consistent across surfaces — L2 auto-runner steps finally show their HTML report without needing L3 review."

Avoid marketing words. Avoid restating the file path or function name unless it's the headline of the change.

## Output

Edited `CHANGELOG.md`. Print the added bullet to stdout for confirmation.
