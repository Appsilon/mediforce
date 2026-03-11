# Continuation Prompt — Agent Pipeline Fixes

Branch: `refactor/move-apps-directory`. Previous commit: `2d1e3fb`.

## What was fixed this session:

1. **Permission blocking** — Agent couldn't write output files. Root cause: `--allowedTools` variadic flag consumed the prompt arg, and path-scoped patterns don't work in CLI. Fix: `--allowedTools Read,Write,Edit,Glob,Grep` + pipe prompt via stdin.

2. **macOS /var symlink** — `tmpdir()` returns `/var/folders/...` but CLI resolves to `/private/var/folders/...`. Fix: `realpath()` after `mkdtemp`.

3. **Timeout at 10min** — Agent was generating huge JSON inline instead of using Write tool. Fix: SKILL.md updated with explicit "use Write tool" instructions + timeout bumped to 20min.

4. **Missing log events** — Logger only captured `assistant` events, not `user` (tool results) or other types. Fix: added handlers for `user` tool_result blocks, generic fallback for unknown events.

5. **Temp dir cleanup on failure** — Was deleting debug artifacts. Fix: only cleanup on success, include tempDir path in error payload.

6. **Log viewer broken** — Format changed from `kind` to `type`+`subtype`. Fix: `classifyEntry()` normalizer, skip empty entries, added `ToolResultEntry` component.

7. **SKILL.md improvements** — Inlined output-schema.md and sap-section-guide.md. Removed "offer next steps" step. Made validation lightweight. Added time budget awareness. Added HARD STOP contract.

8. **Output contract** — Agent writes JSON to file via Write tool, returns `{"output_file": "...", "summary": "..."}`. Plugin reads file from disk via `extractResult()`.

9. **Configurable timeout** — `agentConfig.timeoutMs` in ProcessConfig schema, default 20min.

## Key files changed:

- `packages/agent-runtime/src/plugins/claude-code-agent-plugin.ts` — permissions, logging, output contract, realpath, cwd
- `packages/platform-ui/src/components/processes/agent-log-viewer.tsx` — new format support, skip empty entries
- `packages/platform-core/src/schemas/process-config.ts` — timeoutMs in AgentConfig
- `apps/protocol-to-tfl/plugins/protocol-to-tfl/skills/trial-metadata-extractor/SKILL.md` — rewritten with inlined schemas

## Latest successful run:

Agent completed in ~5.5 minutes. Write succeeded. Contract JSON returned with output_file path.

## What's next:

1. **Commit all changes** — significant unstaged work from this session
2. **Verify extractResult reads the file** — confirm the plugin actually reads the JSON from disk and passes it through as the result
3. **Process advancement** — after agent completes, process should advance extract-metadata → review-metadata → done
4. **Review step UI** — display extracted metadata for human review/approval
5. **E2E tests** — Playwright tests for the upload + extraction flow

## Unstaged changes (from earlier sessions):

- `packages/platform-ui/src/app/(app)/processes/[name]/page.tsx` — start-run dialog
- `packages/platform-ui/src/app/actions/processes.ts` — process actions
- `packages/platform-ui/src/components/tasks/task-detail.tsx` — task detail upload
- `packages/platform-ui/src/components/processes/start-run-dialog.tsx` — new file
- `packages/platform-ui/src/components/tasks/next-step-card.tsx` — new file
- `scripts/seed-upload-task.cjs` / `.mjs` — seed scripts
- `scripts/test-allowed-tools.sh` — test script (can delete)
