#!/usr/bin/env python3
"""Export the generated SDTM datasets to SAS V5 XPT for CORE conformance validation.

The CDISC Rules Engine consumes SAS V5 XPT, Dataset-JSON, or XLSX (CSV input was
dropped after engine 0.16.0). This step reads the SDTM CSVs and their companion
metadata (_variables.csv: type/label; _datasets.csv: dataset label) and writes one
XPT v5 file per domain into 06_sdtm_xpt/.

Run with a Python that has pyreadstat available (the cdisc-rules-engine venv does).

Inputs : 03_synthetic_sdtm/<domain>.csv (+ _variables.csv, _datasets.csv)
Outputs: 06_sdtm_xpt/<domain>.xpt
"""
from __future__ import annotations

import csv
from pathlib import Path

import pandas as pd
import pyreadstat

HERE = Path(__file__).parent
SRC = HERE / "03_synthetic_sdtm"
OUT = HERE / "06_sdtm_xpt"
OUT.mkdir(parents=True, exist_ok=True)
XPT_LABEL_MAX = 40  # SAS V5 variable/dataset label limit

dataset_labels = {row["Filename"]: row["Label"]
                  for row in csv.DictReader((SRC / "_datasets.csv").open())}

var_meta: dict[str, list[dict]] = {}
for row in csv.DictReader((SRC / "_variables.csv").open()):
    var_meta.setdefault(row["dataset"], []).append(row)


def build_frame(dataset: str) -> tuple[pd.DataFrame, list[str]]:
    cols = var_meta[dataset]
    raw = list(csv.DictReader((SRC / f"{dataset}.csv").open()))
    frame = {}
    labels = []
    for col in cols:
        name = col["variable"]
        values = [r.get(name, "") for r in raw]
        if col["type"] == "Num":
            frame[name] = pd.to_numeric(pd.Series(values).replace("", None))
        else:
            frame[name] = pd.Series(values, dtype="string").fillna("")
        labels.append(col["label"][:XPT_LABEL_MAX])
    return pd.DataFrame(frame), labels


for dataset, label in dataset_labels.items():
    df, column_labels = build_frame(dataset)
    pyreadstat.write_xport(
        df, str(OUT / f"{dataset}.xpt"),
        table_name=dataset.upper(),
        file_label=label[:XPT_LABEL_MAX],
        column_labels=column_labels,
        file_format_version=5,
    )
    print(f"  {dataset}.xpt: {len(df)} rows, {len(df.columns)} variables")

print(f"Exported {len(dataset_labels)} SDTM datasets to XPT v5 -> {OUT}")
