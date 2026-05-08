# Agent Skills: Definition, Binding, and Upload

Status: design proposal
Audience: Filip, Marek, future contributors
Origin: Vedha SDTM-IG case + binding refactor discussion

## Problem

Three mechanisms today let an agent pick up a skill. They differ in what they can carry (just text vs. a real plugin tree), where the bytes live, and how a skill is bound (workflow step vs. agent definition). The user-facing one — UI upload via `AgentDefinition.skillFileNames` — concatenates file contents into the prompt under `## Skills` ([resolve-agent-identity.ts:46](packages/platform-ui/src/lib/resolve-agent-identity.ts:46)). It does not give the agent a filesystem, so `references/` and executable scripts are impossible. A real user (Vedha, SDTM-IG conformance skill) hit this wall and shipped her skill via a mediforce monorepo PR, coupling her iteration loop to a platform deploy.

The deeper issue is binding. Today three places attach a skill to a runtime call (step.agent.skill, step.agent.skillsDir, AgentDefinition.skillFileNames) with three different semantics. None of them lets an agent owner say "this agent has these skills" via UI in a way that supports proper plugin trees.

This doc inventories the mechanisms, picks a binding model, and lays out the smallest change that gets us there cleanly.

## 1. Inventory of current mechanisms

| Capability | (1) Step-level monorepo | (2) Workflow `repo` + `skillsDir` | (3) UI `skillFileNames` |
|---|---|---|---|
| Native discovery (SKILL.md frontmatter routing on Claude Code) | Yes — `--plugin-dir` mounted at the plugin root, parent of `skillsDir` ([base-container-agent-plugin.ts:806](packages/agent-runtime/src/plugins/base-container-agent-plugin.ts:806)) | Yes — same code path; `repoSkillsDir` substituted in `resolveSkillsDir` ([container-plugin.ts:418](packages/agent-runtime/src/plugins/container-plugin.ts:418)) | No — file contents concatenated into the prompt under `## Skills` ([resolve-agent-identity.ts:46](packages/platform-ui/src/lib/resolve-agent-identity.ts:46)) |
| `references/` folder | Yes (filesystem) | Yes (filesystem) | No — flat blobs joined with `---` |
| Executable scripts (`python3 /plugin/skills/x/lookup.py …`) | Yes — files mounted into container | Yes — same | No — strings in the prompt |
| Per-file size ceiling | None | None | 100 KB (`MAX_SKILL_FILE_BYTES`, [resolve-agent-identity.ts:4](packages/platform-ui/src/lib/resolve-agent-identity.ts:4)) |
| Iteration loop | Edit in monorepo → mediforce CI deploy | Edit external repo → bump `wd.json` `repo.commit` SHA → re-register workflow | Re-upload file in UI (instant) |
| Bound to | step (single skill `skill`, pool `skillsDir`) | workflow (provides `repo`), step picks | agent (always-on across all steps) |
| Couples to platform deploy? | Yes | No | No |
| Used by | `apps/landing-zone`, `apps/protocol-to-tfl` | Empty in practice; supported in code | Vedha and other UI-only agent owners |

The mechanisms are not redundant but the binding semantics overlap awkwardly: (3) lives on the agent, (1)+(2) live on the workflow step. A given run can stack all three. Today, only Claude Code does anything dynamic with a multi-skill plugin tree — OpenCode never sees `--plugin-dir` ([opencode-agent-plugin.ts](packages/agent-runtime/src/plugins/opencode-agent-plugin.ts)) and consumes only the explicit `step.agent.skill` paste.

## 2. Direction: Registry-first binding

The unifying observation: **skills are repos, agents reference them, runs assemble plugin trees**. Three concrete shifts:

1. **Skills always travel as plugin trees** (SKILL.md + `references/` + scripts). No more "paste content into prompt as strings".
2. **Workspace owns a list of Skill Registries** (git repos that contain skills). Adding a Registry is a workspace-level action in the Tools tab.
3. **Agents reference skills by `(registryId, name)`**. The agent edit picker pulls from the workspace's Registries.

### Data model

New Firestore collection (workspace-scoped):

```ts
SkillRegistry {
  id: string
  name: string                 // human label, e.g. "SDTM skills"
  repo: RepoSchema             // reuse — process-definition.ts:57
  skillsDir: string            // path within repo, e.g. "skills"
  createdAt, updatedAt: string
}
```

Updated `AgentDefinition`:

