---
name: sdtm-rule
description: >
  Author, edit, and review CDISC SDTM/SDTMIG conformance rules in the core-contributor repo.
  Use this skill whenever the user asks to work on a CG rule, CORE rule, or conformance rule -
  including phrases like "author CG0057", "edit CORE-000084", "fix rule CG0085",
  "work on CG rule", "migrate rule", "verify rule", "add test data for rule",
  "fix validation for CORE-000XXX", or any mention of CG/CORE rule IDs.
  Also trigger when user mentions SDTM rule authoring, rule migration, or conformance rule testing.
---

# SDTM Conformance Rule Authoring

This skill guides you through authoring, editing, y verifying CDISC SDTM conformance rules
in the `core-contributor` repository. Each rule lives in `rules/CORE-XXXXXX/` and consists of
a YAML definition plus positive/negative test cases with Excel data files.

## Overview of the Workflow

For each rule, the complete workflow is:

0. **Classify the rule pattern** — if this is a new pattern, open ONE canary PR first; if it matches an existing pattern, copy a merged sibling as your template
1. **Identify** the rule (map CG ID to CORE ID, locate files)
2. **Critically review YAML rule logic** — check for correctness AND completeness
3. **Run the pre-flight checklist** — verify every item before proceeding (includes diff-against-merged-sibling check)
4. **Verify YAML metadata** against the source CSV
5. **Fix negative test data** (validation sheets + yellow highlights)
6. **Add `# verified`** comment at the TOP of the YAML
7. **Run tests** and confirm all pass with `validated: true`

**CRITICAL**: Run tests (`python test.py -r CORE-XXXXXX -v`) after EVERY change —
not just at the end. If you change the YAML, re-run. If you change test data, re-run.
If you change a validation sheet, re-run. Never batch changes without testing between them.

**CRITICAL — batching discipline**: Never open more than 2-3 PRs of the same new pattern in one session without first getting at least one of them reviewed. Template defects amplify by batch size. The 2026-04-28 length-rule batch shipped 8 PRs in 9 minutes; 40 of 44 review comments were the same template defects copy-pasted across all 8.

## Step 0: Is this a new rule pattern? Canary first.

Before authoring a batch of rules, classify the rule **pattern** (e.g., "conditional not-null", "value length > N", "controlled-terminology check", "cross-domain date comparison"). Then:

1. **Search merged sibling rules with the same pattern** — at minimum search the `rules/` directory and the `gh pr list --state merged` history for prior examples of that pattern.

   ```bash
   gh pr list --repo verisianHQ/core-contributor --state merged --search "<pattern keywords>" --json number,title --limit 20
   ```

2. **If no merged sibling exists** for this pattern, you are introducing a new template. Open ONE rule first as a canary PR, wait for review, incorporate feedback, and only THEN batch the remaining rules using the corrected template. Do NOT mass-produce 8 PRs in a single afternoon — every template defect gets amplified by the batch size.

3. **If a merged sibling exists**, copy its YAML wholesale as your starting template and diff your new rule against it field-by-field. Do not re-derive Description / Message / Citation wording from scratch — match the sibling exactly.

This rule was added after the 2026-04-28 length-rule batch (PRs #335-#340) shipped 8 PRs in 9 minutes that all inherited the same ~5 template defects (wrong `Document:` wording, truncated cited guidance, non-canonical Description/Message phrasing, comment block at bottom). 40 of 44 review comments on that batch traced to template drift, not rule logic.

## Step 1: Identify the Rule

### Mapping CG IDs to CORE IDs

Rules are tracked in `CORE-RULES_GitHub Transfer Excel Tracker(SDTM and SDTMIG v2.csv`.
Use this to map between CG rule IDs (e.g., CG0057) and CORE IDs (e.g., CORE-000084).

```python
# Find rule files
import glob
files = glob.glob(f'rules/**/CG{rule_number}*', recursive=True)
```

### Rule directory structure

```
rules/CORE-XXXXXX/
  <conformance-ids>.<uuid>.yml     # Rule YAML
  positive/
    01/data/*.xlsx                  # Test data (should produce 0 errors)
    01/results/results.json
  negative/
    01/data/*.xlsx                  # Test data with intentional errors
    01/results/results.json
```

## Step 2: Critically Review YAML Rule Logic

Before checking metadata, verify the rule's **Check logic** is correct, complete, and uses the right operators.

**IMPORTANT**: Do NOT assume the original published rule logic is correct. Some rules were published
early when certain operators weren't available, or their logic was incomplete. You must critically
evaluate the Check section against the rule's intent (from the Variable/Condition/Rule comment
headers and the source CSV) and fix any gaps. Common issues with original rules:

- **Missing permissible variable handling**: If a checked variable is "permissible" (not "expected/required")
  in some domains, the original rule may only check `empty` without `not_exists`. Add an `any` block.
- **Wrong operators**: Original rules may use `not_equal_to` where `date_not_equal_to` is needed.
- **Missing `value_is_literal: true`**: Original rules often omit this flag on literal string values.
- **Incomplete output variables**: Original rules may list only one output variable when multiple are relevant.

