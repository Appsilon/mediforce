"""Characterization tests for main.migrate_agent_runs row mapping.

`agent_runs` pulls `duration_ms` and token counts out of the run's
`envelope`. The envelope keys follow AgentOutputEnvelopeSchema:
`duration_ms` (snake_case) and `tokenUsage.{inputTokens,outputTokens}` —
NOT `durationMs` / `usage.promptTokens` (#534 regression). The dry-run path
logs the first mapped row and performs no Postgres write.
"""

from __future__ import annotations

from contextlib import contextmanager
from unittest.mock import MagicMock

from main import migrate_agent_runs

from tests.conftest import FakeDoc


class _FakePg:
    """Minimal Postgres stand-in: `load_process_instance_ids` selects ids."""

    def __init__(self, process_instance_ids: list[str]):
        self._ids = process_instance_ids

    @contextmanager
    def cursor(self):
        cur = MagicMock()
        cur.fetchall.return_value = [(pi,) for pi in self._ids]
        yield cur


def test_dry_run_maps_duration_and_tokens_from_envelope(fake_fs, caplog):
    runs = [
        FakeDoc(
            "run-1",
            {
                "processInstanceId": "pi-1",
                "workspace": "acme",
                "stepId": "step-a",
                "pluginId": "narrative-summary",
                "autonomyLevel": "L2",
                "status": "completed",
                "envelope": {
                    "confidence": 0.9,
                    "model": "claude-sonnet-4",
                    "duration_ms": 1234,
                    "tokenUsage": {"inputTokens": 100, "outputTokens": 42},
                },
            },
        ),
    ]
    fs = fake_fs({"agentRuns": runs})

    with caplog.at_level("INFO"):
        result = migrate_agent_runs(fs, _FakePg(["pi-1"]), dry_run=True, ws_cache={})

    assert result == {"inserted": 0, "skipped": 0, "errors": 0}
    assert "agent_runs" in caplog.text
    assert "'duration_ms': 1234" in caplog.text
    assert "'prompt_tokens': 100" in caplog.text
    assert "'completion_tokens': 42" in caplog.text


def test_dry_run_omits_token_fields_when_envelope_lacks_them(fake_fs, caplog):
    runs = [
        FakeDoc(
            "run-2",
            {
                "processInstanceId": "pi-1",
                "workspace": "acme",
                "stepId": "step-a",
                "pluginId": "compliance-check",
                "autonomyLevel": "L1",
                "status": "running",
                "envelope": {"confidence": 0.5, "model": "m", "duration_ms": 7},
            },
        ),
    ]
    fs = fake_fs({"agentRuns": runs})

    with caplog.at_level("INFO"):
        migrate_agent_runs(fs, _FakePg(["pi-1"]), dry_run=True, ws_cache={})

    # `_strip_none_defaults` drops missing token columns so the DB default fires.
    assert "'duration_ms': 7" in caplog.text
    assert "prompt_tokens" not in caplog.text
    assert "completion_tokens" not in caplog.text
