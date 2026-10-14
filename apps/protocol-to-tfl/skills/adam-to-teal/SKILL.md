---
name: adam-to-teal
description: "Generate an interactive Shiny-based clinical trial exploration app using the R teal framework from ADaM datasets and mock TLG shells. Use this skill whenever the user has ADaM datasets and wants to create an interactive teal app for data exploration, review, or QC. Also trigger when the user mentions 'teal app', 'interactive exploration', 'Shiny clinical app', 'teal modules', 'interactive TLGs', 'clinical data explorer', 'teal dashboard', or wants an interactive review tool for their ADaM data. This skill is an alternative/complement to the static TLG generation (adam-to-tlg) — it produces a live, filterable Shiny app instead of static outputs."
---

# ADaM-to-Teal App Generator

## Purpose

This skill reads ADaM datasets (produced by `sdtm-to-adam`) and mock TLG shells (produced by `mock-tlg-generator`) and generates an interactive teal Shiny application for clinical trial data exploration. The app includes:

1. **Pre-configured teal modules** matching the mock TLG shells (demographics, efficacy, safety, etc.)
2. **Global filtering** — users can interactively filter by treatment arm, population flags, visits, subgroups
3. **Reproducible R code** — teal shows the R code behind every output, enabling transparency
4. **Report generation** — users can export selected outputs to a report via teal.reporter

The generated R script is the primary deliverable — a single `app.R` (or modular `app.R` + helper files) that can be launched with `shiny::runApp()`.

## When to use

- User has ADaM datasets and wants an interactive exploration app
- User asks to "create a teal app", "build an interactive dashboard", "make a Shiny app for clinical data"
- User wants to interactively explore, filter, and QC their ADaM data
- User wants a complement to static TLGs for ad-hoc exploration
- User wants to review clinical data with interactive filtering

## Key R packages

The teal ecosystem (all should be installed):

| Package | Purpose |
|---------|---------|
| `teal` | Core framework — `init()`, module orchestration, filtering |
| `teal.data` | Data loading and joining for teal apps |
| `teal.modules.general` | General-purpose modules: data table viewer, variable browser, scatterplot, histogram, cross-table, association |
| `teal.modules.clinical` | Clinical-specific modules: demographics, adverse events, efficacy, KM curves, forest plots, response, MMRM, time-to-event |
| `teal.transform` | Data transformation utilities within teal |
| `teal.widgets` | UI widgets for teal modules |
| `teal.reporter` | Report generation from teal outputs |
| `teal.slice` | Filtering infrastructure |
| `tern` | Statistical analysis functions used by teal.modules.clinical |
| `tern.mmrm` | MMRM analysis integration |
| `rlistings` | Listing generation within teal |

## Workflow

### Step 0: Check and install required R packages

```r
required_pkgs <- c(
  "teal", "teal.data", "teal.modules.general", "teal.modules.clinical",
  "teal.transform", "teal.widgets", "teal.reporter", "teal.slice",
  "teal.code", "teal.logger",
  "tern", "tern.mmrm", "rlistings",
  "dplyr", "haven", "jsonlite", "shiny"
)
missing <- required_pkgs[!sapply(required_pkgs, requireNamespace, quietly = TRUE)]
if (length(missing) > 0) {
  install.packages(missing, repos = "https://cloud.r-project.org")
}
```

### Step 1: Parse mock TLG shells (if available)

If mock TLG shells are provided, parse them to determine which teal modules to include and how to configure them. Map each TLG shell type to a teal module:

| TLG Shell Type | teal Module |
|---------------|-------------|
| Demographics table | `tm_t_summary()` |
| Disposition table | `tm_t_summary()` |
| AE summary table | `tm_t_events_summary()` |
| AE by SOC/PT | `tm_t_events()` |
| Efficacy endpoint summary | `tm_t_summary_by()` or `tm_a_mmrm()` |
| Lab shift table | `tm_t_shift_by_arm()` |
| KM figure | `tm_g_km()` |
| Forest plot | `tm_g_forest_tte()` or `tm_g_forest_rsp()` |
| Patient profile | `tm_g_pp_patient_timeline()` and related |
| Listings | `tm_t_events()` or general data table |

If no TLG shells are provided, generate a sensible default module set based on which ADaM datasets exist.

### Step 2: Inventory ADaM datasets

Read the ADaM data directory. ADaM datasets may be in:
- `.csv` format — read with `read.csv()` or `readr::read_csv()`
- `.json` format — read with `jsonlite::fromJSON()` (or `datasetjson::read_dataset_json()`)
- `.xpt` format — read with `haven::read_xpt()`
- `.sas7bdat` format — read with `haven::read_sas()`

