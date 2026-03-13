# Continue: OpenCode pipeline — git workspace fix, retry run

## Context

OpenCode agent pipeline running end-to-end with DeepSeek direct API. Four fixes were made this session. The pipeline completes all 6 steps, but `generate-adam` and `generate-tlg` write output to `/output/` instead of `/workspace/` — so nothing gets committed to the clinical workspace git repo.

## What was fixed this session

### 1. Large file path bug (root cause of last session's ENOENT)
- **Problem**: `buildPrompt()` wrote large previous step output files to `/output/` on the host machine (a literal path), but the Docker container mounts a *different* temp directory as `/output/`.
- **Fix**: `run()` in `base-container-agent-plugin.ts` now creates the Docker output temp dir *before* calling `buildPrompt()`, and passes `hostOutputDir` so files are written to the actual mounted directory.
- **Files**: `packages/agent-runtime/src/plugins/base-container-agent-plugin.ts`
- **Verified**: `generate-adam` found `/output/prev-generate-tlg-shells-raw.md` successfully in run `f2792e14`.

### 2. Empty output guard on task resolution
- **Problem**: Autoadvance script blindly approved L3 review tasks even when the agent produced no output (escalated with confidence: 0, result: null). Steps advanced with empty `{}` output.
- **Fix**: Resolve route returns HTTP 422 when approving an `agent_output_review` task where `agentOutput.result` is null or `{}`.
- **Files**: `packages/platform-ui/src/app/api/tasks/[taskId]/resolve/route.ts`
- **Tests**: 2 new tests (null result, empty object result) — both pass.

### 3. Autoadvance script improvements
- Poll interval: 60s (was 5s). Max 30 polls = 30 min (was 120 × 5s = 10 min).
- Handles HTTP 422 gracefully: logs warning and stops instead of dying.
- **File**: `scripts/autoadvance-run.sh`

### 4. Docker I/O tests
- 7 new tests in `packages/agent-runtime/src/plugins/__tests__/opencode-agent-plugin.test.ts`
- **Previous step outputs → container**: large output written to hostOutputDir, small output inlined, multiple large outputs each get own file
- **Container outputs → system**: output_file contract resolution, result.json fallback, markdown raw format, git metadata collection
- All 695 tests pass.

## The remaining bug: agent writes to /output/ instead of /workspace/

### What happens
In git mode steps (`generate-adam`, `generate-tlg`), the entrypoint.sh clones the clinical workspace repo to `/workspace/`, runs the agent command, then commits+pushes any changes in `/workspace/`.

But the agent writes all its code and data files to `/output/` (the volume mount for results), not `/workspace/` (the git repo). So the entrypoint finds no changes → no commit → no push → GitHub compare URL is dead.

### Root cause
The SKILL.md files for `sdtm-to-adam` and `adam-to-tlg` don't tell the agent where to write for git mode. The prompt's "Output Directory" section says `Write all output files to this absolute path: /output` — which is correct for standalone steps but wrong for git mode steps where the deliverables should go to `/workspace/`.

### How to fix
Two-part fix needed:

1. **Prompt building** (`base-container-agent-plugin.ts` `buildPrompt()`): In git mode, add a "## Workspace Directory" section telling the agent to write deliverables (R scripts, data files) to `/workspace/` and only write the output contract JSON to `/output/`.

2. **SKILL.md files**: Update `sdtm-to-adam/SKILL.md` and `adam-to-tlg/SKILL.md` to reference `/workspace/` for code and data output. The skills should instruct the agent to:
   - Write R scripts to `/workspace/code/`
   - Write generated data to `/workspace/data/`
   - Write the output contract to `/output/result.json`
   - Use `/output/` only for temp files and the final contract

### Key constraint
The `/output/` directory is the Docker volume where the system reads results. The `/workspace/` directory is the git repo. The agent needs both:
- `/workspace/` for deliverables that get committed to git
- `/output/` for the result contract and any large intermediate files

## What to do next

### 1. Fix the workspace/output split
Update `buildPrompt()` to add workspace instructions for git mode steps. Update SKILL.md files.

### 2. Retry the pipeline
```bash
pnpm dev  # restart dev server to pick up changes
bash scripts/start-test-run.sh opencode-extract
bash scripts/autoadvance-run.sh <instanceId>
```

### 3. Verify
- `generate-adam`: R scripts committed to workspace repo, GitHub compare URL works
- `generate-tlg`: Same verification
- Output contract in `/output/result.json` correctly read by the system

## Key files
- `packages/agent-runtime/src/plugins/base-container-agent-plugin.ts` — Docker orchestration, prompt building
- `packages/agent-runtime/src/plugins/opencode-agent-plugin.ts` — OpenCode plugin
- `packages/agent-runtime/container/entrypoint.sh` — git clone/commit/push logic
- `apps/protocol-to-tfl/plugins/protocol-to-tfl/skills/sdtm-to-adam/SKILL.md` — ADaM generation skill (needs workspace fix)
- `apps/protocol-to-tfl/plugins/protocol-to-tfl/skills/adam-to-tlg/SKILL.md` — TLG generation skill (needs workspace fix)
- `packages/platform-ui/src/app/api/tasks/[taskId]/resolve/route.ts` — task resolution with empty output guard
- `scripts/autoadvance-run.sh` — auto-advance script (60s polling, 30min max)

## Successful run reference
Instance `f2792e14-0e0a-404a-8c95-5ada56e6dabc` (config opencode-extract v6):
- extract-metadata: ✓ (DeepSeek, auto-approved)
- generate-tlg-shells: ✓ (42 TLGs: 28 tables, 8 listings, 6 figures)
- upload-sdtm: ✓ (22 .xpt files)
- generate-adam: ✓ ran 27 min, wrote R code + 3 ADaM datasets — BUT to /output/ not /workspace/
- generate-tlg: ran (status TBD — autoadvance timed out)

Clinical workspace repo: `Appsilon/mediforce-clinical-workspace`
- Initial commit: `4beb1b0ad77872b04bc7ef930def16e555946222`
- Deploy key: `~/.ssh/mediforce_deploy_key`
- No branch `run/f2792e14-*` exists (because nothing was committed)

## Test commands
```bash
pnpm typecheck          # ~5s
pnpm test:fast          # ~6s, 695 tests
pnpm vitest run packages/agent-runtime/src/plugins/__tests__/opencode-agent-plugin.test.ts  # Docker I/O tests
pnpm vitest run packages/platform-ui/src/app/api/tasks  # resolve route tests (36 tests)
```
