#!/usr/bin/env python3
"""Stage 5 — generate synthetic SDTMIG 3.4 datasets directly (SDTM-first).

Deterministic + seeded (RANDOM_SEED=1234). This merges the former two-step path
(synthetic CDASH population -> CDASH->SDTM tabulation) into one: the synthetic values are
generated with the exact same seeded RNG draw sequence as before (so the output is byte-identical
to the proven 06_sdtm oracle), held in memory keyed by each domain's collection header, then
tabulated into proper SDTM (USUBJID, --SEQ, DOMAIN, --TESTCD/--TEST split,
--ORRES/--STRESC/--STRESN, --DTC, VISITNUM, EPOCH, --DY, RFSTDTC/RFXSTDTC derived from EX).

Coded values are sampled from the Controlled Terminology pinned in Stage 4
(02_sdtm_spec/ct_cache.json). The SDTM CSVs stay clean for CORE (no SRCACT/SRCPAGE columns);
representative cell-level provenance is written to a separate lineage.json sidecar.

Inputs : 01_usdm/soa.json, 02_sdtm_spec/ct_cache.json, 02_sdtm_spec/sdtm_spec.json
Outputs: 03_synthetic_sdtm/<domain>.csv  (one SDTM dataset per populated domain, lowercase)
         03_synthetic_sdtm/_datasets.csv, _variables.csv  (CORE CSV-input metadata)
         03_synthetic_sdtm/lineage.json
         03_synthetic_sdtm/datasets_summary.json
         03_synthetic_sdtm/validation_report.json is written by 04_validate.py
"""
from __future__ import annotations

import csv
import json
import random
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).parent
SEED = 1234
N_SUBJECTS = 40
STUDYID = "D6470C00005"

SOA = json.loads((HERE / "01_usdm/soa.json").read_text())
SPEC = json.loads((HERE / "02_sdtm_spec/sdtm_spec.json").read_text())
CT = json.loads((HERE / "02_sdtm_spec/ct_cache.json").read_text())
OUT = HERE / "03_synthetic_sdtm"
OUT.mkdir(parents=True, exist_ok=True)

rng = random.Random(SEED)


def ct_values(ncit: str) -> list[str]:
    rec = CT.get(ncit)
    return [t["submissionValue"] for t in rec["terms"]] if rec else []


# activity -> page, for provenance
ACT_PAGE = {a["id"]: a["provenance"]["protocolPage"] for a in SOA["activities"]}
ACT_BC = {a["id"]: a["biomedicalConceptNcit"] for a in SOA["activities"]}
# Group every SOA activity by its targetSdtmDomain (== SDTM domain), so first_act() resolves
# the same activity id for every domain the generation body touches — including IE and EG, which
# consume rng draws / emit lineage even though they are not tabulated as SDTM. The SDTM spec lists
# only the 8 populated domains, so derive the full mapping from the SoA directly.
DOMAIN_ACTS: dict[str, list[dict]] = {}
for a in SOA["activities"]:
    DOMAIN_ACTS.setdefault(a["targetSdtmDomain"], []).append(
        {"activityId": a["id"], "activityName": a["name"],
         "bcNcit": a["biomedicalConceptNcit"], "protocolPage": a["provenance"]["protocolPage"]})


def first_act(dom: str) -> str:
    a = DOMAIN_ACTS.get(dom)
    return a[0]["activityId"] if a else ""


# ---- subject backbone (cohorts + crossover sequences) ---------------------------------------
SITES = ["0001", "0002", "0003"]
COHORTS = [("Cohort 1", 24, ("AZD9567 72 mg", "Prednisolone 40 mg")),
           ("Cohort 2", 8, ("AZD9567 40 mg", "Prednisolone 20 mg")),
           ("Cohort 3", 8, ("Placebo", "Prednisolone 5 mg"))]
RACES = ["WHITE", "BLACK OR AFRICAN AMERICAN", "ASIAN", "AMERICAN INDIAN OR ALASKA NATIVE"]
ETHNIC = ["HISPANIC OR LATINO", "NOT HISPANIC OR LATINO"]
SEX = ct_values("C66731") or ["M", "F"]
SEX = [s for s in SEX if s in ("M", "F")]

