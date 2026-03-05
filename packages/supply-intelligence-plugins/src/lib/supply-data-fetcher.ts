// Fetches all supply data from the supply-intelligence named Firestore database.
// Self-contained Firebase init following NarrativeSummaryPlugin pattern.

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  type Firestore,
} from 'firebase/firestore';
import type {
  Sku,
  Warehouse,
  Batch,
  InboundShipment,
  DemandForecast,
  RiskConfig,
} from '@mediforce/supply-intelligence';
import { DEFAULT_RISK_CONFIG } from '@mediforce/supply-intelligence';

// ─── Firebase init ──────────────────────────────────────────────────────────

const DB_NAME = 'supply-intelligence';

/**
 * Get the Firestore instance for the supply-intelligence named database.
 * Reuses the platform's default Firebase app (initialized by platform-services)
 * to share the same connection/auth context.
 * Shared across supply-data-fetcher, summary-cache, and issue-writer.
 */
export function getSupplyDb(): Firestore {
  if (getApps().length === 0) {
    // Fallback: initialize if no app exists yet (e.g. standalone tests)
    initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
  }
  return getFirestore(getApp(), DB_NAME);
}

// ─── Data fetcher ───────────────────────────────────────────────────────────

export interface SupplyData {
  skus: Sku[];
  warehouses: Warehouse[];
  batches: Batch[];
  shipments: InboundShipment[];
  forecasts: DemandForecast[];
  config: RiskConfig;
}

/**
 * Fetch all supply data from the named Firestore database.
 * Reads 6 collections: skus, warehouses, batches, inboundShipments,
 * demandForecasts, and riskConfig.
 */
export async function fetchAllSupplyData(): Promise<SupplyData> {
  const db = getSupplyDb();

  const [skuSnap, whSnap, batchSnap, shipSnap, forecastSnap, configSnap] =
    await Promise.all([
      getDocs(collection(db, 'skus')),
      getDocs(collection(db, 'warehouses')),
      getDocs(collection(db, 'batches')),
      getDocs(collection(db, 'inboundShipments')),
      getDocs(collection(db, 'demandForecasts')),
      getDocs(collection(db, 'riskConfig')),
    ]);

  const skus = skuSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Sku);
  const warehouses = whSnap.docs.map(
    (d) => ({ id: d.id, ...d.data() }) as Warehouse,
  );
  const batches = batchSnap.docs.map(
    (d) => ({ id: d.id, ...d.data() }) as Batch,
  );
  const shipments = shipSnap.docs.map(
    (d) => ({ id: d.id, ...d.data() }) as InboundShipment,
  );
  const forecasts = forecastSnap.docs.map(
    (d) => ({ id: d.id, ...d.data() }) as DemandForecast,
  );

  // Use first config doc or fall back to defaults
  const configDoc = configSnap.docs[0];
  const config: RiskConfig = configDoc
    ? ({ id: configDoc.id, ...configDoc.data() } as RiskConfig)
    : DEFAULT_RISK_CONFIG;

  return { skus, warehouses, batches, shipments, forecasts, config };
}
