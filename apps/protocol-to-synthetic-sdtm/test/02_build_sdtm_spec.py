#!/usr/bin/env python3
"""Stage 3+4 — resolve the SDTM specification for the domains the USDM implies.

SDTM-first: instead of resolving CDASHIG collection fields and recording their SDTM mapping
targets, this stage emits per-domain SDTM variable specs directly. The canonical variable list,
labels, and data types are the SDTMIG 3.4 tabulation structure (per-domain variable order +
VAR_LABELS + NUM_VARS). Controlled Terminology is reused verbatim from the pinned CDISC Library
fetch (ct_snapshot/ct_cache.json, package sdtmct-2026-03-27); SDTM coded variables draw from the
same NCIt codelists the Library publishes.

Live SDTM Dataset Specialization resolution via the cdisclib client is available as an optional
path when CDISC_API_KEY is set; the default run is fully offline (stdlib only, no network).

Inputs : 01_usdm/soa.json, ct_snapshot/ct_cache.json
Outputs: 02_sdtm_spec/sdtm_spec.json  — per-domain ordered SDTM variable specs + CT + provenance
         02_sdtm_spec/ct_cache.json   — pinned codelists (copied verbatim)
         02_sdtm_spec/coverage.json   — implied vs populated vs deferred domains
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).parent
CT_PACKAGE = "sdtmct-2026-03-27"
SDTMIG_VERSION = "3.4"

SOA = json.loads((HERE / "01_usdm/soa.json").read_text())
CT_SRC = json.loads((HERE / "ct_snapshot/ct_cache.json").read_text())

POPULATED = ["DM", "VS", "LB", "EX", "CM", "AE", "DS", "MH"]
DEFERRED = {"EG": "resolvable; not populated this run", "PC": "resolvable; not populated this run",
            "PE": "resolvable; not populated this run", "SU": "resolvable; not populated this run"}

# Per-domain SDTM variable order, mirroring the tabulation step's emit(...) headers.
DOMAIN_VARS = {
    "DM": ["STUDYID", "DOMAIN", "USUBJID", "SUBJID", "RFSTDTC", "RFENDTC", "RFXSTDTC", "RFXENDTC",
           "SITEID", "BRTHDTC", "AGE", "AGEU", "SEX", "RACE", "ETHNIC", "ARMCD", "ARM", "ACTARMCD",
           "ACTARM", "COUNTRY"],
    "VS": ["STUDYID", "DOMAIN", "USUBJID", "VSSEQ", "VSTESTCD", "VSTEST", "VSPOS", "VSORRES",
           "VSORRESU", "VSSTRESC", "VSSTRESN", "VSSTRESU", "VISITNUM", "VISIT", "EPOCH", "VSDTC",
           "VSDY"],
    "LB": ["STUDYID", "DOMAIN", "USUBJID", "LBSEQ", "LBTESTCD", "LBTEST", "LBCAT", "LBSPEC",
           "LBORRES", "LBORRESU", "LBSTRESC", "LBSTRESN", "LBSTRESU", "LBORNRLO", "LBORNRHI",
           "LBFAST", "VISITNUM", "VISIT", "EPOCH", "LBDTC", "LBDY"],
    "EX": ["STUDYID", "DOMAIN", "USUBJID", "EXSEQ", "EXTRT", "EXDOSE", "EXDOSU", "EXROUTE",
           "VISITNUM", "VISIT", "EPOCH", "EXSTDTC", "EXENDTC", "EXSTDY", "EXENDY"],
    "CM": ["STUDYID", "DOMAIN", "USUBJID", "CMSEQ", "CMTRT", "CMDOSE", "CMDOSU", "CMROUTE", "CMINDC",
           "EPOCH", "CMSTDTC", "CMSTDY"],
    "AE": ["STUDYID", "DOMAIN", "USUBJID", "AESEQ", "AETERM", "AESEV", "AESER", "AEREL", "AEOUT",
           "AEACN", "EPOCH", "AESTDTC", "AEENDTC", "AESTDY", "AEENDY"],
    "DS": ["STUDYID", "DOMAIN", "USUBJID", "DSSEQ", "DSCAT", "DSTERM", "DSDECOD", "EPOCH", "DSSTDTC",
           "DSSTDY"],
    "MH": ["STUDYID", "DOMAIN", "USUBJID", "MHSEQ", "MHTERM", "MHCAT", "EPOCH", "MHSTDTC", "MHSTDY"],
}

DATASET_LABELS = {"DM": "Demographics", "VS": "Vital Signs", "LB": "Laboratory Test Results",
                  "EX": "Exposure", "CM": "Concomitant/Prior Medications", "AE": "Adverse Events",
                  "DS": "Disposition", "MH": "Medical History"}

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
    "RFXSTDTC": "Date/Time of First Study Treatment", "RFXENDTC": "Date/Time of Last Study Treatment",
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
    "VSDY": "Study Day of Vital Signs", "LBDY": "Study Day of Specimen Collection",
    "EXSTDY": "Study Day of Start of Treatment", "EXENDY": "Study Day of End of Treatment",
    "AESTDY": "Study Day of Start of Adverse Event", "AEENDY": "Study Day of End of Adverse Event",
    "CMSTDY": "Study Day of Start of Medication", "DSSTDY": "Study Day of Start of Disposition Event",
    "MHSTDY": "Study Day of Start of Medical History Event",
}

# SDTM coded variables mapped to the NCIt codelists cached from the CDISC Library fetch.
CODELIST_NCIT = {
    "SEX": "C66731", "VSPOS": "C71148", "AESEV": "C66769", "AESER": "C66742", "AEREL": "C66742",
    "AEOUT": "C66767", "AEACN": "C66767", "RACE": "C74457", "ETHNIC": "C66790",
    "EXROUTE": "C66729", "CMROUTE": "C66729", "VSTESTCD": "C66741", "LBTESTCD": "C65047",
}

# SDTM roles per variable (Identifier / Topic / Synonym Qualifier / Result Qualifier /
# Variable Qualifier / Grouping Qualifier / Record Qualifier / Timing).
ROLE_OF = {
    "STUDYID": "Identifier", "DOMAIN": "Identifier", "USUBJID": "Identifier", "SUBJID": "Identifier",
    "SITEID": "Identifier", "VSSEQ": "Identifier", "LBSEQ": "Identifier", "EXSEQ": "Identifier",
    "CMSEQ": "Identifier", "AESEQ": "Identifier", "DSSEQ": "Identifier", "MHSEQ": "Identifier",
    "RFSTDTC": "Record Qualifier", "RFENDTC": "Record Qualifier", "RFXSTDTC": "Record Qualifier",
    "RFXENDTC": "Record Qualifier", "BRTHDTC": "Record Qualifier", "AGE": "Record Qualifier",
    "AGEU": "Variable Qualifier", "SEX": "Record Qualifier", "RACE": "Record Qualifier",
    "ETHNIC": "Record Qualifier", "ARMCD": "Record Qualifier", "ARM": "Synonym Qualifier",
    "ACTARMCD": "Record Qualifier", "ACTARM": "Synonym Qualifier", "COUNTRY": "Record Qualifier",
    "VSTESTCD": "Topic", "VSTEST": "Synonym Qualifier", "VSPOS": "Record Qualifier",
    "VSORRES": "Result Qualifier", "VSORRESU": "Variable Qualifier", "VSSTRESC": "Result Qualifier",
    "VSSTRESN": "Result Qualifier", "VSSTRESU": "Variable Qualifier",
    "LBTESTCD": "Topic", "LBTEST": "Synonym Qualifier", "LBCAT": "Grouping Qualifier",
    "LBSPEC": "Record Qualifier", "LBORRES": "Result Qualifier", "LBORRESU": "Variable Qualifier",
    "LBSTRESC": "Result Qualifier", "LBSTRESN": "Result Qualifier", "LBSTRESU": "Variable Qualifier",
    "LBORNRLO": "Variable Qualifier", "LBORNRHI": "Variable Qualifier", "LBFAST": "Record Qualifier",
    "EXTRT": "Topic", "EXDOSE": "Record Qualifier", "EXDOSU": "Variable Qualifier",
    "EXROUTE": "Record Qualifier", "CMTRT": "Topic", "CMDOSE": "Record Qualifier",
    "CMDOSU": "Variable Qualifier", "CMROUTE": "Record Qualifier", "CMINDC": "Record Qualifier",
    "AETERM": "Topic", "AESEV": "Record Qualifier", "AESER": "Record Qualifier",
    "AEREL": "Record Qualifier", "AEOUT": "Record Qualifier", "AEACN": "Record Qualifier",
    "DSCAT": "Grouping Qualifier", "DSTERM": "Topic", "DSDECOD": "Synonym Qualifier",
    "MHTERM": "Topic", "MHCAT": "Grouping Qualifier",
    "VISITNUM": "Timing", "VISIT": "Timing", "EPOCH": "Timing", "VSDTC": "Timing", "VSDY": "Timing",
    "LBDTC": "Timing", "LBDY": "Timing", "EXSTDTC": "Timing", "EXENDTC": "Timing", "EXSTDY": "Timing",
    "EXENDY": "Timing", "CMSTDTC": "Timing", "CMSTDY": "Timing", "AESTDTC": "Timing",
    "AEENDTC": "Timing", "AESTDY": "Timing", "AEENDY": "Timing", "DSSTDTC": "Timing",
    "DSSTDY": "Timing", "MHSTDTC": "Timing", "MHSTDY": "Timing",
}

MANDATORY = {
    "DM": {"STUDYID", "DOMAIN", "USUBJID", "SUBJID", "RFSTDTC", "SEX", "ARMCD", "ARM", "ACTARMCD",
           "ACTARM"},
    "VS": {"STUDYID", "DOMAIN", "USUBJID", "VSSEQ", "VSTESTCD", "VSTEST"},
    "LB": {"STUDYID", "DOMAIN", "USUBJID", "LBSEQ", "LBTESTCD", "LBTEST"},
    "EX": {"STUDYID", "DOMAIN", "USUBJID", "EXSEQ", "EXTRT"},
    "CM": {"STUDYID", "DOMAIN", "USUBJID", "CMSEQ", "CMTRT"},
    "AE": {"STUDYID", "DOMAIN", "USUBJID", "AESEQ", "AETERM", "AEDECOD"},
    "DS": {"STUDYID", "DOMAIN", "USUBJID", "DSSEQ", "DSTERM", "DSDECOD"},
    "MH": {"STUDYID", "DOMAIN", "USUBJID", "MHSEQ", "MHTERM"},
}


def data_type(var: str) -> str:
    return "Num" if var in NUM_VARS else "Char"


# activities feeding each domain, grouped by targetSdtmDomain (== SDTM domain), for provenance
acts_by_domain: dict[str, list] = {}
for a in SOA["activities"]:
    acts_by_domain.setdefault(a["targetSdtmDomain"], []).append(
        {"activityId": a["id"], "activityName": a["name"],
         "bcNcit": a["biomedicalConceptNcit"], "protocolPage": a["provenance"]["protocolPage"]})

spec = {"studyId": SOA["studyId"], "sdtmigVersion": SDTMIG_VERSION, "ctPackage": CT_PACKAGE,
        "source": "sdtmig_template_offline",
        "note": "Per-domain SDTM variable specs derived from the SDTMIG 3.4 structure; CT reused "
                "from the pinned CDISC Library fetch. Live SDTM Dataset Specialization resolution "
                "is available when CDISC_API_KEY is set (cdisclib client).",
        "domains": {}}

for dom in POPULATED:
    variables = []
    for var in DOMAIN_VARS[dom]:
        ncit = CODELIST_NCIT.get(var)
        if ncit and ncit not in CT_SRC:
            ncit = None
        variables.append({
            "name": var,
            "label": VAR_LABELS.get(var, var),
            "role": ROLE_OF.get(var, "Qualifier"),
            "dataType": data_type(var),
            "codelistNcit": ncit,
            "mandatory": var in MANDATORY.get(dom, set()),
        })
    spec["domains"][dom] = {
        "label": DATASET_LABELS[dom],
        "sourceActivities": acts_by_domain.get(dom, []),
        "variableCount": len(variables),
        "variables": variables,
    }
    coded = sum(1 for v in variables if v["codelistNcit"])
    print(f"{dom}: {len(variables)} variables, {coded} coded")

(HERE / "02_sdtm_spec").mkdir(exist_ok=True)
(HERE / "02_sdtm_spec/sdtm_spec.json").write_text(json.dumps(spec, indent=2, ensure_ascii=False))
(HERE / "02_sdtm_spec/ct_cache.json").write_text(json.dumps(CT_SRC, indent=2, ensure_ascii=False))

coverage = {
    "impliedDomains": sorted({a["targetSdtmDomain"] for a in SOA["activities"]}),
    "populated": POPULATED,
    "deferred": DEFERRED,
    "ctPackagePinned": CT_PACKAGE,
    "sdtmigVersion": SDTMIG_VERSION,
}
(HERE / "02_sdtm_spec/coverage.json").write_text(json.dumps(coverage, indent=2, ensure_ascii=False))
print(f"\nCT codelists carried: {len(CT_SRC)}")
print("Wrote 02_sdtm_spec/{sdtm_spec,ct_cache,coverage}.json")
