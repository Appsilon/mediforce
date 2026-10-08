---
status: accepted
audience: engineers
last_reviewed: 2026-10-07
---

# ADR-0026: Every MCP server lives in the workspace catalog; an agent only references one

**Date:** 2026-10-07
**Deciders:** Krystian Zieliński
**Partially supersedes:** [ADR-0022](./0022-image-catalog.md) §3, the sentences
contrasting the Image Catalog with an admin-gated Tool Catalog, and §4, the last
paragraph's claim that the two catalogs have different write gates. Both
catalogs are now written by any workspace member. The rest of ADR-0022 stands.

## Context

The Tool Catalog held stdio MCP servers only: a command, its args and env,
curated by workspace admins. An agent's stdio binding named an entry by
`catalogId`, so an agent could never spell out a command of its own.

HTTP MCP servers took the other route. Each agent binding carried its own
`url` and `auth` (headers or OAuth), and any member could write one. So the
same remote server bound to three agents was three copies of the same URL and
auth. The Tools page could list HTTP servers only by scanning every agent, and
had nowhere to add or edit one: clicking an HTTP card sent you to the agent.

## Decision

1. **The catalog holds both transports.** A `ToolCatalogEntry` is a union on
   `type`: `stdio` (`command`, `args`, `env`) or `http` (`url`, `auth`).
   Stored in `tool_catalog_entries` with a `type` column; stdio rows leave
   `url`/`auth` null, http rows leave `command`/`args`/`env` null.
2. **A binding only references an entry.** Both binding variants are
   `{ type, catalogId, allowedTools? }`. The binding's `type` must equal the
   entry's — the resolver throws `CatalogEntryTypeMismatchError` otherwise.
   Creating or updating an agent, or upserting one binding, rejects a
   `catalogId` the agent's workspace catalog does not hold.
3. **Any workspace member manages the catalog.** Create, update, delete,
   list (whole entries, `args`/`env` included) and tool discovery check
   namespace membership, not the admin role. Secrets stay `{{SECRET:name}}`
   references resolved at spawn time.
4. **OAuth stays per agent.** The provider, header name and template live on
   the http entry; the token is still stored per (agent, binding name), so
   each agent connects its own account. Creating an OAuth provider stays
   admin-only, since it holds a client secret; any member can list the
   workspace's providers by id and name to pick one for an entry.
5. **The Tools page becomes the MCP page** (`/{handle}/mcp`). It lists the
   catalog by transport and edits an entry in a dialog. It absorbs the admin
   Tool Catalog page and the per-tool detail page; the old URLs redirect.

Migration `0077` moves every inline HTTP binding into an http entry in the
agent's workspace — reusing an entry with the same url and auth, otherwise a
new one with an id slugged from the host — and rewrites the binding to
reference it. Binding names do not change, so connected OAuth tokens keep
resolving. An agent with no live workspace (platform-global, or its workspace
deleted) has nowhere to put the entry: its HTTP bindings are dropped and the
migration logs a WARNING naming each one, instead of failing the deploy.

## Consequences

- One HTTP server is defined once per workspace and shown once on the MCP page,
  with the agents that bind it.
- **Stdio entries are no longer admin-curated.** A member can now register a
  command that every agent in the workspace may bind. This was the gate that
  kept inline commands out of agents; the gate now sits at workspace
  membership. Agents still cannot carry a command inline, and every catalog
  write is audited (`tool_catalog_entry.*`).
- Changing an http entry's auth changes it for every agent bound to that
  server. The edit dialog says how many agents that is.
- A platform-global agent has no workspace catalog; its bindings are checked
  against the running workflow's namespace at resolution time only.
