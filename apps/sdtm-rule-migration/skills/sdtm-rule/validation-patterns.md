# Validation Sheet Patterns — Detailed Reference

This document provides exact patterns for filling Validation sheets in negative test cases,
organized by rule sensitivity type and check pattern.

## Validation Sheet Format

Headers (always in row 1):

| Column | Name | Description |
|--------|------|-------------|
| A | Error group | Integer grouping ID (1, 2, 3...) — multiple rows with same ID form one error |
| B | Sheet | Excel tab name (e.g., `ae.xpt`, `dm.xpt`) |
| C | Error level | `Record`, `Variable`, or `Dataset` (case-insensitive) |
| D | Row num | Excel row number (data rows start at 5), or `1` for header, or `N/A` |
| E | Variable | SDTM variable name (e.g., `AEPRESP`, `DTHFL`) |
| F | Error value | Expected value, `[PRESENT]`, `[ABSENT]`, or empty cell for null |

## How Error Groups Work

An error group combines multiple Validation rows into a single values dict for matching.
All rows sharing the same Error group number are merged:

```
Error group 1: {EXTRT: "PLACEBO", EXDOSE: 1.0}  ← two rows, group=1
Error group 2: {EXTRT: "PLACEBO", EXDOSE: 12.0}  ← two rows, group=2
```

**Critical**: The Sheet and Row num from `entries[0]` (first row of the group) are used
for the matching key. Other rows in the group can have different Sheet values
(useful for cross-domain rules).

## Pattern A: Record-Level, Single Output Variable

**When**: Rule has one Output Variable, Sensitivity = Record

**Example**: CG0085 (`--PRESP` must be 'Y' or null), CG0131 (DTHFL must be 'Y' or null)

Engine returns: `{"AEPRESP": "N"}` for each error row.

**Validation sheet** (one row per error):

| Error group | Sheet | Error level | Row num | Variable | Error value |
|---|---|---|---|---|---|
| 1 | ae.xpt | Record | 5 | AEPRESP | N |
| 2 | ae.xpt | Record | 7 | AEPRESP | NOT DONE |
| 3 | ae.xpt | Record | 9 | AEPRESP | UNKNOWN |

**Highlights**: Yellow fill on each AEPRESP cell at rows 5, 7, 9.

**Highlight matching**: Cell value at (ae.xpt, row, AEPRESP) must equal Error value exactly.

## Pattern B: Record-Level, Multiple Output Variables

**When**: Rule has 2+ Output Variables, Sensitivity = Record

**Example**: CG0061 (`--STRTPT` non-empty but `--STTPT` empty)

Engine returns: `{"PRSTRTPT": "AFTER", "PRSTTPT": null}` per error row.

**Validation sheet** (TWO rows per error group):

| Error group | Sheet | Error level | Row num | Variable | Error value |
|---|---|---|---|---|---|
| 1 | pr.xpt | Record | 5 | PRSTRTPT | AFTER |
| 1 | pr.xpt | Record | 5 | PRSTTPT | *(empty cell)* |
| 2 | pr.xpt | Record | 6 | PRSTRTPT | AFTER |
| 2 | pr.xpt | Record | 6 | PRSTTPT | *(empty cell)* |

**Why empty cell, not `[ABSENT]`?** For Record-level matching, the code does exact dict comparison:
`v_values == res_values`. The engine returns `null` (Python `None`). An empty Excel cell
reads as `None`. So `None == None` → match. But `"[ABSENT]" != None` → no match.

**Highlights**: Yellow on BOTH PRSTRTPT and PRSTTPT cells for each error row.
Empty cells can be highlighted — the fill is on the cell, not the value.

## Pattern C: Record-Level, Cross-Domain

**When**: Rule compares variables across domains (Match Datasets), Sensitivity = Record

**Example**: CG0069 (DSSTDTC must equal DM.DTHDTC when DSDECOD = 'DEATH')

Engine returns: `{"DSDECOD": "DEATH", "DSSTDTC": "2022-02-20", "DTHDTC": "2021-02-18"}`
The error fires on ds.xpt but DTHDTC comes from dm.xpt.

**Validation sheet** (THREE rows per error group, spanning two sheets):

| Error group | Sheet | Error level | Row num | Variable | Error value |
|---|---|---|---|---|---|
| 1 | ds.xpt | Record | 11 | DSDECOD | DEATH |
| 1 | ds.xpt | Record | 11 | DSSTDTC | 2022-02-20 |
| 1 | dm.xpt | Record | 5 | DTHDTC | 2021-02-18 |

**How this works**:
- `entries[0]` is `(ds.xpt, Record, 11)` → flat_validation key = `(ds.xpt, record, 7)`
  (11 - 4 = 7, matching engine row 7)
