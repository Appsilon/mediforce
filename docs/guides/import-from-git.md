---
status: living
audience: workflow-authors
last_reviewed: 2026-08-19
---

# Import workflows from git

Import copies a workflow definition (`.wd.json`) from a public GitHub repository
into a namespace and registers it as a normal versioned Workflow Definition. It
is a **one-time copy** — no live link back to the repo, no automatic sync (see
[ADR-0009](../adr/0009-workflow-import-scope-boundary.md)).

Import runs the same handler as `mediforce workflow register`, so anything that
registers also imports: every step type, both image modes (prebuilt `image` and
build-mode `repo` + `commit` + `dockerfile`), and fields like
`externalSkillsRepo` / `workspace.remote` are copied verbatim. A top-level
`namespace` in the file is ignored — the import target namespace wins.

## Entry points

- **UI** — workspace home → *Import from git*. Either **Browse** a repo's
  `workflows-index.json` manifest and pick workflows, or **Import by path** by
  pasting the path to a single `.wd.json`. Browse imports each selected workflow
  as its own import; if one fails the batch stops and the earlier ones stay
  imported. A workspace with no workflows yet also gets *Import example
  workflows*, which skips the repo question and browses this repo's manifest.
- **CLI** — one file per invocation:

```bash
pnpm exec mediforce workflow import \
  --repo <url> --path <file> --namespace <ns> [--ref <branch|tag|sha>]
```

Both accept a repository URL or a GitHub `/tree/<ref>[/<directory>]` URL,
including refs containing `/`.

## Provenance

Each imported definition stores:

```jsonc
"source": {
  "url":    "https://github.com/Appsilon/cdisc-workflows",  // canonical repo
  "path":   "smoke-test/src/smoke-test.wd.json",            // repo-root-relative
  "commit": "efe701d2e0a5f375c78872bb2f295edf98861d33"      // resolved SHA
}
```

`--ref` selects *what* to import. It defaults to the ref in a tree URL, or `main`
for a repository URL, and is resolved to an immutable commit SHA before the file
is fetched — so only the resolved `commit` is stored, never the moving ref.

Provenance is normalised: a pasted tree URL is recorded as the canonical
repository plus a repo-root-relative `path`, so `url` + `path` + `commit` locates
the exact file forever, whatever shape was pasted. It is a record only — nothing
at runtime reads it.

## Prerequisites and limits

- **Public GitHub only.** No auth header is sent, so a private repo returns 404;
  non-GitHub hosts (GitLab, Bitbucket, self-hosted) are rejected.
- **No sync.** Re-import to pick up upstream changes — that creates a new version.
- **Secrets are not carried.** Importing succeeds, but running needs the
  workflow's secrets set in the target namespace first (e.g. `GITHUB_TOKEN`,
  `OPENROUTER_API_KEY`, `CDISC_API_KEY`) — exactly as with `register`. Import
  success does not imply run-readiness.
- **Base images** (e.g. `mediforce-golden-image`) must exist on the platform;
  build-mode images are built at run start.

## `workflows-index.json` manifest format

To make a repository — or a subdirectory reached through a tree URL — browsable
in the UI, add a `workflows-index.json` at that source root:

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

Each `path` is relative to that source root. `index.json` — the name manifests
were published under before `workflows-index.json` — is still read when the
canonical name is absent, so an existing repo stays browsable without being
republished. Only a 404 falls back; a rate limit or server error is reported as
itself.

A repo with neither is still importable via **Import by path** (UI) or `--path`
(CLI).
