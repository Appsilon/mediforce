---
name: adam-to-tlg
description: "Generate production-quality Tables, Listings, and Figures (TLGs) from ADaM datasets using R code with gtsummary, gt, and ggplot2, guided by mock TLG shells. Use this skill whenever the user has ADaM datasets and mock TLG shells and wants to produce the actual TLG outputs. Also trigger when the user mentions 'generate TLGs', 'create tables from ADaM', 'produce clinical study report outputs', 'TLG programming', 'table programming', 'figure programming', or wants to implement the statistical analyses defined in mock shells. This skill is the fourth step in a Protocol->SAP->Metadata->TLG Shells->ADaM->TLG pipeline."
---

# ADaM-to-TLG Generator

## Purpose

This skill reads mock TLG shells (produced by `mock-tlg-generator`) and ADaM datasets (produced by `sdtm-to-adam`) and generates the actual TLG outputs — fully formatted tables, listings, and figures with computed statistics, ready for review.

Each TLG is produced by an R script that:
1. Reads the required ADaM dataset(s)
2. Applies the specified population filter
3. Computes the required statistics (descriptive summaries, hypothesis tests, regression models)
4. Formats the output using `gtsummary`/`gt` (tables/listings) or `ggplot2` (figures)
5. Exports to HTML (tables, default) or PNG (figures, default)

The generated R scripts are the primary deliverable — they can be reviewed, modified, and re-run by programmers.

## When to use

