# ctgov-mcp — ClinicalTrials.gov API v2 MCP server

An [MCP](https://modelcontextprotocol.io) server that exposes the
[ClinicalTrials.gov API v2](https://clinicaltrials.gov/data-api/api) to agents. It is the
input source for the protocol-to-synthetic-SDTM pipeline (Stage 1: fetch a study record by
NCT id). The CT.gov API needs **no API key**.

Tools return the API JSON **verbatim** so the pipeline can persist the raw study record and
capture its `dataTimestamp` for provenance.

## Tools

| Tool | Purpose |
|------|---------|
| `get_study(nct_id, fields?, markup_format?, format?)` | Fetch one study record by NCT id. |
| `search_studies(cond?, term?, intr?, titles?, sponsor?, status?, fields?, page_size?, page_token?, count_total?, sort?)` | Search studies; token-paginated. |
| `get_study_metadata()` | Field data dictionary (valid field paths + types). |
| `get_enums()` | Enumerated value sets (status, phase, sex, …). |
| `get_field_values(fields)` | Value distributions for a field (`/stats/field/values`). |
| `get_api_version()` | `{apiVersion, dataTimestamp}` for the run manifest. |
| `list_study_documents(nct_id)` | `documentSection` (protocol/SAP PDF links). |

## Install

```bash
cd mcp/ctgov
uv venv --python 3.11 .venv
uv pip install -e ".[dev]" --python .venv
```

## Run

```bash
.venv/bin/ctgov-mcp        # stdio transport
```

## Register (this repo's .mcp.json)

```json
{
  "mcpServers": {
    "ctgov": {
      "command": "/Users/vedha/Repo/ct_to_synthetic_data/mcp/ctgov/.venv/bin/ctgov-mcp",
      "args": []
    }
  }
}
```

## Configuration (env vars)

| Var | Default | Effect |
|-----|---------|--------|
| `CTGOV_BASE_URL` | `https://clinicaltrials.gov/api/v2` | Override the API base (e.g. for testing). |
| `CTGOV_SNAPSHOT_DIR` | _unset_ | If set, every response is also written to this dir as JSON, for offline/reproducible replay. |

## Tests

```bash
.venv/bin/pytest                 # offline unit tests (fixtures)
.venv/bin/pytest -m live         # live smoke tests (hit CT.gov)
.venv/bin/pytest -m "not live"   # explicitly skip live tests
```
