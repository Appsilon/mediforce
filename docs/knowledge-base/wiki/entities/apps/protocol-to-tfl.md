---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 3
tags: [app, protocol-to-tfl, clinical, cdisc, workflow]
---

**Meta-workflow app that transforms a clinical trial protocol (PDF) plus SAP into production Tables, Figures, Listings (TFLs). Six automated/human steps plus terminal.**

## Purpose

Pipeline for clinical submissions. Starts from raw PDFs (protocol + statistical analysis plan), extracts metadata, generates TLG shells, ingests SDTM data, derives ADaM datasets with R code, and produces final TFLs. Agent-heavy (L3 autonomy — periodic human review) with two `git-mode` steps that commit output to the `Appsilon/mediforce-clinical-workspace` repo.

## Workflow definition

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

## Skills (runtime)

Registered in `apps/protocol-to-tfl/plugins/protocol-to-tfl/skills/_registry.yml`:

- `trial-metadata-extractor` — extracts trial metadata from protocol PDF.
- `mock-tlg-generator` — generates mock TLG specs from metadata.
- `sdtm-to-adam` — derives ADaM datasets from SDTM (see [cdisc-sdtm concept](../../concepts/cdisc-sdtm.md)).
- `adam-to-tlg` — produces final TFLs from ADaM.
- `adam-to-teal` — R-based Teal app generator.

These are runtime skills, resolved by [`agent-runtime`](../packages/agent-runtime.md) via the workflow definition's `skillsDir` field — paths are hardcoded in the `.wd.json`. Do not move them.

## Process configs

Multiple variants under `apps/protocol-to-tfl/`:
- `process-config-claude.json`, `process-config-opencode.json`, `process-config-local.json`

## Relationships

- Depends on: [`claude-code-agent`](../plugins/claude-code-agent.md), [`agent-runtime`](../packages/agent-runtime.md).
- External repo: `Appsilon/mediforce-clinical-workspace` — target of `git-mode` commits.

## Sources

- `apps/protocol-to-tfl/src/protocol-to-tfl.wd.json`
- `apps/protocol-to-tfl/plugins/protocol-to-tfl/skills/_registry.yml`
- `AGENTS.md` → "Skills and Agents"