```ts
// remove: skillFileNames: string[]
// add:
skills: Array<{
  registryId: string
  name: string                 // folder under <repo>/<skillsDir>/
}>
```

Same shape covers single-skill agents (one entry) and multi-skill agents. Step-level `step.agent.skill` stays as an explicit override — useful when you want deterministic single-skill prompt injection regardless of agent's pool.

### UI shape

Two surfaces, cleanly separated:

- **Tools tab → Skill Repositories** (workspace-level): list registries, add form (name + repo URL + branch/commit + skillsDir + optional auth secret), delete, refresh (re-resolve tip → store SHA). MVP: that's it. No skill browser yet.
- **Agent editor → Skills section**: dropdown of workspace Registries + freeform skill name. Validation at save = resolve each entry, fail if skill folder not found.

Later, both grow naturally:
- Tools tab gains "list skills found in this registry" once we parse manifests.
- Agent editor gains autocomplete for skill names after Registry pick.

These are pure UI add-ons over the same data model. No schema migration.

### Runtime assembly

For each run, the runtime needs a single plugin tree on disk to mount as `--plugin-dir` (Claude Code) and `/plugin` (Docker volume — already wired in base for both runtimes, [base-container-agent-plugin.ts:1490](packages/agent-runtime/src/plugins/base-container-agent-plugin.ts:1490)).

Assembly algorithm, called from `execute-agent-step.ts` before agent runs:

1. For each `agent.skills[i]`: load Registry, call `fetchSkillsFromRepo(registry.repo.url, registry.repo.commit, registry.skillsDir)` — already exists ([container-plugin.ts:364](packages/agent-runtime/src/plugins/container-plugin.ts:364)). Returns cached `skillsDir` on host.
2. Materialize a per-run plugin dir at `tmp/agent-<id>-<runId>/`:
   ```
   .claude-plugin/plugin.json     ← synthesized manifest
   skills/
     <name1>/  ← copied from cache
     <name2>/  ← copied from cache (possibly different registry)
   ```
3. Pass that path to `WorkflowAgentContext.agentPluginDir`. Runtime uses it as `pluginDir` instead of `dirname(skillsDir)`.

The `fetchSkillsFromRepo` cache (keyed `sha256(repoUrl + commit + skillsDir)`) handles dedup — N agents pointing at the same Registry SHA share one cache entry.

### Multi-runtime activation (CC + OpenCode)

Same plugin tree. Different surface in the prompt:

- **Claude Code**: `--plugin-dir` flag passes the assembled root ([claude-code-agent-plugin.ts:159](packages/agent-runtime/src/plugins/claude-code-agent-plugin.ts:159)). Native frontmatter discovery activates skills dynamically. No prompt-side index needed.
- **OpenCode**: no `--plugin-dir` flag. Files still on disk at `/plugin/skills/<name>/` (already mounted by base). `buildPrompt` injects an index:
  ```
  ## Available Skills

  These skills are available at /plugin/skills/<name>/. Each has a SKILL.md
  describing when to use it. Read SKILL.md before using a skill.

  - <name1>: <description from frontmatter>
  - <name2>: <description from frontmatter>
  ```
  Descriptions parsed from each SKILL.md frontmatter during step 2 of assembly. OpenCode reads files via bash like any other tool call.

`step.agent.skill` (single explicit pick) keeps working as today — full SKILL.md inlined into the prompt, deterministic.

## 3. Recommended scope — minimum forward-compatible change

| File / area | Change | Approx size |
|---|---|---|
| `platform-core/src/schemas/agent-definition.ts` | drop `skillFileNames`, add `skills: Array<{registryId, name}>` | ~10 lines |
| `platform-core` — new `SkillRegistrySchema` + `SkillRegistryRepository` interface | define schema + repo contract | ~30 lines |
| `platform-infra` — Firestore impl of `SkillRegistryRepository` | mirror `AgentDefinitionRepository` shape | ~80 lines |
| `platform-api` — CRUD endpoints for registries | list/get/create/update/delete | ~60 lines |
| `platform-ui` — Tools sub-tab "Skill Repositories" | list + add form + delete | ~150 lines |
| `platform-ui` — Agent editor Skills section | replace file-upload UI with Registry dropdown + skill name input | ~80 lines |
| `platform-ui/src/lib/resolve-agent-identity.ts` | drop skill blob path; keep `systemPrompt` | ~20 lines (deletion) |
| `agent-runtime` — new `resolveAgentSkills` | assemble per-run plugin dir from `agent.skills` | ~80 lines |
| `agent-runtime/src/plugins/base-container-agent-plugin.ts` | use `agentPluginDir` if present; multi-skill index in `buildPrompt` for OpenCode | ~40 lines |
| `platform-ui/src/lib/execute-agent-step.ts` | call `resolveAgentSkills` before run, populate `agentPluginDir` | ~15 lines |
| Migration script | one-shot: `skillFileNames` → platform-managed Registry → rewrite agent.skills | ~150 lines (one-off) |
| Tests | journey: 2 skills from 2 registries, prompt index correct, plugin dir contains both | ~80 lines |

