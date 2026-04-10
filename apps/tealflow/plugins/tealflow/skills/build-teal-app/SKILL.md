---
name: build-teal-app
description: "Build a complete Teal Shiny app from ADaM datasets using TealFlowMCP tools, validate it, and push to GitHub. Autonomous workflow — no user interaction during execution."
---

# Build Teal App

## Purpose

You are an autonomous agent that builds a complete Teal R Shiny application for clinical trial data exploration. You use TealFlowMCP tools to discover data, select modules, generate code, validate the app, and push the result to a GitHub repository.

You operate without user interaction. All inputs come from workflow variables. If something fails, retry with fixes up to 2 times, then report the error and stop.

## Inputs (workflow variables)

| Variable | Required | Description |
|----------|----------|-------------|
| `dataDir` | yes | Absolute path to directory containing ADaM datasets (.Rds or .csv) |
| `githubRepo` | yes | Target GitHub repo (e.g. `Appsilon/teal-app-study-001`) |
| `analysisGoal` | no | What the app should focus on (e.g. "survival and safety analysis") |
| `modules` | no | Explicit list of teal module names to include |
| `appName` | no | Human-readable app name (defaults to repo name) |

## Execution Steps

### 1. Get TealFlowMCP guidance

Call `tealflow_agent_guidance` to load the full reference for using TealFlowMCP tools correctly. Read it carefully — it contains critical constraints (absolute paths, parameter formats).

### 2. Discover datasets

Call `tealflow_discover_datasets` with the absolute `dataDir` path.

Expected output: list of ADaM datasets with names, formats, file sizes.

If no datasets found, report error and stop.

### 3. Inspect key datasets

For each discovered dataset, call `tealflow_get_dataset_info` to understand:
- Available columns and their types
- Row counts
- Key variables (ARM, PARAMCD, AVAL, USUBJID, AVISIT, etc.)

This is critical for selecting compatible modules and generating correct configuration.

### 4. Select modules

**If `modules` variable is provided:** use those exact modules. Verify compatibility with `tealflow_check_dataset_requirements`.

**If `analysisGoal` is provided:** call `tealflow_search_modules_by_analysis` with the goal. Pick the top matches that are compatible with available datasets.

**If neither:** use the default module selection logic based on which datasets exist:

| Dataset | Modules |
|---------|---------|
| ADSL (always) | `tm_t_summary`, `tm_variable_browser`, `tm_data_table` |
| ADAE | `tm_t_events_summary`, `tm_t_events` |
| ADLB | `tm_t_summary_by`, `tm_g_lineplot` |
| ADTTE | `tm_g_km`, `tm_g_forest_tte` |
| ADQS | `tm_t_summary_by`, `tm_a_mmrm` |
| ADVS | `tm_t_summary_by`, `tm_g_lineplot` |

Always include `tm_data_table` and `tm_variable_browser` for general exploration.

For each candidate module, call `tealflow_check_dataset_requirements` to verify compatibility before including it.

### 5. Generate app code

In order:

1. Call `tealflow_generate_data_loading` with discovered datasets to get `data.R`
2. Call `tealflow_get_app_template` for the base `app.R` structure
3. For each selected module, call `tealflow_generate_module_code` to get the module snippet
4. Assemble the final `app.R` by inserting module code into the template

Write the files to the working directory:
- `data.R` — data loading code
- `app.R` — complete Teal app with all modules

### 6. Set up renv

Call `tealflow_setup_renv_environment` with the project path to install required R packages.

Then call `tealflow_snapshot_renv_environment` to create `renv.lock` for reproducibility.

### 7. Validate

Call `tealflow_check_shiny_startup` to verify the app starts without errors.

- If `status: "ok"` — proceed to push.
- If `status: "error"` — analyze the error type:
  - `missing_package`: run renv setup again
  - `syntax_error`: fix the R code
  - `object_not_found`: check variable names against dataset inspection results
- Retry validation up to 2 times after fixes.
- If still failing, include the error in the result but still push the code (it may need manual fixes).

### 8. Push to GitHub

```bash
cd /output
git init
git checkout -b main
git add app.R data.R renv.lock renv/ .Rprofile
git commit -m "feat: generated Teal app via TealFlowMCP"
git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git"
git push -u origin main --force
```

If the repo already has content, create a new branch instead:
```bash
git checkout -b tealflow/generated-app
git push -u origin tealflow/generated-app
```

### 9. Report result

Return a structured result:

```
## Teal App Generated

**Repository**: {githubRepo}
**Datasets**: {list of loaded datasets}
**Modules**: {list of included modules with labels}
**Validation**: {ok or error details}

The app can be launched with:
  shiny::runApp("app.R")
```

## Constraints

- Use ONLY TealFlowMCP tools for module discovery and code generation. Do not write teal R code manually.
- All paths passed to TealFlowMCP tools MUST be absolute.
- Do not install R packages manually — use `tealflow_setup_renv_environment`.
- Do not add modules that fail `tealflow_check_dataset_requirements`.
- Keep the app simple — prefer fewer well-configured modules over many poorly configured ones.
- If `analysisGoal` mentions specific analyses, prioritize those over defaults.
