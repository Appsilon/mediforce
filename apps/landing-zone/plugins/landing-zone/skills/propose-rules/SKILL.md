---
name: propose-rules
description: "Propose new study-specific validation rules for the landing-zone workflow based on the findings of a rejected delivery. Append-only — never modify existing rules. Reads /workspace/validation-rules.yaml and /workspace/findings.json, writes proposed additions back, plus a PR title and body to /output/result.json. Triggers: 'propose validation rules', 'codify findings into rules', 'landing zone learn from rejection', 'append validation-rules.yaml'. Used by the propose-rules agent step in the landing-zone workflow after a delivery is rejected — the goal is to capture knowledge gained from broken data so the next CRO submission catches the same problem before a human has to look at it."
---

# Propose Rules

## Purpose

After a CDISC delivery is rejected, the platform-recorded findings expose specific gaps in the layer-2 validation rules (`validation-rules.yaml`). This skill reads the findings and the existing rules file, identifies which findings represent missing edit checks, and appends new rules in Filip's pointblank schema. The output is a structured proposal that a human reviews; on approve, the next step opens a PR against the study repo's `main` branch.

This skill is the agent half of a `type: 'review'` step at autonomy level L3. The agent runs, proposes rules, the workflow pauses, a human inspects the diff and answers `approve` / `revise` / `reject`. On `revise` the same step re-runs with a reviewer comment.

## Inputs

