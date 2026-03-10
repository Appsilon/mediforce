# Admiral Coding Conventions

This reference covers `{admiral}` R package best practices, commonly used functions, and code patterns for generating ADaM datasets. Follow these conventions when generating R scripts.

## General Principles

1. **Use admiral functions over manual derivations** — admiral functions handle edge cases, missing data, and CDISC compliance
2. **Pipe-based workflow** — chain derivations using `%>%` in logical order
3. **One script per ADaM dataset** — clear separation of concerns
4. **ADSL first** — always create ADSL before any other dataset
5. **Consistent naming** — use lowercase for file names (`adsl.R`), uppercase for dataset/variable names in code (`ADSL`, `USUBJID`)
6. **Labels are mandatory** — every variable must have a label attribute

## Script Template

```r
# ============================================================================
# Name: {adam_name}.R
# Description: Create {ADAM_NAME} dataset
# Input: SDTM domains: {list}
#        ADaM datasets: ADSL (if not ADSL itself)
# Output: {adam_name}.json (Dataset-JSON)
# Supports TLGs: {list of TLG IDs}
# ============================================================================

# ---- Setup ----
library(admiral)
# library(admiralonco)  # uncomment if oncology derivations needed
library(dplyr, warn.conflicts = FALSE)
library(lubridate)
library(stringr)
library(datasetjson)

# ---- Configuration ----
sdtm_dir <- "{path_to_sdtm}"
adam_dir <- "{path_to_adam_output}"
dir.create(adam_dir, recursive = TRUE, showWarnings = FALSE)

# ---- Helper: Read SDTM data ----
read_sdtm <- function(domain, sdtm_path = sdtm_dir) {
  json_path <- file.path(sdtm_path, paste0(tolower(domain), ".json"))
  xpt_path <- file.path(sdtm_path, paste0(tolower(domain), ".xpt"))
  sas_path <- file.path(sdtm_path, paste0(tolower(domain), ".sas7bdat"))

  if (file.exists(json_path)) {
    df <- datasetjson::read_dataset_json(json_path)
  } else if (file.exists(xpt_path)) {
    df <- haven::read_xpt(xpt_path)
  } else if (file.exists(sas_path)) {
    df <- haven::read_sas(sas_path)
  } else {
    stop(paste("SDTM domain", domain, "not found in", sdtm_path))
  }

  # Ensure all variable names are uppercase
  names(df) <- toupper(names(df))
  # Convert haven_labelled to standard R types
  df <- df %>% mutate(across(where(haven::is.labelled), ~ as.character(.x)))
  df
}

# ---- Read ADSL (for non-ADSL scripts) ----
# adsl <- read.csv(file.path(adam_dir, "adsl.csv"))  # or read from json
# adsl <- datasetjson::read_dataset_json(file.path(adam_dir, "adsl.json"))

# ---- Read source SDTM ----
# dm <- read_sdtm("dm")
# ae <- read_sdtm("ae")
# etc.

# ---- Derivations ----
# [Admiral function calls in logical order]

# ---- Assign labels ----
# attr(adam_dataset$VARNAME, "label") <- "Variable Label"

# ---- Export ----
# write_dataset_json(adam_dataset, file.path(adam_dir, "{adam_name}.json"))
```

## Data Reading Patterns

### Reading SDTM with format detection
The `read_sdtm()` helper above handles all three formats. Key considerations:

- **haven_labelled columns**: `haven::read_xpt()` returns `haven_labelled` type. Convert to standard types before admiral processing:
  ```r
  df <- df %>% mutate(across(where(haven::is.labelled), ~ as.character(.x)))
  # For numeric columns that got labelled:
  df <- df %>% mutate(across(where(is.character), ~ {
    num <- suppressWarnings(as.numeric(.x))
    if (all(is.na(.x) | !is.na(num))) num else .x
  }))
  ```

- **Dataset-JSON**: `datasetjson::read_dataset_json()` returns a data.frame. Variable names may be mixed case — always `toupper()` them.

- **SAS7BDAT**: Similar to XPT, uses `haven::read_sas()`.

