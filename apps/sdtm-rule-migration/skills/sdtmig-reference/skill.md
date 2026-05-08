---
name: sdtmig-reference
description: >
  Look up SDTMIG v3.4 domain/variable information (Core status, Role, Type, allowed values)
  from the authoritative CSV reference file. Use this whenever you need to verify whether a
  variable is Required, Expected, or Permissible in a domain — do NOT assume or guess.
  Trigger when authoring or reviewing rules and you need to confirm variable constraints.
---

# SDTMIG v3.4 Reference Lookup

This skill looks up authoritative SDTMIG v3.4 variable information using a Python script that
reads from `SDTMIG v3.4 Classes and Columns.csv` alongside the script in this skill folder.
Never guess or assume a variable's Core status — always run the script.

## Core status meanings

| Core | Meaning |
|---|---|
| `Req` | Required — must be present and populated in every dataset |
| `Exp` | Expected — should be present; omission requires justification |
| `Perm` | Permissible — may or may not be present in the dataset |

**Rule authoring implication**: A `Perm` variable may be absent from the dataset entirely.
Any rule that checks a `Perm` variable for emptiness MUST use `- any:` with `not_exists` + `empty`.

## The lookup script

Script location: `.claude/skills/sdtmig-reference/lookup.py`
Run from the repo root with `source venv/bin/activate` active.

```bash
# List all available domains
python .claude/skills/sdtmig-reference/lookup.py --domains

# All variables in a domain (with Core status)
python .claude/skills/sdtmig-reference/lookup.py --domain AG

# Specific variable in a domain
python .claude/skills/sdtmig-reference/lookup.py --domain AG --var AGSTAT

# All Permissible variables in a domain
python .claude/skills/sdtmig-reference/lookup.py --domain AG --core Perm

# All Required variables in a domain
python .claude/skills/sdtmig-reference/lookup.py --domain DM --core Req

# Find a variable (or suffix) across ALL domains
python .claude/skills/sdtmig-reference/lookup.py --var STAT
python .claude/skills/sdtmig-reference/lookup.py --var DTHFL
```

The `--var` flag does suffix matching: `--var STAT` matches `AGSTAT`, `CMSTAT`, `MHSTAT`, etc.

## When to use this during rule authoring (Pre-flight checklist item D)

For **every variable** that the rule's Check section tests for `empty` or `non_empty`:

1. Run: `python .claude/skills/sdtmig-reference/lookup.py --domain <DOMAIN> --var <VAR>`
2. Check the `Core` field in the output.
3. If `Core=Perm` in **any applicable domain**:
   - Replace `operator: empty` with `- any: [not_exists, empty]` block in the YAML
   - Create a separate negative test case for the absent-variable scenario (use `[ABSENT]`)

For rules that apply to multiple domains (e.g., the variable `--STAT` applies to AG, CM, EC, etc.),
run the cross-domain check: `python .claude/skills/sdtmig-reference/lookup.py --var STAT`
If **any** domain shows `Perm`, the rule needs the `any` block.

## Reading the output

```
  AGSTAT               Core=Perm   Role=Record Qualifier  Type=Char  Label=Completion Status
                         Note: Used to indicate that a question about a prespecified agent was
                               not answered. Should be null or have a value of "NOT DONE".
```

Key fields:
- `Core` → Required / Expected / Permissible
- `Role` → Identifier, Timing, Record Qualifier, Variable Qualifier, Grouping Qualifier, etc.
- `Val List` → controlled allowed values (if any)
- `Note` → CDISC definition and usage guidance (useful for Description/Message wording)