- Values dict = `{DSDECOD: DEATH, DSSTDTC: 2022-02-20, DTHDTC: 2021-02-18}` → matches engine
- Highlight check uses each entry's own Sheet/Row:
  - (ds.xpt, 11, DSDECOD) → "DEATH" ✓
  - (ds.xpt, 11, DSSTDTC) → "2022-02-20" ✓
  - (dm.xpt, 5, DTHDTC) → "2021-02-18" ✓

**Mapping cross-domain rows**: Find the USUBJID in the primary domain's error row,
then find the matching row in the secondary domain.

**Acceptable warnings**: USUBJID highlights and header-row highlights in the secondary domain
will show as "unvalidated highlights" — this is expected.

## Pattern D: Dataset/Variable-Level, Exists/Not-Exists

**When**: Rule checks variable existence, Sensitivity = Dataset

**Example**: CG0057 (if --ENTPT exists, --ENRTPT must exist),
CG0091 (if --TPTNUM exists, --TPT must exist)

Engine returns: `{"VSTPT": "Not in dataset", "VSTPTNUM": 1.0}` (row=None)

**Important**: For Variable/Dataset level matching, the code checks:
```python
v_not_absent = set(k for k, v in v_values.items() if v != "[ABSENT]")
res_not_absent = set(k for k, v in res_values.items() if v != "[ABSENT]")
match = (v_not_absent == res_not_absent) or (not v_not_absent)
```

So the sets of non-ABSENT variable names must match between validation and engine.
Since the engine returns "Not in dataset" (which is NOT "[ABSENT]"), BOTH variables
appear in `res_not_absent`. Your validation must put non-ABSENT values for both.

**Validation sheet**:

| Error group | Sheet | Error level | Row num | Variable | Error value |
|---|---|---|---|---|---|
| 1 | vs.xpt | Variable | 1 | VSTPTNUM | [PRESENT] |
| 1 | vs.xpt | Variable | 1 | VSTPT | Not in dataset |

**Why this works**:
- `v_not_absent` = {VSTPTNUM, VSTPT} (neither is [ABSENT])
- `res_not_absent` = {VSTPT, VSTPTNUM} (neither is [ABSENT])
- Sets match ✓

**Highlight check**:
- VSTPTNUM with [PRESENT]: code checks `var in highlights[sheet][row]` → needs header highlighted ✓
- VSTPT with "Not in dataset": code does `continue` (skips non-[PRESENT] entries) ✓

**Highlights**: Yellow on the EXISTS variable's header cell (row 1) only.

### Variant: Single Output Variable

If the rule has only ONE output variable (like CG0057/CORE-000084 which outputs only --ENTPT):

Engine returns: `{"CMENTPT": None}` (just one variable)

| Error group | Sheet | Error level | Row num | Variable | Error value |
|---|---|---|---|---|---|
| 1 | cm.xpt | Variable | 1 | CMENTPT | [PRESENT] |

This works because:
- `v_not_absent` = {CMENTPT}
- `res_not_absent` = {CMENTPT} (None != "[ABSENT]")
- Sets match ✓

## Debugging Validation Failures

### "Fully Validated: No" but errors are found

1. **Check the values dict**: Read results.json. The engine error's `value` field shows
   exactly what needs to match. For Record level, your validation dict must be identical.

2. **Check types**: Engine may return `1.0` (float) but your Excel cell has `1` (int).
   These won't match for Record level.

3. **Check all output variables**: Read the YAML's `Outcome.Output Variables`. Every
   variable listed there appears in the engine's value dict and must be in your validation.

4. **Check Row num arithmetic**: For Record level, the code does `row_num - 4` to convert
   Excel rows to engine rows. Make sure your Row num values are Excel row numbers (5, 6, 7...)
   not engine row numbers (1, 2, 3...).

### "unhighlighted validations"

Your Validation entry references a cell that isn't yellow. Either:
- You forgot to highlight it
- The Row num or Variable is wrong
- For Record level with null: the empty highlighted cell returns `None`,
  but Error value is `[ABSENT]` (string) → mismatch. Use empty cell instead.

### "unvalidated highlights"

A yellow cell has no matching Validation entry. Common causes:
- Extra informational highlights (USUBJID, header rows) — acceptable
- Erroneous highlights in positive test cases — remove them

### Encoding errors

`'charmap' codec can't decode byte 0x9d` → Smart quotes in YAML.
Fix by replacing UTF-8 curly quotes with ASCII:

```python
with open(yaml_path, 'rb') as f:
    content = f.read()
content = content.replace(b'\xe2\x80\x9c', b'"')  # left smart quote
content = content.replace(b'\xe2\x80\x9d', b'"')  # right smart quote
with open(yaml_path, 'wb') as f:
    f.write(content)
```