study_start = date(2020, 11, 26)
subjects = []
sid_n = 0
for cohort, n, (trtA, trtB) in COHORTS:
    for _ in range(n):
        sid_n += 1
        subjid = f"{sid_n:04d}"
        seq = rng.choice(["AB", "BA"])
        scr = study_start + timedelta(days=rng.randint(0, 120))
        day1 = scr + timedelta(days=rng.randint(10, 14))  # screening <=14d before IMP
        sex = rng.choice(SEX)
        subjects.append({
            "SUBJID": subjid, "SITEID": rng.choice(SITES), "cohort": cohort,
            "seq": seq, "trtA": trtA, "trtB": trtB, "sex": sex,
            "age": rng.randint(40, 75), "scr": scr, "day1": day1,
            "height": round(rng.uniform(150, 190), 1),
            "weight": round(rng.uniform(60, 110), 1),
        })

# visit day offsets relative to Day 1 (TP1 first dose); (label, dayoffset)
VISITS = {
    "ENC_V1": ("SCREENING", -14), "ENC_V3": ("DAY 4 (TP1)", 4),
    "ENC_V5": ("DAY 31 (TP2)", 31), "ENC_V6": ("FOLLOW-UP", 61),
}


def vdate(s, enc):
    return (s["day1"] + timedelta(days=VISITS[enc][1])).isoformat()


def vlabel(enc):
    return VISITS[enc][0]


# In-memory CDASH datasets: cdash[dom] = list of dicts keyed by that domain's collection header.
cdash: dict[str, list[dict]] = {}
summary, lineage = {}, []


def collect(name, header, rows):
    # Stringify exactly as the CSV writer/reader round-trip would, so the in-memory CDASH rows are
    # byte-identical to what csv.DictReader produced in the former two-file pipeline.
    cdash[name] = [{h: ("" if v == "" else str(v)) for h, v in zip(header, r)} for r in rows]
    return len(rows)


def trace(dom, var, usubjid, value):
    a = first_act(dom)
    lineage.append({"domain": dom, "variable": var, "subjid": usubjid, "value": value,
                    "usdmActivityId": a, "biomedicalConceptNcit": ACT_BC.get(a),
                    "protocolPage": ACT_PAGE.get(a), "ctPackage": SPEC["ctPackage"],
                    "sdtmigVersion": SPEC["sdtmigVersion"]})


# ---- DM ------------------------------------------------------------------------------------
hdr = ["STUDYID", "SITEID", "SUBJID", "BRTHDAT", "AGE", "AGEU", "SEX", "RACE", "ETHNIC", "SRCACT", "SRCPAGE"]
rows = []
for s in subjects:
    brth = date(s["scr"].year - s["age"], rng.randint(1, 12), rng.randint(1, 28)).isoformat()
    race, eth = rng.choice(RACES), rng.choice(ETHNIC)
    rows.append([STUDYID, s["SITEID"], s["SUBJID"], brth, s["age"], "YEARS", s["sex"], race, eth,
                 first_act("DM"), ACT_PAGE[first_act("DM")]])
    trace("DM", "SEX", s["SUBJID"], s["sex"])
summary["DM"] = collect("DM", hdr, rows)

# ---- IE (criteria not met — a couple of documented exceptions) -----------------------------
hdr = ["STUDYID", "SITEID", "SUBJID", "IECAT", "IETESTCD", "IETEST", "IEORRES", "SRCACT", "SRCPAGE"]
rows = []
for s in rng.sample(subjects, 2):
    rows.append([STUDYID, s["SITEID"], s["SUBJID"], "INCLUSION", "INCL02",
                 "HbA1c within protocol range", "WAIVER GRANTED", first_act("IE"), ACT_PAGE[first_act("IE")]])
summary["IE"] = collect("IE", hdr, rows)

