#!/usr/bin/env python3
"""Stage 5 — populate synthetic CDASH datasets from the resolved spec.

Deterministic + seeded (RANDOM_SEED=1234). Identifiers (STUDYID/SITEID/SUBJID/--SEQ) are
assigned deterministically; coded values are sampled from the Controlled Terminology fetched in
Stage 4 (02_cdash_spec/ct_cache.json); numeric results are sampled within plausible clinical
ranges. Every populated findings row carries provenance columns (SRCACT = USDM activity id,
SRCPAGE = protocol SoA page); a separate 03_synthetic_cdash/lineage.json links a representative
sample of cells back through USDM activity -> biomedical concept -> protocol page.

Outputs: 03_synthetic_cdash/<DOMAIN>.csv  (one CDASH dataset per populated domain)
         03_synthetic_cdash/lineage.json
         03_synthetic_cdash/datasets_summary.json
"""
from __future__ import annotations

import csv
import json
import random
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).parent
SEED = 1234
N_SUBJECTS = 40
STUDYID = "D6470C00005"

SOA = json.loads((HERE / "01_usdm/soa.json").read_text())
SPEC = json.loads((HERE / "02_cdash_spec/cdash_spec.json").read_text())
CT = json.loads((HERE / "02_cdash_spec/ct_cache.json").read_text())
OUT = HERE / "03_synthetic_cdash"

rng = random.Random(SEED)


def ct_values(ncit: str) -> list[str]:
    rec = CT.get(ncit)
    return [t["submissionValue"] for t in rec["terms"]] if rec else []


# activity -> page, for provenance
ACT_PAGE = {a["id"]: a["provenance"]["protocolPage"] for a in SOA["activities"]}
ACT_BC = {a["id"]: a["biomedicalConceptNcit"] for a in SOA["activities"]}
DOMAIN_ACTS = {d: SPEC["domains"][d]["sourceActivities"] for d in SPEC["domains"]}


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


def write_csv(name, header, rows):
    p = OUT / f"{name}.csv"
    with p.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    return len(rows)


summary, lineage = {}, []


def trace(dom, var, usubjid, value):
    a = first_act(dom)
    lineage.append({"domain": dom, "variable": var, "subjid": usubjid, "value": value,
                    "usdmActivityId": a, "biomedicalConceptNcit": ACT_BC.get(a),
                    "protocolPage": ACT_PAGE.get(a), "ctPackage": SPEC["ctPackage"],
                    "cdashigVersion": SPEC["cdashigVersion"]})


# ---- DM ------------------------------------------------------------------------------------
hdr = ["STUDYID", "SITEID", "SUBJID", "BRTHDAT", "AGE", "AGEU", "SEX", "RACE", "ETHNIC", "SRCACT", "SRCPAGE"]
rows = []
for s in subjects:
    brth = date(s["scr"].year - s["age"], rng.randint(1, 12), rng.randint(1, 28)).isoformat()
    race, eth = rng.choice(RACES), rng.choice(ETHNIC)
    rows.append([STUDYID, s["SITEID"], s["SUBJID"], brth, s["age"], "YEARS", s["sex"], race, eth,
                 first_act("DM"), ACT_PAGE[first_act("DM")]])
    trace("DM", "SEX", s["SUBJID"], s["sex"])
summary["DM"] = write_csv("DM", hdr, rows)

# ---- IE (criteria not met — a couple of documented exceptions) -----------------------------
hdr = ["STUDYID", "SITEID", "SUBJID", "IECAT", "IETESTCD", "IETEST", "IEORRES", "SRCACT", "SRCPAGE"]
rows = []
for s in rng.sample(subjects, 2):
    rows.append([STUDYID, s["SITEID"], s["SUBJID"], "INCLUSION", "INCL02",
                 "HbA1c within protocol range", "WAIVER GRANTED", first_act("IE"), ACT_PAGE[first_act("IE")]])
summary["IE"] = write_csv("IE", hdr, rows)

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
summary["MH"] = write_csv("MH", hdr, rows)

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
summary["VS"] = write_csv("VS", hdr, rows)

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
summary["EG"] = write_csv("EG", hdr, rows)

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
summary["LB"] = write_csv("LB", hdr, rows)

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
summary["EX"] = write_csv("EX", hdr, rows)

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
summary["CM"] = write_csv("CM", hdr, rows)

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
summary["AE"] = write_csv("AE", hdr, rows)

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
summary["DS"] = write_csv("DS", hdr, rows)

# ---- lineage + summary ----------------------------------------------------------------------
(OUT / "lineage.json").write_text(json.dumps({
    "note": "Representative cell-level lineage: synthetic value -> USDM activity -> biomedical "
            "concept (NCIt) -> protocol SoA page. Full provenance is in each dataset's "
            "SRCACT/SRCPAGE columns.",
    "studyId": SOA["studyId"], "subjects": N_SUBJECTS, "seed": SEED,
    "samples": lineage,
}, indent=2, ensure_ascii=False))
(OUT / "datasets_summary.json").write_text(json.dumps({
    "studyId": SOA["studyId"], "sponsorStudyId": STUDYID, "subjects": N_SUBJECTS, "seed": SEED,
    "cdashigVersion": SPEC["cdashigVersion"], "ctPackage": SPEC["ctPackage"],
    "rowCounts": summary, "totalRows": sum(summary.values()),
}, indent=2, ensure_ascii=False))

print(f"Generated {len(summary)} CDASH datasets, {sum(summary.values())} total rows, "
      f"{N_SUBJECTS} subjects (seed {SEED}).")
for d, n in summary.items():
    print(f"  {d}: {n} rows")
