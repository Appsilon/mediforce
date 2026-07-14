# cdisclib-mcp

An MCP server (Python, FastMCP over stdio) wrapping the **CDISC Library API** — Biomedical
Concepts, SDTM Dataset Specializations, Controlled Terminology, and full-text search. It is the
metadata backbone of the protocol-to-synthetic-SDTM pipeline (Stages 3–5): retrieve candidate
Biomedical Concepts, resolve their SDTM Dataset Specializations into variable-level specs, and
pull Controlled Terminology codelists to constrain synthetic values.

Tools return the API JSON **verbatim** so raw records can be persisted and their package
versions pinned in the run manifest for provenance.

## Auth

The CDISC Library requires a key (your **cdiscID**). Set it in the environment:

```bash
export CDISC_API_KEY=<your-cdiscID>
```

A request without a key raises a clear error before any network call. A `401/403` from the
API surfaces as an auth error (key invalid or lacking access).

## Tools

| Tool | Endpoint | What it does |
|------|----------|--------------|
| `search(q, page_size?, start?, type?)` | `mdr/search` | Full-text search → `{totalHits, hasMore, hits[]}`. Stage-3 candidate retrieval. |
| `list_biomedical_concepts()` | `cosmos/v2/mdr/bc/biomedicalconcepts` | BC catalogue index (candidate set for matching). |
| `get_biomedical_concept(concept_id)` | `cosmos/v2/mdr/bc/biomedicalconcepts/{id}` | One BC: synonyms, definition, categories, `dataElementConcepts[]`. |
| `list_bc_categories()` | `cosmos/v2/mdr/bc/categories` | BC category index. |
| `list_dataset_specializations()` | `cosmos/v2/mdr/specializations/sdtm/datasetspecializations` | SDTM Dataset Specialization index. |
| `get_dataset_specialization(spec_id)` | `…/datasetspecializations/{id}` | One specialization: `domain` + `variables[]` (the Stage-4 spec & Stage-5 constraints). |
| `list_ct_packages()` | `mdr/ct/packages` | Dated CT package index (pin one in the manifest). |
| `get_codelist(codelist_id, package?, scope?)` | `mdr/root/ct/{scope}/codelists/{id}` or `mdr/ct/packages/{package}/codelists/{id}` | A codelist + its `terms[]`. Default: latest root view (`scope=sdtmct`); pass `package` to pin. |
| `get_products()` | `mdr/products` | Product/version index — manifest provenance. |

## Config (env vars)

| Var | Default | Effect |
|-----|---------|--------|
| `CDISC_API_KEY` | _unset (required)_ | The cdiscID sent as the `api-key` header. |
| `CDISC_LIBRARY_BASE_URL` | `https://library.cdisc.org/api` | Override the API base. |
| `CDISCLIB_SNAPSHOT_DIR` | _unset_ | If set, every response is also written to disk as JSON for offline/reproducible replay. |

## Setup (one-time)

```bash
cd mcp/cdisclib
uv venv --python 3.11 .venv
uv pip install -e ".[dev]" --python .venv
```

## Start / register

Registered in the repo's `.mcp.json` as `cdisclib` (stdio command =
`mcp/cdisclib/.venv/bin/cdisclib-mcp`), with `CDISC_API_KEY` passed through `env`. Reload the
Claude Code session to pick it up. To run standalone:

```bash
CDISC_API_KEY=<key> mcp/cdisclib/.venv/bin/cdisclib-mcp   # stdio transport
```

## Tests

```bash
cd mcp/cdisclib
.venv/bin/pytest -m "not live"   # offline unit tests (fixtures)
CDISC_API_KEY=<key> .venv/bin/pytest -m live   # live smoke tests (hit the Library)
```

## Postman collection (full API surface)

The MCP exposes the **9 tools the pipeline needs**, not the whole CDISC Library API. For
exploratory/manual testing of the *entire* surface, import
[`cdisc-library.postman_collection.json`](./cdisc-library.postman_collection.json) into Postman.
It contains **127 GET requests** grouped into the four specs CDISC publishes:

| Folder | Base | Requests |
|--------|------|----------|
| 1. CDISC Library API (core) | `/api` | 108 (89 from the official `share-2.0/1.1.0` swagger + 19 SwaggerHub-mirror extras, flagged in their description), sub-foldered by OpenAPI tag |
| 2. COSMoS v1 (BC + SDTM Dataset Specialization) | `/api/cosmos/v1` | 6 |
| 3. COSMoS v2 — Biomedical Concept | `/api/cosmos/v2` | 6 |
| 4. COSMoS v2 — Dataset Specialization | `/api/cosmos/v2` | 7 |

URLs are built as `{{baseUrl}}/mdr/...` (core) and `{{baseUrl}}/cosmos/vN/mdr/...` (COSMoS), where
`baseUrl` **includes** `/api`. Optional query params are pre-added but disabled; path params use
Postman `:var` syntax (fill them under a request's *Path Variables*).

### Authenticating (environments)

Two environment files set `baseUrl` + the `cdisc_api_key` variable, which the collection sends as
the `api-key` header on every request. In Postman: **Import** the environment, then select it from
the environment dropdown (top-right).

| Environment file | `baseUrl` | `cdisc_api_key` | Notes |
|------------------|-----------|-----------------|-------|
| `cdisc-library.production.postman_environment.json` | `https://library.cdisc.org/api` | **your key (pre-filled, secret)** | Real data. **gitignored** — it holds the actual key. |
| `cdisc-library.mock.postman_environment.json` | `https://virtserver.swaggerhub.com/CDISC1/share-2.0/1.1.0` | _(empty)_ | SwaggerHub mock; example payloads, no auth. Covers the **core** folder only — the COSMoS folders are not mocked (they 404). |

> ⚠️ The production environment file contains your live `CDISC_API_KEY`. It is listed in
> `.gitignore` so it is never committed. To share the collection with a teammate, hand them only
> the collection + the mock environment, and let them paste their own key into a production
> environment. The key is stored as a Postman `secret`-type variable (masked in the UI).

If you'd rather not use an environment at all, set the `cdisc_api_key` **collection variable**
directly (Collection → Variables) — but prefer the environment so the secret stays out of the
shared collection file.

Regenerate it after CDISC updates their specs (downloads the source specs itself):

```bash
.venv/bin/python tools/build_postman_collection.py
```

Sources: core = official CDISC swagger unioned with the SwaggerHub mirror
`lexjansen/cdisc-library_api 1.8`; COSMoS = `github.com/cdisc-org/COSMoS`. Caveats: the official
core spec declares `basicAuth`, but the live API uses the `api-key` header (the collection is
configured for api-key). Mirror-only paths are flagged — some are live (`/mdr/rules`,
`/mdr/products/QrsInstrument`), some 404 (`/mdr/suggest`).
