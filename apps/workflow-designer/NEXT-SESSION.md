# Next Session: Fix generate-definition SKILL.md for local/Docker agnostic output

## Problem

The `generate-definition` agent step fails because the SKILL.md at
`apps/process-designer/plugins/process-designer/skills/generate-definition/SKILL.md`
hardcodes Docker container paths (`/output/process-definition.yaml`). When running
locally (no Docker image in config), `/output/` doesn't exist as a mounted volume.

## What to do

Make the SKILL.md work in both local and Docker execution modes, just like the
protocol-to-tfl skills already do. Study how these existing skills handle output:

- `apps/protocol-to-tfl/plugins/protocol-to-tfl/skills/trial-metadata-extractor/SKILL.md`
- `apps/protocol-to-tfl/plugins/protocol-to-tfl/skills/mock-tlg-generator/SKILL.md`
- `apps/protocol-to-tfl/plugins/protocol-to-tfl/skills/sdtm-to-adam/SKILL.md`

Also study how the plugin builds the prompt and manages I/O paths:

- `packages/agent-runtime/src/plugins/claude-code-agent-plugin.ts` — look at `buildPrompt()`,
  `spawnLocalProcess()` vs `spawnDockerContainer()`, and how `hostOutputDir` is resolved
- `packages/agent-runtime/src/runner/agent-runner.ts` — look at `parseAgentOutput()`
  to understand what output contract format is expected

The key insight: the plugin creates a temp dir that gets mounted as `/output/` in Docker,
but in local mode the agent writes to the actual temp dir path. The SKILL.md should NOT
hardcode `/output/` — it should follow whatever pattern the existing working skills use
to be mode-agnostic.

## Config considerations

The current `process-config-claude.json` has no `image` field — decide whether to:
1. Add `"image": "mediforce-golden-image"` to always run in Docker (simpler)
2. Keep it imageless for local mode and make the skill truly agnostic (more flexible)
3. Create two configs: `claude-docker` and `claude-local` like protocol-to-tfl has

Also consider: the generate-definition step doesn't need R, tidyverse, or any heavy
dependencies — it just needs Claude CLI. So local mode is actually ideal for it.
A `local-claude` config variant (like protocol-to-tfl has) would work well.

## After fixing the skill

1. Bump config version to v2 in `process-config-claude.json`
2. Re-register via API: `POST /api/configs` with the updated config
3. Start a new instance and test the full flow end-to-end
4. The existing test instance `04e08bd2-a378-4984-80a3-e68ab0dd1ee2` can be cancelled

## What's already working

- Process definition registered (v1)
- Process config registered (claude v1)
- Params form renders correctly — describe-idea step completed successfully
- Validation script (inline JS in config) and registration script are ready
- All 715 tests pass, typecheck clean
