# Teal Modules Configuration Reference

This guide covers configuration patterns for `teal.modules.clinical` and `teal.modules.general` modules used in clinical trial teal apps.

## Core Concepts

### choices_selected()

Most module parameters use `choices_selected()` to define what variables the user can pick from and which is selected by default:

```r
arm_var = choices_selected(
  choices = variable_choices(ADSL, c("TRT01P", "TRT01A", "ARM")),
  selected = "TRT01P"
)
```

- `choices` — vector of variable names or `variable_choices(data, subset)` for dynamic choices
- `selected` — default selection(s)

### data_extract_spec()

For more complex variable selection (across datasets), use `data_extract_spec()`:

```r
data_extract_spec(
  dataname = "ADLB",
  select = select_spec(choices = c("AVAL", "CHG", "BASE"), selected = "AVAL"),
  filter = filter_spec(vars = "PARAMCD", choices = levels(ADLB$PARAMCD), selected = "ALT")
)
```

### Common parameters across clinical modules

Most `teal.modules.clinical` modules share these parameters:

| Parameter | Description | Typical Value |
|-----------|-------------|---------------|
| `label` | Tab label in the app | Descriptive string |
| `dataname` | Primary ADaM dataset | `"ADAE"`, `"ADLB"`, etc. |
| `parentname` | Parent dataset (usually ADSL) | `"ADSL"` |
| `arm_var` | Treatment arm variable | `choices_selected(c("TRT01P","TRT01A"), "TRT01P")` |
| `pre_output` | UI element above the output | `NULL` or `shiny::tags$div(...)` |
| `post_output` | UI element below the output | `NULL` |

## teal.modules.clinical Modules

### tm_t_summary — Summary Table (Demographics, Baseline)

Produces a summary table of selected variables by treatment arm.

```r
tm_t_summary(
  label = "Demographic Table",
  dataname = "ADSL",
  arm_var = choices_selected(choices = c("TRT01P", "TRT01A"), selected = "TRT01P"),
  summarize_vars = choices_selected(
    choices = c("AGE", "AGEGR1", "SEX", "RACE", "ETHNIC", "BMIBL", "HEIGHTBL", "WEIGHTBL"),
    selected = c("AGE", "SEX", "RACE")
  ),
  useNA = "ifany"
)
```

### tm_t_events_summary — AE Overview Table

High-level AE summary (any AE, SAE, related AE, etc.).

```r
tm_t_events_summary(
  label = "AE Overview",
  dataname = "ADAE",
  parentname = "ADSL",
  arm_var = choices_selected(choices = c("TRT01A"), selected = "TRT01A")
)
```

### tm_t_events — Events by Category Table (AE by SOC/PT)

Events counted by body system and preferred term.

```r
tm_t_events(
  label = "AE by SOC and PT",
  dataname = "ADAE",
  parentname = "ADSL",
  arm_var = choices_selected(choices = c("TRT01A"), selected = "TRT01A"),
  hlt = choices_selected(choices = c("AEBODSYS"), selected = "AEBODSYS"),
  llt = choices_selected(choices = c("AEDECOD"), selected = "AEDECOD"),
  event_type = "adverse event"
)
```

Also works for concomitant medications (dataname = "ADCM", hlt = ATC class, llt = preferred name).

### tm_t_summary_by — Summary by Parameter and Visit

For BDS datasets — summarize AVAL/CHG by PARAMCD, AVISIT, and treatment arm.

```r
tm_t_summary_by(
  label = "Lab Summary",
  dataname = "ADLB",
  parentname = "ADSL",
  arm_var = choices_selected(choices = c("TRT01A"), selected = "TRT01A"),
  summarize_vars = choices_selected(choices = c("AVAL", "CHG"), selected = "AVAL"),
  by_vars = choices_selected(choices = c("AVISIT", "AVISITN"), selected = "AVISIT"),
  paramcd = choices_selected(
    choices = levels(ADLB$PARAMCD),
    selected = levels(ADLB$PARAMCD)[1]
  )
)
```