# ---- MH ------------------------------------------------------------------------------------
hdr = ["STUDYID", "SITEID", "SUBJID", "MHSEQ", "MHCAT", "MHTERM", "MHSTDAT", "MHONGO", "SRCACT", "SRCPAGE"]
COMORB = ["Hypertension", "Hypercholesterolaemia", "Obesity", "Osteoarthritis", "Gastro-oesophageal reflux disease"]
rows = []
for s in subjects:
    seqn = 1
    onset = date(s["scr"].year - rng.randint(1, 10), rng.randint(1, 12), rng.randint(1, 28)).isoformat()
    rows.append([STUDYID, s["SITEID"], s["SUBJID"], seqn, "GENERAL", "Type 2 diabetes mellitus",
                 onset, "Y", first_act("MH"), ACT_PAGE[first_act("MH")]])
    trace("MH", "MHTERM", s["SUBJID"], "Type 2 diabetes mellitus")
    for c in rng.sample(COMORB, rng.randint(0, 2)):
        seqn += 1
        rows.append([STUDYID, s["SITEID"], s["SUBJID"], seqn, "GENERAL", c,
                     date(s["scr"].year - rng.randint(1, 8), rng.randint(1, 12), rng.randint(1, 28)).isoformat(),
                     "Y", first_act("MH"), ACT_PAGE[first_act("MH")]])
summary["MH"] = collect("MH", hdr, rows)

# ---- VS ------------------------------------------------------------------------------------
hdr = ["STUDYID", "SITEID", "SUBJID", "VSSEQ", "VISIT", "VSDAT", "VSTPT", "VSTEST", "VSORRES",
       "VSORRESU", "VSPOS", "SRCACT", "SRCPAGE"]
POS = "SUPINE" if "SUPINE" not in ct_values("C71148") else "SUPINE"
vtests = [("Systolic Blood Pressure", lambda: rng.randint(105, 158), "mmHg"),
          ("Diastolic Blood Pressure", lambda: rng.randint(62, 96), "mmHg"),
          ("Pulse Rate", lambda: rng.randint(54, 92), "beats/min"),
          ("Temperature", lambda: round(rng.uniform(36.2, 37.4), 1), "C")]
rows = []
for s in subjects:
    seqn = 0
    for enc in ["ENC_V1", "ENC_V3", "ENC_V5", "ENC_V6"]:
        for tname, fn, unit in vtests:
            seqn += 1
            val = fn()
            rows.append([STUDYID, s["SITEID"], s["SUBJID"], seqn, vlabel(enc), vdate(s, enc),
                         "PRE-DOSE", tname, val, unit, "SUPINE", "ACT_VS", ACT_PAGE["ACT_VS"]])
        if enc == "ENC_V1":  # height/weight at screening
            seqn += 1
            rows.append([STUDYID, s["SITEID"], s["SUBJID"], seqn, vlabel(enc), vdate(s, enc),
                         "PRE-DOSE", "Height", s["height"], "cm", "STANDING", "ACT_HTWT", ACT_PAGE["ACT_HTWT"]])
            seqn += 1
            rows.append([STUDYID, s["SITEID"], s["SUBJID"], seqn, vlabel(enc), vdate(s, enc),
                         "PRE-DOSE", "Weight", s["weight"], "kg", "STANDING", "ACT_HTWT", ACT_PAGE["ACT_HTWT"]])
    trace("VS", "VSORRES(SBP)", s["SUBJID"], rows[-1][8])
summary["VS"] = collect("VS", hdr, rows)

# ---- EG ------------------------------------------------------------------------------------
hdr = ["STUDYID", "SITEID", "SUBJID", "EGSEQ", "VISIT", "EGDAT", "EGTEST", "EGORRES", "EGORRESU", "SRCACT", "SRCPAGE"]
egtests = [("QTcF Interval, Aggregate", lambda: rng.randint(380, 455), "ms"),
           ("Heart Rate", lambda: rng.randint(55, 90), "beats/min"),
           ("PR Interval, Aggregate", lambda: rng.randint(120, 200), "ms"),
           ("QRS Duration, Aggregate", lambda: rng.randint(80, 110), "ms")]
