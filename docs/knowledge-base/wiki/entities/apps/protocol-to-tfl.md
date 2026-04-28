---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 3
tags: [app, protocol-to-tfl, clinical, cdisc, workflow]
---

**Protocol PDF + SAP → TFLs. 6 steps + terminal. L3 autonomy, two `git-mode` steps commit to `Appsilon/mediforce-clinical-workspace`.**

## Steps

File: `apps/protocol-to-tfl/src/protocol-to-tfl.wd.json`.

| # | Step | Type | Agent | Autonomy |
|---|------|------|-------|----------|
| 1 | upload-documents | human | — | — |
| 2 | extract-metadata | agent | claude-code-agent | L3 |
| 3 | generate-tlg-shells | agent | claude-code-agent | L3 |
| 4 | upload-sdtm | human | — | — |
| 5 | generate-adam | agent | claude-code-agent (git-mode) | L3 |
| 6 | generate-tlg | agent | claude-code-agent (git-mode) | L3 |
| 7 | done | terminal | — | — |

See [autonomy-levels](../../concepts/autonomy-levels.md), [cdisc-sdtm](../../concepts/cdisc-sdtm.md).

## Runtime skills

Registered in `apps/protocol-to-tfl/plugins/protocol-to-tfl/skills/_registry.yml`:

- `trial-metadata-extractor` — protocol PDF → metadata.
- `mock-tlg-generator` — metadata → mock TLG specs.
- `sdtm-to-adam` — SDTM → ADaM.
- `adam-to-tlg` — ADaM → final TFLs.
- `adam-to-teal` — R-based Teal app.

**Paths hardcoded in `.wd.json` via `skillsDir`. Don't move them.** See [runtime-skill-path-coupling](../../gotchas/runtime-skill-path-coupling.md).

## Process configs

Variants: `process-config-claude.json`, `process-config-opencode.json`, `process-config-local.json`.

## Relationships

- Depends on: [`claude-code-agent`](../plugins/claude-code-agent.md), [`agent-runtime`](../packages/agent-runtime.md).
- External repo: `Appsilon/mediforce-clinical-workspace` — target of `git-mode` commits.

## Sources

- `apps/protocol-to-tfl/src/protocol-to-tfl.wd.json`
- `apps/protocol-to-tfl/plugins/protocol-to-tfl/skills/_registry.yml`
- `AGENTS.md` → "Skills and Agents"
