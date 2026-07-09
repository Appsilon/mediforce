"""5-class router for CDISC validation findings.

Pure deterministic classification — no LLM, no I/O. Lives next to validate.py
because pharma compliance / reproducibility / cost reasons preclude letting
the LLM agent route automated steps. The agent reads the resulting class
from input.json and renders the report; it does not classify.

## Glossary (CDISC rule prefix → category)

| Prefix     | Category               | Source                     |
|------------|------------------------|----------------------------|
| SD0001-49  | Structure (SDTM)       | CDISC Conformance Rules    |
| SD0050-99  | Controlled Terminology | per-domain CT checks       |
| AD0001-99  | Structure (ADaM)       | ADaM IG                    |
| CT####     | Controlled Terminology | CT codelist checks         |
| CG####     | Consistency General    | cross-record / cross-domain|
| FDA####    | FDA Business Rules     | FDA submission expectations|
| PMDA####   | PMDA                   | Japanese regulator         |
| anything   | Other                  | unrecognised — surface     |

Severity field is read as-is. Missing severity is treated as `Major`
(conservative default per Q1 of the v0.1 product decisions).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal, TypedDict


Classification = Literal["clean", "minor-fix", "recovery", "escalate", "chaos"]


class Finding(TypedDict, total=False):
    rule_id: str
    core_id: str
    domain: str
    severity: str  # Critical / Major / Minor / Warning
    message: str
    issues: int


@dataclass(frozen=True)
class RouterThresholds:
    """Tunable thresholds. Defaults here; future studies/<id>/router-rules.yaml may override."""

    # Min ratio of Controlled-Terminology findings to qualify as minor-fix
    minor_fix_ct_ratio: float = 0.80
    # Default expected-domains list for chaos calculation when EXPECTED_DOMAINS
    # is not supplied by the caller
    default_expected_domains: tuple[str, ...] = ("DM", "AE", "LB", "EX", "VS", "MH", "CM")
    # Chaos triggers when Critical-Structure domains exceed this fraction of expected
    chaos_critical_structure_fraction: float = 0.50


@dataclass(frozen=True)
class ClassificationResult:
    classification: Classification
    reason: str  # 1-2 sentence text that explains which rule fired
    script_failed_flag: bool


def _category_of(finding: Finding) -> str:
    """Map a finding to one of: Structure / ControlledTerminology / Consistency / FDA / PMDA / Other."""
    raw = (finding.get("rule_id") or finding.get("core_id") or "").strip().upper()
    if not raw:
        return "Other"
    # Allow numeric range matching for SD prefix
    if raw.startswith("SD") and len(raw) >= 6:
        try:
            num = int(raw[2:6])
            if 1 <= num <= 49:
                return "Structure"
            if 50 <= num <= 99:
                return "ControlledTerminology"
        except ValueError:
            pass
    if raw.startswith("AD"):
        return "Structure"
    if raw.startswith("CT"):
        return "ControlledTerminology"
    if raw.startswith("CG"):
        return "Consistency"
    if raw.startswith("FDA"):
        return "FDA"
    if raw.startswith("PMDA"):
        return "PMDA"
    return "Other"


def _severity_of(finding: Finding) -> str:
    raw = (finding.get("severity") or "").strip()
    if not raw:
        # Conservative default per Q1 — missing severity treated as Major
        return "Major"
    return raw


def _critical_structure_domains(findings: Iterable[Finding]) -> set[str]:
    """Return the set of unique domains with at least one Critical Structure finding."""
    out: set[str] = set()
    for finding in findings:
        if _category_of(finding) != "Structure":
            continue
        if _severity_of(finding).lower() != "critical":
            continue
        domain = (finding.get("domain") or "").strip().upper()
        if domain:
            out.add(domain)
    return out


def classify(
    *,
    script_status: str,
    findings: list[Finding],
    expected_domains: list[str] | None = None,
    thresholds: RouterThresholds | None = None,
) -> ClassificationResult:
    """Classify a delivery into one of the five v0.1 classes.

    Evaluation order (first match wins):
      1. scriptStatus=failed → chaos
      2. Critical Structure findings span > 50% of expected domains → chaos
      3. Critical Structure findings span >= 2 unique domains → escalate
      4. Critical Structure findings in exactly 1 unique domain → recovery
      5. >= 80% of findings are Controlled Terminology → minor-fix
      6. findingsCount == 0 → clean
      7. fallback (findings exist, none of the above) → recovery

    The fallback at (7) reflects that an ambiguous has-findings case still
    surfaces to a human reviewer. It is NOT escalate — only multi-domain
    critical structure failures bypass the human.
    """
    thresholds = thresholds or RouterThresholds()
    expected = tuple(
        domain.strip().upper()
        for domain in (expected_domains or thresholds.default_expected_domains)
        if domain.strip()
    )
    findings_count = len(findings)

    # 1. chaos — script failed
    if script_status != "ok":
        return ClassificationResult(
            "chaos",
            f"Validation script failed (scriptStatus={script_status!r}); cannot trust findings.",
            script_failed_flag=True,
        )

    crit_struct_domains = _critical_structure_domains(findings)

    # 2. chaos — critical structure across > 50% of expected domains
    if expected and len(crit_struct_domains) > thresholds.chaos_critical_structure_fraction * len(expected):
        return ClassificationResult(
            "chaos",
            f"Critical Structure findings in {len(crit_struct_domains)} of {len(expected)} expected domains "
            f"({len(crit_struct_domains)}/{len(expected)} > {thresholds.chaos_critical_structure_fraction:.0%}).",
            script_failed_flag=False,
        )

    # 3. escalate — critical structure in >= 2 unique domains
    if len(crit_struct_domains) >= 2:
        return ClassificationResult(
            "escalate",
            f"Critical Structure findings in {len(crit_struct_domains)} unique domains "
            f"({', '.join(sorted(crit_struct_domains))}); no recovery path.",
            script_failed_flag=False,
        )

    # 4. recovery — critical structure in exactly 1 unique domain
    if len(crit_struct_domains) == 1:
        domain = next(iter(crit_struct_domains))
        return ClassificationResult(
            "recovery",
            f"Critical Structure findings in single domain {domain}; other domains parseable.",
            script_failed_flag=False,
        )

    # 5. minor-fix — >= 80% findings are Controlled Terminology
    if findings_count > 0:
        ct_count = sum(1 for finding in findings if _category_of(finding) == "ControlledTerminology")
        ratio = ct_count / findings_count
        if ratio >= thresholds.minor_fix_ct_ratio:
            return ClassificationResult(
                "minor-fix",
                f"{ct_count}/{findings_count} findings ({ratio:.0%}) are Controlled Terminology; pattern looks fixable.",
                script_failed_flag=False,
            )

    # 6. clean — no findings
    if findings_count == 0:
        return ClassificationResult(
            "clean",
            "No findings — delivery passes all CDISC CORE rules.",
            script_failed_flag=False,
        )

    # 7. fallback — has findings but no specific pattern
    return ClassificationResult(
        "recovery",
        f"{findings_count} findings without a clear pattern; surfacing to human reviewer.",
        script_failed_flag=False,
    )
