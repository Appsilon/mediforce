"""MCP server exposing the ClinicalTrials.gov API v2.

Tools are thin wrappers that return the API JSON verbatim (Stage 1 of the pipeline must
persist the raw study record and capture ``dataTimestamp``). A shared CtGovClient handles
retries/backoff; responses are optionally snapshotted to disk for reproducibility.
"""

from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from .cache import write_snapshot
from .client import CtGovClient, CtGovNotFound

mcp = FastMCP("ctgov")

# One client for the process lifetime.
_client = CtGovClient()


def _call(path: str, params: dict[str, Any] | None = None) -> Any:
    """Run a GET, snapshot it (if enabled), and surface errors as plain exceptions
    that FastMCP reports back to the caller."""
    result = _client.get(path, params)
    write_snapshot(path, params, result)
    return result


@mcp.tool()
def get_study(
    nct_id: str,
    fields: str | None = None,
    markup_format: str = "markdown",
    format: str = "json",
) -> Any:
    """Fetch a single ClinicalTrials.gov study record by NCT id.

    Returns the raw study JSON (protocolSection, derivedSection, resultsSection,
    documentSection, hasResults). This is the pipeline's Stage-1 input.

    Args:
        nct_id: The trial id, e.g. "NCT04280705".
        fields: Optional comma-separated field paths to trim the record
            (e.g. "IdentificationModule,EligibilityModule").
        markup_format: "markdown" or "legacy" — controls rendering of free-text fields.
        format: "json" (default) or "csv".
    """
    nct = nct_id.strip().upper()
    if not nct.startswith("NCT"):
        raise ValueError(f"Invalid NCT id '{nct_id}' (expected to start with 'NCT').")
    params = {"fields": fields, "markupFormat": markup_format, "format": format}
    try:
        return _call(f"studies/{nct}", params)
    except CtGovNotFound:
        raise ValueError(
            f"No study found for '{nct}'. Check the NCT id at clinicaltrials.gov."
        ) from None


@mcp.tool()
def search_studies(
    cond: str | None = None,
    term: str | None = None,
    intr: str | None = None,
    titles: str | None = None,
    sponsor: str | None = None,
    status: str | None = None,
    fields: str | None = None,
    page_size: int = 10,
    page_token: str | None = None,
    count_total: bool = False,
    sort: str | None = None,
) -> Any:
    """Search ClinicalTrials.gov studies. Returns {totalCount?, studies[], nextPageToken?}.

    Pagination is token-based: pass the returned ``nextPageToken`` as ``page_token`` to
    fetch the next page.

    Args:
        cond: Condition/disease query (query.cond).
        term: Other terms query (query.term).
        intr: Intervention query (query.intr).
        titles: Title/acronym query (query.titles).
        sponsor: Sponsor query (query.spons).
        status: Filter by overall status, e.g. "RECRUITING" or
            "RECRUITING|COMPLETED" (filter.overallStatus).
        fields: Comma-separated field paths to return per study.
        page_size: Results per page (1-1000, default 10).
        page_token: Token from a prior response's nextPageToken.
        count_total: If true, include totalCount on the first page.
        sort: Sort spec, e.g. "LastUpdatePostDate:desc".
    """
    params = {
        "query.cond": cond,
        "query.term": term,
        "query.intr": intr,
        "query.titles": titles,
        "query.spons": sponsor,
        "filter.overallStatus": status,
        "fields": fields,
        "pageSize": max(1, min(int(page_size), 1000)),
        "pageToken": page_token,
        "countTotal": "true" if count_total else None,
        "sort": sort,
    }
    return _call("studies", params)


@mcp.tool()
def get_study_metadata() -> Any:
    """Return the ClinicalTrials.gov field data dictionary (nested name/type/children tree).

    Use this to discover valid ``fields`` paths and field types when mapping study data to USDM.
    """
    return _call("studies/metadata")


@mcp.tool()
def get_enums() -> Any:
    """Return the enumerated value sets used by study fields (e.g. status, phase, sex).

    Each entry is {type, values:[{value, legacyValue}]}.
    """
    return _call("studies/enums")


@mcp.tool()
def get_field_values(fields: str) -> Any:
    """Return value distributions for the given field(s) via /stats/field/values.

    Args:
        fields: Comma-separated field name(s), e.g. "Phase" or "Phase,OverallStatus".
    """
    return _call("stats/field/values", {"fields": fields})


@mcp.tool()
def get_api_version() -> Any:
    """Return {apiVersion, dataTimestamp} — the provenance anchor for a pipeline run's manifest."""
    return _call("version")


@mcp.tool()
def list_study_documents(nct_id: str) -> Any:
    """Return the documentSection for a study (protocol/SAP PDF links, when available).

    Thin wrapper over get_study with fields=DocumentSection. Feeds future protocol-PDF
    (Schedule of Activities) extraction.
    """
    nct = nct_id.strip().upper()
    if not nct.startswith("NCT"):
        raise ValueError(f"Invalid NCT id '{nct_id}' (expected to start with 'NCT').")
    try:
        record = _call(f"studies/{nct}", {"fields": "DocumentSection", "format": "json"})
    except CtGovNotFound:
        raise ValueError(f"No study found for '{nct}'.") from None
    return record.get("documentSection", {}) if isinstance(record, dict) else record


def main() -> None:
    """Console-script entry point: run the MCP server over stdio."""
    mcp.run()


if __name__ == "__main__":
    main()
