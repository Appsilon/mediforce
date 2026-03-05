// Writes draft issues to the draftIssues collection in the
// supply-intelligence named Firestore database.

import {
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
} from 'firebase/firestore';
import type { TherapeuticCategory } from '@mediforce/supply-intelligence';
import { getSupplyDb } from './supply-data-fetcher.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DraftIssue {
  id: string;
  skuId: string;
  warehouseId: string;
  skuName: string;
  warehouseName: string;
  country: string;
  category: TherapeuticCategory;
  title: string;
  riskSummary: string;
  suggestedActions: string;
  reason: string;
  impactEstimateCents: number;
  priorityScore: number;
  riskLevel: 'red';
  expiryRiskCents: number;
  stockoutRiskCents: number;
  nearestExpiryDays: number;
  status: 'suggested';
  createdAt: string;
  agentRunId: string;
}

// ─── Writers ────────────────────────────────────────────────────────────────

const COLLECTION_NAME = 'draftIssues';

/**
 * Write a single draft issue to Firestore. Idempotent via setDoc —
 * re-runs overwrite the previous issue for the same SKU+warehouse pair.
 */
export async function writeDraftIssue(issue: DraftIssue): Promise<void> {
  const db = getSupplyDb();
  await setDoc(doc(db, COLLECTION_NAME, issue.id), issue);
}

/**
 * Delete all existing draft issues before re-running.
 * Ensures pairs that are no longer red get cleaned up.
 */
export async function clearDraftIssues(): Promise<void> {
  const db = getSupplyDb();
  const snap = await getDocs(collection(db, COLLECTION_NAME));
  const deletes = snap.docs.map((d) => deleteDoc(d.ref));
  await Promise.all(deletes);
}
