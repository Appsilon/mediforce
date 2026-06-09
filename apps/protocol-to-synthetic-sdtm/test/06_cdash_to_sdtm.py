#!/usr/bin/env python3
"""Tabulate the synthetic CDASH datasets into SDTMIG 3.4 datasets for CORE validation.

CORE (the CDISC Rules Engine) publishes conformance rules for SDTMIG/SENDIG/ADaMIG/TIG/USDM —
*not* CDASH (CDASH is a collection standard with no published CORE rule catalog). Our CDASH spec
already recorded each field's SDTM mapping target, so this step does the standard CDASH->SDTM
tabulation: add SDTM identifiers/timing (STUDYID, DOMAIN, USUBJID, --SEQ, VISITNUM, --DTC),
split findings into --TESTCD/--TEST/--ORRES/--STRESC/--STRESN, and derive DM reference dates.

Inputs : 03_synthetic_cdash/*.csv
Outputs: 06_sdtm/datasets/<domain>.csv (+ _datasets.csv, _variables.csv for CORE CSV input)
"""
from __future__ import annotations

import csv
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).parent
CD = HERE / "03_synthetic_cdash"
OUT = HERE / "06_sdtm/datasets"
OUT.mkdir(parents=True, exist_ok=True)
STUDYID = "D6470C00005"


def read(name):
    with (CD / f"{name}.csv").open() as f:
        return list(csv.DictReader(f))


def usubjid(r):
    return f"{STUDYID}-{r['SUBJID']}"


VISITNUM = {"SCREENING": 1, "DAY 1 (TP1)": 3, "DAY 4 (TP1)": 3, "DAY 26 (TP2)": 5,
            "DAY 31 (TP2)": 5, "FOLLOW-UP": 6}
VS_CD = {"Systolic Blood Pressure": "SYSBP", "Diastolic Blood Pressure": "DIABP",
         "Pulse Rate": "PULSE", "Temperature": "TEMP", "Height": "HEIGHT", "Weight": "WEIGHT"}
LB_CD = {"Glucose": ("GLUC", "Glucose"), "Insulin": ("INSULIN", "Insulin"),
         "C-Peptide": ("CPEPTIDE", "C-Peptide"), "Hemoglobin A1C": ("HBA1C", "Hemoglobin A1C"),
         "Cholesterol": ("CHOL", "Cholesterol"), "Triglycerides": ("TRIG", "Triglycerides"),
         "Cholesterol, HDL": ("HDL", "HDL Cholesterol"), "Sodium": ("SODIUM", "Sodium"),
         "Potassium": ("K", "Potassium"), "Cortisol": ("CORTISOL", "Cortisol"),
         "Hemoglobin": ("HGB", "Hemoglobin"), "Hematocrit": ("HCT", "Hematocrit"),
         "Potassium, Urine": ("K", "Potassium"), "Sodium, Urine": ("SODIUM", "Sodium")}


def num(v):
    try:
        float(v)
        return v
    except (TypeError, ValueError):
        return ""


EPOCH_OF = {"SCREENING": "SCREENING", "DAY 1 (TP1)": "TREATMENT", "DAY 4 (TP1)": "TREATMENT",
            "DAY 26 (TP2)": "TREATMENT", "DAY 31 (TP2)": "TREATMENT", "FOLLOW-UP": "FOLLOW-UP"}


def study_day(dtc: str, rfst: str):
    """SDTM --DY = days from RFSTDTC (no day 0: dates on/after ref are +1)."""
    if not dtc or not rfst:
        return ""
    try:
        from datetime import date as _d
        d0 = _d.fromisoformat(rfst[:10])
        d1 = _d.fromisoformat(dtc[:10])
    except ValueError:
        return ""
    delta = (d1 - d0).days
    return delta + 1 if delta >= 0 else delta


def seq_by_subject(rows):
    counters = defaultdict(int)
    for r in rows:
        counters[r["USUBJID"]] += 1
        r["_seq"] = counters[r["USUBJID"]]
    return rows