### tm_t_shift_by_arm — Shift Table

Baseline-to-post-baseline shift categories (Low/Normal/High).

```r
tm_t_shift_by_arm(
  label = "Lab Shift Table",
  dataname = "ADLB",
  parentname = "ADSL",
  arm_var = choices_selected(choices = c("TRT01A"), selected = "TRT01A"),
  paramcd = choices_selected(choices = levels(ADLB$PARAMCD), selected = "ALT"),
  visit_var = choices_selected(choices = c("AVISIT"), selected = "AVISIT"),
  aval_var = choices_selected(choices = "ANRIND", selected = "ANRIND"),
  baseline_var = choices_selected(choices = "BNRIND", selected = "BNRIND")
)
```

### tm_t_tte — Time-to-Event Table

Tabular summary of time-to-event endpoints (median survival, event rates, HR).

```r
tm_t_tte(
  label = "Time-to-Event Summary",
  dataname = "ADTTE",
  parentname = "ADSL",
  arm_var = choices_selected(choices = c("TRT01P"), selected = "TRT01P"),
  paramcd = choices_selected(choices = levels(ADTTE$PARAMCD), selected = levels(ADTTE$PARAMCD)[1]),
  time_unit_var = choices_selected(choices = "AVALU", selected = "AVALU"),
  aval_var = choices_selected(choices = "AVAL", selected = "AVAL"),
  cnsr_var = choices_selected(choices = "CNSR", selected = "CNSR"),
  event_desc_var = choices_selected(choices = "EVNTDESC", selected = "EVNTDESC")
)
```

### tm_g_km — Kaplan-Meier Plot

Interactive KM curves with number-at-risk table.

```r
tm_g_km(
  label = "KM Plot",
  dataname = "ADTTE",
  parentname = "ADSL",
  arm_var = choices_selected(choices = c("TRT01P"), selected = "TRT01P"),
  paramcd = choices_selected(choices = levels(ADTTE$PARAMCD), selected = levels(ADTTE$PARAMCD)[1]),
  strata_var = choices_selected(
    choices = c("SEX", "AGEGR1", "RACE"),
    selected = NULL
  ),
  facet_var = choices_selected(choices = c("SEX", "AGEGR1"), selected = NULL),
  time_unit_var = choices_selected(choices = "AVALU", selected = "AVALU"),
  cnsr_var = choices_selected(choices = "CNSR", selected = "CNSR")
)
```

### tm_g_forest_tte — Forest Plot (Time-to-Event)

Forest plot of hazard ratios by subgroup.

```r
tm_g_forest_tte(
  label = "Forest Plot - TTE",
  dataname = "ADTTE",
  parentname = "ADSL",
  arm_var = choices_selected(choices = c("TRT01P"), selected = "TRT01P"),
  paramcd = choices_selected(choices = levels(ADTTE$PARAMCD), selected = levels(ADTTE$PARAMCD)[1]),
  subgroup_var = choices_selected(
    choices = c("SEX", "AGEGR1", "RACE", "STRATA1"),
    selected = c("SEX", "AGEGR1")
  ),
  strata_var = choices_selected(choices = c("STRATA1", "STRATA2"), selected = NULL),
  aval_var = choices_selected(choices = "AVAL", selected = "AVAL"),
  cnsr_var = choices_selected(choices = "CNSR", selected = "CNSR")
)
```

### tm_g_forest_rsp — Forest Plot (Response)

Forest plot of odds ratios for binary response by subgroup.