rows = []
for s in subjects:
    seqn = 0
    for enc in ["ENC_V1", "ENC_V3", "ENC_V5", "ENC_V6"]:
        for tname, fn, unit in egtests:
            seqn += 1
            rows.append([STUDYID, s["SITEID"], s["SUBJID"], seqn, vlabel(enc), vdate(s, enc),
                         tname, fn(), unit, "ACT_ECG", ACT_PAGE["ACT_ECG"]])
    trace("EG", "EGORRES(QTcF)", s["SUBJID"], rows[-4][7])
summary["EG"] = collect("EG", hdr, rows)

# ---- LB ------------------------------------------------------------------------------------
hdr = ["STUDYID", "SITEID", "SUBJID", "LBSEQ", "VISIT", "LBDAT", "LBCAT", "LBTEST", "LBORRES",
       "LBORRESU", "LBORNRLO", "LBORNRHI", "LBFAST", "SRCACT", "SRCPAGE"]
# (category, test, sampler, unit, low, high, fasting, source activity)
lbtests = [
    ("CHEMISTRY", "Glucose", lambda: round(rng.uniform(6.5, 12.0), 1), "mmol/L", 4.1, 5.9, "Y", "ACT_MMTT"),
    ("CHEMISTRY", "Insulin", lambda: round(rng.uniform(40, 160), 0), "pmol/L", 18, 173, "Y", "ACT_MMTT"),
    ("CHEMISTRY", "C-Peptide", lambda: round(rng.uniform(0.4, 1.6), 2), "nmol/L", 0.37, 1.47, "Y", "ACT_MMTT"),
    ("CHEMISTRY", "Hemoglobin A1C", lambda: round(rng.uniform(6.0, 9.0), 1), "%", 4.0, 6.0, "Y", "ACT_HBA1C"),
    ("CHEMISTRY", "Cholesterol", lambda: round(rng.uniform(3.5, 6.8), 1), "mmol/L", 0, 5.2, "Y", "ACT_CHEM"),
    ("CHEMISTRY", "Triglycerides", lambda: round(rng.uniform(0.8, 3.2), 2), "mmol/L", 0, 1.7, "Y", "ACT_CHEM"),
    ("CHEMISTRY", "Cholesterol, HDL", lambda: round(rng.uniform(0.8, 1.8), 2), "mmol/L", 1.0, 2.2, "Y", "ACT_CHEM"),
    ("CHEMISTRY", "Sodium", lambda: round(rng.uniform(135, 145), 0), "mmol/L", 136, 145, "Y", "ACT_CHEM"),
    ("CHEMISTRY", "Potassium", lambda: round(rng.uniform(3.6, 5.1), 1), "mmol/L", 3.5, 5.1, "Y", "ACT_CHEM"),
    ("CHEMISTRY", "Cortisol", lambda: round(rng.uniform(150, 550), 0), "nmol/L", 138, 635, "Y", "ACT_CORT"),
    ("HEMATOLOGY", "Hemoglobin", lambda: round(rng.uniform(120, 165), 0), "g/L", 120, 160, "N", "ACT_HEM"),
    ("HEMATOLOGY", "Hematocrit", lambda: round(rng.uniform(0.37, 0.50), 2), "1", 0.36, 0.48, "N", "ACT_HEM"),
    ("URINALYSIS", "Potassium, Urine", lambda: round(rng.uniform(20, 80), 0), "mmol/L", None, None, "N", "ACT_UNAK"),
    ("URINALYSIS", "Sodium, Urine", lambda: round(rng.uniform(40, 220), 0), "mmol/L", None, None, "N", "ACT_UNAK"),
]
rows = []
for s in subjects:
    seqn = 0
    for enc in ["ENC_V1", "ENC_V3", "ENC_V5", "ENC_V6"]:
        for cat, test, fn, unit, lo, hi, fast, act in lbtests:
            # urine electrolytes only at residency visits; chem/hem all visits
            if cat == "URINALYSIS" and enc in ("ENC_V1", "ENC_V6"):
                continue
            seqn += 1
            rows.append([STUDYID, s["SITEID"], s["SUBJID"], seqn, vlabel(enc), vdate(s, enc),
                         cat, test, fn(), unit, lo if lo is not None else "", hi if hi is not None else "",
                         fast, act, ACT_PAGE[act]])
    trace("LB", "LBORRES(Glucose)", s["SUBJID"], rows[-len(lbtests)][8])
