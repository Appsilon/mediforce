#!/usr/bin/env python3
"""Stage 2 — build a USDM v3.0 study representation for NCT04556760.

Inputs : 00_raw/NCT04556760.json (verbatim CT.gov record, Stage 1)
         protocol/Prot_000.pdf Schedule of Activities (pp.20-24), extracted into SOA below.
Outputs: 01_usdm/soa.json  — the extracted Schedule of Activities (visits x activities)
         01_usdm/usdm.json — a USDM v3.0-structured study (DDF class names)

Design principle (per spec): the structured/enumerated fields are mapped deterministically
from the CT.gov record; the SoA activity list + visit grid is the bounded extraction from the
protocol PDF (done by reading pp.20-24). Every activity carries a provenance pointer
(protocol page + the source it came from) so Stage 3/4 can trace SDTM variables back to source.
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).parent
RAW = json.loads((HERE / "00_raw/NCT04556760.json").read_text())
PS = RAW["protocolSection"]

NCT = PS["identificationModule"]["nctId"]
STUDYID = PS["identificationModule"]["orgStudyIdInfo"]["id"]  # D6470C00005

# ---------------------------------------------------------------------------------------------
# Visit grid extracted from the protocol Schedule of Activities (Prot_000.pdf pp.20-24).
# Encounter ids are stable handles used by the schedule timeline + provenance.
# ---------------------------------------------------------------------------------------------
ENCOUNTERS = [
    {"id": "ENC_V1", "name": "Visit 1", "label": "Screening", "epoch": "EP_SCRN",
     "timing": "<= 14 days before start of IMP"},
    {"id": "ENC_V2", "name": "Visit 2", "label": "Outpatient visit (Day -4)", "epoch": "EP_TP1",
     "timing": "Day -4"},
    {"id": "ENC_V3", "name": "Visit 3", "label": "Residency in Unit (Treatment Period 1)",
     "epoch": "EP_TP1", "timing": "Days -2 to 4"},
    {"id": "ENC_WASH", "name": "Washout", "label": "Washout (3 weeks)", "epoch": "EP_WASH",
     "timing": "3 weeks"},
    {"id": "ENC_V4", "name": "Visit 4", "label": "Outpatient visit (Day 24)", "epoch": "EP_TP2",
     "timing": "Day 24 (-4)"},
    {"id": "ENC_V5", "name": "Visit 5", "label": "Residency in Unit 2 (Treatment Period 2)",
     "epoch": "EP_TP2", "timing": "Days 26 to 31"},
    {"id": "ENC_V6", "name": "Visit 6", "label": "Final/ET visit", "epoch": "EP_FU",
     "timing": "Follow-up Day 30 +/- 4 days after last dose"},
]

EPOCHS = [
    {"id": "EP_SCRN", "name": "Screening", "type": "SCREENING"},
    {"id": "EP_TP1", "name": "Treatment Period 1", "type": "TREATMENT"},
    {"id": "EP_WASH", "name": "Washout", "type": "WASHOUT"},
    {"id": "EP_TP2", "name": "Treatment Period 2", "type": "TREATMENT"},
    {"id": "EP_FU", "name": "Follow-up", "type": "FOLLOW_UP"},
]

# Activities from the SoA. Each: id, name, encounters where performed, the SDTM domain it
# feeds (Stage 3 target), and an NCIt biomedical-concept hint where one cleanly applies.
# 'source' = SoA row; page = protocol page the row appears on.
A = lambda **k: k  # noqa: E731  (compact literal helper)
ACTIVITIES = [
    A(id="ACT_IC",   name="Informed consent",            enc=["ENC_V1"], sdtm="IE",  bc=None,       page=20),
    A(id="ACT_ELIG", name="Verify eligibility criteria", enc=["ENC_V1","ENC_V4"], sdtm="IE", bc=None, page=20),
    A(id="ACT_DM",   name="Demography",                  enc=["ENC_V1"], sdtm="DM",  bc=None,       page=20),
    A(id="ACT_HTWT", name="Height and weight",           enc=["ENC_V1","ENC_V3","ENC_V5","ENC_V6"], sdtm="VS", bc="C25347/C25208", page=20),
    A(id="ACT_MH",   name="Medical History",             enc=["ENC_V1"], sdtm="MH",  bc=None,       page=20),
    A(id="ACT_PE",   name="Physical examination",        enc=["ENC_V1","ENC_V3","ENC_V5","ENC_V6"], sdtm="PE", bc=None, page=20),
    A(id="ACT_TOB",  name="Tobacco use",                 enc=["ENC_V1","ENC_V2","ENC_V5"], sdtm="SU", bc=None, page=20),
    A(id="ACT_ECG",  name="Safety ECG (12-lead)",        enc=["ENC_V1","ENC_V3","ENC_V5","ENC_V6"], sdtm="EG", bc="C71355", page=20),
    A(id="ACT_VS",   name="Vital signs (SBP, DBP, pulse, temperature)", enc=["ENC_V1","ENC_V3","ENC_V5","ENC_V6"], sdtm="VS", bc="C54706", page=20),
    A(id="ACT_RAND", name="Randomisation (IVRS/IWRS)",   enc=["ENC_V3"], sdtm="DS",  bc=None,       page=21),
    A(id="ACT_AE",   name="Adverse events",              enc=["ENC_V1","ENC_V2","ENC_V3","ENC_V4","ENC_V5","ENC_V6"], sdtm="AE", bc=None, page=21),
    A(id="ACT_CM",   name="Concomitant medication",      enc=["ENC_V1","ENC_V2","ENC_V3","ENC_V4","ENC_V5","ENC_V6"], sdtm="CM", bc=None, page=21),
    A(id="ACT_HEM",  name="Haematology",                 enc=["ENC_V1","ENC_V3","ENC_V5","ENC_V6"], sdtm="LB", bc="C28133", page=21),
    A(id="ACT_CHEM", name="Clinical chemistry (incl. triglycerides, HDL-C)", enc=["ENC_V1","ENC_V3","ENC_V5","ENC_V6"], sdtm="LB", bc="C49237", page=21),
    A(id="ACT_COAG", name="Coagulation (INR, PT, aPTT)", enc=["ENC_V1"], sdtm="LB", bc="C61367", page=21),
    A(id="ACT_HBA1C",name="HbA1c",                       enc=["ENC_V1"], sdtm="LB", bc="C64849", page=21),
    A(id="ACT_MMTT", name="MMTT (glucose, insulin, C-peptide, GLP-1, GIP, glucagon, FFAs)", enc=["ENC_V3","ENC_V5"], sdtm="LB", bc="C105585", page=23),
    A(id="ACT_CORT", name="Serum cortisol",              enc=["ENC_V3","ENC_V5","ENC_V6"], sdtm="LB", bc="C105443", page=23),
    A(id="ACT_UNAK", name="24-h urinary sodium & potassium (U-Na, U-K)", enc=["ENC_V3","ENC_V5"], sdtm="LB", bc="C147062", page=24),
    A(id="ACT_UA",   name="Urinalysis",                  enc=["ENC_V1","ENC_V3","ENC_V5","ENC_V6"], sdtm="LB", bc="C17241", page=24),
    A(id="ACT_PREG", name="Pregnancy test (hCG)",        enc=["ENC_V1","ENC_V6"], sdtm="LB", bc="C25640", page=21),
    A(id="ACT_PK",   name="PK sampling (AZD9567, prednisolone)", enc=["ENC_V3","ENC_V5"], sdtm="PC", bc=None, page=22),
    A(id="ACT_DOSE", name="IMP administration (AZD9567 / prednisolone / placebo)", enc=["ENC_V3","ENC_V5"], sdtm="EX", bc=None, page=22),
    A(id="ACT_DISP", name="Study completion / disposition", enc=["ENC_V6"], sdtm="DS", bc=None, page=24),
]

# ---------------------------------------------------------------------------------------------
# Arms / cohorts and interventions (deterministic from CT.gov armsInterventionsModule).
# ---------------------------------------------------------------------------------------------
arms = PS["armsInterventionsModule"]["armGroups"]
interventions = PS["armsInterventionsModule"]["interventions"]


def codeable(decode, system="NCIt", code=None):
    """A compact USDM AliasCode/Code-style object."""
    return {"code": code, "codeSystem": system, "decode": decode}


# ---- Schedule of Activities artifact ---------------------------------------------------------
soa = {
    "studyId": NCT,
    "sponsorStudyId": STUDYID,
    "source": "Clinical Study Protocol v3.0 (Prot_000.pdf), Section 1.3 Schedule of Activities, pp.20-24",
    "epochs": EPOCHS,
    "encounters": ENCOUNTERS,
    "activities": [
        {"id": a["id"], "name": a["name"], "performedAt": a["enc"],
         "targetSdtmDomain": a["sdtm"], "biomedicalConceptNcit": a["bc"],
         "provenance": {"protocolPage": a["page"], "source": "SoA"}}
        for a in ACTIVITIES
    ],
}
(HERE / "01_usdm/soa.json").write_text(json.dumps(soa, indent=2, ensure_ascii=False))

# ---- USDM v3.0 study document ----------------------------------------------------------------
masking = PS["designModule"]["designInfo"].get("maskingInfo", {}).get("masking")
usdm = {
    "usdmVersion": "3.0.0",
    "systemName": "protocol-to-synthetic-sdtm",
    "study": {
        "id": "STUDY_AZD9567",
        "name": STUDYID,
        "label": PS["identificationModule"]["briefTitle"],
        "versions": [{
            "id": "SV1",
            "versionIdentifier": "3.0",
            "rationale": "Built from ClinicalTrials.gov registry record + protocol SoA.",
            "titles": [
                {"id": "T_BRIEF", "type": "Brief Study Title",
                 "text": PS["identificationModule"]["briefTitle"]},
                {"id": "T_OFFICIAL", "type": "Official Study Title",
                 "text": PS["identificationModule"]["officialTitle"]},
            ],
            "studyIdentifiers": [
                {"id": "ID_NCT", "studyIdentifier": NCT, "studyIdentifierScope": "ClinicalTrials.gov"},
                {"id": "ID_SPONSOR", "studyIdentifier": STUDYID, "studyIdentifierScope": "AstraZeneca"},
            ],
            "studyType": codeable("Interventional", code="C98388"),
            "studyPhase": codeable("Phase 2a Trial", code="C49686"),
            "rationaleOrPurpose": PS["descriptionModule"]["briefSummary"],
            "businessTherapeuticAreas": [codeable("Endocrinology")],
            "studyDesigns": [{
                "id": "SD1",
                "name": "Main Study Design",
                "label": "Phase 2a randomised, double-blind, double-dummy, two-way cross-over",
                "studyType": codeable("Interventional", code="C98388"),
                "interventionModel": codeable("Crossover Study", code="C82637"),
                "blindingSchema": codeable("Double Blind", code="C15228") if masking == "DOUBLE" else None,
                "therapeuticAreas": [codeable("Type 2 Diabetes Mellitus", code="C26747")],
                "indications": [{
                    "id": "IND1", "name": "T2DM",
                    "description": PS["conditionsModule"]["conditions"][0],
                    "codes": [codeable("Diabetes Mellitus, Non-Insulin-Dependent", code="C26747")],
                }],
                "population": {
                    "id": "POP1", "name": "Adults with T2DM",
                    "plannedEnrollmentNumber": PS["designModule"]["enrollmentInfo"]["count"],
                    "plannedSex": [codeable(PS["eligibilityModule"]["sex"])],
                    "plannedAge": {"minValue": PS["eligibilityModule"]["minimumAge"],
                                   "maxValue": PS["eligibilityModule"]["maximumAge"]},
                    "criteria": "ref:eligibilityCriteria",
                },
                "arms": [
                    {"id": f"ARM_{i+1}", "name": a["label"], "description": a["description"],
                     "type": codeable(a["type"].title().replace("_", " "))}
                    for i, a in enumerate(arms)
                ],
                "epochs": [
                    {"id": e["id"], "name": e["name"], "type": codeable(e["type"].title())}
                    for e in EPOCHS
                ],
                "encounters": [
                    {"id": e["id"], "name": e["name"], "label": e["label"],
                     "scheduledAtEpoch": e["epoch"], "plannedTiming": e["timing"]}
                    for e in ENCOUNTERS
                ],
                "studyInterventions": [
                    {"id": f"INT_{i+1}", "name": iv["name"], "description": iv["description"],
                     "type": codeable(iv["type"].title()),
                     "role": codeable("Investigational" if iv["type"] == "DRUG" else "Placebo")}
                    for i, iv in enumerate(interventions)
                ],
                "activities": [
                    {"id": a["id"], "name": a["name"],
                     "biomedicalConceptIds": [a["bc"]] if a["bc"] else [],
                     "definedProcedures": []}
                    for a in ACTIVITIES
                ],
                "scheduleTimeline": {
                    "id": "TL1", "name": "Main Timeline", "mainTimeline": True,
                    "instances": [
                        {"id": f"SAI_{a['id']}_{enc}", "activityId": a["id"], "encounterId": enc,
                         "type": "ScheduledActivityInstance"}
                        for a in ACTIVITIES for enc in a["enc"]
                    ],
                },
            }],
        }],
    },
    # Eligibility criteria kept as discrete criterion objects (bounded extraction from registry).
    "eligibilityCriteria": [
        {"id": f"EC_{cat[:3].upper()}_{n}", "category": cat, "identifier": f"{cat[:3].upper()}{n}",
         "text": line.strip("* ").strip()}
        for cat, block in [
            ("Inclusion", PS["eligibilityModule"]["eligibilityCriteria"].split("Exclusion Criteria:")[0]),
            ("Exclusion", PS["eligibilityModule"]["eligibilityCriteria"].split("Exclusion Criteria:")[-1]),
        ]
        for n, line in enumerate((l for l in block.splitlines() if l.strip().startswith("*")), 1)
    ],
    "objectives": [
        {"id": "OBJ1", "level": "Primary",
         "text": "Assess the effect on glycaemic control of AZD9567 (glucose AUC(0-4) vs baseline "
                 "following standardised MMTT) compared to prednisolone in adults with T2DM.",
         "endpoints": [{"id": "EP1", "level": "Primary",
                        "text": PS["outcomesModule"]["primaryOutcomes"][0]["measure"]}]},
        {"id": "OBJ2", "level": "Secondary",
         "text": "Evaluate safety, tolerability and pharmacokinetics of AZD9567.",
         "endpoints": [{"id": f"EP_S{i+1}", "level": "Secondary", "text": o["measure"]}
                       for i, o in enumerate(PS["outcomesModule"]["secondaryOutcomes"][:6])]},
    ],
}
(HERE / "01_usdm/usdm.json").write_text(json.dumps(usdm, indent=2, ensure_ascii=False))

n_inst = len(usdm["study"]["versions"][0]["studyDesigns"][0]["scheduleTimeline"]["instances"])
print(f"USDM built: {len(ACTIVITIES)} activities, {len(ENCOUNTERS)} encounters, "
      f"{len(EPOCHS)} epochs, {n_inst} scheduled instances, "
      f"{len(usdm['eligibilityCriteria'])} eligibility criteria.")
print("SDTM domains implied:", sorted({a['sdtm'] for a in ACTIVITIES}))