```r
tm_g_forest_rsp(
  label = "Forest Plot - Response",
  dataname = "ADRS",
  parentname = "ADSL",
  arm_var = choices_selected(choices = c("TRT01P"), selected = "TRT01P"),
  paramcd = choices_selected(choices = levels(ADRS$PARAMCD), selected = "BOR"),
  aval_var = choices_selected(choices = "AVALC", selected = "AVALC"),
  subgroup_var = choices_selected(
    choices = c("SEX", "AGEGR1", "RACE"),
    selected = c("SEX", "AGEGR1")
  ),
  resp_definition = choices_selected(
    choices = c("CR", "PR", "CR/PR"),
    selected = "CR/PR"
  )
)
```

### tm_a_mmrm — MMRM Analysis

Mixed model for repeated measures with LS means and diagnostics.

```r
tm_a_mmrm(
  label = "MMRM Analysis",
  dataname = "ADQS",
  parentname = "ADSL",
  aval_var = choices_selected(choices = c("AVAL", "CHG"), selected = "CHG"),
  arm_var = choices_selected(choices = c("TRT01P"), selected = "TRT01P"),
  id_var = choices_selected(choices = "USUBJID", selected = "USUBJID"),
  visit_var = choices_selected(choices = c("AVISIT"), selected = "AVISIT"),
  paramcd = choices_selected(choices = levels(ADQS$PARAMCD), selected = levels(ADQS$PARAMCD)[1]),
  cov_var = choices_selected(choices = c("BASE", "AGEGR1", "SEX"), selected = "BASE"),
  conf_level = choices_selected(choices = c(0.9, 0.95, 0.99), selected = 0.95)
)
```

### tm_g_lineplot — Line Plot (Mean Over Time)

Mean (with CI) of an analysis variable over visits by arm.

```r
tm_g_lineplot(
  label = "Mean Over Time",
  dataname = "ADLB",
  parentname = "ADSL",
  strata = choices_selected(choices = c("TRT01A"), selected = "TRT01A"),
  x = choices_selected(choices = c("AVISIT", "AVISITN", "ADY"), selected = "AVISIT"),
  y = choices_selected(choices = c("AVAL", "CHG"), selected = "AVAL"),
  param = choices_selected(choices = levels(ADLB$PARAMCD), selected = levels(ADLB$PARAMCD)[1])
)
```

### Patient Profile Modules

```r
# Patient timeline
tm_g_pp_patient_timeline(
  label = "Patient Timeline",
  dataname_adae = "ADAE",
  dataname_adcm = "ADCM",
  parentname = "ADSL",
  patient_col = "USUBJID"
)

# Vitals (patient-level)
tm_g_pp_vitals(
  label = "Patient Vitals",
  dataname = "ADVS",
  parentname = "ADSL",
  patient_col = "USUBJID",
  paramcd = choices_selected(choices = levels(ADVS$PARAMCD), selected = "WEIGHT"),
  aval_var = "AVAL",
  visit_var = "AVISIT"
)
```

## teal.modules.general Modules

### tm_data_table — Raw Data Viewer

```r
tm_data_table(
  label = "Data Table"
  # Automatically shows all loaded datasets with search/filter
)
```

### tm_variable_browser — Variable Explorer

```r
tm_variable_browser(
  label = "Variable Browser"
  # Automatically shows distributions for all variables in all datasets
)
```

### tm_g_scatterplot — Scatterplot

```r
tm_g_scatterplot(
  label = "Scatterplot",
  x = data_extract_spec(dataname = "ADSL", select = select_spec(choices = c("AGE", "BMIBL"))),
  y = data_extract_spec(dataname = "ADSL", select = select_spec(choices = c("HEIGHTBL", "WEIGHTBL"))),
  color_by = data_extract_spec(dataname = "ADSL", select = select_spec(choices = c("SEX", "TRT01P")))
)
```

### tm_g_distribution — Distribution Plot

```r
tm_g_distribution(
  label = "Distribution",
  stacked_dist = data_extract_spec(
    dataname = "ADSL",
    select = select_spec(choices = c("AGE", "BMIBL", "HEIGHTBL"))
  ),
  group_by = data_extract_spec(
    dataname = "ADSL",
    select = select_spec(choices = c("SEX", "TRT01P", "RACE"))
  )
)
```