Estimate: ~600 lines of production code + tests + one-off migration. Achievable in a few focused days. No new abstractions beyond `SkillRegistry`.

### Migration

For Vedha and other (3) users:

1. Create one platform-managed Registry per workspace, backed by a fresh git repo (`mediforce/<workspace>-skills` or similar).
2. For each agent with non-empty `skillFileNames`: download each blob, write to `skills/<agentId>/<filename-stem>/SKILL.md`, commit, push.
3. Resolve the new SHA, register as a `SkillRegistry`.
4. Rewrite `agent.skills = [{ registryId, name: '<agentId>/<filename-stem>' }, ...]`. Clear `skillFileNames`.

Vedha specifically: her skill already lives in the monorepo. Add the monorepo as a Registry (`repo.url = mediforce monorepo`, `skillsDir = apps/sdtm-rule-migration/plugins/sdtm-rule-migration/skills`), reference `name = sdtmig-reference`. When she's ready, she can lift to her own repo and switch the Registry — without a mediforce deploy.

## 4. What stays out of MVP

Deferred, additive, no schema change required:

- **Skill browser in Tools tab**. List skills found at resolved SHA, show frontmatter description. Pure UI feature.
- **Autocomplete in agent picker**. Same data, surfaced in agent editor.
- **Per-skill pin override**. Optional `pin?: string` on skill ref to use a different SHA than the Registry's. Additive field.
- **Marketplace.json parsing**. Read `.claude-plugin/marketplace.json` if present in the Registry repo — Claude Code's standard manifest format. Lets one Registry expose multiple plugins. Resolver-only change.
- **Floating-branch Registries**. `RepoSchema.commit` requires hex SHA today ([process-definition.ts:61](packages/platform-core/src/schemas/process-definition.ts:61)). Allow `branch` mode where Registry resolves tip on a TTL. Schema additive.
- **Per-org Registry sharing**. Move `skillRegistries` from workspace to org collection so multiple workspaces share Registries. Data migration only.
- **Cache hygiene**. TTL/LRU eviction for `SKILLS_CACHE_DIR`. Low priority — disk is cheap.
- **Test-fetch button**. Validate `repo.auth` token resolves before first run.

## 5. Follow-up issues to file

1. **Refactor: `AgentDefinition.skillFileNames` → `agent.skills` + `SkillRegistry`**. The MVP described in §3.
2. **UI: Tools sub-tab "Skill Repositories"**. CRUD on `SkillRegistry`. No skill browser yet.
3. **UI: Agent editor Skills section**. Registry dropdown + skill name input. Replace file upload with hard error message pointing at Tools tab.
4. **Runtime: `resolveAgentSkills` + multi-skill prompt index**. Generalize `fetchSkillsFromRepo`, assemble per-run plugin dir, inject "Available Skills" index for OpenCode.
5. **Migrator: legacy `skillFileNames` → platform-managed Registry**. One-shot per environment.
6. **Schema: `RepoSchema.commit` XOR `branch`**. Allow floating-branch Registries with resolved-SHA cache key. Document freshness window.
7. **Observability: surface assembled plugin dir in run logs**. Already partially logged ([base-container-agent-plugin.ts:782](packages/agent-runtime/src/plugins/base-container-agent-plugin.ts:782)); expose to UI run view so users can debug "why didn't my skill load".
8. **Deprecate `step.agent.skillsDir`**. After §1 ships, workflow-level skill pool is redundant — agent's `skills` is the pool. Keep for backwards compat with existing `apps/*` workflows; plan removal in a follow-up milestone.
9. **Docs: "How to ship a skill" decision tree**. New skill → commit to a Registry repo → bump Registry SHA in Tools tab → reference in agent. One page, link from the agent editor.