- **`/output/input.json`** — engine-provided step input. Carries:
  - Prior step outputs flattened (the `draft-rejection-note` skill's `result.json` summarising why the delivery was rejected)
  - On revise iterations: `verdict: "revise"` and `comment: "<text>"` from the previous task completion
  - `runId`, `studyId` available either at top level or via `variables` / `env`
- **`/workspace/validation-rules.yaml`** — current rules file, owned by data managers. Two cases you cannot tell apart from the file alone:
  - First pass of this run: file contains only previously-merged rules (Filip's baseline + anything merged from prior PRs)
  - Revise pass: file also contains rules YOU appended in your prior iteration of this same run
- **`/workspace/findings.json`** — raw CDISC CORE engine output: `Issue_Summary`, `Issue_Details`, `Conformance_Details`. Each finding row carries at least `rule_id` (or `core_id`), `dataset` (the SDTM domain), `severity`, `message`, and an issue count. Field names can vary; read defensively.
- **`/workspace/templates/validation-rules.template.yaml`** — the canonical schema documentation (header comments enumerate the supported `check` functions and severity levels).

## Outputs

- **`/workspace/validation-rules.yaml`** — the rewritten rules file with your proposed additions appended. Existing entries are preserved byte-for-byte (the file is line-oriented YAML, do not reformat).
- **`/output/result.json`** — structured summary with these required fields:
  ```json
  {
    "proposedRules": [ /* array of rule objects you appended this iteration */ ],
    "proposedRuleIds": ["CUSTOM-DM-007", "CUSTOM-AE-005"],
    "proposedRulesYaml": "- id: CUSTOM-DM-007\n  domain: DM\n  ...",
    "prTitle": "Add 3 study-specific rules from rejected delivery <deliveryId>",
    "prBody": "<markdown body — see Step 5>",
    "summary": "One-sentence rationale for the human reviewer.",
    "iterationNote": "On revise: what you changed since last iteration."
  }
  ```

  `proposedRulesYaml` is the rendered YAML block of just the rules you appended this iteration — the same text you wrote into `validation-rules.yaml`, but standalone. The reviewer reads it inline in the task UI without needing to follow a GitHub link (the run branch is local-only at this stage, so no remote URL is reachable yet). Emit an empty string when `proposedRules` is empty.

## Workflow

### Step 1 — Read state

Read in this order:

1. `/output/input.json` — gives you `runId`, `studyId` (often under `variables.STUDY_ID` or env), the rejection reason, and on revise iterations the reviewer's `comment`.
2. `/workspace/validation-rules.yaml` — parse the YAML once. Build the set of existing rule IDs. Build a `(domain, variable, check)` index so you can detect near-duplicates.
3. `/workspace/findings.json` — iterate `Issue_Summary` rows. For each finding, decide whether it points at a real, codifiable rule or whether it is generic / data-quality noise.
4. `/workspace/templates/validation-rules.template.yaml` — re-confirm the available `check` functions and severity vocabulary if anything looks ambiguous. Do not invent check function names.

### Step 2 — Branch on iteration

If `/output/input.json` contains `verdict: "revise"` or carries an `iterationCount` greater than 0:

- Read the reviewer comment carefully. It is the source of truth for what changes you must make.
- Identify rules YOU added in the prior iteration via the `proposedRuleIds` you wrote out then (if available in input) — or, conservatively, by diffing the YAML against `git show origin/main:validation-rules.yaml` if the workspace allows it. **You may only modify or remove rules you added this run.** Existing baseline rules are immutable.
- Apply the reviewer's feedback by adding, removing, or refining only your own additions.
- In `iterationNote` of the output, state precisely what changed since last pass.

If this is the first pass (no `verdict` field, or `verdict: "approve"` is impossible at this stage), proceed directly to Step 3.

### Step 3 — Pick candidates from findings

A finding becomes a rule candidate only when ALL of these hold:

- It names a specific SDTM `domain` and `variable` (or a clear cross-domain reference)
- The failure can be expressed as one of the supported `check` functions: `col_vals_in_set`, `col_vals_not_null`, `col_vals_between`, `rows_distinct`, `cross_domain_ref` (verify against the template file)
- A rule for the same `(domain, variable, check)` combination does not already exist in the file
- The finding is recurrent or severe enough to be worth codifying (use the `issues` count and the severity field)

Skip candidates that:

- Express judgement, narrative, or anything that can't be machine-checked
- Duplicate existing rules (even with slightly different params — propose an issue/comment for the human instead, do not create a near-duplicate)
- Need data the agent can't see (e.g., "compare against external reference")

Aim for between 1 and 8 new rules per iteration. If there are zero candidates, that is a valid outcome — emit `proposedRules: []` and explain in `summary`. The downstream script step will detect no diff and skip PR creation cleanly.

### Step 4 — Construct rule entries

For each accepted candidate, construct a YAML object matching the schema:

```yaml
- id: CUSTOM-<DOMAIN>-<NNN>
  domain: <DM|AE|LB|EX|VS|MH|CM|cross|...>
  variable: <SDTM variable name>
  check: <one of the supported check functions>
  params:
    # function-specific params; copy shape from the template / existing rules
  severity: <Critical|Major|Minor|Warning>
  message: "<one sentence, factual, names the constraint>"
```

ID generation: pick the next free `NNN` per domain. Scan existing IDs of the form `CUSTOM-<DOMAIN>-<NNN>` and use `max(NNN) + 1`. Pad to 3 digits.

Severity guidance:

- `Critical` — schema-breaking or safety-critical (null primary keys, out-of-protocol arms, structural violations)
- `Major` — protocol or business-rule violations (out-of-range values, undefined codes)
- `Minor` — formatting and presentation issues
- `Warning` — soft expectations

Do not use `Critical` to propagate the original finding's severity — calibrate against the new rule's purpose.

Append in domain order matching the existing file structure (DM, AE, LB, …). Place new entries inside the existing domain section. Never reorder existing entries.

### Step 5 — Compose the PR body

The PR body is the document a human reviews on GitHub before merging. Write it in markdown with these sections:

```markdown
## Summary

<one paragraph: what was rejected, what gap the new rules close>

## Proposed rules

- `CUSTOM-DM-007` (Major) — AGE must be between 50 and 95 (Alzheimer's inclusion criteria). Triggered by 3 findings in this run where AGE values were 23, 38, 999.
- `CUSTOM-AE-005` (Critical) — AETERM must not be null. Triggered by 12 null AETERM rows in this delivery.
<...>

## Source delivery

- Run: `<runId>`
- Study: `<studyId>`
- Rejection reason: `<one-liner from draft-rejection-note output>`

## Review checklist

- [ ] Each rule's `check` function exists in `validate_custom.R`
- [ ] Severity is calibrated to the rule's purpose, not just the underlying finding
- [ ] No near-duplicates of existing rules
- [ ] Messages are factual, not editorial
```

PR title format: `Add <N> study-specific rules from rejected delivery <deliveryId>` where `<deliveryId>` falls back to `runId` if not present in input.

### Step 6 — Write outputs

1. Write the updated YAML to `/workspace/validation-rules.yaml`. Re-parse it after writing to verify it is valid YAML; if not, restore the prior content from memory and emit an empty `proposedRules` array with `summary: "internal-error: produced invalid YAML"`.
2. Build `proposedRulesYaml`: serialise the new rule objects (only the ones you appended this iteration, not the whole file) as a YAML string. Match the indentation and key order used in the appended block so the reviewer sees exactly what landed in the file. If `proposedRules` is empty, set `proposedRulesYaml` to an empty string.
3. Write `/output/result.json` with the schema in the Outputs section.

## Boundaries

- **Append-only.** Never delete or modify rules that exist before your run.
- **No re-running validation.** You are not the rules engine. You read its output.
- **No external lookups.** Do not reference external standards, vendors, or tools beyond what is in the inputs.
- **No invented check functions.** Only use functions enumerated in the template file. If a finding points at something the existing check vocabulary cannot express, skip it and note in `summary` that a vocabulary extension may be useful.
- **Empty proposal is valid output.** If nothing in the findings warrants a new rule, emit `proposedRules: []` with a one-sentence reason. The reviewer can still approve (no PR opens) or revise (asks you to look harder).
- **Never change the YAML formatting** of unchanged sections. Pure append where possible.

## Failure modes

- **Cannot parse `validation-rules.yaml`** — emit `proposedRules: []`, `summary: "could not parse existing rules file"`, do NOT write to the workspace. Reviewer will know to investigate.
- **Cannot read `findings.json`** — emit `proposedRules: []`, `summary: "could not read findings"`. Same — no workspace write.
- **Reviewer comment contradicts itself across iterations** — apply the latest `comment` literally; if impossible, surface the contradiction in `iterationNote` and ask for clarification via `summary`.
