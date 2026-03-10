# run_all.R — Master execution script for all TLGs
cat("============================================================\n")
cat("  CDISCPILOT01 TLG Generation — Run All\n")
cat("============================================================\n\n")

scripts <- c(
  "t_01_pop.R", "t_02_eos.R", "t_03_demo.R", "t_04_site.R",
  "t_05_adas_wk24.R", "t_06_cibic_wk24.R", "t_07_adas_wk8.R",
  "t_08_cibic_wk8.R", "t_09_adas_wk16.R", "t_10_cibic_wk16.R",
  "t_11_adas_comp.R", "t_12_adas_male.R", "t_13_adas_female.R",
  "t_14_adas_time.R", "t_15_adas_mmrm.R", "t_16_npix.R",
  "t_17_expo.R", "t_18_teae.R", "t_19_sae.R", "t_20_lab_summ.R",
  "t_21_lab_abn.R", "t_22_lab_abn_cs.R", "t_23_lab_shift_visit.R",
  "t_24_lab_shift_overall.R", "t_25_hyslaw.R", "t_26_vs_summ.R",
  "t_27_vs_chg.R", "t_28_wt_chg.R", "t_29_cm.R",
  "f_01_km_derm.R"
)

results <- data.frame(script = character(), status = character(),
                       time_sec = numeric(), error = character(),
                       stringsAsFactors = FALSE)

for (s in scripts) {
  cat(sprintf("\n--- Running %s ---\n", s))
  t0 <- proc.time()["elapsed"]
  status <- tryCatch({
    source(s, local = new.env(parent = globalenv()))
    "SUCCESS"
  }, error = function(e) {
    cat("  ERROR:", conditionMessage(e), "\n")
    conditionMessage(e)
  })
  elapsed <- round(proc.time()["elapsed"] - t0, 1)

  if (status == "SUCCESS") {
    results <- rbind(results, data.frame(script = s, status = "OK",
                                          time_sec = elapsed, error = "",
                                          stringsAsFactors = FALSE))
    cat(sprintf("  OK (%.1fs)\n", elapsed))
  } else {
    results <- rbind(results, data.frame(script = s, status = "FAIL",
                                          time_sec = elapsed, error = status,
                                          stringsAsFactors = FALSE))
    cat(sprintf("  FAIL (%.1fs)\n", elapsed))
  }
}

cat("\n============================================================\n")
cat("  SUMMARY\n")
cat("============================================================\n")
cat(sprintf("  Total: %d | OK: %d | FAIL: %d\n",
            nrow(results), sum(results$status == "OK"), sum(results$status == "FAIL")))
if (any(results$status == "FAIL")) {
  cat("\n  Failed scripts:\n")
  fails <- results[results$status == "FAIL", ]
  for (i in seq_len(nrow(fails))) {
    cat(sprintf("    %s: %s\n", fails$script[i], fails$error[i]))
  }
}

# Write log
writeLines(capture.output(print(results, row.names = FALSE)),
           file.path(dirname(getwd()), "outputs", "run_log.txt"))
cat("\nLog written to outputs/run_log.txt\n")