**Before reviewing the Check logic**, look up every variable mentioned in the Check section using
the `sdtmig-reference` skill to understand its Core status, Role, and allowed values — do not rely
on memory or assumptions:

```bash
# Look up a specific variable across all applicable domains
python ./skills/sdtmig-reference/lookup.py --var <VARNAME>
# e.g.: python ./skills/sdtmig-reference/lookup.py --var PRESP
```

### Literal values need `value_is_literal: true`

When a rule checks a variable against a specific literal string (e.g., 'DEATH', 'UNPLAN', 'Y', 'N'),
the YAML must include `value_is_literal: true`. Without this flag, the value may be interpreted as
a variable reference instead of a literal string.

**Example — correct:**

```yaml
- name: DSDECOD
  operator: equal_to
  value: DEATH
  value_is_literal: true
```

**Example — incorrect (missing flag):**

```yaml
- name: DSDECOD
  operator: equal_to
  value: DEATH
```

Always check every `value:` field in the Check section. If it's a literal string (not a variable name),
add `value_is_literal: true`.

**When `value_is_literal` is NOT needed:**

- Operators with no `value:` field at all (`empty`, `non_empty`, `exists`, `not_exists`) — these
  never need it
- When `value:` refers to another variable/column name (e.g., `value: DTHDTC` in a cross-domain
  comparison where you want the engine to look up the DTHDTC column)

**Quick test:** If the value is a string you'd put in single quotes in the source CSV's Condition
column (e.g., `--PRESP = 'Y'`, `DSDECOD = 'DEATH'`), it needs `value_is_literal: true`.

### Use date-specific operators for date variables

When comparing date variables (any variable ending in `DTC` like DSSTDTC, DTHDTC, RFSTDTC, etc.),
use date-specific operators instead of generic ones. Date operators handle partial dates correctly.

| Instead of     | Use                 |
| -------------- | ------------------- |
| `equal_to`     | `date_equal_to`     |
| `not_equal_to` | `date_not_equal_to` |
| `less_than`    | `date_less_than`    |
| `greater_than` | `date_greater_than` |

