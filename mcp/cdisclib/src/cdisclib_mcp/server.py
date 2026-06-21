"""MCP server exposing the CDISC Library API.

Tools are thin wrappers that return the API JSON verbatim. They serve the pipeline's
metadata-resolution stages:

  * Stage 3 (match activities to Biomedical Concepts): ``search``, ``list_biomedical_concepts``,
    ``get_biomedical_concept``, ``list_bc_categories`` — retrieve candidate BCs, then the LLM
    selects from them (it never invents a conceptId).
  * Stage 4 (resolve SDTM specs): ``list_dataset_specializations``, ``get_dataset_specialization``
    — the ``variables[]`` of a Dataset Specialization are the variable-level spec + the Stage-5
    value-constraint set.
  * Stage 5 (populate datasets): ``get_codelist`` — Controlled Terminology to sample coded values.
  * Provenance/manifest: ``list_ct_packages``, ``get_products`` — pin CT package date + product
    versions for the run manifest.

A shared CdiscLibraryClient handles auth (api-key header), retries/backoff; responses are
optionally snapshotted to disk for reproducibility.
"""

from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from .cache import write_snapshot
from .client import CdiscLibraryClient, CdiscNotFound

mcp = FastMCP("cdisclib")

# One client for the process lifetime.
_client = CdiscLibraryClient()

# Co-resident API namespaces (see client docstring).
_COSMOS = "cosmos/v2/mdr"  # Biomedical Concepts + SDTM Dataset Specializations
_MDR = "mdr"  # Controlled Terminology, search, product index


def _call(path: str, params: dict[str, Any] | None = None) -> Any:
    """Run a GET, snapshot it (if enabled), and surface errors as plain exceptions
    that FastMCP reports back to the caller."""
    result = _client.get(path, params)
    write_snapshot(path, params, result)
    return result


# --- Search ---------------------------------------------------------------------------------


@mcp.tool()
def search(q: str, page_size: int = 10, start: int = 1, type: str | None = None) -> Any:
    """Full-text search across the CDISC Library. Returns {totalHits, hasMore, hits[]}.

    Stage-3 candidate retrieval: find Biomedical Concepts / CT terms by keyword (e.g. an
    activity label or NCIt synonym) before the LLM selects the best match. Each hit carries
    a ``conceptId``, ``codelist``, ``type``, ``definition``, and ``href``.

    Args:
        q: Search query (e.g. "systolic blood pressure", "glucose").
        page_size: Results per page (default 10).
        start: 1-based index of the first result (for pagination).
        type: Optional result-type filter, e.g. "Biomedical Concept", "Codelist", "Term".
    """
    params = {"q": q, "pageSize": max(1, int(page_size)), "start": max(1, int(start)), "type": type}
    return _call(f"{_MDR}/search", params)


# --- Biomedical Concepts (COSMoS) -----------------------------------------------------------


@mcp.tool()
def list_biomedical_concepts() -> Any:
    """Return the Biomedical Concept catalogue index (latest BC package).

    The ``_links.biomedicalConcepts[]`` list gives {href, title} per BC — the candidate set
    for Stage-3 matching. Use ``get_biomedical_concept`` to fetch a concept's detail.
    """
    return _call(f"{_COSMOS}/bc/biomedicalconcepts")


@mcp.tool()
def get_biomedical_concept(concept_id: str) -> Any:
    """Fetch a single Biomedical Concept by NCIt conceptId (e.g. "C105585").

    Returns the BC detail: shortName, synonyms, definition, categories, ncitCode, resultScales,
    and ``dataElementConcepts[]`` (the data elements that drive SDTM variable derivation in
    Stage 4). This is the metadata the LLM-selected BC contributes to the lineage graph.

    Args:
        concept_id: The BC's NCIt conceptId, e.g. "C105585".
    """
    cid = concept_id.strip()
    try:
        return _call(f"{_COSMOS}/bc/biomedicalconcepts/{cid}")
    except CdiscNotFound:
        raise ValueError(
            f"No Biomedical Concept found for '{cid}'. List candidates with "
            "list_biomedical_concepts or search()."
        ) from None


@mcp.tool()
def list_bc_categories() -> Any:
    """Return the Biomedical Concept category index (e.g. "Laboratory Tests", "Vital Signs").

    Useful for narrowing the candidate BC set by domain area during Stage-3 matching.
    """
    return _call(f"{_COSMOS}/bc/categories")