summary["LB"] = collect("LB", hdr, rows)

# ---- EX (crossover: two treatment periods per subject) -------------------------------------
hdr = ["STUDYID", "SITEID", "SUBJID", "EXSEQ", "VISIT", "EXTRT", "EXDOSE", "EXDOSU", "EXROUTE",
       "EXSTDAT", "EXENDAT", "SRCACT", "SRCPAGE"]


def parse_dose(trt):
    # "AZD9567 72 mg" -> ("AZD9567", 72, "mg"); "Placebo" -> ("Placebo", 0, "mg")
    # (SDTM EX rule: EXTRT=PLACEBO requires EXDOSE=0, so collect placebo dose as 0.)
    parts = trt.split()
    if len(parts) >= 3 and parts[-1] == "mg":
        return " ".join(parts[:-2]), parts[-2], "mg"
    return trt, 0, "mg"


rows = []
for s in subjects:
    p1_trt, p2_trt = (s["trtA"], s["trtB"]) if s["seq"] == "AB" else (s["trtB"], s["trtA"])
    for seqn, (enc, trt, dstart) in enumerate(
            [("DAY 1 (TP1)", p1_trt, s["day1"]),
             ("DAY 26 (TP2)", p2_trt, s["day1"] + timedelta(days=25))], 1):
        name, dose, unit = parse_dose(trt)
        rows.append([STUDYID, s["SITEID"], s["SUBJID"], seqn, enc, name, dose, unit, "ORAL",
                     dstart.isoformat(), (dstart + timedelta(days=2)).isoformat(),
                     "ACT_DOSE", ACT_PAGE["ACT_DOSE"]])
    trace("EX", "EXTRT", s["SUBJID"], rows[-2][5])
summary["EX"] = collect("EX", hdr, rows)

# ---- CM ------------------------------------------------------------------------------------
hdr = ["STUDYID", "SITEID", "SUBJID", "CMSEQ", "CMTRT", "CMDOSE", "CMDOSU", "CMROUTE", "CMINDC",
       "CMSTDAT", "CMONGO", "SRCACT", "SRCPAGE"]
rows = []
for s in subjects:
    seqn = 1
    rows.append([STUDYID, s["SITEID"], s["SUBJID"], seqn, "METFORMIN", rng.choice([500, 850, 1000]),
                 "mg", "ORAL", "Type 2 diabetes mellitus",
                 (s["scr"] - timedelta(days=rng.randint(60, 800))).isoformat(), "Y",
                 "ACT_CM", ACT_PAGE["ACT_CM"]])
    if rng.random() < 0.4:
        seqn += 1
        add = rng.choice([("DAPAGLIFLOZIN", 10), ("SITAGLIPTIN", 100), ("RAMIPRIL", 5), ("ATORVASTATIN", 20)])
        rows.append([STUDYID, s["SITEID"], s["SUBJID"], seqn, add[0], add[1], "mg", "ORAL",
                     "Type 2 diabetes mellitus" if add[0] in ("DAPAGLIFLOZIN", "SITAGLIPTIN") else "Comorbidity",
                     (s["scr"] - timedelta(days=rng.randint(30, 400))).isoformat(), "Y",
                     "ACT_CM", ACT_PAGE["ACT_CM"]])
    trace("CM", "CMTRT", s["SUBJID"], "METFORMIN")
summary["CM"] = collect("CM", hdr, rows)

# ---- AE ------------------------------------------------------------------------------------
hdr = ["STUDYID", "SITEID", "SUBJID", "AESEQ", "AETERM", "AESTDAT", "AEENDAT", "AESEV", "AESER",
       "AEREL", "AEOUT", "AEACN", "SRCACT", "SRCPAGE"]