### Reading previously generated ADaM
For scripts that depend on other ADaM datasets (e.g., ADAE needs ADSL):
```r
adsl <- datasetjson::read_dataset_json(file.path(adam_dir, "adsl.json"))
names(adsl) <- toupper(names(adsl))
```

## Writing Patterns

### Dataset-JSON export (default)

The `datasetjson` package requires a specific structure. The simplest approach:

```r
# Method 1: Direct write (if datasetjson supports it)
write_dataset_json(adam_dataset, file.path(adam_dir, "adsl.json"))

# Method 2: If Method 1 fails, convert to a datasetjson object first
# This requires defining the dataset structure
ds <- dataset_json(
  rows = adam_dataset,
  study = "CDISCPILOT01",
  dataset = "ADSL",
  label = "Subject-Level Analysis Dataset"
)
write_dataset_json(ds, file.path(adam_dir, "adsl.json"))
```

### Fallback: CSV export
If Dataset-JSON export encounters issues, fall back to CSV as an intermediate format:
```r
write.csv(adam_dataset, file.path(adam_dir, "adsl.csv"), row.names = FALSE)
```

### XPT export (when user requests it)
```r
library(xportr)
adam_dataset %>%
  xportr_type(metacore_spec) %>%
  xportr_length(metacore_spec) %>%
  xportr_label(metacore_spec) %>%
  xportr_write(file.path(adam_dir, "adsl.xpt"))
```

## Common Admiral Functions Reference

### Date/Time Derivations

```r
# Convert character DTC to date
derive_vars_dt(new_vars_prefix = "AST", dtc = AESTDTC)
derive_vars_dt(new_vars_prefix = "AEN", dtc = AEENDTC)

# With imputation for partial dates
derive_vars_dt(
  new_vars_prefix = "AST",
  dtc = AESTDTC,
  highest_imputation = "M",  # impute up to month level
  date_imputation = "first"  # impute to first of month
)

# Derive study day
derive_vars_dy(reference_date = TRTSDT, source_vars = exprs(ASTDT, AENDT))

# Derive duration
derive_vars_duration(
  new_var = TRTDUR,
  start_date = TRTSDT,
  end_date = TRTEDT
)
```

### Merging SDTM into ADaM

```r
# Merge specific variables from another dataset
derive_vars_merged(
  dataset_add = adsl,
  by_vars = exprs(STUDYID, USUBJID),
  new_vars = exprs(TRTSDT, TRTEDT, TRT01P, TRT01A, SAFFL, ITTFL)
)

# Merge with date selection (first/last)
derive_vars_merged_dt(
  dataset_add = ex,
  by_vars = exprs(STUDYID, USUBJID),
  new_vars_prefix = "TRTS",
  dtc = EXSTDTC,
  mode = "first"
)
```

### Baseline Derivation

```r
# Flag baseline records
derive_var_extreme_flag(
  by_vars = exprs(USUBJID, PARAMCD),
  order = exprs(ADT, ASEQ),
  new_var = ABLFL,
  mode = "last",
  flag_filter = ADT <= TRTSDT  # last pre-treatment record
)

# Derive baseline value
derive_var_base(
  by_vars = exprs(USUBJID, PARAMCD),
  source_var = AVAL,
  new_var = BASE
)

# Derive change from baseline
derive_var_chg()

# Derive percent change from baseline
derive_var_pchg()
```

### LOCF / WOCF Imputation

```r
# LOCF (Last Observation Carried Forward)
derive_locf_records(
  dataset_ref = adsl,  # reference for expected visits
  by_vars = exprs(STUDYID, USUBJID, PARAMCD),
  order = exprs(AVISITN, AVISIT),
  keep_vars = exprs(STUDYID, USUBJID, PARAMCD, PARAM, AVISIT, AVISITN, AVAL, BASE)
)

# Alternative: manual LOCF using fill
dataset %>%
  group_by(USUBJID, PARAMCD) %>%
  arrange(AVISITN) %>%
  fill(AVAL, .direction = "down") %>%
  ungroup() %>%
  mutate(DTYPE = if_else(is.na(original_AVAL) & !is.na(AVAL), "LOCF", NA_character_))
```