# --- SDTM Dataset Specializations (COSMoS) --------------------------------------------------


@mcp.tool()
def list_dataset_specializations() -> Any:
    """Return the SDTM Dataset Specialization index (latest specialization package).

    The ``_links.datasetSpecializations[]`` list gives {href, title} per specialization
    (e.g. "VSBP" systolic/diastolic BP, "ALBSERPL" albumin). Stage 4 fetches the matched
    BC's specialization(s) with ``get_dataset_specialization`` to build the variable-level spec.
    """
    return _call(f"{_COSMOS}/specializations/sdtm/datasetspecializations")


@mcp.tool()
def get_dataset_specialization(spec_id: str) -> Any:
    """Fetch a single SDTM Dataset Specialization by id (e.g. "VSBP", "ALBSERPL").

    Returns: datasetSpecializationId, domain, shortName, source, sdtmigStartVersion/EndVersion,
    and ``variables[]`` — each variable's name, role, dataType, length, codelist/subsetCodelist,
    valueList, assignedTerm, mandatoryVariable, mandatoryValue, originType, and VLM target. These
    variables ARE the Stage-4 per-domain spec and the Stage-5 value-constraint set.

    Args:
        spec_id: The dataset specialization id, e.g. "VSBP".
    """
    sid = spec_id.strip()
    try:
        return _call(f"{_COSMOS}/specializations/sdtm/datasetspecializations/{sid}")
    except CdiscNotFound:
        raise ValueError(
            f"No SDTM Dataset Specialization found for '{sid}'. "
            "List ids with list_dataset_specializations."
        ) from None


# --- Controlled Terminology (MDR) -----------------------------------------------------------


@mcp.tool()
def list_ct_packages() -> Any:
    """Return the Controlled Terminology package index.

    Each entry is {href, title, type} for a dated CT package (sdtmct-YYYY-MM-DD, cdashct-…,
    adamct-…, sendct-…). Pick and pin one package date in the run manifest for reproducibility.
    """
    return _call(f"{_MDR}/ct/packages")


@mcp.tool()
def get_codelist(codelist_id: str, package: str | None = None, scope: str = "sdtmct") -> Any:
    """Fetch a Controlled Terminology codelist by conceptId.

    Two views, depending on ``package``:
      * With ``package`` (recommended for the pipeline): returns the codelist as it exists in
        that dated package, including ``terms[]`` — the permitted values Stage-5 samples for a
        coded SDTM variable. Pin this package date in the run manifest for reproducibility.
      * Without ``package``: returns the version-agnostic "root" view, whose
        ``_links.versions[]`` lists every dated package this codelist appears in. Use it to
        discover/choose a version; it does NOT contain terms.

    Args:
        codelist_id: The codelist's NCIt conceptId, e.g. "C66741" (VS Test Code).
        package: Dated CT package to pin, e.g. "sdtmct-2026-03-27". When set, returns the
            codelist + terms from that package.
        scope: CT scope for the root view when ``package`` is not given — one of "sdtmct",
            "cdashct", "adamct", "sendct" (default "sdtmct").
    """
    cl = codelist_id.strip()
    if package:
        path = f"{_MDR}/ct/packages/{package.strip()}/codelists/{cl}"
        miss_hint = f"in package '{package}'"
    else:
        path = f"{_MDR}/root/ct/{scope.strip()}/codelists/{cl}"
        miss_hint = f"in the latest '{scope}' root view"
    try:
        return _call(path)
    except CdiscNotFound:
        raise ValueError(
            f"No codelist '{cl}' found {miss_hint}. Verify the conceptId/scope, "
            "or use search(q=..., type='Codelist')."
        ) from None


# --- Provenance / manifest ------------------------------------------------------------------


@mcp.tool()
def get_products() -> Any:
    """Return the CDISC Library product index (versions of SDTM, SDTMIG, CDASH, ADaM, CT, …).

    Provenance anchor for the run manifest: pin the standard versions a pipeline run resolved
    against (USDM/SDTMIG version, CT package date).
    """
    return _call(f"{_MDR}/products")


def main() -> None:
    """Console-script entry point: run the MCP server over stdio."""
    mcp.run()


if __name__ == "__main__":
    main()