AE_POOL = ["Headache", "Nausea", "Hyperglycaemia", "Insomnia", "Dizziness", "Fatigue",
           "Injection site bruising", "Dyspepsia"]
SEV = ct_values("C66769") or ["MILD", "MODERATE", "SEVERE"]
OUT_VALS = ["RECOVERED/RESOLVED", "RECOVERING/RESOLVING", "NOT RECOVERED/NOT RESOLVED"]
ACN = ["DOSE NOT CHANGED", "DRUG WITHDRAWN", "DOSE REDUCED"]
rows = []
for s in subjects:
    if rng.random() < 0.55:
        for seqn in range(1, rng.randint(1, 3) + 1):
            onset = s["day1"] + timedelta(days=rng.randint(0, 30))
            dur = rng.randint(1, 7)
            outcome = rng.choice(OUT_VALS)
            # End date only when the event has actually ended (not for ongoing/unresolved AEs).
            endat = "" if outcome == "NOT RECOVERED/NOT RESOLVED" else (onset + timedelta(days=dur)).isoformat()
            rows.append([STUDYID, s["SITEID"], s["SUBJID"], seqn, rng.choice(AE_POOL),
                         onset.isoformat(), endat,
                         rng.choices(SEV, weights=[6, 3, 1])[0], "N",
                         rng.choice(["Y", "N"]), outcome,
                         rng.choices(ACN, weights=[8, 1, 1])[0], "ACT_AE", ACT_PAGE["ACT_AE"]])
        if rows:
            trace("AE", "AETERM", s["SUBJID"], rows[-1][4])
summary["AE"] = collect("AE", hdr, rows)

# ---- DS ------------------------------------------------------------------------------------
hdr = ["STUDYID", "SITEID", "SUBJID", "DSSEQ", "DSCAT", "DSTERM", "DSDECOD", "DSSTDAT", "SRCACT", "SRCPAGE"]
rows = []
for i, s in enumerate(subjects):
    end = s["day1"] + timedelta(days=61)
    if i in (7, 22):  # a couple of discontinuations for realism
        term, decod = "Adverse event", "ADVERSE EVENT"
        end = s["day1"] + timedelta(days=rng.randint(5, 30))
    else:
        term, decod = "Completed", "COMPLETED"
    rows.append([STUDYID, s["SITEID"], s["SUBJID"], 1, "DISPOSITION EVENT", term, decod,
                 end.isoformat(), "ACT_DISP", ACT_PAGE["ACT_DISP"]])
summary["DS"] = collect("DS", hdr, rows)


# =============================================================================================
# Tabulation: CDASH (in-memory) -> SDTMIG 3.4, ported verbatim from 06_cdash_to_sdtm.py.
# =============================================================================================
def read(name):
    return cdash[name]


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

# ---- lineage + summary sidecars --------------------------------------------------------------
(OUT / "lineage.json").write_text(json.dumps({
    "note": "Representative cell-level lineage: synthetic value -> USDM activity -> biomedical "
            "concept (NCIt) -> protocol SoA page. The SDTM CSVs are kept clean for CORE (no "
            "SRCACT/SRCPAGE columns); this sidecar carries the provenance.",
    "studyId": SOA["studyId"], "subjects": N_SUBJECTS, "seed": SEED,
    "samples": lineage,
}, indent=2, ensure_ascii=False))
(OUT / "datasets_summary.json").write_text(json.dumps({
    "studyId": SOA["studyId"], "sponsorStudyId": STUDYID, "subjects": N_SUBJECTS, "seed": SEED,
    "sdtmigVersion": SPEC["sdtmigVersion"], "ctPackage": SPEC["ctPackage"],
    "rowCounts": counts, "totalRows": sum(counts.values()),
}, indent=2, ensure_ascii=False))

print(f"Generated {len(counts)} SDTM datasets, {sum(counts.values())} total rows, "
      f"{N_SUBJECTS} subjects (seed {SEED}).")
for d, n in counts.items():
    print(f"  {d}: {n} rows")