### Shift Analysis

```r
# Derive normal range indicator
mutate(
  ANRIND = case_when(
    AVAL < A1LO ~ "LOW",
    AVAL > A1HI ~ "HIGH",
    TRUE ~ "NORMAL"
  )
)

# Derive shift (after BNRIND is set from baseline ANRIND)
derive_var_shift(
  new_var = SHIFT1,
  from_var = BNRIND,
  to_var = ANRIND
)
```

### Occurrence Flags (for ADAE)

```r
# First occurrence flags
derive_var_extreme_flag(
  by_vars = exprs(USUBJID, AEBODSYS),
  order = exprs(ASTDT, AESEQ),
  new_var = AOCCFL,
  mode = "first"
)

derive_var_extreme_flag(
  by_vars = exprs(USUBJID, AEBODSYS, AEDECOD),
  order = exprs(ASTDT, AESEQ),
  new_var = AOCCSFL,
  mode = "first"
)
```

### Treatment Variables

```r
# In BDS datasets, derive TRTP/TRTA from ADSL
mutate(
  TRTP = TRT01P,
  TRTA = TRT01A,
  TRTPN = TRT01PN,
  TRTAN = TRT01AN
)
```

### Derived Parameters

```r
# BMI from height and weight
derive_param_bmi(
  by_vars = exprs(STUDYID, USUBJID, AVISIT, AVISITN),
  weight_code = "WEIGHT",
  height_code = "HEIGHT",
  set_values_to = exprs(PARAMCD = "BMI", PARAM = "Body Mass Index (kg/m2)")
)

# BSA (Body Surface Area)
derive_param_bsa(
  by_vars = exprs(STUDYID, USUBJID, AVISIT, AVISITN),
  weight_code = "WEIGHT",
  height_code = "HEIGHT",
  method = "Mosteller"
)
```

### Time-to-Event (ADTTE)

```r
# Define event source
event <- event_source(
  dataset_name = "adae",
  filter = TRTEMFL == "Y" & CQ01NAM == "DERMATOLOGICAL",
  date = ASTDT,
  set_values_to = exprs(EVNTDESC = "First Derm AE", CNSR = 0)
)

# Define censoring source
censor <- censor_source(
  dataset_name = "adsl",
  date = pmin(TRTEDT, EOSDT, na.rm = TRUE),
  set_values_to = exprs(
    EVNTDESC = "Censored",
    CNSDTDSC = "End of treatment or study",
    CNSR = 1
  )
)

# Derive parameter
derive_param_tte(
  dataset_adsl = adsl,
  start_date = TRTSDT,
  event_conditions = list(event),
  censor_conditions = list(censor),
  source_datasets = list(adae = adae, adsl = adsl),
  set_values_to = exprs(PARAMCD = "TTDERM")
)
```

### Oncology-Specific (admiralonco)

```r
library(admiralonco)

# Best Overall Response
derive_param_response(
  dataset = adrs,
  ref_confirm = 28  # days for confirmation
)

# Confirmed response
derive_param_confirmed_resp(
  dataset = adrs,
  ref_confirm = 28
)

# PFS derivation
derive_param_tte(
  dataset_adsl = adsl,
  source_datasets = list(adsl = adsl, adrs = adrs),
  start_date = RANDDT,
  event_conditions = list(pd_event, death_event),
  censor_conditions = list(last_assessment_censor),
  set_values_to = exprs(PARAMCD = "PFS")
)
```

## Variable Labelling

Always assign labels. Two approaches:

### Approach 1: Using attr() directly
```r
attr(adsl$USUBJID, "label") <- "Unique Subject Identifier"
attr(adsl$AGE, "label") <- "Age"
attr(adsl$SAFFL, "label") <- "Safety Population Flag"
```

### Approach 2: Bulk labelling with a named vector
```r
var_labels <- c(
  USUBJID = "Unique Subject Identifier",
  AGE = "Age",
  AGEGR1 = "Pooled Age Group 1",
  SEX = "Sex",
  RACE = "Race",
  TRT01P = "Planned Treatment for Period 01",
  TRT01A = "Actual Treatment for Period 01",
  SAFFL = "Safety Population Flag",
  ITTFL = "Intent-to-Treat Population Flag"
)

for (var in names(var_labels)) {
  if (var %in% names(adsl)) {
    attr(adsl[[var]], "label") <- var_labels[[var]]
  }
}
```

