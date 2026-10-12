---
status: accepted
audience: engineers
last_reviewed: 2026-10-12
---

# ADR-0027: A Workflow Step may add catalog Skills on top of its Agent's

**Date:** 2026-10-12
**Deciders:** Krystian Zieliński
**Partially supersedes:** [ADR-0025](./0025-skill-catalog.md) §4, the last
paragraph ("Workflow Definitions never name Skills"), and §7, the sentence
saying the Step Fingerprint covers the Agent's Skills only.

## Context

ADR-0025 gave Skills to Agents only. A Step could still name a Step skill, but
only as a `skillsDir` and `skill` path into the files the workflow carries or
into its `externalSkillsRepo`. So the workflow editor had two path fields next to
the new Skills page, and a Step that needed one extra Skill needed an Agent of
its own.

## Decision

1. **`step.agent.skills` is a list of `(namespace, id)` references**, the same
   shape as `AgentDefinition.skills`. The workflow editor picks them from the
   catalog. It does not type paths.
2. **Offered, the same as the Agent's** (ADR-0025 §5). Nothing is pasted into
   the prompt.
3. **Additive.** The Step's Skills come after the Agent's. A Step Skill with the
   same id replaces the Agent's Skill, because the Step is the more specific
   choice (ADR-0025 §6). A Step with no `agentId` can still add Skills.
4. **What a Step may add depends on its Workflow,** in the way ADR-0025 §3 limits
   an Agent:
   - a private Workflow may add its own Namespace's Skills and every public one;
   - a public Workflow may add only public ones.
5. **Deleting a Skill is not refused because a Step names it.** Stored Workflow
   versions are immutable, so an old version would block the delete forever. A
   Step whose Skill is gone fails at run time with `SkillNotFoundError`, which
   names the Step.
6. **A workflow-file skill wins a name clash.** While a step still has a
   `skillsDir`, its folder's skills and the catalog Skills (its Agent's and its
   own) share one plugin folder. A catalog Skill with the id of a skill in that
   folder is left out, and the run reports it.
7. **Checked on save.** Registering a workflow (and importing one), making it
   public, and copying or transferring it to another workspace refuse a Step
   Skill the workflow may not reach, naming the step. Only the latest version
   is checked when a workflow is made public or transferred: older ones fail
   at run time, as in decision 5.
8. **One resolver.** `resolveSkillsForStep` resolves the Agent's list and the
   Step's, so the runtime and the Step Fingerprint see the same set. The `skill`
   component covers both, and a Step offered no Skills keeps the Fingerprint it
   had.

## Consequences

- **Workflow-file skills (`skill` and `skillsDir`) still run, but the editor
  cannot add one.** It shows an existing one read-only so the author can remove
  it. They stay in the schema, with `externalSkillsRepo`, until Skills can be
  imported from git and the `apps/` workflows move to the catalog
  ([#1505](https://github.com/Appsilon/mediforce/issues/1505)).
  `externalSkillsRepo` is also the build-context fallback for a bare
  `dockerfile`, and the editor offers it only for that.
- Step-level narrowing (switching off one of the Agent's Skills) is still out
  of scope.
