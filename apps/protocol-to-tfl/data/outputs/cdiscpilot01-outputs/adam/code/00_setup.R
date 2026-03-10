# ============================================================================
# Name: 00_setup.R
# Description: Shared configuration and helper functions for ADaM generation
# Study: CDISCPILOT01 - Xanomeline TTS in Alzheimer's Disease
# ============================================================================

.libPaths(c(
  "/Library/Frameworks/R.framework/Versions/4.4-arm64/Resources/dev_libraries",
  .libPaths()
))

library(admiral)
library(dplyr, warn.conflicts = FALSE)
library(tidyr)
library(lubridate)
library(stringr)
library(haven)
library(rlang)

# ---- Paths ----
sdtm_dir <- "/Users/vedha/Repo/protocol-to-tfl/test-docs/cdiscpilot01/sdtm"
adam_dir  <- "/Users/vedha/Repo/protocol-to-tfl/outputs/cdiscpilot01/adam/data"
dir.create(adam_dir, recursive = TRUE, showWarnings = FALSE)

# ---- Helper: Read SDTM domain ----
read_sdtm <- function(domain, sdtm_path = sdtm_dir) {
  domain_lower <- tolower(domain)
  json_path <- file.path(sdtm_path, paste0(domain_lower, ".json"))
  xpt_path  <- file.path(sdtm_path, paste0(domain_lower, ".xpt"))
  sas_path  <- file.path(sdtm_path, paste0(domain_lower, ".sas7bdat"))

  if (file.exists(xpt_path)) {
    df <- haven::read_xpt(xpt_path)
  } else if (file.exists(json_path)) {
    df <- datasetjson::read_dataset_json(json_path)
  } else if (file.exists(sas_path)) {
    df <- haven::read_sas(sas_path)
  } else {
    stop(paste("SDTM domain", domain, "not found in", sdtm_path))
  }

  names(df) <- toupper(names(df))
  # Strip haven labelled types to plain character/numeric
  df <- df %>%
    mutate(across(where(haven::is.labelled), ~ {
      if (is.numeric(vctrs::vec_data(.x))) as.numeric(.x) else as.character(.x)
    })) %>%
    mutate(across(where(is.character), ~ trimws(.x)))
  df
}

# ---- Helper: Read previously generated ADaM ----
read_adam <- function(dataset, adam_path = adam_dir) {
  csv_path <- file.path(adam_path, paste0(tolower(dataset), ".csv"))
  if (!file.exists(csv_path)) stop(paste("ADaM dataset", dataset, "not found at", csv_path))
  read.csv(csv_path, stringsAsFactors = FALSE, colClasses = "character") %>%
    mutate(across(everything(), ~ trimws(.x)))
}

# ---- Helper: Export ADaM dataset ----
export_adam <- function(dataset, name, adam_path = adam_dir) {
  csv_path <- file.path(adam_path, paste0(tolower(name), ".csv"))
  write.csv(dataset, csv_path, row.names = FALSE, na = "")
  cat("Exported", name, ":", nrow(dataset), "rows,", ncol(dataset), "cols ->", csv_path, "\n")

  # Also try Dataset-JSON export
  tryCatch({
    json_path <- file.path(adam_path, paste0(tolower(name), ".json"))
    # Ensure all columns are basic types for JSON serialization
    df_export <- dataset
    for (col in names(df_export)) {
      if (inherits(df_export[[col]], "Date")) {
        df_export[[col]] <- as.character(df_export[[col]])
      }
    }
    jsonlite::write_json(df_export, json_path, pretty = TRUE, na = "null")
    cat("  JSON export:", json_path, "\n")
  }, error = function(e) {
    cat("  JSON export failed:", e$message, " (CSV available)\n")
  })
}

# ---- Helper: Combine supplemental qualifiers ----
combine_supp <- function(parent, supp) {
  if (is.null(supp) || nrow(supp) == 0) return(parent)

  id_var <- unique(supp$IDVAR)[1]

  supp_wide <- supp %>%
    select(STUDYID, USUBJID, IDVARVAL, QNAM, QVAL) %>%
    pivot_wider(names_from = QNAM, values_from = QVAL)

  parent %>%
    mutate(.JOIN_KEY = as.character(.data[[id_var]])) %>%
    left_join(supp_wide, by = c("STUDYID", "USUBJID", ".JOIN_KEY" = "IDVARVAL")) %>%
    select(-`.JOIN_KEY`)
}

cat("Setup complete. SDTM dir:", sdtm_dir, "\nADaM dir:", adam_dir, "\n")
