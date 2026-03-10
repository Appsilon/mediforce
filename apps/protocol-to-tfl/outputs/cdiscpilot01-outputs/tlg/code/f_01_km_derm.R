# F-1: KM Curve for Time to First Dermatological Event | Source: ADTTE | Pop: Safety
source("00_setup.R")
cat("=== F-1: KM Curve - Time to First Dermatological Event ===\n")

adtte <- read_adam("adtte") %>%
  filter(SAFFL == "Y", PARAMCD == "TTDERM") %>%
  mutate(AVAL = as.numeric(AVAL), CNSR = as.numeric(CNSR)) %>%
  trt_factor()

# Fit KM model
surv_fit <- survfit(Surv(AVAL, 1 - CNSR) ~ TRT01P, data = adtte)

# Plot using ggsurvfit (without risktable to avoid version issues)
p <- ggsurvfit(surv_fit) +
  add_censor_mark(size = 2) +
  labs(
    title = "Kaplan-Meier Curve: Time to First Dermatological Adverse Event",
    subtitle = "Population: Safety",
    x = "Time (days)",
    y = "Event-Free Probability",
    caption = "Source: ADTTE (PARAMCD=TTDERM)"
  ) +
  scale_color_manual(values = c("#1b9e77", "#d95f02", "#7570b3")) +
  study_theme() +
  theme(legend.position = "bottom")

save_figure(p, "f_01_km_derm", w = 10, h = 7)