For each dataset, note:
- Dataset name (ADSL, ADAE, ADLB, etc.)
- Available variables and their types
- Record counts
- Key classification variables (PARAMCD values, visit values, etc.)

### Step 3: Design the teal app structure

The app must follow teal conventions:

```r
app <- teal::init(
  data = teal_data_object,
  modules = teal::modules(
    # General exploration
    tm_data_table("Data Table", ...),
    tm_variable_browser("Variable Browser", ...),

    # Clinical modules organized by category
    teal::modules(
      label = "Demographics",
      tm_t_summary(...)
    ),
    teal::modules(
      label = "Safety",
      tm_t_events_summary(...),
      tm_t_events(...),
      ...
    ),
    teal::modules(
      label = "Efficacy",
      tm_g_km(...),
      tm_a_mmrm(...),
      ...
    )
  ),
  filter = teal_slices(...)
)

shinyApp(app$ui, app$server)
```

### Step 4: Configure teal data

teal requires data to be set up with relationships defined (especially the ADSL merge keys). Use `teal_data()` with `join_keys()`:

```r
data <- teal_data()

# Load datasets into teal_data
data <- within(data, {
  ADSL <- read_data("adsl")   # helper to read whatever format
  ADAE <- read_data("adae")
  ADLB <- read_data("adlb")
  # ... etc
})

# Define join keys — ADSL is the parent
join_keys(data) <- default_cdisc_join_keys[names(data)]
```

Use `default_cdisc_join_keys` from `teal.data` which knows the standard CDISC ADaM relationships (ADSL joins to BDS datasets on STUDYID + USUBJID).

### Step 5: Configure teal modules

Read the module configuration reference:

```
references/teal-modules-guide.md
```

For each module, configure:
- **Label** — descriptive name shown in the app sidebar
- **Dataset** — which ADaM dataset(s) to use
- **Variables** — arm variable (usually TRT01A/TRT01P), parameter variable (PARAMCD), visit variable (AVISIT), analysis variable (AVAL/CHG), etc.
- **Default filters** — population flags, specific parameters, etc.

**CRITICAL API NOTES (dev teal 1.1.0+):**

1. **Use `variable_choices()` and `value_choices()`** — Clinical modules require these wrappers inside `choices_selected()`:
   - `variable_choices("DATANAME", c("VAR1", "VAR2"))` — for variable selection (arm_var, aval_var, summarize_vars, etc.)
   - `value_choices("DATANAME", "PARAMCD", "PARAM")` — for value-level filtering (paramcd, visit_var in shift tables, avisit in ANCOVA). This is critical because these go through `cs_to_des_filter()` which requires a `var_choices` attribute.

2. **`tm_g_lineplot` uses `group_var`** not `strata` — The `strata` argument was renamed to `group_var` and is now defunct.

3. **`tm_t_ancova` requires `cov_var`** — No default; must specify covariates (e.g., `BASE`, `SITEGR1`).

4. **`tm_t_tte` requires `time_points` and `strata_var`** — `time_points` has no default; specify landmark times. `time_unit_var` defaults to `AVALU` which may not exist.

5. **`header`/`footer` in `init()` are deprecated** — Use `modify_header(app, ...)` and `modify_footer(app, ...)` after `init()`.

Key configuration patterns:

#### Demographics / Baseline (tm_t_summary)
```r
tm_t_summary(
  label = "Demographics Table",
  dataname = "ADSL",
  arm_var = choices_selected(
    choices = variable_choices("ADSL", c("TRT01P", "TRT01A")),
    selected = "TRT01P"
  ),
  summarize_vars = choices_selected(
    choices = variable_choices("ADSL", c("AGE", "SEX", "RACE", "ETHNIC", "BMIBL")),
    selected = c("AGE", "SEX", "RACE")
  )
)
```

#### AE Summary (tm_t_events_summary)
```r
tm_t_events_summary(
  label = "AE Summary",
  dataname = "ADAE",
  parentname = "ADSL",
  arm_var = choices_selected(choices = c("TRT01A", "TRT01P"), selected = "TRT01A")
)
```

#### KM Plot (tm_g_km)
```r
tm_g_km(
  label = "Kaplan-Meier",
  dataname = "ADTTE",
  parentname = "ADSL",
  arm_var = choices_selected(choices = c("TRT01P", "TRT01A"), selected = "TRT01P"),
  paramcd = choices_selected(
    choices = levels(ADTTE$PARAMCD),
    selected = levels(ADTTE$PARAMCD)[1]
  ),
  strata_var = choices_selected(choices = c("SEX", "AGEGR1", "RACE"), selected = NULL)
)
```

