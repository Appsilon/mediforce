---
name: project-scaffolder
description: "Organize template files from an archive location into a standard clinical analysis project structure. Use this skill whenever the user has a set of programming templates, macros, or boilerplate files (in an archive, zip, or flat folder) and wants them copied and organized into a conventional study project layout (adam/, tlf/, programs/, output/, docs/, macros/). Also trigger when the user mentions 'set up a project', 'scaffold a study', 'organize templates', 'copy templates into project structure', 'standard folder structure', 'project skeleton', or 'initialize an analysis repo'. This is typically the first step before ADaM programming or TFL generation."
---

# Project Scaffolder

## Purpose

This skill takes a flat or arbitrarily-structured **archive of templates** (R/SAS programs,
macros, spec stubs, README boilerplate) and organizes them into a **standard clinical analysis
project structure**. It is deterministic, low-risk file organization — the kind of repetitive
setup a programmer does at the start of every study.

It produces:

1. A populated project directory following a conventional layout
2. A `MANIFEST.md` recording where every source file landed and why
3. A short summary of any files that could not be confidently classified (left in `_unsorted/`)

## When to use

- User has a template archive and wants a new study project initialized from it
- User asks to "scaffold", "set up the project", or "organize templates"
- This is the entry point before `spec-to-adam` (ADaM programming) or `adam-to-tlg` (TFL output)

## Target project structure

Unless the user supplies their own layout (see "Custom layout" below), use this default:

```
{project_dir}/
├── programs/
│   ├── adam/          # ADaM derivation programs (R / SAS)
│   ├── tlf/           # Table/Listing/Figure programs
│   └── macros/        # Shared/utility macros and helper functions
├── specs/             # Dataset and TLF specifications (Excel/CSV/markdown)
├── data/
│   ├── sdtm/          # Source SDTM datasets
│   └── adam/          # Derived ADaM datasets (output)
├── output/
│   ├── tables/
│   ├── figures/
│   └── listings/
├── docs/              # Protocol, SAP, READMEs, conventions
└── _unsorted/         # Files the skill could not confidently classify
```

## Workflow

### Step 1: Inventory the archive

Read the input archive directory (mounted at `/data` or provided by the user). If the input is a
`.zip` or `.tar.gz`, extract it to a temp directory first. Build a flat list of every file with:
its name, extension, and (for text files) a short content sniff (first ~30 lines).

### Step 2: Classify each file

Classify by extension **and** content signal, in this priority order:

| Signal | Destination |
|--------|-------------|
| Filename matches `ad*.R`, `ad*.sas`, or content references `library(admiral)` / `derive_vars_` | `programs/adam/` |
| Filename matches `t_*`, `l_*`, `f_*`, or content references `gtsummary` / `proc report` / `ggplot` | `programs/tlf/` |
| Filename contains `macro`/`util`/`helper`, or `.sas` file defining `%macro` | `programs/macros/` |
| `.xlsx`, `.xls`, `.csv` whose header row contains spec columns (Variable, Label, Origin, Derivation) | `specs/` |
| `.pdf`, `README*`, `*.md`, `*conventions*` | `docs/` |
| `.xpt`, `.sas7bdat`, `.json` SDTM-shaped data | `data/sdtm/` |
| Anything else | `_unsorted/` (record the reason) |

**Never delete or overwrite** a source file. Copy into the target structure; if a name collision
occurs, suffix with `_2`, `_3`, etc. and note it in the manifest.

### Step 3: Create the structure and copy

Create the full directory tree (even empty dirs — they document intent). Copy each classified file
to its destination. Preserve the original filename.

### Step 4: Write the manifest

Write `{project_dir}/MANIFEST.md`:

```markdown
# Project Scaffold Manifest

Source archive: {archive name / path}
Files processed: {N}

| Source file | Destination | Classified by |
|-------------|-------------|---------------|
| derive_adsl.R | programs/adam/derive_adsl.R | content: library(admiral) |
| ...           | ...                          | ...                       |

## Unsorted ({M})
- {file}: {why it could not be classified}
```

### Step 5: Present summary

Report: number of files organized, the resulting tree (one level deep), and the count of unsorted
files needing human attention.

## Custom layout

If the user provides their own folder convention (e.g. a `project-structure.yaml`, a sample
existing project to mirror, or instructions in the prompt), follow that layout instead of the
default. The classification logic stays the same — only the destination paths change.

## Output

```
{output_dir}/
├── MANIFEST.md
└── project/            # the scaffolded structure (this is the deliverable)
    └── ...
```

Set `output_file` to `MANIFEST.md` in the result and leave the full `project/` tree in the output
directory so it is captured as workflow output files.