See the [operator reference](https://cdisc-org.github.io/conformance-rules-editor/#/check_operator)
for the full list of available operators.

### Handle permissible (optional) variables that may be absent

Some variables are "expected" in certain domains but only "permissible" in others. For permissible
variables, the variable might not exist in the dataset at all. The rule must handle both cases:
the variable exists but is empty, AND the variable doesn't exist.

**Always verify Core status before writing the Check logic** — never assume:

```bash
python ./skills/sdtmig-reference/lookup.py --var <VARNAME>
# If ANY domain in the output shows Core=Perm, the any block is required
```

Use an `any` block to cover both:

```yaml
- any:
    - name: --BDSYCD
      operator: not_exists
    - name: --BDSYCD
      operator: empty
```

**CRITICAL YAML SYNTAX**: The `any` block is a list item in the parent `all:` array.
Use `- any:` (the hyphen is the list item marker). Do NOT write `- operator: any` or
`- conditions:` — those will cause "Rule contains invalid operator" errors at runtime.

This flags when the variable is missing from the dataset entirely OR when it exists but is empty.
Additional negative test data must cover the absent-variable case (see Pattern 5 below).

### Include ALL output variables

The `Outcome.Output Variables` list must include every variable that is relevant to understanding
the error. When in doubt, include more rather than fewer — reviewers will flag missing ones.

Think about what a data manager would need to see to understand and fix the issue. For example,
if the rule checks that "--BODSYS is not empty but --BDSYCD is empty", both `--BODSYS` and
`--BDSYCD` should be output variables.

**Always include the domain's Topic variable**, even when it is not referenced in the Check.
The Topic variable identifies _which_ record the error is about — without it, a reviewer sees
`AESER='X', USUBJID=CDISC001, SEQ=2` and cannot tell whether the bad row is "Headache" or
"Cardiac Arrest". For cross-domain (Match Datasets) rules, include the Topic variable from the
matched domain too. Common Topic variables by class:

| Class                           | Topic variable(s)                          |
| ------------------------------- | ------------------------------------------ |
| Events (AE, MH, CE, ...)        | --TERM (AETERM, MHTERM, CETERM)            |
| Interventions (CM, EX, EC, ...) | --TRT (CMTRT, EXTRT, ECTRT)                |
| Findings (LB, VS, EG, ...)      | --TESTCD and --TEST                        |
| Disposition (DS)                | DSTERM (also DSDECOD as Synonym Qualifier) |

Use the Role field from `sdtmig-reference` to guide this decision — always include variables
whose Role is **Topic**, **Record Qualifier**, or **Variable Qualifier**; "Identifier" variables
(USUBJID, SEQ) give context but are usually output by the engine automatically and don't need
to be listed explicitly:

```bash
python ./skills/sdtmig-reference/lookup.py --domain <DOMAIN>
# Check the Role column for every variable — find the Topic and include it
```

### Message and description wording conventions

- Use **'present'** instead of 'exist' (e.g., "--STTPT is present" not "--STTPT exists")
- End descriptions and messages with a **period**
- Look at similar merged rules for consistent phrasing — match their style
- For cross-domain rules, reference the other domain naturally
  (e.g., "DTHDTC in DM dataset" not "DM.DTHDTC")

Use the **CDISC Notes** field from `sdtmig-reference` as the authoritative source for variable
definitions when writing Descriptions and Messages — it is the exact wording CDISC uses:

```bash
python ./skills/sdtmig-reference/lookup.py --domain <DOMAIN> --var <VARNAME>
# The "Note:" line shows the official CDISC definition
```

## Step 3: Pre-Flight Checklist (MANDATORY)

Before proceeding to metadata or test data, explicitly verify EVERY item below. These are the
most common review findings — each one has caused PR comments in the past.

### A. Literal Value Scan

Scan EVERY `value:` field in the Check section. For each one, ask: "Is this a literal string
(like 'DEATH', 'UNPLAN', 'Y', 'N') or a variable name (like DTHDTC, USUBJID)?"

- If literal → `value_is_literal: true` MUST be present
- If variable reference → `value_is_literal` must NOT be present
  **This is the #1 most common review finding.** Do not skip it.

### B. Date Operator Scan

Scan EVERY operator in the Check section. For each comparison involving a DTC variable
(any variable name ending in `DTC`), verify:

- `equal_to` → must be `date_equal_to`
- `not_equal_to` → must be `date_not_equal_to`
- `less_than` → must be `date_less_than`
- `greater_than` → must be `date_greater_than`

### C. Output Variables Completeness

List every variable mentioned in the Check conditions. Then verify `Outcome.Output Variables`
includes ALL variables that would help a data manager understand the error:

- Every variable in a comparison (both sides)
- Every condition variable (e.g., DSDECOD if checking DSDECOD = 'DEATH')
- Cross-domain variables (e.g., DTHDTC from DM)
- **The Topic variable for each in-scope domain (and each Match Datasets domain), even if it
  is not in the Check.** Without it the reviewer cannot tell _which_ record has the issue.
  AETERM for AE, MHTERM for MH, CETERM for CE, CMTRT for CM, EXTRT for EX, ECTRT for EC,
  DSTERM for DS, --TESTCD/--TEST for Findings (LB, VS, EG, ...).

Look up the Role of each candidate variable — variables with Role **Topic**, **Record Qualifier**,
or **Variable Qualifier** directly characterise the error and must be included; Timing variables
should be included when the rule is about date/time constraints:

```bash
python ./skills/sdtmig-reference/lookup.py --domain <DOMAIN> --var <VARNAME>
# Run --domain <DOMAIN> alone to find the Topic variable (Role=Topic) for that domain
```

### D. Permissible Variable Check

For each variable the rule checks for `empty` or `non_empty`, **look it up** using the SDTMIG
reference script — do not guess:

```bash
python ./skills/sdtmig-reference/lookup.py --var <VARNAME>
# e.g.: python ./skills/sdtmig-reference/lookup.py --var STAT
```

If **any** applicable domain shows `Core=Perm`:

- Replace `operator: empty` with `- any:` block (`not_exists` + `empty`)
- Create a separate negative test case for the absent-variable scenario (use `[ABSENT]`)

See the `sdtmig-reference` skill for full lookup usage.

### E. Wording Check

- Description and Message end with a **period** (.)
- Use **'present'** not 'exist' (e.g., "is present in dataset")
- Use **'but'** not 'and' for error conditions (e.g., "X is not empty but Y is empty")
- Use **single quotes** around literal values in descriptions and messages: `'Y'` not `"Y"`, `'DEATH'` not `"DEATH"`
- Use **'not populated'** (not 'blank', 'null', 'empty', or 'not provided') for describing missing/null values
- Use **'populated'** (not 'provided', 'present', 'not empty', or 'filled in') for describing present/non-null values in Descriptions and Messages (e.g., "when --OCCUR is populated" not "when --OCCUR is provided")
- Keep "populated" / "not populated" symmetric across Description and Message — reviewers flag inconsistent pairings (e.g., "when X is provided" in Message while Description uses "when X is populated")
- Cross-domain references: "DTHDTC in DM dataset" NOT "DM.DTHDTC"
- Compare wording with similar merged rules for consistency
- The Message should use the same phrasing as the Description (reviewers will flag inconsistencies)

#### Canonical phrasing per rule pattern

Match these patterns exactly — reviewers correct deviations one-by-one with `suggestion` blocks. If your rule fits a pattern below, use that exact phrasing rather than re-deriving it:

| Pattern                                                        | Description                                                                        | Message                                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Length constraint (variable value > N chars)                   | `Raise an error when the length of <VAR> is greater than <N> characters.`          | `<VAR> value length is greater than <N> characters.`            |
| Conditional not-null (Y must be populated when X is populated) | `Raise an error when <Y> is not populated and <X> is populated.`                   | `<Y> is not populated when <X> is populated.`                   |
| Paired existence (if X present, Y must be present)             | `Raise an error when <X> is present in dataset but <Y> is not present in dataset.` | `<Y> is not present in dataset when <X> is present in dataset.` |

Where this batch went wrong (PRs #335-#340, length-rule pattern): we wrote variants like "Check that the length of X..." or "X must not exceed N characters" — every PR was corrected to the canonical form above. If no canonical form exists for your pattern, copy the Description/Message verbatim from a merged sibling and only swap the variable name.

### E1. Diff Against a Merged Sibling (MANDATORY for new patterns)

Before opening a PR, identify ONE already-merged rule with the same pattern and diff your YAML against it. Compare every metadata field:

```bash
# Find candidate siblings
gh pr list --repo verisianHQ/core-contributor --state merged --search "<pattern keywords>" --json number,title,url --limit 10

# Then diff the YAML files locally
diff rules/CORE-XXXXXX/<your-rule>.yml rules/CORE-YYYYYY/<sibling>.yml
```

Fields to verify field-by-field, not skim:

- `Description` — exact phrasing including word order, capitalisation, period
- `Outcome.Message` — same
- `Citations[*].Document` — exact wording (e.g., `SDTMIG v3.4` not `IG v3.4`, `SENDIG v3.0` not `SEND IG v3.0`; SENDIG versions: `v3.0`, `v3.1`, `v3.1.1`)
- `Citations[*].Cited Guidance` — full sentences (see E5)
- Comment block placement (see E6)

If your wording differs from the sibling and you cannot justify the change from the source CSV, change yours to match the sibling.

### E2. Citation Item Field Completeness

For EVERY citation in the YAML (each SDTMIG version, TIG, etc.), open the source CSV row
and compare the `Item` column against the YAML `Item:` field. Easy to miss because:

- Older SDTMIG versions (v3.2, v3.3) often have an empty Item column, establishing a pattern
  of citations with no `Item:` key.
- SDTMIG v3.4 and TIG rows frequently DO have a populated Item (e.g., `--PRESP|--OCCUR|--STAT`).
- If the author notices the Item on the TIG citation but not on the SDTMIG v3.4 citation, the
  missing field slips through — this exact issue was flagged on CORE-000015 PR #236.

Do this explicitly for each citation, one at a time:

1. Note the `Document` value in the YAML citation (e.g., `Model v2.0`, `SDTM v2.1`).
2. Find the matching CSV row (match on Rule ID + Document).
3. If the CSV `Item` column is non-empty, the YAML citation MUST have a matching `Item:` key.
4. If the CSV `Item` column is empty, the YAML citation should NOT have an `Item:` key.

```python
# Programmatic scan — run after any citation-level change
import csv, yaml
CSV_PATH = './skills/sdtm-rule/SDTM_and_SDTMIG_Conformance_Rules_v2.0.csv'
with open(CSV_PATH, encoding='utf-8-sig', newline='') as f:
    rows = [{(k.strip() if k else k): v for k, v in r.items()} for r in csv.DictReader(f)]
# Filter to this Rule ID, then build {Document: Item} map from the CSV rows.
# Then verify every YAML citation's Document has (or correctly lacks) the Item key.
```

### E5. Cited Guidance Completeness

`Cited Guidance` text is copied from the source CSV. It is easy to truncate mid-sentence when copy-pasting — the original cell wraps in Excel and the visible portion may not be the whole value. Reviewers consistently flag truncations (PRs #335 and #338 had 4+ truncated `restrictions.` clauses each).

Verify every citation:

1. Open the CSV row for the citation (matching Rule ID + Document).
2. Compare the YAML `Cited Guidance:` value byte-for-byte against the CSV `Cited Guidance` field — including the trailing punctuation and any final clause.
3. The text must end with the same final word and punctuation as the CSV (commonly a period after "restrictions" or "characters").
4. If the cited guidance includes multiple sentences, all of them must be present.

```python
import csv, yaml
CSV_PATH = './skills/sdtm-rule/SDTM_and_SDTMIG_Conformance_Rules_v2.0.csv'
with open(CSV_PATH, encoding='utf-8-sig', newline='') as f:
    rows = [{(k.strip() if k else k): v for k, v in r.items()} for r in csv.DictReader(f)]
# For each citation in the YAML, locate the (Rule ID, Document) row in `rows`
# and assert yaml_citation['Cited Guidance'] == csv_row['Cited Guidance']
```

### E6. Comment Block at TOP of YAML

The `# Variable:` / `# Condition:` / `# Rule:` / `# verified` comment block must be at the **top of the YAML file**, before all other keys (before `Authorities:`, before `Description:`, etc.). Reviewers explicitly flagged this on PRs #335 and #336: "could you maybe move this part to the top of the schema? all the # lines, including the # verified".

Correct placement:

```yaml
# Variable: SETCD
# Condition: SETCD value length > 8 characters
# Rule: Length of SETCD must be <= 8 characters
# verified
Authorities:
  - Organization: CDISC
    ...
```

Wrong placement (comment block at end of file): re-arrange the file so the comments come first.

### F. Workbook Structure Check

- Multi-domain test data: one workbook with separate sheets per domain, NOT separate files
- Multiple test folders only for genuinely different scenarios (not just different domains)

### F2. Highlight Audit (MANDATORY before saving test data)

Before finalising any test workbook, explicitly scan ALL yellow highlights in ALL sheets and
verify each one is intentional. Run this check:

```python
from openpyxl.styles import PatternFill
yellow = 'FFFFFF00'
for sheet in wb.sheetnames:
    ws = wb[sheet]
    for row in ws.iter_rows():
        for cell in row:
            if cell.fill and cell.fill.fgColor and cell.fill.fgColor.rgb == yellow:
                print(f"Row {cell.row}, Col {cell.column}, var={ws.cell(1, cell.column).value}, value={cell.value}")
```

**Rules for valid highlights:**

- **Record sensitivity**: only data rows with actual errors should be highlighted — NEVER the header row (row 1)
- **Variable/Dataset sensitivity**: only the header row (row 1) of the relevant variable column should be highlighted
- Any highlight that doesn't map to a validation entry is erroneous — remove it with `PatternFill(fill_type=None)`

The header row highlight in a Record rule is the most common leftover artifact from original test data.

### G. Validation ↔ Highlight ↔ Engine Consistency Check

After ANY change to the YAML Check logic or operators, the engine may produce different errors
than before. When this happens, existing validation entries and highlights may become stale.
**You MUST re-verify consistency across all three:**

1. **Engine errors** (from results.json after running tests) — what the engine actually catches
2. **Validation sheet entries** — must match engine errors exactly (no unmatched validations)
3. **Yellow highlights** — must match validation entries exactly (no unhighlighted validations)

Common scenario: switching from `not_equal_to` to `date_not_equal_to` changes which rows trigger
errors (e.g., null date comparisons may no longer fire). If a validation entry references a case
the engine no longer catches, REMOVE that validation entry AND its highlights. Do not leave
orphaned validation entries or highlights.

### I. `any` Block Syntax Check

If the Check section contains any `any` or `all` nested blocks, verify the YAML syntax:

- **Correct**: `- any:` (list item key, then nested list)
- **Wrong**: `- operator: any` or `- conditions:` — these cause "Rule contains invalid operator" at runtime

```yaml
# CORRECT
Check:
  all:
    - name: --PRESP
      operator: equal_to
      value: Y
      value_is_literal: true
    - any:
        - name: --STAT
          operator: not_exists
        - name: --STAT
          operator: empty
```

### H. Absent Variable Error Value Audit

For every validation entry where the Error value is `Not in dataset`, verify the Error level:

- If Error level is **Record** → change to `[ABSENT]` (NEVER use `Not in dataset` at Record level)
- If Error level is **Variable** or **Dataset** → `Not in dataset` is correct, keep it

This is a programmatic check — run it on every workbook before finalising:

```python
ws = wb['Validation']
for row in ws.iter_rows(min_row=2):
    level = row[2].value   # Error level column
    val = row[5].value     # Error value column
    if level and level.lower() == 'record' and val == 'Not in dataset':
        print(f"ERROR row {row[0].row}: Record-level entry uses 'Not in dataset' — must be '[ABSENT]'")
```

### H2. Date Operator Null Behavior

`date_not_equal_to` (and other date operators) do NOT fire when one or both dates are null.
This means test data where a DTC variable is null will NOT trigger errors with date operators.
When designing negative test data for date comparison rules:

- Use non-null but **different** date values to trigger errors
- Do NOT rely on null vs non-null date comparisons as error cases

## Step 4: Verify YAML Metadata

Compare the YAML against the **source CSV**:
`./skills/sdtm-rule/SDTM_and_SDTMIG_Conformance_Rules_v2.0.csv` (exported from the
"SDTMIG Conformance Rules v2.0" sheet of the original workbook).

### What to compare

For each SDTMIG version entry (v3.2, v3.3, v3.4), verify:

| YAML Field                 | Spreadsheet Column                                                         |
| -------------------------- | -------------------------------------------------------------------------- |
| `Citations.Document`       | Document                                                                   |
| `Citations.Section`        | Section                                                                    |
| `Citations.Item`           | Item                                                                       |
| `Citations.Cited Guidance` | Cited Guidance                                                             |
| `Rule Identifier.Id`       | Rule ID                                                                    |
| `Rule Identifier.Version`  | Rule Version                                                               |
| `Scope.Classes`            | Class (use full names: EVT→EVENTS, INT→INTERVENTIONS, SPC→SPECIAL PURPOSE) |
| `Scope.Domains`            | Domain (NOT(X,Y) → Exclude list)                                           |

To verify which class a domain belongs to, or to see all domains in a class, use:

```bash
# List all domains (each sheet name shows "Class - DOMAIN (N)")
python ./skills/sdtmig-reference/lookup.py --domains
```

The sheet name format is `"Class - DOMAIN (N)"` — the Class portion tells you the correct
`Scope.Classes` value (e.g., "Interventions" → INTERVENTIONS, "Events" → EVENTS).

### Common metadata issues

- **Semicolons instead of colons** in Cited Guidance (e.g., `Examples;` → `Examples:`)
- **Missing `Item:` field on a citation** — when the CSV `Item` column is populated for a
  given (Rule ID, Document) row, the corresponding YAML citation MUST include the `Item:` key.
  This is especially easy to miss for the SDTMIG v3.4 / Model v2.0 citation, because SDTMIG v3.2
  and v3.3 rows typically have an empty Item column — so only one SDTMIG citation in a rule
  needs an Item, and it's easy to skip. See Pre-Flight Checklist item E2.
- **Missing colons in Item** (e.g., `Table 2.2.5.1 --STTPT` → `Table 2.2.5.1: --STRTPT`)
- **Colons in Item values must be quoted** — a colon inside an `Item:` value breaks YAML parsing.
  Wrap such values in single quotes: `Item: 'Table 2.2.5.1: --STRTPT'`
- **Wrong Document naming**: `SDTMIG v3.x` vs `IG v3.x` — match the source. Canonical forms reviewers expect:
  - SDTM: `SDTM v1.4`, `SDTM v1.7`, `SDTM v1.8`, `SDTM v2.0`, `Model v2.0` (use the exact form in the CSV)
  - SDTMIG: `SDTMIG v3.2`, `SDTMIG v3.3`, `SDTMIG v3.4` (no spaces, no "IG" abbreviation alone)
  - SENDIG: `SENDIG v3.0`, `SENDIG v3.1`, `SENDIG v3.1.1` (no space between SEND and IG, lowercase `v`, no "version" word)
  - TIG: match the CSV exactly (e.g., `TIG v1.0`)
  - This was the most-flagged issue on the 2026-04-28 length-rule batch — 18 of 44 review comments were `Document:` corrections to SENDIG version strings.
- **Wrong Section**: check each version independently, sections change between SDTMIG versions
- **Extra/missing spaces** in Cited Guidance text
- **Smart quotes** (curly `""`) that break Windows encoding — replace with ASCII `""`
- **Missing trailing periods** in Cited Guidance

### Reading the source CSV

```python
import csv
CSV_PATH = './skills/sdtm-rule/SDTM_and_SDTMIG_Conformance_Rules_v2.0.csv'
with open(CSV_PATH, encoding='utf-8-sig', newline='') as f:
    # The CSV header has a trailing space on "Item " — strip keys to normalise.
    rows = [{(k.strip() if k else k): v for k, v in r.items()} for r in csv.DictReader(f)]
# Columns: Rule ID, SDTMIG Version, Rule Version, Class, Domain, Variable,
#           Condition, Rule, Document, Section, Item, Cited Guidance, Release Notes
# Filter rows for a specific rule with: [r for r in rows if r['Rule ID'] == 'CG0057']
```

## Step 5: Fix Negative Test Data

This is the most complex step. Each negative test case needs:

1. **Yellow-highlighted cells** marking where errors occur
2. **Validation sheet entries** describing expected errors

### Understanding the test validation system

The test runner (`test.py`) performs TWO independent matching operations:

#### A. Engine Error Matching (`validate_errors`)

Matches Validation sheet entries against engine-reported errors.

- **Row number conversion**: Validation sheet uses **Excel row numbers** (data starts at row 5).
  The code subtracts 4 to get engine row numbers, EXCEPT when Row num is `1` or `"N/A"`.
- **Error groups**: Multiple Validation rows with the same Error group ID are combined into
  a single values dict: `{Variable: Error_value, Variable2: Error_value2, ...}`
- **The `entries[0]` rule**: Sheet and Row num come from the FIRST entry in the error group.

**Matching by Error Level:**

| Level      | Matching Logic                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Record`   | **Key-set match**: the SET of variable names in validation (excluding `[ABSENT]` entries) must equal the set in engine output (also excluding `[ABSENT]` entries). Values are NOT compared. |
| `Variable` | Set of non-`[ABSENT]` variable names must match between validation and engine.                                                                                                              |
| `Dataset`  | Same as Variable.                                                                                                                                                                           |

**`[ABSENT]` handling in Record-level entries**: When a variable is absent from the dataset,
the engine includes it in the error dict with value `"Not in dataset"`. In the validation sheet,
use `[ABSENT]` as the Error value for that variable. The engine matching then EXCLUDES it from
both sides of the key-set comparison, and the highlight check is SKIPPED entirely for `[ABSENT]`
entries (so you do not need to highlight an absent column). This is the correct approach for
testing `not_exists` scenarios with Record sensitivity.

**WARNING**: Do NOT use `Not in dataset` as the Error value for Record-level entries — this will
cause "not highlighted correctly" errors because the highlight checker will try to find a cell
in a column that doesn't exist. `Not in dataset` is ONLY valid for Variable/Dataset-level entries.
For Record-level absent variables, ALWAYS use `[ABSENT]`.

#### B. Highlight Matching (`check_highlights`)

Matches Validation entries against yellow-highlighted cells (fill color `FFFFFF00`).
Uses **raw Excel row numbers** (no subtraction).

| Level      | Highlight Check                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------- |
| `Record`   | Cell value at (sheet, row, variable) must **exactly equal** Error value.                       |
| `Variable` | Only checks `[PRESENT]` entries — verifies the variable name exists in highlights at that row. |
| `Dataset`  | **Skipped entirely** (no highlight check).                                                     |

### Filling Validation Sheets by Sensitivity Type

Read `validation-patterns.md` for detailed patterns and examples.

**Key rules:**

- **Every validation row must have ALL 6 columns filled**: Error group, Sheet, Error level, Row num, Variable, Error value. Do NOT leave Sheet/Error level/Row num as None/blank for continuation rows in the same error group — repeat the same values. Leaving any of these blank causes the test runner to crash with `AttributeError: 'NoneType' object has no attribute 'lower'`.
- For **Record** sensitivity: include ALL Output Variables per error group, use actual cell values, use `None` (empty cell) for null values, use `[ABSENT]` for variables absent from the dataset
- For **Dataset/Variable** sensitivity with `exists`/`not_exists` checks: use `[PRESENT]` for the existing variable, use `Not in dataset` for the missing variable

**CRITICAL — `[ABSENT]` vs `Not in dataset`:**

- **Record sensitivity**: ALWAYS use `[ABSENT]` when a variable is absent from the dataset. NEVER use `Not in dataset` — it will cause "not highlighted correctly" errors because the highlight checker tries to find a cell in a column that doesn't exist.
- **Variable/Dataset sensitivity**: Use `Not in dataset` (these skip highlight checks entirely).
- This is the most common validation sheet mistake. When you see `Not in dataset` in a Record-level validation entry, it is ALWAYS wrong — change it to `[ABSENT]`.
- For **cross-domain rules** (e.g., Match Datasets): use the primary domain's sheet for the first entry, cross-domain sheet for referenced variables
- Always highlight **all** cells referenced in validation entries (except `[ABSENT]` entries — those are skipped automatically)

### Test Data Workbook Structure

When a rule applies to multiple domains, **consolidate all datasets into a single Excel workbook**
with each dataset as a separate sheet, rather than creating separate workbook files per dataset.
For example, if a rule applies to AE and CM domains, create one workbook with `ae.xpt` and `cm.xpt`
as separate sheets instead of two separate Excel files.

This applies to both positive and negative test cases. Only create multiple test case folders
(e.g., `negative/01`, `negative/02`) when testing genuinely different scenarios, not just
different domains.

**When building test data sheets**, use `sdtmig-reference` to:

- Get the correct column names, types, and lengths for a domain (`--domain <DOM>`)
- Include all `Core=Req` columns (they must be present in every valid dataset)
- Use `Core=Exp` columns when they are relevant to the rule being tested
- Check the `Val List` field for variables with controlled allowed values (e.g., TYPE=Char, Val List shows "Y")

```bash
# Get the full column list with types and lengths for building test data
python ./skills/sdtmig-reference/lookup.py --domain AG
# Check which columns are Req (must include), Exp (should include), Perm (optional)
python ./skills/sdtmig-reference/lookup.py --domain AG --core Req
```

### Applying Yellow Highlights

```python
from openpyxl.styles import PatternFill
yellow = PatternFill(start_color='FFFFFF00', end_color='FFFFFF00', fill_type='solid')
cell.fill = yellow
```

### Removing Erroneous Highlights

Some positive test cases may have leftover yellow highlights that shouldn't be there.
Remove them:

```python
no_fill = PatternFill(fill_type=None)
cell.fill = no_fill
```

## Step 6: Add `# verified`

After verifying the YAML metadata and fixing test data, add `# verified` to the YAML file,
after any existing comment block (e.g., `# Variable:`, `# Condition:`, `# Rule:`):

```yaml
# Variable: --ENRTPT
# Condition: --ENTPT present in dataset
# Rule: --ENRTPT present in dataset
# verified
Authorities: ...
```

If no comment block exists, add the comment headers from the source CSV along with `# verified`.

## Step 7: Run Tests

**A rule is NOT complete until tests pass.** Always run tests after EVERY change to YAML or test data.
Never batch multiple changes — run tests between each change. If the reviewer asks for changes, re-run
tests on ALL test cases (not just the one you changed) before marking the update as done.

```bash
python test.py -r CORE-XXXXXX -v
```

### Expected results

- **Positive tests**: 0 errors, `[PASS]`
- **Negative tests**: >0 errors, all showing `Fully Validated in Test Case: Yes`, `[PASS]`
- **No `\***ISSUES**\*` section** in any test case output

**A rule is NOT complete if `\***ISSUES**\*` appears in the test output**, even if all cases show `[PASS]`.
You MUST fix all issues and re-run until the output is completely clean.

### Interpreting issues

- **`Fully Validated: No`** → Validation sheet entries don't match engine errors (check values dict)
- **`unhighlighted validations`** / **`not highlighted correctly`** → Validation entry points to a cell that isn't yellow. **Most common cause**: using `Not in dataset` instead of `[ABSENT]` for an absent variable in a Record-level validation entry. Fix: change the Error value to `[ABSENT]` — this tells the test runner to skip the highlight check for that variable.
- **`unvalidated highlights`** → Yellow cell has no matching validation entry (often OK for extra context highlights like USUBJID)
- **`EXECUTION ERROR` with charmap** → Smart quotes in YAML, replace with ASCII

### Acceptable warnings

Some warnings are expected and don't indicate real problems:

- Cross-domain rules may show unvalidated USUBJID highlights
- Header-row highlights (row 1) may show as unvalidated
- These are informational, not errors

## Common Patterns Reference

### Pattern 1: Paired variable existence (Dataset sensitivity)

Rules like CG0057, CG0091, CG0092 — "if X exists, Y must also exist"

```
Check: X exists AND Y not_exists
Sensitivity: Dataset
Validation: Error level=Variable, Row=1, X=[PRESENT], Y=Not in dataset
Highlights: X header cell yellow
```

Verify both X and Y are `Core=Perm` in the applicable domains — this pattern only makes sense
for variables that may legitimately be absent:

```bash
python ./skills/sdtmig-reference/lookup.py --var <X>
python ./skills/sdtmig-reference/lookup.py --var <Y>
```

### Pattern 2: Conditional non-empty (Record sensitivity)

Rules like CG0061, CG0082 — "if X is not empty, Y must not be empty"

```
Check: X non_empty AND Y empty
Sensitivity: Record
Validation: one error group per row, include BOTH X and Y values
Highlights: both X and Y cells yellow on error rows
```

### Pattern 3: Value constraint (Record sensitivity)

Rules like CG0085, CG0131 — "X must be in allowed set"

```
Check: X non_empty AND X not_equal_to allowed_value
  - If allowed_value is a literal string, add value_is_literal: true
Sensitivity: Record
Validation: one error group per row, X = actual invalid value
Highlights: X cell yellow on error rows
```

Use `sdtmig-reference` to confirm the controlled values for X — the `Val List` field shows
the exact allowed values (e.g., `Y` or `Y/N`), and the CDISC Note confirms the constraint:

```bash
python ./skills/sdtmig-reference/lookup.py --domain <DOMAIN> --var <X>
# Check "Val List:" and "Note:" in the output
```

### Pattern 4: Cross-domain comparison (Record sensitivity)

Rules like CG0069 — "X in domain A must equal Y in domain B"

```
Check: condition + date_not_equal_to or not_equal_to (with Match Datasets)
  - Use date_not_equal_to for DTC date variables
  - If checking a literal condition value (e.g., DSDECOD = 'DEATH'), add value_is_literal: true
Sensitivity: Record
Validation: error group with entries from both sheets
  - First entries: primary sheet + row (for engine matching)
  - Cross-domain entry: other sheet + row (for highlight matching)
  - Include ALL output variables in the error group
Highlights: relevant cells in BOTH domain sheets
```

### Pattern 5: Conditional non-empty with permissible variables

Rules like CG0086 — "if X is not empty and Y is not populated, Z must not be empty (Y may be absent)"

```yaml
Check:
  all:
    - name: X
      operator: non_empty
    - any:                      # ← CORRECT: "any" is a list item inside "all"
        - name: Y
          operator: not_exists
        - name: Y
          operator: empty
    - name: Z
      operator: empty
Sensitivity: Record
Validation: create test data for BOTH cases:
  - Y exists but is empty → Record level, Y=None, use actual cell value for Y
  - Y is absent from dataset → Record level, Y=[ABSENT] (highlight check skipped)
Output Variables: include X, Y, and Z
Message: "Z is not populated when X is equal to '...' and Y is not populated."
```

**Every validation row has ALL 6 columns.** Example for the absent-Y case:

```
(1, 'ag.xpt', 'Record', 5, 'X',  'value')
(1, 'ag.xpt', 'Record', 5, 'Z',  None)
(1, 'ag.xpt', 'Record', 5, 'Y',  '[ABSENT]')   ← highlight check skipped, no need to highlight Y
```

### Pattern 6: Value length constraint (Record sensitivity)

Rules like CG0149, CG0257, CG0258, CG0297, CG0246, CG0406, CG0416 — "the length of variable X must not exceed N characters."

```
Check: X non_empty AND length(X) > N    (use the appropriate length operator)
Sensitivity: Record
Validation: one error group per row, X = the over-length value
Highlights: X cell yellow on error rows
```

**Canonical wording (do NOT deviate — every variant gets corrected):**

```yaml
# Variable: <VAR>
# Condition: <VAR> value length > <N> characters
# Rule: Length of <VAR> must be <= <N> characters
# verified
...
Description: Raise an error when the length of <VAR> is greater than <N> characters.
...
Outcome:
  Message: <VAR> value length is greater than <N> characters.
```

Citations for SEND-applicable length rules typically include `SENDIG v3.0`, `SENDIG v3.1`, and `SENDIG v3.1.1` — verify each Document string exactly. Cited Guidance for SEND character-length rules often ends with the clause `...are limited to N characters, but do not have special character restrictions.` — copy the FULL sentence from the CSV, do not truncate.

## Branch and PR Conventions

Branch naming: `<username>/CORE-XXXXXX/edit` (for existing rules) or `<username>/CORE-XXXXXX/create`

If pushing to a fork:

```bash
git remote add fork git@github.com:<user>/core-contributor.git
git push -u fork <branch-name>
```
