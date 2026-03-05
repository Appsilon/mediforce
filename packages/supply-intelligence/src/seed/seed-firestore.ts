/**
 * Firestore seeding function for supply intelligence data.
 *
 * Dual-purpose:
 * - Importable for E2E test setup: `import { seedSupplyData } from './seed-firestore.js'`
 * - Used by CLI entry point: `run-seed.ts`
 *
 * Uses writeBatch for atomic writes. Batches are chunked to stay within
 * Firestore's 500-operation-per-commit limit. Seeding is idempotent:
 * fixed IDs + batch.set() overwrites existing documents.
 */

import {
  type Firestore,
  writeBatch,
  doc,
} from 'firebase/firestore';

import {
  SKUS,
  WAREHOUSES,
  BATCHES,
  INBOUND_SHIPMENTS,
  DEMAND_FORECASTS,
  DEFAULT_RISK_CONFIG,
  SEED_COUNTS,
} from './seed-data.js';

interface WriteOperation {
  collection: string;
  id: string;
  data: Record<string, unknown>;
}

/**
 * Commit write operations in chunks of 499 to stay within
 * Firestore's 500-operation-per-batch limit.
 */
async function commitInChunks(
  db: Firestore,
  operations: WriteOperation[],
): Promise<void> {
  const CHUNK_SIZE = 499;
  for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
    const chunk = operations.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const op of chunk) {
      batch.set(doc(db, op.collection, op.id), op.data);
    }
    await batch.commit();
  }
}

/**
 * Seed Firestore with the complete supply intelligence dataset.
 *
 * Idempotent: uses fixed IDs and setDoc semantics (overwrites on re-run).
 * Safe to call multiple times without creating duplicates.
 *
 * @param db - Firestore instance (client SDK)
 */
export async function seedSupplyData(db: Firestore): Promise<void> {
  const operations: WriteOperation[] = [];

  // 1. Risk Config
  console.log('Seeding risk config...');
  operations.push({
    collection: 'riskConfig',
    id: DEFAULT_RISK_CONFIG.id,
    data: { ...DEFAULT_RISK_CONFIG },
  });

  // 2. Warehouses
  console.log(`Seeding ${SEED_COUNTS.warehouses} warehouses...`);
  for (const warehouse of WAREHOUSES) {
    operations.push({
      collection: 'warehouses',
      id: warehouse.id,
      data: { ...warehouse },
    });
  }

  // 3. SKUs
  console.log(`Seeding ${SEED_COUNTS.skus} SKUs...`);
  for (const sku of SKUS) {
    operations.push({
      collection: 'skus',
      id: sku.id,
      data: { ...sku },
    });
  }

  // 4. Batches
  console.log(`Seeding ${SEED_COUNTS.batches} batches...`);
  for (const batch of BATCHES) {
    operations.push({
      collection: 'batches',
      id: batch.id,
      data: { ...batch },
    });
  }

  // 5. Inbound Shipments
  console.log(`Seeding ${SEED_COUNTS.inboundShipments} inbound shipments...`);
  for (const shipment of INBOUND_SHIPMENTS) {
    operations.push({
      collection: 'inboundShipments',
      id: shipment.id,
      data: { ...shipment },
    });
  }

  // 6. Demand Forecasts
  console.log(`Seeding ${SEED_COUNTS.demandForecasts} demand forecasts...`);
  for (const forecast of DEMAND_FORECASTS) {
    operations.push({
      collection: 'demandForecasts',
      id: forecast.id,
      data: { ...forecast },
    });
  }

  // Commit all operations in chunks
  const totalDocs = operations.length;
  console.log(`Committing ${totalDocs} documents in chunks of 499...`);
  await commitInChunks(db, operations);

  console.log(`Seeded ${totalDocs} documents to Firestore`);
}