#### MMRM Analysis (tm_a_mmrm)
```r
tm_a_mmrm(
  label = "MMRM Analysis",
  dataname = "ADQS",  # or whichever BDS dataset
  parentname = "ADSL",
  aval_var = choices_selected(choices = c("AVAL", "CHG"), selected = "CHG"),
  arm_var = choices_selected(choices = c("TRT01P", "TRT01A"), selected = "TRT01P"),
  id_var = choices_selected(choices = "USUBJID", selected = "USUBJID"),
  visit_var = choices_selected(choices = c("AVISIT", "AVISITN"), selected = "AVISIT"),
  paramcd = choices_selected(choices = levels(ADQS$PARAMCD), selected = levels(ADQS$PARAMCD)[1])
)
```

### Step 6: Set up default filters

Configure sensible default filter states using `teal_slices()`:

```r
filter = teal_slices(
  teal_slice("ADSL", "SAFFL", selected = "Y"),
  teal_slice("ADSL", "ITTFL", selected = "Y")
)
```

These can be modified interactively by users in the running app.

### Step 7: Generate the app.R script

Generate a self-contained `app.R` script that:

1. Loads all required libraries
2. Defines a data-reading helper function (handles CSV/JSON/XPT/SAS7BDAT)
3. Creates the `teal_data` object with all ADaM datasets
4. Defines `join_keys` for proper dataset relationships
5. Configures all teal modules (organized into logical groups)
6. Sets default filters
7. Calls `teal::init()` and `shiny::shinyApp()`

The script should be runnable with `shiny::runApp("app.R")` or `Rscript -e 'shiny::runApp("app.R")'`.

### Step 8: Generate optional helper files

If the app is complex (many modules), split into:

```
{output_dir}/
├── app.R                    # Main app entry point
├── R/
│   ├── data_loading.R       # Data reading helpers
│   ├── modules_demog.R      # Demographics module configs
│   ├── modules_safety.R     # Safety module configs
│   ├── modules_efficacy.R   # Efficacy module configs
│   └── modules_general.R    # General exploration modules
└── README.md                # How to launch the app (only if requested)
```

For simpler apps (fewer than ~10 modules), keep everything in a single `app.R`.

### Step 9: Test the app launches

Run a quick startup test to verify the app initializes without errors:

```r
# Test that the app object can be created (without actually launching Shiny)
source("app.R", local = TRUE)
# If no errors, the app configuration is valid
```

Alternatively, run the app briefly and check for startup errors in the console output.

### Step 10: Present summary to user

After completion, present:
- List of teal modules included (with labels)
- Which ADaM datasets are loaded
- Default filter configuration
- How to launch the app (`shiny::runApp("{output_dir}")`)
- How to customize (add/remove modules, change defaults)

## Module selection logic

When no TLG shells are provided, select modules based on available ADaM datasets:

| ADaM Dataset | Modules to Include |
|-------------|-------------------|
| ADSL (always) | `tm_t_summary` (demographics), `tm_variable_browser`, `tm_data_table` |
| ADAE | `tm_t_events_summary`, `tm_t_events` (by SOC/PT), `tm_g_pp_adverse_events` |
| ADLB | `tm_t_summary_by` (lab summary), `tm_g_lineplot` (mean over time), `tm_t_shift_by_arm` |
| ADVS | `tm_t_summary_by`, `tm_g_lineplot` |
| ADTTE | `tm_g_km`, `tm_g_forest_tte`, `tm_t_tte` |
| ADQS / ADQSADAS / etc. | `tm_t_summary_by`, `tm_g_lineplot`, `tm_a_mmrm` |
| ADEX | `tm_t_summary_by` (exposure summary) |
| ADCM | `tm_t_events` (concomitant medications) |

Always include general exploration modules:
- `tm_data_table` — view raw data
- `tm_variable_browser` — explore variable distributions

## Output format

The primary output is an R Shiny app that runs locally. The app provides:
- Interactive HTML tables (via `rtables`/`tern` under the hood)
- Interactive plots (via `ggplot2`/`teal.widgets`)
- Downloadable outputs via `teal.reporter`
- Reproducible R code for every displayed output

## Customization guidance

After generating the app, inform the user they can:
1. **Add modules** — add more `tm_*()` calls in the modules list
2. **Remove modules** — delete unwanted module blocks
3. **Change defaults** — modify `choices_selected()` to change default variable selections
4. **Add custom modules** — write custom teal modules using `teal::module()` for specialized analyses
5. **Deploy** — the app can be deployed to Posit Connect, ShinyApps.io, or run locally

## Reference files

- `references/teal-modules-guide.md` — Detailed configuration reference for all teal.modules.clinical and teal.modules.general modules, including function signatures, key parameters, and example configurations.
