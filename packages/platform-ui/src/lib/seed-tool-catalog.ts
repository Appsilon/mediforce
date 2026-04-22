import type { FirestoreToolCatalogRepository } from '@mediforce/platform-infra';
import type { ToolCatalogEntry } from '@mediforce/platform-core';

/** Namespace → catalog entries to upsert at startup. Entries here are the
 *  ones required by checked-in workflow definitions; bespoke
 *  admin-configured entries will live in Firestore only. Keep this list
 *  small — it's not a catalog of all known MCP servers. */
const BUILTIN_CATALOG: Record<string, ToolCatalogEntry[]> = {
  appsilon: [
    {
      id: 'tealflow-mcp',
      command: 'tealflow-mcp',
      description:
        'Tealflow MCP — lists and describes available teal modules for clinical trial data exploration.',
    },
  ],
};

export async function seedBuiltinToolCatalog(
  repo: FirestoreToolCatalogRepository,
): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  for (const [namespace, entries] of Object.entries(BUILTIN_CATALOG)) {
    for (const entry of entries) {
      tasks.push(repo.upsert(namespace, entry));
    }
  }
  await Promise.all(tasks);
}
