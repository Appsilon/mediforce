"""Tests for the deterministic 5-class router (router_rules.py).

Covers the 11 cases from the v0.1 router spec test plan:
  1.  empty findings + ok                                        → clean
  2.  4 CT + 1 Major Structure (boundary 4/5 = 80%)              → minor-fix
  3.  3 CT + 2 Major Structure (60%)                             → NOT minor-fix
  4.  1 critical Structure DM + 5 Minor AE                       → recovery
  5.  critical Structure DM + critical Structure AE              → escalate
  6.  scriptStatus=failed                                        → chaos
  7.  critical Structure in 4/7 expected domains                 → chaos
  8.  crit Struct dom1 + crit Struct dom2 (default expected)     → escalate
  9.  findingsCount=0, scriptStatus=ok                           → clean (alias of 1)
  10. 1 CT only (boundary L1=1, 1/1=100%)                        → minor-fix
  11. missing severity field                                     → treated as Major

Run from repo root:
  python3 -m unittest apps/landing-zone/scripts/test_router.py -v
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from router_rules import Finding, classify  # noqa: E402


def make_finding(
    *,
    rule_id: str = "",
    core_id: str = "",
    domain: str = "",
    severity: str = "",
    message: str = "",
    issues: int = 1,
) -> Finding:
    """Build a Finding TypedDict, only including non-empty keys."""
    out: Finding = {}
    if rule_id:
        out["rule_id"] = rule_id
    if core_id:
        out["core_id"] = core_id
    if domain:
        out["domain"] = domain
    if severity:
        out["severity"] = severity
    if message:
        out["message"] = message
    out["issues"] = issues
    return out


class TestRouterClassification(unittest.TestCase):
    def test_01_empty_findings_ok_is_clean(self) -> None:
        result = classify(script_status="ok", findings=[])
        self.assertEqual(result.classification, "clean")
        self.assertFalse(result.script_failed_flag)

    def test_02_four_ct_one_major_structure_is_minor_fix(self) -> None:
        # 4 CT + 1 Major Structure → CT ratio = 4/5 = 80% boundary → minor-fix
        findings: list[Finding] = [
            make_finding(rule_id="CT0001", domain="DM", severity="Minor"),
            make_finding(rule_id="CT0002", domain="AE", severity="Minor"),
            make_finding(rule_id="CT0003", domain="LB", severity="Minor"),
            make_finding(rule_id="CT0004", domain="VS", severity="Minor"),
            make_finding(rule_id="SD0001", domain="DM", severity="Major"),
        ]
        result = classify(script_status="ok", findings=findings)
        self.assertEqual(result.classification, "minor-fix")
        self.assertFalse(result.script_failed_flag)

    def test_03_three_ct_two_major_structure_is_not_minor_fix(self) -> None:
        # 3 CT + 2 Major Structure → CT ratio = 3/5 = 60% < 80% → NOT minor-fix
        # No critical Structure → not recovery/escalate/chaos. Fallback → recovery.
        findings: list[Finding] = [
            make_finding(rule_id="CT0001", domain="DM", severity="Minor"),
            make_finding(rule_id="CT0002", domain="AE", severity="Minor"),
            make_finding(rule_id="CT0003", domain="LB", severity="Minor"),
            make_finding(rule_id="SD0001", domain="DM", severity="Major"),
            make_finding(rule_id="SD0002", domain="AE", severity="Major"),
        ]
        result = classify(script_status="ok", findings=findings)
        self.assertNotEqual(result.classification, "minor-fix")
        self.assertEqual(result.classification, "recovery")
        self.assertFalse(result.script_failed_flag)

    def test_04_one_critical_structure_dm_plus_minor_ae_is_recovery(self) -> None:
        findings: list[Finding] = [
            make_finding(rule_id="SD0001", domain="DM", severity="Critical"),
            make_finding(rule_id="CT0010", domain="AE", severity="Minor"),
            make_finding(rule_id="CT0011", domain="AE", severity="Minor"),
            make_finding(rule_id="CT0012", domain="AE", severity="Minor"),
            make_finding(rule_id="CT0013", domain="AE", severity="Minor"),
            make_finding(rule_id="CT0014", domain="AE", severity="Minor"),
        ]
        result = classify(script_status="ok", findings=findings)
        self.assertEqual(result.classification, "recovery")
        self.assertFalse(result.script_failed_flag)

    def test_05_critical_structure_dm_and_ae_is_escalate(self) -> None:
        findings: list[Finding] = [
            make_finding(rule_id="SD0001", domain="DM", severity="Critical"),
            make_finding(rule_id="SD0002", domain="AE", severity="Critical"),
        ]
        result = classify(script_status="ok", findings=findings)
        self.assertEqual(result.classification, "escalate")
        self.assertFalse(result.script_failed_flag)

    def test_06_script_status_failed_is_chaos(self) -> None:
        result = classify(script_status="failed", findings=[])
        self.assertEqual(result.classification, "chaos")
        self.assertTrue(result.script_failed_flag)

    def test_07_critical_structure_in_four_of_seven_expected_is_chaos(self) -> None:
        # 4 / 7 = 57% > 50% → chaos via fraction trigger
        findings: list[Finding] = [
            make_finding(rule_id="SD0001", domain="DM", severity="Critical"),
            make_finding(rule_id="SD0002", domain="AE", severity="Critical"),
            make_finding(rule_id="SD0003", domain="LB", severity="Critical"),
            make_finding(rule_id="SD0004", domain="EX", severity="Critical"),
        ]
        result = classify(script_status="ok", findings=findings)
        self.assertEqual(result.classification, "chaos")
        self.assertFalse(result.script_failed_flag)

    def test_08_crit_struct_two_domains_default_expected_is_escalate(self) -> None:
        # Default expected = 7 domains; 2 critical-structure domains is 2/7 = 29%,
        # below the 50% chaos threshold → falls through to escalate.
        findings: list[Finding] = [
            make_finding(rule_id="SD0001", domain="DM", severity="Critical"),
            make_finding(rule_id="SD0002", domain="AE", severity="Critical"),
        ]
        result = classify(script_status="ok", findings=findings)
        self.assertEqual(result.classification, "escalate")
        self.assertNotEqual(result.classification, "recovery")
        self.assertFalse(result.script_failed_flag)

    def test_09_findings_count_zero_status_ok_is_clean(self) -> None:
        result = classify(script_status="ok", findings=[])
        self.assertEqual(result.classification, "clean")
        self.assertFalse(result.script_failed_flag)

    def test_10_single_ct_finding_is_minor_fix(self) -> None:
        # 1 CT total, 1/1 = 100% >= 80% → minor-fix
        findings: list[Finding] = [
            make_finding(rule_id="CT0001", domain="DM", severity="Minor"),
        ]
        result = classify(script_status="ok", findings=findings)
        self.assertEqual(result.classification, "minor-fix")
        self.assertFalse(result.script_failed_flag)

    def test_11_missing_severity_is_treated_as_major(self) -> None:
        # A Structure finding with no severity field. The conservative default
        # is Major, NOT Critical, so it must NOT trigger recovery/escalate/chaos.
        # With one such finding the classifier should fall through:
        #   crit_struct_domains is empty (severity defaulted to Major, not Critical)
        #   1 finding, 0 CT → ratio 0% < 80% → not minor-fix
        #   findingsCount > 0 → fallback recovery
        findings: list[Finding] = [
            make_finding(rule_id="SD0001", domain="DM"),  # no severity
        ]
        result = classify(script_status="ok", findings=findings)
        self.assertEqual(result.classification, "recovery")
        self.assertFalse(result.script_failed_flag)


if __name__ == "__main__":
    unittest.main()
