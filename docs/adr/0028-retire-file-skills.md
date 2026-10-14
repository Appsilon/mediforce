---
status: accepted
audience: engineers
last_reviewed: 2026-10-13
---

# ADR-0028: Skills come from the catalog only; git is a source to import from

**Date:** 2026-10-13
**Deciders:** Krystian Zieliński
**Issue:** [#1505](https://github.com/Appsilon/mediforce/issues/1505)
**Partially supersedes:** [ADR-0027](./0027-step-adds-catalog-skills.md)
decision 6 and its first Consequence ("workflow-file skills still run"), and
[ADR-0025](./0025-skill-catalog.md) §5's sentence on the Step skill and §6's
paragraph on merging a Step skill folder.

## Context

ADR-0027 moved step skills to the catalog, but a step could still reach a
skill through a path: `agent.skill` + `agent.skillsDir`, read from the files
the workflow carries, from its `externalSkillsRepo`, or from the host's
checkout. Those paths could not be removed while nothing turned a skill in git
into a catalog Skill: an `apps/` package imported into another workspace would
have named Skills that did not exist there.

## Decision

1. **A Skill in git is imported, not referenced.** `mediforce skill import`
   (and *Import from git* on the Skills page) takes a GitHub repo URL, a ref
   and a directory, resolves the ref to a commit, and makes every
   `<dir>/<name>/SKILL.md` folder a Skill of the workspace. The clone is
   anonymous, as for a draft repo browse: the caller names the repository, so
   the deployment's own key is never spent on it. A new Skill is private. One
   whose files differ is updated in place, keeping its visibility, because a
   re-import is how upstream changes are taken; an identical one is left
   alone. A bad folder imports nothing.
2. **A workflow package ships its Skills.** Importing a workflow from git
   first imports the package's `skills/` folder (beside the `.wd.json`, or
   beside its `src/` folder) into the importing workspace, then points every
   step skill reference naming one of those Skills in the file's own namespace
   (or in any, when the file declares none) at that workspace; a reference to
   another namespace is left alone. The definition is validated before any
   Skill is written, so one that cannot register imports nothing.
3. **A step names Skills only in `agent.skills`.** `skill`, `skillsDir` and the
   workflow's `externalSkillsRepo` leave the schema. Registering a file that
   still sets any of them is refused with a pointer to `agent.skills` and
   `skill import`, rather than stripped: a stripped `externalSkillsRepo` would
   hand a bare `dockerfile` step the golden image. A step whose
   instructions were a pasted SKILL.md now has a `prompt` that names its Skill:
   the Skill is offered, not imposed (ADR-0025 §5), so the prompt is what makes
   the agent use it.
4. **A stored step that named a file skill fails loudly.** Migration 0079
   replaces `skill` / `skillsDir` with `agent.retiredFileSkill`
   (`<skillsDir>/<skill>`). Running such a step throws
   `RetiredFileSkillError`, which names the step and the skill, before any
   plugin runs (a dry run included); saving it again is refused until the
   author removes the marker, which the step editor and the run preflight both
   point out. It never runs without its skill. A `skill` with no `skillsDir`
   was never read by the runtime and is dropped.
5. **`externalSkillsRepo` as a build context is written onto the step.** The
   same migration copies the repo and commit onto every step that built a bare
   `dockerfile` from it, and its `auth` onto every repo-building step without a
   `repoAuth`, which is what the runtime resolved. The image tag is unchanged.
   The column is dropped.
   Before rewriting a version, the migration keeps what it looked like in
   `workflow_definitions.legacy_definition` (`{ steps, externalSkillsRepo? }`,
   the steps verbatim, `skill` / `skillsDir` included). It is server-managed:
   no registration or template carries it, and only the migration writes it.
   The workspace's Workflows problems box names the repository its skills were
   read from and links the version page, which shows the original definition
   read-only beside the migrated steps.
6. **The Step Fingerprint keeps its shape.** The `skill` component no longer
   hashes a file skill. It stays `null` for a step offered no Skills and keeps
   its `step: null` slot otherwise, so no Fingerprint of a step that never had
   a file skill moves.

## Consequences

- `apps/` packages keep their skills in `<app>/skills/` as the source the
  import reads; nothing at run time reads them from disk.
- The Docker `MOCK_AGENT` mode found its fixtures beside `skillsDir`; it reads
  `MOCK_FIXTURES_DIR` instead, and mounts none when it is unset.
- A Skill is capped at 1 MB (ADR-0025 §1). A skill in git larger than
  that cannot be imported as it stands.
- A stored version whose step built through the `externalSkillsRepo` fallback
  gains `repo` / `commit` / `repoAuth` on the step, so its Fingerprint's
  `config` component changes once and its Step Qualification goes stale.

## Considered options

- **Keep file skills as a second, read-only source.** Rejected: two sources
  with different semantics (pasted versus offered) and a third path through the
  host checkout, for skills that can now be imported.
- **Strip the old fields on read.** Rejected: a stored step would then run
  without the instructions it was written around.
- **Refuse the old fields on read.** Rejected: a failed parse drops the version
  from every listing.
- **Rewrite package references on register as well as import.** Rejected:
  `register --file` has no package to import Skills from; it needs them in the
  workspace first (`mediforce skill import`).
