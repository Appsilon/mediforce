# T-3: Demographics and Baseline | Source: ADSL | Population: ITT
source("00_setup.R")
cat("=== T-3: Summary of Demographic and Baseline Characteristics ===\n")

adsl <- read_adam("adsl") %>%
  filter(ITTFL == "Y") %>%
  trt_factor() %>%
  mutate(across(c(AGE, WEIGHTBL, HEIGHTBL, BMIBL, MMSETOT, DURDIS, EDUCLVL), as.numeric),
         AGEGR1 = factor(AGEGR1, levels = c("<65", "65-80", ">80")),
         BMIBLGR1 = factor(BMIBLGR1, levels = c("<25", "25-<30", ">=30")))

tbl <- adsl %>%
  tbl_summary(
    by = TRT01P,
    include = c(AGE, AGEGR1, SEX, RACE, MMSETOT, DURDIS, EDUCLVL,
                WEIGHTBL, HEIGHTBL, BMIBL, BMIBLGR1),
    label = list(AGE ~ "Age (years)", AGEGR1 ~ "Age category, n (%)",
                 SEX ~ "Sex, n (%)", RACE ~ "Race, n (%)",
                 MMSETOT ~ "Mini-Mental State (MMSE)",
                 DURDIS ~ "Duration of disease (months)",
                 EDUCLVL ~ "Years of education",
                 WEIGHTBL ~ "Weight (kg)", HEIGHTBL ~ "Height (cm)",
                 BMIBL ~ "BMI (kg/m2)", BMIBLGR1 ~ "BMI category, n (%)"),
    statistic = list(all_continuous() ~ "{mean} ({sd})",
                     all_categorical() ~ "{n} ({p}%)"),
    digits = list(all_continuous() ~ c(1, 2)), missing = "no"
  ) %>%
  add_overall() %>%
  add_p(test = list(all_continuous() ~ "aov",
                    all_categorical() ~ "chisq.test")) %>%
  modify_caption("**Table T-3: Summary of Demographic and Baseline Characteristics**<br>Protocol: CDISCPILOT01 | Population: Intent-to-Treat")

save_table(tbl, "t_03_demo")
