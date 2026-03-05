// Writes agent summaries to the agentSummaries collection in the
// supply-intelligence named Firestore database.

import {
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  query,
  where,
} from 'firebase/firestore';
import { getSupplyDb } from './supply-data-fetcher.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentSummary {
  id: string;
  scope: 'sku-pair' | 'category' | 'overview';
  scopeKey: string;
  narrative: string;
  generatedAt: string;
  agentRunId: string;
  model: string;
}

// ─── Writers ────────────────────────────────────────────────────────────────

const COLLECTION_NAME = 'agentSummaries';

/**
 * Write a single agent summary to Firestore. Idempotent via setDoc.
 */
export async function writeSummary(summary: AgentSummary): Promise<void> {
  const db = getSupplyDb();
  await setDoc(doc(db, COLLECTION_NAME, summary.id), summary);
}

/**
 * Delete all summaries of a given scope before regeneration.
 * Cleans up stale data from SKUs/categories that no longer exist.
 */
export async function clearStaleSummaries(
  scope: AgentSummary['scope'],
): Promise<void> {
  const db = getSupplyDb();
  const q = query(
    collection(db, COLLECTION_NAME),
    where('scope', '==', scope),
  );
  const snap = await getDocs(q);
  const deletes = snap.docs.map((d) => deleteDoc(d.ref));
  await Promise.all(deletes);
}