### tm_g_association — Association Plot

```r
tm_g_association(
  label = "Association",
  ref = data_extract_spec(dataname = "ADSL", select = select_spec(choices = c("AGE", "SEX", "RACE"))),
  vars = data_extract_spec(dataname = "ADSL", select = select_spec(choices = c("TRT01P", "SEX", "AGEGR1"), multiple = TRUE))
)
```

### tm_t_crosstable — Cross-Tabulation

```r
tm_t_crosstable(
  label = "Cross Table",
  x = data_extract_spec(dataname = "ADSL", select = select_spec(choices = c("SEX", "RACE", "AGEGR1"))),
  y = data_extract_spec(dataname = "ADSL", select = select_spec(choices = c("TRT01P", "SEX")))
)
```

## Data Setup Patterns

### Reading ADaM data into teal_data

```r
data <- teal_data()
data <- within(data, {
  library(haven)
  library(jsonlite)

  # Helper: read ADaM from any format
  read_adam <- function(name, data_dir) {
    csv_path <- file.path(data_dir, paste0(name, ".csv"))
    json_path <- file.path(data_dir, paste0(name, ".json"))
    xpt_path <- file.path(data_dir, paste0(name, ".xpt"))
    sas_path <- file.path(data_dir, paste0(name, ".sas7bdat"))

    if (file.exists(xpt_path)) {
      haven::read_xpt(xpt_path)
    } else if (file.exists(csv_path)) {
      read.csv(csv_path, stringsAsFactors = FALSE)
    } else if (file.exists(json_path)) {
      jsonlite::fromJSON(json_path)
    } else if (file.exists(sas_path)) {
      haven::read_sas(sas_path)
    } else {
      stop(paste("Dataset", name, "not found in", data_dir))
    }
  }

  DATA_DIR <- "{adam_data_dir}"

  ADSL <- read_adam("adsl", DATA_DIR)
  ADAE <- read_adam("adae", DATA_DIR)
  # ... etc

  # Ensure factor variables for teal
  ADSL$TRT01P <- factor(ADSL$TRT01P)
  ADSL$TRT01A <- factor(ADSL$TRT01A)
  ADSL$SEX <- factor(ADSL$SEX)
  ADSL$RACE <- factor(ADSL$RACE)
  # ... etc for categorical variables used in modules
})

# Join keys
join_keys(data) <- default_cdisc_join_keys[names(data)]
```

### Important: Factor conversion

teal modules expect categorical variables to be factors. Always convert:
- Treatment arm variables (TRT01P, TRT01A, TRT01PN, etc.)
- Demographic categories (SEX, RACE, ETHNIC, AGEGR1)
- Flag variables (SAFFL, ITTFL, EFFFL) — convert "Y"/"N" to factor
- Parameter codes (PARAMCD)
- Visit variables (AVISIT)
- AE coding (AEBODSYS, AEDECOD, AESEV, AESER)

### Join keys for standard ADaM

`default_cdisc_join_keys` handles most cases. For custom datasets, define manually:

```r
join_keys(data) <- join_keys(
  join_key("ADSL", "ADSL", c("STUDYID", "USUBJID")),
  join_key("ADSL", "ADAE", c("STUDYID", "USUBJID")),
  join_key("ADAE", "ADAE", c("STUDYID", "USUBJID", "ASTDTM", "AETERM", "AESEQ")),
  join_key("ADSL", "ADLB", c("STUDYID", "USUBJID")),
  join_key("ADLB", "ADLB", c("STUDYID", "USUBJID", "PARAMCD", "AVISIT")),
  # ... etc
)
```

## App Launch

```r
# From the app directory
shiny::runApp("app.R")

# Or with specific port
shiny::runApp("app.R", port = 3838, host = "0.0.0.0")

# For deployment to Posit Connect
# Just push the app.R file (and data) to the server
```
