---
status: accepted
audience: engineers
last_reviewed: 2026-10-19
---

# ADR-0030: An agent step writes `result.json` and its Output Files into one folder, and nothing else counts

**Date:** 2026-10-19
**Deciders:** Krystian Zieliński
**Epic:** [#1568](https://github.com/Appsilon/mediforce/issues/1568) — agent step output contract
**Issue:** [#1569](https://github.com/Appsilon/mediforce/issues/1569)
**Supersedes:** [#1551](https://github.com/Appsilon/mediforce/issues/1551) (closed PR [#1554](https://github.com/Appsilon/mediforce/pull/1554), never merged)
**Partially supersedes:** [ADR-0015](./0015-output-files-on-run-branch.md),
the Decision's copy step (copying `/output` into the workspace after each agent
step) and its exclusion list of internal runtime files
(`INTERNAL_OUTPUT_FILE_NAMES`).

## Context

An agent step's output is spread across too many channels, and the prompt that
explains them contradicts itself.

- **Two folders.** `workingDir` is the run's git worktree. `/output` is a
  scratch folder mounted for one step, which also holds the engine's own files
  (`prompt.txt`, `input.json`, `mcp-config.json`, `auth.json`, …). When the
  step ends, the agent's files are copied into the worktree at
  `.mediforce/output/<stepId>/` (`copyOutputFilesIntoWorkspace`) and `/output`
  is deleted. The prompt tells agents both "it is published" and "it is
  discarded" about the same folder, and also asks for "ALL deliverable files"
  in the worktree, so outputs land in both places.
- **Four ways to produce a result**, in `extractResult`
  (`packages/agent-runtime/src/plugins/base-container-agent-plugin.ts`):
  1. a JSON closing message replaces the result, and beats `result.json`;
  2. a closing message with an `output_file` key stands for that file's
     contents;
  3. a prose closing message becomes `{ raw }`;
  4. with no closing message, `/output` is scanned and every file in it is
     packed into the result (`recoverOutputFromDirectory`) — including the
     engine's own `input.json` and `mcp-config.json`.
- **The prompt contradicts itself.** "Do not offer conversational summaries"
  sits next to a closing message the engine parses. "Include `confidence` in
  your output JSON" never says which JSON.
- **Duplicated deliverables.** A deliverable is copied into the worktree, and
  one of them is copied again into a temp folder for "Download Report"
  (`persistDeliverableFile`).
- **Five places in the UI** show one step's output: the Report, Output File,
  Extracted Data and Raw JSON tabs, plus the run's Output Files panel.

[#1551](https://github.com/Appsilon/mediforce/issues/1551) tried to keep the
closing message as a second output next to `result.json`
(`agentSummary` / `resultSource`). Its PR,
[#1554](https://github.com/Appsilon/mediforce/pull/1554), was closed unmerged:
two outputs mean a second prompt section, duplicated content, and a channel no
step should rely on. `main` never carried it, so there is nothing to revert.

## Decision

1. **One folder.** A step's output folder is
   `<worktree>/.mediforce/output/<stepId>/`. The agent sees it as `/output`
   through a bind mount of that same folder: nothing is copied. The engine's
   own files (`prompt.txt`, `mcp-config.json`, `auth.json`, MCP recordings,
   previous-step values too large for the prompt) move to a separate
   engine-owned mount, `/engine`, which is never committed. The step's inputs
   are the one exception: the engine seeds `input.json` (and
   `previous_run.json`, when the workflow carries state between runs) into
   `/output`, where every script and skill has always read them, and removes
   both before the step commit. A step therefore cannot publish an Output File
   named `input.json` or `previous_run.json`. Top-level dotfiles in `/output`
   (tool state such as `.Rhistory` or `.cache/`) are removed before the commit
   too, as ADR-0015's copy skipped them. Skill and workflow text names the
   folder as `/output`; there is no `{output_dir}` placeholder.
2. **Repository edits are code changes, not outputs.** An agent that edits code
   in the worktree (`mediforce-fullstack`, `sdtm-rule-migration`) keeps doing
   so. Those edits show as the step commit's diff, not as Output Files.
3. **`result.json` is required.** `/output/result.json` holds one JSON object:
   the step's result, plus the reserved keys `confidence` and
   `confidence_rationale`, which the engine moves into the Agent Output
   Envelope. A missing file, invalid JSON, or a value that is not an object
   **fails** the step ("agent wrote no result.json").
4. **No closing message.** The engine ignores the agent's final message.
   `output_file`, `{ raw }`, the `/output` scan and agent-reported `tokenUsage`
   are removed; token usage comes from the runtime only. A step that wants a
   summary puts it in a key of `result.json` or writes it as a file.
5. **The list of Output Files comes from git, never from the agent.** It is
   read from the run branch's tree under `.mediforce/output/<stepId>/`, as
   `mediforce.runs.listOutputFiles` already does. The step's Output Files are
   every file in that folder except `result.json`, which is still committed and
   readable (decision 7). There is no new envelope
   field: ADR-0015 rejected file metadata on the envelope as a second source of
   truth.
6. **Later steps get one entry per earlier step:** its result plus the paths of
   its Output Files.
7. **One UI viewer per step:** a dropdown that shows `result.json` by default,
   followed by every Output File of that step. `presentation.md` becomes an
   ordinary file, and "Download Report" is replaced by a download for each
   file. Both are **accepted regressions**.

## Considered options

- **Separate `result.json`, `confidence.json` and `files.json`:** rejected. Two
  more files the agent has to remember; reserved keys in `result.json` already
  work, and a file list the agent writes by hand drifts from what is on disk.
- **A file list stored on the envelope:** rejected, as in ADR-0015 — git is the
  only source of truth for files.
- **Keeping the closing message as a second output (#1551 / #1554):** rejected.
  No step should rely on it, and keeping it means duplicated content and a
  second prompt section.
- **Banning repository edits:** rejected. It breaks the code-writing workflows.

## What ADR-0015 keeps

- git is the only source of truth for Output Files;
- `.mediforce/` is a reserved namespace in the worktree;
- `MEDIFORCE_OUTPUT_FILE_MAX_BYTES`, and its rule that the value must match on
  the runtime and API hosts;
- listing through `git ls-tree` and downloads through `git cat-file`, so the
  API host shares a filesystem with `~/.mediforce/bare-repos`;
- failed steps are still committed (✗ commits), Output Files included.

## What ADR-0015 loses

- The copy step after each agent step: the agent writes into the committed
  folder directly.
- The `INTERNAL_OUTPUT_FILE_NAMES` exclusion list: the engine's files no longer
  share the folder. The seeded inputs and top-level dotfiles are removed before
  the commit (decision 1), and the only committed file left out of the Output
  File list is `result.json` (decision 5), filtered where the list is read from
  git.

## Consequences

- The output folder is cleared when a step starts, so a step that runs again
  (loops, retries) never inherits files from its earlier execution. Listing and
  downloads keep reading the run-branch tip, so they show only the latest
  execution's Output Files. An earlier execution's files stay in git at the
  commit recorded on its Step Execution (`commitSha`), as ADR-0015's
  "versioned per step, immutable" requires, but the UI and CLI no longer list
  them. Today a re-run already overwrites same-named files at the tip and
  leaves stale differently-named ones behind, wrongly shown as the latest
  execution's. Hiding earlier executions' files from the listing is an
  **accepted regression**; reading a chosen execution's files at its
  `commitSha` is not part of this ADR.
- Files over the size cap are removed before the commit and logged — the same
  outcome as today's skip.
- Agents and scripts keep writing to `/output/result.json`, so existing scripts
  keep working.
- Every agent-step workflow must write `result.json`. Workflows that rely on a
  JSON closing message or `output_file` are migrated in
  [#1570](https://github.com/Appsilon/mediforce/issues/1570); the UI viewer
  lands in [#1571](https://github.com/Appsilon/mediforce/issues/1571).
- Evaluator code checks (`packages/agent-runtime/src/plugins/code-check.ts`)
  keep their own `/output/input.json` and `/output/result.json`. That is the
  check's scratch folder, not a workflow step's output, and this ADR does not
  apply to it.
