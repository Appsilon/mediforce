"""Generate the 4 mess variants for the landing-zone v0.1 demo from ./clean/.

The clean baseline is fetched separately by ``fetch_clean.py``. This script
reads ./clean/ and produces four sibling directories, each demonstrating a
distinct failure mode for the validation pipeline:

    injection/                  — 5 deterministic CDISC SDTM rule violations
    mess-encoding/              — DM.xpt with CP1252 bytes in a SITEID field
    mess-missing-domain/        — clean/ minus AE.xpt
    mess-inconsistent-values/   — DM.xpt with SITEID values that vary in casing
                                  ("NY" / "New York" / "new york")

The fifth demo variant from config.yaml — ``mess-late`` — does not need its
own data copy. The seeding script reuses ./clean/ but stamps older mtimes on
the SFTP server, so it lives entirely in seeding logic.

Library: ``pyreadstat`` (preserves XPT v5 column labels and storage widths,
which CDISC CORE rules expect). ``xport`` was considered but pins
``pandas<1.4`` and fails to build on Python 3.13+.

Each mess scenario is documented inline next to the function that generates
it, including the rule code (when applicable) and the expected behavior of
the downstream validator.

Run from anywhere; output is written next to this script.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

import pandas as pd
import pyreadstat


HERE = Path(__file__).resolve().parent
CLEAN = HERE / "clean"
DOMAINS = ["DM", "AE", "LB", "EX", "VS"]


def ensure_clean() -> None:
    if not CLEAN.is_dir():
        sys.exit(f"clean/ not found at {CLEAN}. Run fetch_clean.py first.")
    missing = [name for name in DOMAINS if not (CLEAN / f"{name}.xpt").exists()]
    if missing:
        sys.exit(f"clean/ is missing: {', '.join(missing)}. Re-run fetch_clean.py.")


def reset_dir(target: Path) -> None:
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)


def copy_clean_into(target: Path, exclude: set[str] | None = None) -> None:
    """Copy clean/ contents into target/, optionally skipping some filenames."""
    exclude = exclude or set()
    for source in CLEAN.iterdir():
        if source.name in exclude:
            continue
        if source.is_file():
            shutil.copy2(source, target / source.name)


def write_xport(df: pd.DataFrame, meta: pyreadstat.metadata_container, path: Path) -> None:
    """Write df back to XPT v5 preserving table name and column labels."""
    pyreadstat.write_xport(
        df,
        str(path),
        file_format_version=5,
        table_name=meta.table_name or path.stem.upper(),
        column_labels=meta.column_labels,
    )


# ---------------------------------------------------------------------------
# Variant 1: injection — 5 deterministic CDISC SDTM rule violations.
#
# Errors per legacy/pawel.md (lines 64-68). The fifth error in pawel.md
# (AD0196 — missing AVALU when AVAL is set) is an ADaM rule and cannot be
# applied to an SDTM-only delivery, so it is replaced here with a fifth
# SDTM-applicable violation: RFXSTDTC after RFXENDTC for one subject in DM
# (a date-ordering inconsistency the rules engine flags under one of the
# CG-series cross-variable consistency rules).
# ---------------------------------------------------------------------------
def variant_injection(target: Path) -> None:
    reset_dir(target)
    copy_clean_into(target)

    # SD0003 — broken ISO date in LBDTC.
    # Replace one valid ISO timestamp with a SAS-style "15MAR2020" string.
    lb_path = target / "LB.xpt"
    lb, lb_meta = pyreadstat.read_xport(str(lb_path))
    lb.loc[0, "LBDTC"] = "15MAR2020"

    # SD0005 — duplicate (USUBJID, LBSEQ).
    # Set the second row's USUBJID+LBSEQ to match the first row's.
    lb.loc[1, "USUBJID"] = lb.loc[0, "USUBJID"]
    lb.loc[1, "LBSEQ"] = lb.loc[0, "LBSEQ"]

    # SD0018 — LBTESTCD over 8 characters.
    # CDISC limits SDTM short names to 8 chars; "ALANINETRANSFERASE" is 18.
    lb.loc[2, "LBTESTCD"] = "ALANINETRANSFERASE"

    write_xport(lb, lb_meta, lb_path)

    # CT2xxx — invalid SEX outside CDISC CT (allowed: F, M, U, UNDIFFERENTIATED).
    dm_path = target / "DM.xpt"
    dm, dm_meta = pyreadstat.read_xport(str(dm_path))
    dm.loc[0, "SEX"] = "X"

    # Fifth violation (substitute for the ADaM-only AD0196): invert RFXSTDTC
    # and RFXENDTC for subject at row 1, producing a treatment-end-before-start
    # inconsistency the engine flags as a cross-variable date-ordering issue.
    rfx_start_original = dm.loc[1, "RFXSTDTC"]
    rfx_end_original = dm.loc[1, "RFXENDTC"]
    dm.loc[1, "RFXSTDTC"] = rfx_end_original
    dm.loc[1, "RFXENDTC"] = rfx_start_original
    write_xport(dm, dm_meta, dm_path)


# ---------------------------------------------------------------------------
# Variant 2: mess-encoding — XPT with CP1252 bytes in a string field.
#
# XPT v5 is byte-exact: string columns are fixed-width raw bytes with no
# encoding metadata. Real-world CRO deliveries occasionally arrive with
# Latin-1 / CP1252 / CP1250 bytes in subject- or site-related text fields,
# which a downstream UTF-8 reader will reject with UnicodeDecodeError.
#
# We patch SITEID's first row from "701" to the CP1252 byte sequence for
# "Mün" (M=0x4d, ü=0xfc, n=0x6e). 0xfc is an invalid UTF-8 start byte, so
# pyreadstat.read_xport(...) without an explicit encoding parameter raises
# UnicodeDecodeError — exactly the failure mode we want to demonstrate.
# ---------------------------------------------------------------------------
def variant_encoding(target: Path) -> None:
    reset_dir(target)
    copy_clean_into(target)

    dm_path = target / "DM.xpt"
    dm, dm_meta = pyreadstat.read_xport(str(dm_path))

    # Use a unique 3-char ASCII marker to make the post-write byte patch safe.
    marker = "QQQ"
    if (dm["SITEID"].astype(str) == marker).any():
        sys.exit(f"marker {marker!r} already present in SITEID; pick a different one")
    dm.loc[0, "SITEID"] = marker
    write_xport(dm, dm_meta, dm_path)

    # CP1252 bytes for "Mün" (3 bytes, exact SITEID storage width).
    cp1252_replacement = b"\x4d\xfc\x6e"
    raw = dm_path.read_bytes()
    if raw.count(b"QQQ") != 1:
        sys.exit(f"expected exactly one occurrence of marker; found {raw.count(b'QQQ')}")
    dm_path.write_bytes(raw.replace(b"QQQ", cp1252_replacement))


# ---------------------------------------------------------------------------
# Variant 3: mess-missing-domain — clean/ minus AE.xpt.
#
# Tests the validator's handling of an incomplete delivery. config.yaml
# declares AE as a required domain for the SDTM full package; its absence
# should be flagged at the package-completeness level (pre-flight), not at
# the rules-engine level.
# ---------------------------------------------------------------------------
def variant_missing_domain(target: Path) -> None:
    reset_dir(target)
    copy_clean_into(target, exclude={"AE.xpt"})


# ---------------------------------------------------------------------------
# Variant 4: mess-inconsistent-values — SITEID written as varying free text.
#
# Real CRO deliveries occasionally arrive with site labels that vary in
# casing or wording across rows (e.g., "NY" / "New York" / "new york"),
# making cross-row aggregation unreliable. SITEID is normally a code; we
# overload it here to demonstrate the inconsistency-detection path.
# ---------------------------------------------------------------------------
def variant_inconsistent_values(target: Path) -> None:
    reset_dir(target)
    copy_clean_into(target)

    dm_path = target / "DM.xpt"
    dm, dm_meta = pyreadstat.read_xport(str(dm_path))

    # SITEID storage width is 3 bytes, so the original column cannot hold
    # "New York" or "new york". Promote the column to a wider storage by
    # constructing fresh values; pyreadstat infers the width from the data.
    site_variants = ["NY", "New York", "new york"]
    new_siteid = []
    for index, value in enumerate(dm["SITEID"].astype(str)):
        if value == "701":
            new_siteid.append(site_variants[index % len(site_variants)])
        else:
            new_siteid.append(value)
    dm["SITEID"] = new_siteid
    write_xport(dm, dm_meta, dm_path)


VARIANTS = [
    ("injection", variant_injection),
    ("mess-encoding", variant_encoding),
    ("mess-missing-domain", variant_missing_domain),
    ("mess-inconsistent-values", variant_inconsistent_values),
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.parse_args()

    ensure_clean()
    for name, builder in VARIANTS:
        target = HERE / name
        builder(target)
        files = sorted(path.name for path in target.iterdir())
        print(f"built  {name:30s}  -> {', '.join(files)}", file=sys.stderr)
    print("done.", file=sys.stderr)


if __name__ == "__main__":
    main()
