import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FirestoreToolCatalogRepository } from '@mediforce/platform-infra';
import type { ToolCatalogEntry } from '@mediforce/platform-core';
import { ToolCatalogEntrySchema } from '@mediforce/platform-core';

/** Namespace → catalog entries to upsert at startup. Entries here are
 *  the ones required by checked-in workflow definitions; bespoke
 *  admin-configured entries will live in Firestore only. Keep this list
 *  small — it's not a catalog of all known MCP servers.
 *
 *  Authoritative data lives in data/seeds/tool-catalog.json (shared with
 *  scripts/seed_tool_catalog.py). Validated on load so schema drift in
 *  the JSON surfaces at startup, not at the first call site. */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// packages/platform-ui/src/lib -> repo root (4 levels up)
const SEED_PATH = resolve(__dirname, '../../../../data/seeds/tool-catalog.json');

function loadBuiltinCatalog(): Record<string, ToolCatalogEntry[]> {
  const raw = JSON.parse(readFileSync(SEED_PATH, 'utf-8')) as Record<string, unknown[]>;
  const result: Record<string, ToolCatalogEntry[]> = {};
  for (const [namespace, entries] of Object.entries(raw)) {
    result[namespace] = entries.map(entry => ToolCatalogEntrySchema.parse(entry));
  }
  return result;
}

const BUILTIN_CATALOG = loadBuiltinCatalog();

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