## Supplemental Qualifier Handling

SUPP-- datasets need to be pivoted and merged into their parent domain:

```r
# Merge supplemental qualifiers
combine_supp <- function(parent, supp) {
  if (is.null(supp) || nrow(supp) == 0) return(parent)

  supp_wide <- supp %>%
    select(STUDYID, USUBJID, IDVAR, IDVARVAL, QNAM, QVAL) %>%
    tidyr::pivot_wider(
      id_cols = c(STUDYID, USUBJID, IDVAR, IDVARVAL),
      names_from = QNAM,
      values_from = QVAL
    )

  # Determine the join key from IDVAR
  id_var <- unique(supp$IDVAR)

  parent %>%
    mutate(IDVARVAL = as.character(.data[[id_var]])) %>%
    left_join(supp_wide, by = c("STUDYID", "USUBJID", "IDVARVAL")) %>%
    select(-IDVAR, -IDVARVAL)
}

# Usage:
dm <- combine_supp(dm, suppdm)
ae <- combine_supp(ae, suppae)
```

## Numeric Treatment Coding

```r
# Standard numeric coding for treatment arms
TRT01PN = case_when(
  TRT01P == "Placebo" ~ 0,
  TRT01P == "Xanomeline Low Dose" ~ 1,
  TRT01P == "Xanomeline High Dose" ~ 2,
  TRUE ~ NA_real_
)
```

## Visit Windowing

```r
# Define windows and assign analysis visits
assign_analysis_visit <- function(data, windows) {
  # windows is a tibble with AVISIT, AVISITN, lower_day, upper_day
  data %>%
    cross_join(windows) %>%
    filter(ADY >= lower_day & ADY <= upper_day) %>%
    # If a record falls in multiple windows, take the closest to target
    group_by(USUBJID, PARAMCD, AVISIT) %>%
    slice_min(abs(ADY - target_day), n = 1, with_ties = FALSE) %>%
    ungroup()
}
```

## Error Handling in Scripts

```r
# Wrap risky operations in tryCatch
tryCatch({
  dm <- read_sdtm("dm")
}, error = function(e) {
  message("ERROR: Could not read DM domain: ", e$message)
  stop(e)
})

# Check for expected variables before using them
required_vars <- c("USUBJID", "ARM", "RFSTDTC")
missing_vars <- setdiff(required_vars, names(dm))
if (length(missing_vars) > 0) {
  warning("Missing expected variables in DM: ", paste(missing_vars, collapse = ", "))
}
```

## Execution Order

Scripts must be executed in dependency order:

```
1. 00_setup.R          # Package loading, helper functions, configuration
2. 01_adsl.R           # Subject-level (no ADaM dependencies)
3. 02_adae.R           # Depends on ADSL only
4. 03_adlb.R           # Depends on ADSL only
5. 04_advs.R           # Depends on ADSL only
6. 05_adex.R           # Depends on ADSL only
7. 06_adqs*.R          # Depends on ADSL only
8. 07_adcm.R           # Depends on ADSL only
9. 08_adtte.R          # May depend on ADSL + ADAE + other ADaM
```

## Quality Checks After Generation

```r
# Quick sanity checks
cat("ADSL: ", nrow(adsl), " subjects\n")
cat("  SAFFL=Y: ", sum(adsl$SAFFL == "Y"), "\n")
cat("  ITTFL=Y: ", sum(adsl$ITTFL == "Y"), "\n")
cat("  Arms: ", paste(unique(adsl$TRT01P), collapse=", "), "\n")

# Check for key variables
stopifnot("USUBJID" %in% names(adsl))
stopifnot("SAFFL" %in% names(adsl))

# BDS dataset checks
cat("ADLB: ", nrow(adlb), " records, ",
    length(unique(adlb$PARAMCD)), " parameters, ",
    length(unique(adlb$USUBJID)), " subjects\n")
```
