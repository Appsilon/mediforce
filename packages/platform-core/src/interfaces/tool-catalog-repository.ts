import type { ToolCatalogEntry } from '../schemas/agent-mcp-binding.js';

/** Admin-curated catalog of stdio MCP server launch specs, keyed by id
 *  within a namespace. Entries are referenced by AgentMcpBinding.catalogId;
 *  keeping command/args only in this store closes the RCE surface that
 *  step-level inline command fields used to expose.
 *
 *  All operations are namespace-scoped: `namespaces/{handle}/toolCatalog/*`. */
export interface ToolCatalogRepository {
  /** Return the entry with the given id, or null when absent. */
  getById(namespace: string, entryId: string): Promise<ToolCatalogEntry | null>;
  /** Return all entries in the namespace, in no guaranteed order. */
  list(namespace: string): Promise<ToolCatalogEntry[]>;
  /** Create or replace an entry. Seed scripts use this to keep catalog
   *  contents reproducible across environments. */
  upsert(namespace: string, entry: ToolCatalogEntry): Promise<ToolCatalogEntry>;
  /** Remove an entry. No-op when id is absent. */
  delete(namespace: string, entryId: string): Promise<void>;
}