def write(domain, header, rows):
    with (OUT / f"{domain.lower()}.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        for r in rows:
            w.writerow([r.get(h, "") for h in header])
    return len(rows)


datasets, variables, counts = [], [], {}


def emit(domain, label, header, rows):
    counts[domain] = write(domain, header, rows)
    datasets.append((domain.lower(), label))
    for v in header:
        variables.append((domain.lower(), v, VAR_LABELS.get(v, v), "Num" if v in NUM_VARS else "Char",
                          8 if v in NUM_VARS else 200))


NUM_VARS = {"VSSEQ", "VSORRES", "VSSTRESN", "VISITNUM", "VSDY", "LBSEQ", "LBORRES", "LBSTRESN",
            "LBORNRLO", "LBORNRHI", "LBDY", "EXSEQ", "EXDOSE", "EXSTDY", "EXENDY", "CMSEQ",
            "CMDOSE", "CMSTDY", "AESEQ", "AESTDY", "AEENDY", "DSSEQ", "DSSTDY", "MHSEQ", "MHSTDY",
            "AGE"}
VAR_LABELS = {
    "STUDYID": "Study Identifier", "DOMAIN": "Domain Abbreviation",
    "USUBJID": "Unique Subject Identifier", "SUBJID": "Subject Identifier for the Study",
    "SITEID": "Study Site Identifier", "RFSTDTC": "Subject Reference Start Date/Time",
    "RFENDTC": "Subject Reference End Date/Time", "BRTHDTC": "Date/Time of Birth",
    "AGE": "Age", "AGEU": "Age Units", "SEX": "Sex", "RACE": "Race", "ETHNIC": "Ethnicity",
    "ARMCD": "Planned Arm Code", "ARM": "Description of Planned Arm",
    "ACTARMCD": "Actual Arm Code", "ACTARM": "Description of Actual Arm", "COUNTRY": "Country",
    "VSSEQ": "Sequence Number", "VSTESTCD": "Vital Signs Test Short Name",
    "VSTEST": "Vital Signs Test Name", "VSORRES": "Result or Finding in Original Units",
    "VSORRESU": "Original Units", "VSSTRESC": "Character Result/Finding in Std Format",
    "VSSTRESN": "Numeric Result/Finding in Standard Units", "VSSTRESU": "Standard Units",
    "VSPOS": "Vital Signs Position of Subject", "VSDTC": "Date/Time of Measurements",
    "VISITNUM": "Visit Number", "VISIT": "Visit Name",
    "LBSEQ": "Sequence Number", "LBTESTCD": "Lab Test or Examination Short Name",
    "LBTEST": "Lab Test or Examination Name", "LBCAT": "Category for Lab Test",
    "LBORRES": "Result or Finding in Original Units", "LBORRESU": "Original Units",
    "LBSTRESC": "Character Result/Finding in Std Format",
    "LBSTRESN": "Numeric Result/Finding in Standard Units", "LBSTRESU": "Standard Units",
    "LBORNRLO": "Reference Range Lower Limit", "LBORNRHI": "Reference Range Upper Limit",
    "LBSPEC": "Specimen Type", "LBFAST": "Fasting Status", "LBDTC": "Date/Time of Specimen Collection",
    "EXSEQ": "Sequence Number", "EXTRT": "Name of Treatment", "EXDOSE": "Dose",
    "EXDOSU": "Dose Units", "EXROUTE": "Route of Administration",
    "EXSTDTC": "Start Date/Time of Treatment", "EXENDTC": "End Date/Time of Treatment",
    "CMSEQ": "Sequence Number", "CMTRT": "Reported Name of Drug, Med, or Therapy",
    "CMDOSE": "Dose per Administration", "CMDOSU": "Dose Units",
    "CMROUTE": "Route of Administration", "CMINDC": "Indication", "CMSTDTC": "Start Date/Time",
    "AESEQ": "Sequence Number", "AETERM": "Reported Term for the Adverse Event",
    "AESTDTC": "Start Date/Time of Adverse Event", "AEENDTC": "End Date/Time of Adverse Event",
    "AESEV": "Severity/Intensity", "AESER": "Serious Event", "AEREL": "Causality",
    "AEOUT": "Outcome of Adverse Event", "AEACN": "Action Taken with Study Treatment",
    "DSSEQ": "Sequence Number", "DSCAT": "Category for Disposition Event",
    "DSTERM": "Reported Term for the Disposition Event", "DSDECOD": "Standardized Disposition Term",
    "DSSTDTC": "Start Date/Time of Disposition Event", "EPOCH": "Epoch",
    "MHSEQ": "Sequence Number", "MHTERM": "Reported Term for the Medical History",
    "MHCAT": "Category for Medical History", "MHSTDTC": "Start Date/Time of History Event",
    "EPOCH": "Epoch", "VSDY": "Study Day of Vital Signs", "LBDY": "Study Day of Specimen Collection",
    "EXSTDY": "Study Day of Start of Treatment", "EXENDY": "Study Day of End of Treatment",
    "AESTDY": "Study Day of Start of Adverse Event", "AEENDY": "Study Day of End of Adverse Event",
    "CMSTDY": "Study Day of Start of Medication", "DSSTDY": "Study Day of Start of Disposition Event",
    "MHSTDY": "Study Day of Start of Medical History Event",
}

# ---- reference dates from EX (first/last dose per subject) ----------------------------------
ex_raw = read("EX")
rfst, rfen = {}, {}
for r in ex_raw:
    u = usubjid(r)
    rfst[u] = min(rfst.get(u, "9999"), r["EXSTDAT"])
    rfen[u] = max(rfen.get(u, "0000"), r["EXENDAT"])

ARMCD = {"Cohort 1": "COHORT1", "Cohort 2": "COHORT2", "Cohort 3": "COHORT3"}
# subject -> cohort (from DM is absent; recover from EX dose? use CM? we stored cohort only in gen)
# Reconstruct cohort from EX treatments per subject.
cohort_of = {}
for r in ex_raw:
    u = usubjid(r)
    if "72" in r["EXDOSE"] or r["EXTRT"] == "AZD9567" and r["EXDOSE"] == "72":
        cohort_of[u] = "Cohort 1"
for r in ex_raw:
    u = usubjid(r)
    cohort_of.setdefault(u, None)
# Better: infer by dose set
doses = defaultdict(set)
for r in ex_raw:
    doses[usubjid(r)].add((r["EXTRT"], r["EXDOSE"]))
for u, ds in doses.items():
    s = {d for _, d in ds}
    if "72" in s:
        cohort_of[u] = "Cohort 1"
    elif "40" in s and "20" in s:
        cohort_of[u] = "Cohort 2"
    elif "" in s or "5" in s:
        cohort_of[u] = "Cohort 3"
    else:
        cohort_of[u] = "Cohort 1"

# ---- DM --------------------------------------------------------------------------------------
dm_rows = []
for r in read("DM"):
    u = usubjid(r)
    coh = cohort_of.get(u, "Cohort 1")
    dm_rows.append({"STUDYID": STUDYID, "DOMAIN": "DM", "USUBJID": u, "SUBJID": r["SUBJID"],
                    "SITEID": r["SITEID"], "RFSTDTC": rfst.get(u, ""), "RFENDTC": rfen.get(u, ""),
                    "RFXSTDTC": rfst.get(u, ""), "RFXENDTC": rfen.get(u, ""),
                    "BRTHDTC": r["BRTHDAT"], "AGE": r["AGE"], "AGEU": r["AGEU"], "SEX": r["SEX"],
                    "RACE": r["RACE"], "ETHNIC": r["ETHNIC"], "ARMCD": ARMCD[coh], "ARM": coh,
                    "ACTARMCD": ARMCD[coh], "ACTARM": coh, "COUNTRY": "USA"})
emit("DM", "Demographics",
     ["STUDYID", "DOMAIN", "USUBJID", "SUBJID", "RFSTDTC", "RFENDTC", "RFXSTDTC", "RFXENDTC",
      "SITEID", "BRTHDTC", "AGE", "AGEU", "SEX", "RACE", "ETHNIC", "ARMCD", "ARM", "ACTARMCD",
      "ACTARM", "COUNTRY"], dm_rows)

# ---- VS --------------------------------------------------------------------------------------
vs_rows = []
for r in read("VS"):
    u = usubjid(r)
    tc = VS_CD.get(r["VSTEST"], r["VSTEST"][:8].upper())
    vs_rows.append({"STUDYID": STUDYID, "DOMAIN": "VS", "USUBJID": u, "VSTESTCD": tc,
                    "VSTEST": r["VSTEST"], "VSPOS": r["VSPOS"], "VSORRES": r["VSORRES"],
                    "VSORRESU": r["VSORRESU"], "VSSTRESC": r["VSORRES"], "VSSTRESN": num(r["VSORRES"]),
                    "VSSTRESU": r["VSORRESU"], "VSDTC": r["VSDAT"],
                    "VSDY": study_day(r["VSDAT"], rfst.get(u, "")), "EPOCH": EPOCH_OF.get(r["VISIT"], ""),
                    "VISIT": r["VISIT"], "VISITNUM": VISITNUM.get(r["VISIT"], "")})
seq_by_subject(vs_rows)
for r in vs_rows:
    r["VSSEQ"] = r["_seq"]
emit("VS", "Vital Signs",
     ["STUDYID", "DOMAIN", "USUBJID", "VSSEQ", "VSTESTCD", "VSTEST", "VSPOS", "VSORRES", "VSORRESU",
      "VSSTRESC", "VSSTRESN", "VSSTRESU", "VISITNUM", "VISIT", "EPOCH", "VSDTC", "VSDY"], vs_rows)

# ---- LB --------------------------------------------------------------------------------------
lb_rows = []
for r in read("LB"):
    u = usubjid(r)
    tc, tname = LB_CD.get(r["LBTEST"], (r["LBTEST"][:8].upper(), r["LBTEST"]))
    spec = "URINE" if "Urine" in r["LBTEST"] else "SERUM"
    lb_rows.append({"STUDYID": STUDYID, "DOMAIN": "LB", "USUBJID": u, "LBTESTCD": tc, "LBTEST": tname,
                    "LBCAT": r["LBCAT"], "LBSPEC": spec, "LBORRES": r["LBORRES"], "LBORRESU": r["LBORRESU"],
                    "LBSTRESC": r["LBORRES"], "LBSTRESN": num(r["LBORRES"]), "LBSTRESU": r["LBORRESU"],
                    "LBORNRLO": r["LBORNRLO"], "LBORNRHI": r["LBORNRHI"], "LBFAST": r["LBFAST"],
                    "LBDTC": r["LBDAT"], "LBDY": study_day(r["LBDAT"], rfst.get(u, "")),
                    "EPOCH": EPOCH_OF.get(r["VISIT"], ""), "VISIT": r["VISIT"],
                    "VISITNUM": VISITNUM.get(r["VISIT"], "")})
seq_by_subject(lb_rows)
for r in lb_rows:
    r["LBSEQ"] = r["_seq"]
emit("LB", "Laboratory Test Results",
     ["STUDYID", "DOMAIN", "USUBJID", "LBSEQ", "LBTESTCD", "LBTEST", "LBCAT", "LBSPEC", "LBORRES",
      "LBORRESU", "LBSTRESC", "LBSTRESN", "LBSTRESU", "LBORNRLO", "LBORNRHI", "LBFAST",
      "VISITNUM", "VISIT", "EPOCH", "LBDTC", "LBDY"], lb_rows)

# ---- EX --------------------------------------------------------------------------------------
ex_rows = []
for r in ex_raw:
    u = usubjid(r)
    ex_rows.append({"STUDYID": STUDYID, "DOMAIN": "EX", "USUBJID": u, "EXTRT": r["EXTRT"].upper(),
                    "EXDOSE": r["EXDOSE"], "EXDOSU": r["EXDOSU"], "EXROUTE": r["EXROUTE"],
                    "EXSTDTC": r["EXSTDAT"], "EXENDTC": r["EXENDAT"],
                    "EXSTDY": study_day(r["EXSTDAT"], rfst.get(u, "")),
                    "EXENDY": study_day(r["EXENDAT"], rfst.get(u, "")),
                    "EPOCH": EPOCH_OF.get(r["VISIT"], "TREATMENT"), "VISIT": r["VISIT"],
                    "VISITNUM": VISITNUM.get(r["VISIT"], "")})
seq_by_subject(ex_rows)
for r in ex_rows:
    r["EXSEQ"] = r["_seq"]
emit("EX", "Exposure",
     ["STUDYID", "DOMAIN", "USUBJID", "EXSEQ", "EXTRT", "EXDOSE", "EXDOSU", "EXROUTE",
      "VISITNUM", "VISIT", "EPOCH", "EXSTDTC", "EXENDTC", "EXSTDY", "EXENDY"], ex_rows)

# ---- CM --------------------------------------------------------------------------------------
cm_rows = []
for r in read("CM"):
    u = usubjid(r)
    cm_rows.append({"STUDYID": STUDYID, "DOMAIN": "CM", "USUBJID": u, "CMTRT": r["CMTRT"],
                    "CMDOSE": r["CMDOSE"], "CMDOSU": r["CMDOSU"], "CMROUTE": r["CMROUTE"],
                    "CMINDC": r["CMINDC"], "CMSTDTC": r["CMSTDAT"],
                    "CMSTDY": study_day(r["CMSTDAT"], rfst.get(u, "")), "EPOCH": "TREATMENT"})
seq_by_subject(cm_rows)
for r in cm_rows:
    r["CMSEQ"] = r["_seq"]
emit("CM", "Concomitant/Prior Medications",
     ["STUDYID", "DOMAIN", "USUBJID", "CMSEQ", "CMTRT", "CMDOSE", "CMDOSU", "CMROUTE", "CMINDC",
      "EPOCH", "CMSTDTC", "CMSTDY"], cm_rows)

# ---- AE --------------------------------------------------------------------------------------
ae_rows = []
for r in read("AE"):
    u = usubjid(r)
    ae_rows.append({"STUDYID": STUDYID, "DOMAIN": "AE", "USUBJID": u, "AETERM": r["AETERM"],
                    "AESTDTC": r["AESTDAT"], "AEENDTC": r["AEENDAT"], "AESEV": r["AESEV"],
                    "AESER": r["AESER"], "AEREL": r["AEREL"], "AEOUT": r["AEOUT"], "AEACN": r["AEACN"],
                    "AESTDY": study_day(r["AESTDAT"], rfst.get(u, "")),
                    "AEENDY": study_day(r["AEENDAT"], rfst.get(u, "")), "EPOCH": "TREATMENT"})
seq_by_subject(ae_rows)
for r in ae_rows:
    r["AESEQ"] = r["_seq"]
emit("AE", "Adverse Events",
     ["STUDYID", "DOMAIN", "USUBJID", "AESEQ", "AETERM", "AESEV", "AESER", "AEREL", "AEOUT", "AEACN",
      "EPOCH", "AESTDTC", "AEENDTC", "AESTDY", "AEENDY"], ae_rows)

# ---- DS --------------------------------------------------------------------------------------
ds_rows = []
for r in read("DS"):
    u = usubjid(r)
    ds_rows.append({"STUDYID": STUDYID, "DOMAIN": "DS", "USUBJID": u, "DSCAT": r["DSCAT"],
                    "DSTERM": r["DSTERM"], "DSDECOD": r["DSDECOD"], "DSSTDTC": r["DSSTDAT"],
                    "DSSTDY": study_day(r["DSSTDAT"], rfst.get(u, "")),
                    "EPOCH": "FOLLOW-UP" if r["DSDECOD"] == "COMPLETED" else "TREATMENT"})
seq_by_subject(ds_rows)
for r in ds_rows:
    r["DSSEQ"] = r["_seq"]
emit("DS", "Disposition",
     ["STUDYID", "DOMAIN", "USUBJID", "DSSEQ", "DSCAT", "DSTERM", "DSDECOD", "EPOCH", "DSSTDTC",
      "DSSTDY"], ds_rows)

# ---- MH --------------------------------------------------------------------------------------
mh_rows = []
for r in read("MH"):
    u = usubjid(r)
    mh_rows.append({"STUDYID": STUDYID, "DOMAIN": "MH", "USUBJID": u, "MHTERM": r["MHTERM"],
                    "MHCAT": r["MHCAT"], "MHSTDTC": r["MHSTDAT"],
                    "MHSTDY": study_day(r["MHSTDAT"], rfst.get(u, "")), "EPOCH": "SCREENING"})
seq_by_subject(mh_rows)
for r in mh_rows:
    r["MHSEQ"] = r["_seq"]
emit("MH", "Medical History",
     ["STUDYID", "DOMAIN", "USUBJID", "MHSEQ", "MHTERM", "MHCAT", "EPOCH", "MHSTDTC", "MHSTDY"], mh_rows)

# ---- CORE CSV-input metadata -----------------------------------------------------------------
with (OUT / "_datasets.csv").open("w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["Filename", "Label"])
    for fn, lbl in datasets:
        w.writerow([fn, lbl])
with (OUT / "_variables.csv").open("w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["dataset", "variable", "label", "type", "length"])
    for row in variables:
        w.writerow(row)

print(f"Tabulated {len(counts)} SDTM datasets -> {OUT}")
for d, n in counts.items():
    print(f"  {d}: {n} rows")