- User has ADaM datasets and mock TLG shells and wants actual TLG outputs
- User asks to "generate tables", "create figures", "program TLGs", "produce outputs"
- User has completed the ADaM generation step and wants the final reporting outputs
- User wants to implement specific statistical analyses (ANCOVA, MMRM, Fisher's, KM, etc.)

## Workflow

### Step 0: Check and install required R packages

```r
required_pkgs <- c(
  "gtsummary", "gt", "ggplot2", "dplyr", "tidyr", "stringr",
  "survival", "ggsurvfit", "mmrm", "emmeans", "broom",
  "lme4", "nlme", "cardx", "cards",
  "haven", "jsonlite"
)
missing <- required_pkgs[!sapply(required_pkgs, requireNamespace, quietly = TRUE)]
if (length(missing) > 0) {
  install.packages(missing, repos = "https://cloud.r-project.org")
}
```

### Step 1: Parse mock TLG shells

Read the mock TLG shells markdown file. For each shell, extract:

- **TLG ID and type** (Table/Listing/Figure)
- **Title and subtitle**
- **Population** (ITT, Safety, Efficacy, etc.)
- **Column structure** (treatment arms, total column)
- **Row stubs** (parameters, categories, statistics to display)
- **Statistical methods** (ANCOVA, ANOVA, Fisher's exact, MMRM, KM, CMH, etc.)
- **Footnotes** (abbreviations, method references, population definitions)
- **Programming notes** (ADaM dataset, key variables, special derivations)
- **Source dataset**

Build a master plan: `{TLG_ID} -> {type, dataset, population, method, variables, footnotes}`

### Step 2: Inventory ADaM datasets

Read the ADaM data directory. ADaM datasets may be in:
- `.csv` format (from `sdtm-to-adam` skill)
- `.json` format (jsonlite or Dataset-JSON)
- `.xpt` format (SAS transport)
- `.sas7bdat` format

For each dataset, note available variables and record counts. Verify each TLG shell's required dataset exists.

### Step 3: Create the output directory structure

```
{output_dir}/
├── code/
│   ├── 00_setup.R           # Shared config, helpers, theme
│   ├── t_01_pop.R           # Table T-1
│   ├── t_02_eos.R           # Table T-2
│   ├── ...
│   ├── f_01_km_derm.R       # Figure F-1
│   └── run_all.R            # Master script
├── outputs/
│   ├── tables/
│   │   ├── t_01_pop.html
│   │   ├── t_02_eos.html
│   │   └── ...
│   ├── figures/
│   │   ├── f_01_km_derm.png
│   │   └── ...
│   └── listings/
│       └── ...
├── tlg-index.md             # Index linking TLG IDs to output files
└── issues.md                # Error log
```

Script naming convention: `{type}_{number}_{short_name}.R` where type is `t` (table), `l` (listing), or `f` (figure). This makes it easy to navigate from mock shell ID to code file.

### Step 4: Generate the shared setup script (00_setup.R)

This script contains:
- Library loading
- Path configuration (ADaM data dir, output dir)
- ADaM data reading helper (handles CSV/JSON/XPT/SAS7BDAT)
- Shared gtsummary theme (consistent formatting across all tables)
- Shared ggplot2 theme
- Common helper functions (formatting p-values, CIs, etc.)

The gtsummary theme should set:
- Consistent decimal formatting
- Standard header/footnote formatting
- Treatment arm display names with N
- Standard statistic labels

### Step 5: Generate individual TLG scripts

For each TLG shell, generate an R script. Read the programming guide for patterns:

```
references/tlg-programming-guide.md
```

For statistical methods, read:

```
references/statistical-methods-guide.md
```

#### Table scripts pattern

Each table script follows this structure:

```r
# ============================================================
# TLG ID: {id}
# Title: {title}
# Population: {population}
# Source: {dataset}
# Method: {statistical method}
# ============================================================

source("00_setup.R")

# ---- Read data ----
adsl <- read_adam("adsl")
# ... additional datasets as needed

# ---- Filter population ----
analysis_data <- adsl %>% filter(SAFFL == "Y")

# ---- Compute statistics / Build table ----
tbl <- analysis_data %>%
  tbl_summary(
    by = TRT01P,
    include = c(...),
    statistic = list(...)
  ) %>%
  add_overall() %>%
  modify_header(...) %>%
  modify_footnote(...) %>%
  modify_caption(...)

# ---- Export ----
gt::gtsave(as_gt(tbl), file.path(output_dir, "tables", "{id}.html"))
```

#### Figure scripts pattern

```r
source("00_setup.R")

# ---- Read data ----
adtte <- read_adam("adtte")

# ---- Filter and prepare ----
plot_data <- adtte %>% filter(SAFFL == "Y", PARAMCD == "TTDERM")

# ---- Create figure ----
p <- ggplot(plot_data, aes(...)) +
  ... +
  study_theme()

# ---- Export ----
ggsave(file.path(output_dir, "figures", "{id}.png"),
       plot = p, width = 10, height = 7, dpi = 300)
```

#### Listing scripts pattern

```r
source("00_setup.R")

# ---- Read data ----
adae <- read_adam("adae")

# ---- Filter and select ----
listing_data <- adae %>%
  filter(...) %>%
  select(...) %>%
  arrange(...)

# ---- Format as table ----
tbl <- listing_data %>%
  gt() %>%
  tab_header(...) %>%
  tab_footnote(...)

# ---- Export ----
gt::gtsave(tbl, file.path(output_dir, "listings", "{id}.html"))
```

### Step 6: Generate the master run script (run_all.R)

```r
# Master script: runs all TLG scripts in order
scripts <- list.files("code", pattern = "^[tlf]_", full.names = TRUE)
scripts <- sort(scripts)

results <- list()
for (s in scripts) {
  cat("Running:", basename(s), "...\n")
  result <- tryCatch({
    source(s, local = new.env())
    cat("  SUCCESS\n")
    "OK"
  }, error = function(e) {
    cat("  FAILED:", e$message, "\n")
    paste("ERROR:", e$message)
  })
  results[[basename(s)]] <- result
}

# Summary
cat("\n=== TLG Generation Summary ===\n")
cat("Total:", length(results), "\n")
cat("Success:", sum(results == "OK"), "\n")
cat("Failed:", sum(results != "OK"), "\n")
```

### Step 7: Execute all scripts

Run the master script (or individual scripts) via `Rscript`. For each script:

1. Execute and capture output
2. If it fails, examine the error, fix the code, and re-run
3. After successful execution, verify the output file exists
4. Quick sanity check: for HTML tables, verify file is non-empty; for PNG figures, verify file exists and has reasonable size

### Step 8: Generate the TLG index

Create a markdown index linking each TLG ID to its output file and status:

```markdown
## TLG Output Index

| TLG ID | Title | Type | Script | Output | Status |
|--------|-------|------|--------|--------|--------|
| T-1 | Summary of Populations | Table | t_01_pop.R | t_01_pop.html | OK |
| ...
| F-1 | KM: Time to First Derm Event | Figure | f_01_km_derm.R | f_01_km_derm.png | OK |
```

### Step 9: Generate error log

Compile all issues:

```markdown
## TLG Generation Issues

### Failed TLGs
- {TLG ID}: {error message and reason}

### Warnings
- {TLG ID}: {warning about data or formatting}

### Missing Data
- {TLG ID}: {ADaM dataset or variable not found}
```

### Step 10: Present summary to user

After completion, present:
- Total TLGs generated vs total in shells
- Breakdown by type (tables, listings, figures)
- Any failed TLGs with reasons
- Output location
- How to re-run individual TLGs or modify formatting

## Statistical methods implementation

The skill must implement the statistical methods specified in the TLG shells. Common methods and their R implementations:

### Descriptive statistics
- **n, Mean, SD, Median, Min, Max, Q1, Q3**: `gtsummary::tbl_summary()` with appropriate `statistic` argument
- **n (%)**: `gtsummary::tbl_summary()` for categorical variables

### Hypothesis tests
- **Fisher's exact test**: `gtsummary::add_p(test = all_categorical() ~ "fisher.test")`
- **Pearson's chi-square**: `gtsummary::add_p(test = all_categorical() ~ "chisq.test")`
- **ANOVA**: `gtsummary::add_p(test = all_continuous() ~ "aov")`
- **Wilcoxon/Kruskal-Wallis**: `gtsummary::add_p(test = all_continuous() ~ "kruskal.test")`
- **CMH test**: `stats::mantelhaen.test()` or `cardx::ard_stats_cmh_test()`

### Regression models
- **ANCOVA**: `lm(CHG ~ TRT01P + BASE + SITEGR1, data = ...)` then `emmeans::emmeans()` for LS means and pairwise comparisons
- **ANOVA (no baseline covariate)**: `lm(AVAL ~ TRT01P + SITEGR1, data = ...)` then `emmeans`
- **MMRM**: `mmrm::mmrm(CHG ~ TRT01P * AVISIT + BASE * AVISIT + SITEGR1, data = ..., covariance = "unstructured")` then `emmeans` for visit-level contrasts
- **Dose-response test**: Treatment coded as continuous (Placebo=0, Low=54, High=81) in the ANCOVA model

### Survival analysis
- **Kaplan-Meier**: `survival::survfit(Surv(AVAL, 1-CNSR) ~ TRT01P, data = ...)` then `ggsurvfit::ggsurvfit()` for the KM plot with number-at-risk table
- **Log-rank test**: `survival::survdiff()` or extracted from `survfit`
- **Cox regression**: `survival::coxph()` for hazard ratios

### Multiple comparisons
- Pairwise comparisons via `emmeans::contrast()` with method = "pairwise"
- Confidence intervals and p-values from `emmeans::confint()` and `emmeans::test()`

## Table formatting conventions

### gtsummary theme

Set a study-level gtsummary theme in the setup script:

```r
theme_gtsummary_study <- function() {
  theme_gtsummary_compact()
  # Additional theme settings for consistent formatting
}
```

### Column headers

Always include N in column headers: `"Placebo (N=86)"`. Use `modify_header()` to set this.

### Footnotes

Reproduce footnotes from mock shells:
- Statistical method references
- Abbreviation definitions
- Population definition
- Source dataset

### Title/subtitle

Include:
- Protocol ID
- Population
- Table title from mock shell

## Figure formatting conventions

### ggplot2 study theme

```r
study_theme <- function() {
  theme_bw() +
  theme(
    plot.title = element_text(size = 12, face = "bold"),
    plot.subtitle = element_text(size = 10),
    legend.position = "bottom",
    panel.grid.minor = element_blank()
  )
}
```

### KM curves (via ggsurvfit)

Must include:
- Kaplan-Meier survival curves with distinct line styles per arm
- Number-at-risk table below the plot
- Censoring tick marks
- Legend with arm names
- Title, subtitle, axis labels
- HD resolution (300 DPI, ~10x7 inches)

### Other figures

Follow the mock shell descriptions for axis labels, reference lines, legends, etc.

## Output format details

### Tables: HTML (default)
- Generated via `gt::gtsave(as_gt(tbl), "file.html")`
- Clean, self-contained HTML files
- If user requests RTF: `gtsummary::as_flex_table(tbl) %>% flextable::save_as_docx("file.docx")`
- If user requests PDF: render via `gt::gtsave(as_gt(tbl), "file.pdf")`

### Figures: PNG (default)
- Generated via `ggplot2::ggsave("file.png", dpi = 300, width = 10, height = 7)`
- HD resolution (300 DPI)
- If user requests PDF: `ggsave("file.pdf")`
- If user requests SVG: `ggsave("file.svg")`

### Listings: HTML (default)
- Generated via `gt::gtsave(tbl, "file.html")`
- Patient-level data formatted with gt

## Supplementary context

If mock shells alone are insufficient, the skill may also read:
- **Trial metadata JSON** for study design context
- **ADaM spec** (from `sdtm-to-adam`) for variable definitions
- **Protocol/SAP PDFs** for detailed statistical methodology

## Reference files

- `references/tlg-programming-guide.md` — gtsummary/gt code patterns for common table types, ggplot2 patterns for common figure types, listing patterns.
- `references/statistical-methods-guide.md` — R implementations of ANCOVA, ANOVA, MMRM, Fisher's exact, CMH, KM, Cox regression, and dose-response testing. Includes emmeans usage for LS means and pairwise comparisons.
