# Import workflows from git

Import copies a workflow definition (`.wd.json`) from a GitHub repository into a
namespace and registers it as a normal versioned Workflow Definition. It is a
**one-time copy** — there is no live link back to the repo and no automatic sync
(see [ADR-0009](../adr/0009-workflow-import-scope-boundary.md)).

Two entry points:

- **UI** — workspace home → *Import from git*. Either **Browse** a repo's
  `index.json` manifest and pick workflows, or **Import by path** by pasting the
  path to a single `.wd.json`.
- **CLI** — `pnpm exec mediforce workflow import --repo <url> --path <file> --namespace <ns> [--ref <branch|tag|sha>]`.

Both call the same handler as `mediforce workflow register`, so a file that
registers will also import.

## What gets recorded

Each imported definition stores a provenance record:

```jsonc
"source": {
  "url":    "https://github.com/Appsilon/cdisc-workflows",
  "path":   "smoke-test/src/smoke-test.wd.json",
  "commit": "efe701d2e0a5f375c78872bb2f295edf98861d33"  // resolved SHA
}
```

`--ref` selects *what* to import; it is resolved to an immutable commit SHA at
import time, and the file is fetched at that SHA. It defaults to the ref in a
GitHub tree URL, or `main` for a repository URL. Only the resolved `commit` is
stored — the moving ref is not.

## Supported

- **Public GitHub repos**, one `.wd.json` per import.
- Browse via an `index.json` manifest at the repository root or at the end of a
  GitHub `/tree/<single-segment-ref>/<directory>` URL, or import a single file
  by path. For refs containing `/`, use the repository URL and enter the ref
  separately.
- Files that declare a top-level `namespace` — it is ignored; the import target
  namespace wins (parity with `workflow register`).
- Any step the schema accepts: `human`, `agent` (`claude-code-agent`), `script`
  (`script-container`, `databricks-job`), `cowork`, `action`.
- Both image modes: prebuilt (`image`) and build-mode (`repo` + `commit` +
  `dockerfile`). `externalSkillsRepo` and `workspace.remote` are preserved
  verbatim.

## Not supported / prerequisites

- **Private repos** — no auth header is sent, so a private repo returns 404.
- **Non-GitHub hosts** (GitLab, Bitbucket, self-hosted) are rejected.
- **No live sync** — to pick up upstream changes, re-import (creates a new
  version).
- **Secrets are not carried.** Importing succeeds, but running needs the
  workflow's secrets set in the target namespace first (e.g. `GITHUB_TOKEN`,
  `OPENROUTER_API_KEY`, `CDISC_API_KEY`) — exactly as with `register`. Import
  success does not imply run-readiness.
- **Base images** (e.g. `mediforce-golden-image`) must exist on the platform;
  build-mode images are built at run start.
- Deprecated fields (top-level `repo`, step-level `mcpServers`) are still parsed
  but will stop importing cleanly once removed.

## `index.json` manifest format

To make a repo or repository subdirectory browsable in the UI, add an
`index.json` at the selected source root:

```jsonc
{
  "workflows": [
    {
      "name": "protocol-to-synthetic-sdtm",
      "path": "protocol-to-synthetic-sdtm/src/protocol-to-synthetic-sdtm.wd.json",
      "description": "Protocol to synthetic SDTM pipeline",  // optional
      "tags": ["cdisc", "sdtm"],                              // optional
      "builtin": false                                        // optional
    }
  ]
}
```

A repo without an `index.json` is still importable via **Import by path** (UI) or
`--path` (CLI).
