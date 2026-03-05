/**
 * Static seed data for supply intelligence demo.
 *
 * All IDs are fixed and deterministic for idempotent seeding.
 * Monetary values are integer cents (never floating-point).
 * Product names are real pharma products from multiple global companies.
 * Warehouses use real European pharma hub cities.
 */

import type { Sku } from '../schemas/sku.js';
import type { Warehouse } from '../schemas/warehouse.js';
import type { Batch } from '../schemas/batch.js';
import type { InboundShipment } from '../schemas/inbound-shipment.js';
import type { DemandForecast } from '../schemas/demand-forecast.js';
import { DEFAULT_RISK_CONFIG } from '../schemas/risk-config.js';

// ============================================================================
// Reference date: all relative dates are computed from this anchor.
// Using a fixed date ensures deterministic data regardless of when seed runs.
// ============================================================================
const REF_DATE = new Date('2026-03-02');

function daysFromRef(days: number): string {
  const d = new Date(REF_DATE);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// ============================================================================
// WAREHOUSES (15)
// ============================================================================

export const WAREHOUSES: Warehouse[] = [
  { id: 'wh-DE-Frankfurt-01', name: 'Frankfurt Central Depot', city: 'Frankfurt', country: 'DE' },
  { id: 'wh-DE-Frankfurt-02', name: 'Frankfurt Pharma Hub', city: 'Frankfurt', country: 'DE' },
  { id: 'wh-CH-Basel-01', name: 'Basel Life Sciences Center', city: 'Basel', country: 'CH' },
  { id: 'wh-NL-Rotterdam-01', name: 'Rotterdam Port Logistics', city: 'Rotterdam', country: 'NL' },
  { id: 'wh-NL-Leiden-01', name: 'Leiden BioScience Depot', city: 'Leiden', country: 'NL' },
  { id: 'wh-IE-Dublin-01', name: 'Dublin Pharma Manufacturing', city: 'Dublin', country: 'IE' },
  { id: 'wh-IE-Cork-01', name: 'Cork BioHub', city: 'Cork', country: 'IE' },
  { id: 'wh-IT-Milan-01', name: 'Milan Distribution Center', city: 'Milan', country: 'IT' },
  { id: 'wh-FR-Lyon-01', name: 'Lyon Pharma Logistics', city: 'Lyon', country: 'FR' },
  { id: 'wh-ES-Barcelona-01', name: 'Barcelona MedCenter', city: 'Barcelona', country: 'ES' },
  { id: 'wh-BE-Brussels-01', name: 'Brussels EU Pharma Hub', city: 'Brussels', country: 'BE' },
  { id: 'wh-AT-Vienna-01', name: 'Vienna Central Pharma', city: 'Vienna', country: 'AT' },
  { id: 'wh-PL-Warsaw-01', name: 'Warsaw Regional Depot', city: 'Warsaw', country: 'PL' },
  { id: 'wh-SE-Stockholm-01', name: 'Stockholm Nordic Hub', city: 'Stockholm', country: 'SE' },
  { id: 'wh-DK-Copenhagen-01', name: 'Copenhagen Pharma Center', city: 'Copenhagen', country: 'DK' },
];

// ============================================================================
// SKUs (65)
// Real pharma product names from multiple global companies.
// Categories: cardiovascular, oncology, anti-infectives, respiratory, gastro
// ============================================================================

export const SKUS: Sku[] = [
  // --- Roche (5) ---
  { id: 'sku-roche-herceptin-150mg', name: 'Herceptin 150mg', manufacturer: 'Roche', category: 'oncology', unitCostCents: 184_750, monthlyDemand: 120, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.05, '4': 1.05, '5': 1.0, '6': 0.95, '7': 0.95, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.05, '12': 1.0 } },
  { id: 'sku-roche-avastin-400mg', name: 'Avastin 400mg', manufacturer: 'Roche', category: 'oncology', unitCostCents: 215_320, monthlyDemand: 95, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.05, '4': 1.05, '5': 1.0, '6': 0.95, '7': 0.95, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.05, '12': 1.0 } },
  { id: 'sku-roche-rituxan-100mg', name: 'Rituxan 100mg', manufacturer: 'Roche', category: 'oncology', unitCostCents: 97_830, monthlyDemand: 180, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.05, '4': 1.05, '5': 1.0, '6': 0.95, '7': 0.95, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.05, '12': 1.0 } },
  { id: 'sku-roche-perjeta-420mg', name: 'Perjeta 420mg', manufacturer: 'Roche', category: 'oncology', unitCostCents: 267_490, monthlyDemand: 65, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.05, '4': 1.05, '5': 1.0, '6': 0.95, '7': 0.95, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.05, '12': 1.0 } },
  { id: 'sku-roche-tecentriq-1200mg', name: 'Tecentriq 1200mg', manufacturer: 'Roche', category: 'oncology', unitCostCents: 342_610, monthlyDemand: 50, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.05, '4': 1.05, '5': 1.0, '6': 0.95, '7': 0.95, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.05, '12': 1.0 } },

  // --- Novartis (5) ---
  { id: 'sku-novartis-entresto-97mg', name: 'Entresto 97mg', manufacturer: 'Novartis', category: 'cardiovascular', unitCostCents: 18_490, monthlyDemand: 2500, seasonalFactors: { '1': 1.05, '2': 1.05, '3': 1.0, '4': 0.95, '5': 0.95, '6': 0.9, '7': 0.9, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.1, '12': 1.1 } },
  { id: 'sku-novartis-cosentyx-150mg', name: 'Cosentyx 150mg', manufacturer: 'Novartis', category: 'respiratory', unitCostCents: 167_250, monthlyDemand: 110, seasonalFactors: { '1': 0.9, '2': 0.9, '3': 1.3, '4': 1.4, '5': 1.4, '6': 0.7, '7': 0.6, '8': 0.7, '9': 0.9, '10': 1.0, '11': 1.0, '12': 0.9 } },
  { id: 'sku-novartis-kisqali-200mg', name: 'Kisqali 200mg', manufacturer: 'Novartis', category: 'oncology', unitCostCents: 189_730, monthlyDemand: 85, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.05, '4': 1.05, '5': 1.0, '6': 0.95, '7': 0.95, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.05, '12': 1.0 } },
  { id: 'sku-novartis-zolgensma-2ml', name: 'Zolgensma 2ml', manufacturer: 'Novartis', category: 'oncology', unitCostCents: 195_440, monthlyDemand: 15, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.0, '4': 1.0, '5': 1.0, '6': 1.0, '7': 1.0, '8': 1.0, '9': 1.0, '10': 1.0, '11': 1.0, '12': 1.0 } },
  { id: 'sku-novartis-lucentis-10mg', name: 'Lucentis 10mg', manufacturer: 'Novartis', category: 'oncology', unitCostCents: 112_370, monthlyDemand: 140, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.05, '4': 1.05, '5': 1.0, '6': 0.95, '7': 0.95, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.05, '12': 1.0 } },

  // --- Pfizer (5) ---
  { id: 'sku-pfizer-ibrance-125mg', name: 'Ibrance 125mg', manufacturer: 'Pfizer', category: 'oncology', unitCostCents: 154_890, monthlyDemand: 200, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.05, '4': 1.05, '5': 1.0, '6': 0.95, '7': 0.95, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.05, '12': 1.0 } },
  { id: 'sku-pfizer-xtandi-40mg', name: 'Xtandi 40mg', manufacturer: 'Pfizer', category: 'oncology', unitCostCents: 128_470, monthlyDemand: 160, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.05, '4': 1.05, '5': 1.0, '6': 0.95, '7': 0.95, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.05, '12': 1.0 } },
  { id: 'sku-pfizer-eliquis-5mg', name: 'Eliquis 5mg', manufacturer: 'Pfizer', category: 'cardiovascular', unitCostCents: 1_685, monthlyDemand: 15000, seasonalFactors: { '1': 1.05, '2': 1.05, '3': 1.0, '4': 0.95, '5': 0.95, '6': 0.9, '7': 0.9, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.1, '12': 1.1 } },
  { id: 'sku-pfizer-prevnar-13', name: 'Prevnar 13', manufacturer: 'Pfizer', category: 'anti-infectives', unitCostCents: 23_150, monthlyDemand: 800, seasonalFactors: { '1': 1.3, '2': 1.3, '3': 1.1, '4': 0.9, '5': 0.8, '6': 0.7, '7': 0.7, '8': 0.7, '9': 0.9, '10': 1.1, '11': 1.2, '12': 1.3 } },
  { id: 'sku-pfizer-xeljanz-5mg', name: 'Xeljanz 5mg', manufacturer: 'Pfizer', category: 'respiratory', unitCostCents: 78_320, monthlyDemand: 250, seasonalFactors: { '1': 0.9, '2': 0.9, '3': 1.3, '4': 1.4, '5': 1.4, '6': 0.7, '7': 0.6, '8': 0.7, '9': 0.9, '10': 1.0, '11': 1.0, '12': 0.9 } },

  // --- AstraZeneca (5) ---
  { id: 'sku-az-tagrisso-80mg', name: 'Tagrisso 80mg', manufacturer: 'AstraZeneca', category: 'oncology', unitCostCents: 198_560, monthlyDemand: 130, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.05, '4': 1.05, '5': 1.0, '6': 0.95, '7': 0.95, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.05, '12': 1.0 } },
  { id: 'sku-az-lynparza-150mg', name: 'Lynparza 150mg', manufacturer: 'AstraZeneca', category: 'oncology', unitCostCents: 145_280, monthlyDemand: 100, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.05, '4': 1.05, '5': 1.0, '6': 0.95, '7': 0.95, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.05, '12': 1.0 } },
  { id: 'sku-az-farxiga-10mg', name: 'Farxiga 10mg', manufacturer: 'AstraZeneca', category: 'cardiovascular', unitCostCents: 1_290, monthlyDemand: 12000, seasonalFactors: { '1': 1.05, '2': 1.05, '3': 1.0, '4': 0.95, '5': 0.95, '6': 0.9, '7': 0.9, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.1, '12': 1.1 } },
  { id: 'sku-az-symbicort-160mcg', name: 'Symbicort 160mcg', manufacturer: 'AstraZeneca', category: 'respiratory', unitCostCents: 4_730, monthlyDemand: 8000, seasonalFactors: { '1': 0.9, '2': 0.9, '3': 1.3, '4': 1.4, '5': 1.4, '6': 0.7, '7': 0.6, '8': 0.7, '9': 0.9, '10': 1.0, '11': 1.0, '12': 0.9 } },
  { id: 'sku-az-nexium-40mg', name: 'Nexium 40mg', manufacturer: 'AstraZeneca', category: 'gastro', unitCostCents: 2_340, monthlyDemand: 9000, seasonalFactors: { '1': 1.0, '2': 0.95, '3': 0.95, '4': 1.0, '5': 1.05, '6': 1.1, '7': 1.1, '8': 1.05, '9': 1.0, '10': 0.95, '11': 0.95, '12': 1.0 } },

  // --- Teva (4) ---
  { id: 'sku-teva-metformin-500mg', name: 'Generic Metformin 500mg', manufacturer: 'Teva', category: 'gastro', unitCostCents: 485, monthlyDemand: 20000, seasonalFactors: { '1': 1.0, '2': 0.95, '3': 0.95, '4': 1.0, '5': 1.05, '6': 1.1, '7': 1.1, '8': 1.05, '9': 1.0, '10': 0.95, '11': 0.95, '12': 1.0 } },
  { id: 'sku-teva-omeprazole-20mg', name: 'Generic Omeprazole 20mg', manufacturer: 'Teva', category: 'gastro', unitCostCents: 530, monthlyDemand: 18000, seasonalFactors: { '1': 1.0, '2': 0.95, '3': 0.95, '4': 1.0, '5': 1.05, '6': 1.1, '7': 1.1, '8': 1.05, '9': 1.0, '10': 0.95, '11': 0.95, '12': 1.0 } },
  { id: 'sku-teva-copaxone-40mg', name: 'Copaxone 40mg', manufacturer: 'Teva', category: 'anti-infectives', unitCostCents: 67_420, monthlyDemand: 300, seasonalFactors: { '1': 1.3, '2': 1.3, '3': 1.1, '4': 0.9, '5': 0.8, '6': 0.7, '7': 0.7, '8': 0.7, '9': 0.9, '10': 1.1, '11': 1.2, '12': 1.3 } },
  { id: 'sku-teva-amlodipine-5mg', name: 'Generic Amlodipine 5mg', manufacturer: 'Teva', category: 'cardiovascular', unitCostCents: 310, monthlyDemand: 22000, seasonalFactors: { '1': 1.05, '2': 1.05, '3': 1.0, '4': 0.95, '5': 0.95, '6': 0.9, '7': 0.9, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.1, '12': 1.1 } },

  // --- Takeda (3) ---
  { id: 'sku-takeda-entyvio-300mg', name: 'Entyvio 300mg', manufacturer: 'Takeda', category: 'gastro', unitCostCents: 189_610, monthlyDemand: 75, seasonalFactors: { '1': 1.0, '2': 0.95, '3': 0.95, '4': 1.0, '5': 1.05, '6': 1.1, '7': 1.1, '8': 1.05, '9': 1.0, '10': 0.95, '11': 0.95, '12': 1.0 } },
  { id: 'sku-takeda-vyvanse-50mg', name: 'Vyvanse 50mg', manufacturer: 'Takeda', category: 'anti-infectives', unitCostCents: 3_845, monthlyDemand: 6000, seasonalFactors: { '1': 1.3, '2': 1.3, '3': 1.1, '4': 0.9, '5': 0.8, '6': 0.7, '7': 0.7, '8': 0.7, '9': 0.9, '10': 1.1, '11': 1.2, '12': 1.3 } },
  { id: 'sku-takeda-ninlaro-4mg', name: 'Ninlaro 4mg', manufacturer: 'Takeda', category: 'oncology', unitCostCents: 234_560, monthlyDemand: 40, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.05, '4': 1.05, '5': 1.0, '6': 0.95, '7': 0.95, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.05, '12': 1.0 } },

  // --- Sanofi (3) ---
  { id: 'sku-sanofi-dupixent-300mg', name: 'Dupixent 300mg', manufacturer: 'Sanofi', category: 'respiratory', unitCostCents: 178_930, monthlyDemand: 150, seasonalFactors: { '1': 0.9, '2': 0.9, '3': 1.3, '4': 1.4, '5': 1.4, '6': 0.7, '7': 0.6, '8': 0.7, '9': 0.9, '10': 1.0, '11': 1.0, '12': 0.9 } },
  { id: 'sku-sanofi-lantus-100iu', name: 'Lantus 100IU', manufacturer: 'Sanofi', category: 'gastro', unitCostCents: 8_730, monthlyDemand: 5000, seasonalFactors: { '1': 1.0, '2': 0.95, '3': 0.95, '4': 1.0, '5': 1.05, '6': 1.1, '7': 1.1, '8': 1.05, '9': 1.0, '10': 0.95, '11': 0.95, '12': 1.0 } },
  { id: 'sku-sanofi-aubagio-14mg', name: 'Aubagio 14mg', manufacturer: 'Sanofi', category: 'anti-infectives', unitCostCents: 56_780, monthlyDemand: 350, seasonalFactors: { '1': 1.3, '2': 1.3, '3': 1.1, '4': 0.9, '5': 0.8, '6': 0.7, '7': 0.7, '8': 0.7, '9': 0.9, '10': 1.1, '11': 1.2, '12': 1.3 } },

  // --- Merck (3) ---
  { id: 'sku-merck-keytruda-100mg', name: 'Keytruda 100mg', manufacturer: 'Merck', category: 'oncology', unitCostCents: 276_830, monthlyDemand: 110, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.05, '4': 1.05, '5': 1.0, '6': 0.95, '7': 0.95, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.05, '12': 1.0 } },
  { id: 'sku-merck-januvia-100mg', name: 'Januvia 100mg', manufacturer: 'Merck', category: 'gastro', unitCostCents: 5_270, monthlyDemand: 7000, seasonalFactors: { '1': 1.0, '2': 0.95, '3': 0.95, '4': 1.0, '5': 1.05, '6': 1.1, '7': 1.1, '8': 1.05, '9': 1.0, '10': 0.95, '11': 0.95, '12': 1.0 } },
  { id: 'sku-merck-gardasil-9', name: 'Gardasil 9', manufacturer: 'Merck', category: 'anti-infectives', unitCostCents: 24_690, monthlyDemand: 900, seasonalFactors: { '1': 1.3, '2': 1.3, '3': 1.1, '4': 0.9, '5': 0.8, '6': 0.7, '7': 0.7, '8': 0.7, '9': 0.9, '10': 1.1, '11': 1.2, '12': 1.3 } },

  // --- BMS (3) ---
  { id: 'sku-bms-opdivo-240mg', name: 'Opdivo 240mg', manufacturer: 'BMS', category: 'oncology', unitCostCents: 312_480, monthlyDemand: 90, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.05, '4': 1.05, '5': 1.0, '6': 0.95, '7': 0.95, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.05, '12': 1.0 } },
  { id: 'sku-bms-revlimid-25mg', name: 'Revlimid 25mg', manufacturer: 'BMS', category: 'oncology', unitCostCents: 87_650, monthlyDemand: 250, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.05, '4': 1.05, '5': 1.0, '6': 0.95, '7': 0.95, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.05, '12': 1.0 } },
  { id: 'sku-bms-eliquis-2.5mg', name: 'Eliquis 2.5mg', manufacturer: 'BMS', category: 'cardiovascular', unitCostCents: 1_685, monthlyDemand: 10000, seasonalFactors: { '1': 1.05, '2': 1.05, '3': 1.0, '4': 0.95, '5': 0.95, '6': 0.9, '7': 0.9, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.1, '12': 1.1 } },

  // --- Abbvie (3) ---
  { id: 'sku-abbvie-humira-40mg', name: 'Humira 40mg', manufacturer: 'Abbvie', category: 'respiratory', unitCostCents: 82_510, monthlyDemand: 400, seasonalFactors: { '1': 0.9, '2': 0.9, '3': 1.3, '4': 1.4, '5': 1.4, '6': 0.7, '7': 0.6, '8': 0.7, '9': 0.9, '10': 1.0, '11': 1.0, '12': 0.9 } },
  { id: 'sku-abbvie-skyrizi-150mg', name: 'Skyrizi 150mg', manufacturer: 'Abbvie', category: 'respiratory', unitCostCents: 196_870, monthlyDemand: 80, seasonalFactors: { '1': 0.9, '2': 0.9, '3': 1.3, '4': 1.4, '5': 1.4, '6': 0.7, '7': 0.6, '8': 0.7, '9': 0.9, '10': 1.0, '11': 1.0, '12': 0.9 } },
  { id: 'sku-abbvie-rinvoq-15mg', name: 'Rinvoq 15mg', manufacturer: 'Abbvie', category: 'respiratory', unitCostCents: 73_490, monthlyDemand: 350, seasonalFactors: { '1': 0.9, '2': 0.9, '3': 1.3, '4': 1.4, '5': 1.4, '6': 0.7, '7': 0.6, '8': 0.7, '9': 0.9, '10': 1.0, '11': 1.0, '12': 0.9 } },

  // --- GSK (3) ---
  { id: 'sku-gsk-nucala-100mg', name: 'Nucala 100mg', manufacturer: 'GSK', category: 'respiratory', unitCostCents: 345_210, monthlyDemand: 60, seasonalFactors: { '1': 0.9, '2': 0.9, '3': 1.3, '4': 1.4, '5': 1.4, '6': 0.7, '7': 0.6, '8': 0.7, '9': 0.9, '10': 1.0, '11': 1.0, '12': 0.9 } },
  { id: 'sku-gsk-trelegy-ellipta', name: 'Trelegy Ellipta', manufacturer: 'GSK', category: 'respiratory', unitCostCents: 6_890, monthlyDemand: 4000, seasonalFactors: { '1': 0.9, '2': 0.9, '3': 1.3, '4': 1.4, '5': 1.4, '6': 0.7, '7': 0.6, '8': 0.7, '9': 0.9, '10': 1.0, '11': 1.0, '12': 0.9 } },
  { id: 'sku-gsk-shingrix', name: 'Shingrix', manufacturer: 'GSK', category: 'anti-infectives', unitCostCents: 17_830, monthlyDemand: 1200, seasonalFactors: { '1': 1.3, '2': 1.3, '3': 1.1, '4': 0.9, '5': 0.8, '6': 0.7, '7': 0.7, '8': 0.7, '9': 0.9, '10': 1.1, '11': 1.2, '12': 1.3 } },

  // --- Amgen (3) ---
  { id: 'sku-amgen-repatha-140mg', name: 'Repatha 140mg', manufacturer: 'Amgen', category: 'cardiovascular', unitCostCents: 67_890, monthlyDemand: 280, seasonalFactors: { '1': 1.05, '2': 1.05, '3': 1.0, '4': 0.95, '5': 0.95, '6': 0.9, '7': 0.9, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.1, '12': 1.1 } },
  { id: 'sku-amgen-prolia-60mg', name: 'Prolia 60mg', manufacturer: 'Amgen', category: 'cardiovascular', unitCostCents: 132_450, monthlyDemand: 190, seasonalFactors: { '1': 1.05, '2': 1.05, '3': 1.0, '4': 0.95, '5': 0.95, '6': 0.9, '7': 0.9, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.1, '12': 1.1 } },
  { id: 'sku-amgen-neulasta-6mg', name: 'Neulasta 6mg', manufacturer: 'Amgen', category: 'oncology', unitCostCents: 56_240, monthlyDemand: 350, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.05, '4': 1.05, '5': 1.0, '6': 0.95, '7': 0.95, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.05, '12': 1.0 } },

  // --- Additional products for coverage (19 more to reach 65+) ---

  // Boehringer Ingelheim
  { id: 'sku-bi-jardiance-25mg', name: 'Jardiance 25mg', manufacturer: 'Boehringer Ingelheim', category: 'cardiovascular', unitCostCents: 1_870, monthlyDemand: 11000, seasonalFactors: { '1': 1.05, '2': 1.05, '3': 1.0, '4': 0.95, '5': 0.95, '6': 0.9, '7': 0.9, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.1, '12': 1.1 } },
  { id: 'sku-bi-ofev-150mg', name: 'Ofev 150mg', manufacturer: 'Boehringer Ingelheim', category: 'respiratory', unitCostCents: 89_760, monthlyDemand: 120, seasonalFactors: { '1': 0.9, '2': 0.9, '3': 1.3, '4': 1.4, '5': 1.4, '6': 0.7, '7': 0.6, '8': 0.7, '9': 0.9, '10': 1.0, '11': 1.0, '12': 0.9 } },
  { id: 'sku-bi-pradaxa-150mg', name: 'Pradaxa 150mg', manufacturer: 'Boehringer Ingelheim', category: 'cardiovascular', unitCostCents: 4_290, monthlyDemand: 5500, seasonalFactors: { '1': 1.05, '2': 1.05, '3': 1.0, '4': 0.95, '5': 0.95, '6': 0.9, '7': 0.9, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.1, '12': 1.1 } },

  // Bayer
  { id: 'sku-bayer-xarelto-20mg', name: 'Xarelto 20mg', manufacturer: 'Bayer', category: 'cardiovascular', unitCostCents: 1_540, monthlyDemand: 14000, seasonalFactors: { '1': 1.05, '2': 1.05, '3': 1.0, '4': 0.95, '5': 0.95, '6': 0.9, '7': 0.9, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.1, '12': 1.1 } },
  { id: 'sku-bayer-eylea-2mg', name: 'Eylea 2mg', manufacturer: 'Bayer', category: 'oncology', unitCostCents: 143_270, monthlyDemand: 170, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.05, '4': 1.05, '5': 1.0, '6': 0.95, '7': 0.95, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.05, '12': 1.0 } },
  { id: 'sku-bayer-stivarga-40mg', name: 'Stivarga 40mg', manufacturer: 'Bayer', category: 'oncology', unitCostCents: 178_340, monthlyDemand: 55, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.05, '4': 1.05, '5': 1.0, '6': 0.95, '7': 0.95, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.05, '12': 1.0 } },

  // Gilead
  { id: 'sku-gilead-biktarvy-50mg', name: 'Biktarvy 50/200/25mg', manufacturer: 'Gilead', category: 'anti-infectives', unitCostCents: 11_230, monthlyDemand: 3500, seasonalFactors: { '1': 1.3, '2': 1.3, '3': 1.1, '4': 0.9, '5': 0.8, '6': 0.7, '7': 0.7, '8': 0.7, '9': 0.9, '10': 1.1, '11': 1.2, '12': 1.3 } },
  { id: 'sku-gilead-veklury-100mg', name: 'Veklury 100mg', manufacturer: 'Gilead', category: 'anti-infectives', unitCostCents: 43_890, monthlyDemand: 450, seasonalFactors: { '1': 1.3, '2': 1.3, '3': 1.1, '4': 0.9, '5': 0.8, '6': 0.7, '7': 0.7, '8': 0.7, '9': 0.9, '10': 1.1, '11': 1.2, '12': 1.3 } },
  { id: 'sku-gilead-descovy-200mg', name: 'Descovy 200/25mg', manufacturer: 'Gilead', category: 'anti-infectives', unitCostCents: 8_930, monthlyDemand: 2800, seasonalFactors: { '1': 1.3, '2': 1.3, '3': 1.1, '4': 0.9, '5': 0.8, '6': 0.7, '7': 0.7, '8': 0.7, '9': 0.9, '10': 1.1, '11': 1.2, '12': 1.3 } },

  // Novo Nordisk
  { id: 'sku-novo-ozempic-1mg', name: 'Ozempic 1mg', manufacturer: 'Novo Nordisk', category: 'gastro', unitCostCents: 9_450, monthlyDemand: 8000, seasonalFactors: { '1': 1.0, '2': 0.95, '3': 0.95, '4': 1.0, '5': 1.05, '6': 1.1, '7': 1.1, '8': 1.05, '9': 1.0, '10': 0.95, '11': 0.95, '12': 1.0 } },
  { id: 'sku-novo-wegovy-2.4mg', name: 'Wegovy 2.4mg', manufacturer: 'Novo Nordisk', category: 'gastro', unitCostCents: 13_750, monthlyDemand: 6000, seasonalFactors: { '1': 1.0, '2': 0.95, '3': 0.95, '4': 1.0, '5': 1.05, '6': 1.1, '7': 1.1, '8': 1.05, '9': 1.0, '10': 0.95, '11': 0.95, '12': 1.0 } },
  { id: 'sku-novo-victoza-1.8mg', name: 'Victoza 1.8mg', manufacturer: 'Novo Nordisk', category: 'gastro', unitCostCents: 7_180, monthlyDemand: 4500, seasonalFactors: { '1': 1.0, '2': 0.95, '3': 0.95, '4': 1.0, '5': 1.05, '6': 1.1, '7': 1.1, '8': 1.05, '9': 1.0, '10': 0.95, '11': 0.95, '12': 1.0 } },

  // Astellas
  { id: 'sku-astellas-xtandi-80mg', name: 'Xtandi 80mg', manufacturer: 'Astellas', category: 'oncology', unitCostCents: 256_790, monthlyDemand: 70, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.05, '4': 1.05, '5': 1.0, '6': 0.95, '7': 0.95, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.05, '12': 1.0 } },

  // UCB
  { id: 'sku-ucb-cimzia-200mg', name: 'Cimzia 200mg', manufacturer: 'UCB', category: 'respiratory', unitCostCents: 147_830, monthlyDemand: 95, seasonalFactors: { '1': 0.9, '2': 0.9, '3': 1.3, '4': 1.4, '5': 1.4, '6': 0.7, '7': 0.6, '8': 0.7, '9': 0.9, '10': 1.0, '11': 1.0, '12': 0.9 } },

  // Regeneron
  { id: 'sku-regeneron-eylea-hd-8mg', name: 'Eylea HD 8mg', manufacturer: 'Regeneron', category: 'oncology', unitCostCents: 213_950, monthlyDemand: 85, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.05, '4': 1.05, '5': 1.0, '6': 0.95, '7': 0.95, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.05, '12': 1.0 } },

  // Mylan (Viatris)
  { id: 'sku-mylan-lisinopril-10mg', name: 'Generic Lisinopril 10mg', manufacturer: 'Mylan', category: 'cardiovascular', unitCostCents: 275, monthlyDemand: 18000, seasonalFactors: { '1': 1.05, '2': 1.05, '3': 1.0, '4': 0.95, '5': 0.95, '6': 0.9, '7': 0.9, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.1, '12': 1.1 } },

  // Sandoz
  { id: 'sku-sandoz-atorvastatin-20mg', name: 'Generic Atorvastatin 20mg', manufacturer: 'Sandoz', category: 'cardiovascular', unitCostCents: 390, monthlyDemand: 16000, seasonalFactors: { '1': 1.05, '2': 1.05, '3': 1.0, '4': 0.95, '5': 0.95, '6': 0.9, '7': 0.9, '8': 0.95, '9': 1.0, '10': 1.05, '11': 1.1, '12': 1.1 } },

  // Lundbeck
  { id: 'sku-lundbeck-trintellix-10mg', name: 'Trintellix 10mg', manufacturer: 'Lundbeck', category: 'anti-infectives', unitCostCents: 5_670, monthlyDemand: 2000, seasonalFactors: { '1': 1.3, '2': 1.3, '3': 1.1, '4': 0.9, '5': 0.8, '6': 0.7, '7': 0.7, '8': 0.7, '9': 0.9, '10': 1.1, '11': 1.2, '12': 1.3 } },

  // --- Zero demand SKUs (edge cases) ---
  { id: 'sku-roche-kadcyla-160mg', name: 'Kadcyla 160mg', manufacturer: 'Roche', category: 'oncology', unitCostCents: 387_520, monthlyDemand: 0, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.0, '4': 1.0, '5': 1.0, '6': 1.0, '7': 1.0, '8': 1.0, '9': 1.0, '10': 1.0, '11': 1.0, '12': 1.0 } },
  { id: 'sku-novartis-tasigna-200mg', name: 'Tasigna 200mg', manufacturer: 'Novartis', category: 'oncology', unitCostCents: 165_890, monthlyDemand: 0, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.0, '4': 1.0, '5': 1.0, '6': 1.0, '7': 1.0, '8': 1.0, '9': 1.0, '10': 1.0, '11': 1.0, '12': 1.0 } },
  { id: 'sku-bms-zeposia-0.92mg', name: 'Zeposia 0.92mg', manufacturer: 'BMS', category: 'anti-infectives', unitCostCents: 89_410, monthlyDemand: 0, seasonalFactors: { '1': 1.0, '2': 1.0, '3': 1.0, '4': 1.0, '5': 1.0, '6': 1.0, '7': 1.0, '8': 1.0, '9': 1.0, '10': 1.0, '11': 1.0, '12': 1.0 } },
];

// ============================================================================
// BATCHES (350+)
// Each SKU gets 3-8 batches distributed across 2-4 warehouses.
// Includes deliberate edge cases: expired, near-expiry, zero-demand SKUs.
// ============================================================================

// Warehouse pool for distributing batches
const WH_IDS = WAREHOUSES.map((w) => w.id);

/**
 * Deterministic batch generation. Uses fixed offsets for reproducibility.
 */
function generateBatches(): Batch[] {
  const batches: Batch[] = [];
  let batchIdx = 1;

  // Helper to pad batch IDs
  const batchId = () => `batch-${String(batchIdx++).padStart(3, '0')}`;

  // Map of which warehouses each SKU is stocked in (deterministic assignment)
  function warehousesForSku(skuIndex: number, count: number): string[] {
    const result: string[] = [];
    for (let i = 0; i < count; i++) {
      result.push(WH_IDS[(skuIndex * 3 + i * 7) % WH_IDS.length]);
    }
    // Deduplicate while maintaining count
    const unique = [...new Set(result)];
    while (unique.length < count) {
      const next = WH_IDS[(skuIndex * 5 + unique.length * 11) % WH_IDS.length];
      if (!unique.includes(next)) unique.push(next);
    }
    return unique.slice(0, count);
  }

  // --- Expired batches (8 batches across various SKUs) ---
  const expiredSkus = [
    { skuIdx: 0, whIdx: 0, qty: 45, costDelta: 0, mfgDaysAgo: -540, expiryDaysAgo: -15 },
    { skuIdx: 3, whIdx: 2, qty: 20, costDelta: -50, mfgDaysAgo: -720, expiryDaysAgo: -30 },
    { skuIdx: 10, whIdx: 1, qty: 150, costDelta: 0, mfgDaysAgo: -400, expiryDaysAgo: -5 },
    { skuIdx: 15, whIdx: 3, qty: 80, costDelta: 30, mfgDaysAgo: -500, expiryDaysAgo: -20 },
    { skuIdx: 22, whIdx: 0, qty: 200, costDelta: 0, mfgDaysAgo: -600, expiryDaysAgo: -10 },
    { skuIdx: 30, whIdx: 2, qty: 35, costDelta: -20, mfgDaysAgo: -450, expiryDaysAgo: -2 },
    { skuIdx: 38, whIdx: 1, qty: 60, costDelta: 0, mfgDaysAgo: -380, expiryDaysAgo: -45 },
    { skuIdx: 45, whIdx: 0, qty: 100, costDelta: 10, mfgDaysAgo: -550, expiryDaysAgo: -8 },
  ];

  for (const eb of expiredSkus) {
    const sku = SKUS[eb.skuIdx];
    batches.push({
      id: batchId(),
      skuId: sku.id,
      warehouseId: WH_IDS[eb.whIdx],
      lotNumber: `LOT-EXP-${String(batchIdx - 1).padStart(3, '0')}`,
      quantityOnHand: eb.qty,
      unitCostCents: sku.unitCostCents + eb.costDelta,
      manufacturingDate: daysFromRef(eb.mfgDaysAgo),
      expiryDate: daysFromRef(eb.expiryDaysAgo),
    });
  }

  // --- Batches expiring within 30 days (12 batches — urgency triggers) ---
  const urgentSkus = [
    { skuIdx: 1, whIdx: 0, qty: 30, costDelta: 0, mfgDaysAgo: -350, expiryDays: 5 },
    { skuIdx: 5, whIdx: 2, qty: 500, costDelta: -15, mfgDaysAgo: -330, expiryDays: 10 },
    { skuIdx: 8, whIdx: 1, qty: 25, costDelta: 0, mfgDaysAgo: -360, expiryDays: 15 },
    { skuIdx: 12, whIdx: 3, qty: 3000, costDelta: 0, mfgDaysAgo: -340, expiryDays: 7 },
    { skuIdx: 17, whIdx: 0, qty: 2500, costDelta: 20, mfgDaysAgo: -300, expiryDays: 20 },
    { skuIdx: 20, whIdx: 2, qty: 4000, costDelta: 0, mfgDaysAgo: -320, expiryDays: 25 },
    { skuIdx: 25, whIdx: 1, qty: 1500, costDelta: -30, mfgDaysAgo: -310, expiryDays: 12 },
    { skuIdx: 28, whIdx: 0, qty: 40, costDelta: 0, mfgDaysAgo: -350, expiryDays: 3 },
    { skuIdx: 32, whIdx: 3, qty: 200, costDelta: 15, mfgDaysAgo: -290, expiryDays: 18 },
    { skuIdx: 35, whIdx: 2, qty: 80, costDelta: 0, mfgDaysAgo: -345, expiryDays: 8 },
    { skuIdx: 40, whIdx: 1, qty: 150, costDelta: -25, mfgDaysAgo: -300, expiryDays: 22 },
    { skuIdx: 48, whIdx: 0, qty: 600, costDelta: 0, mfgDaysAgo: -280, expiryDays: 28 },
  ];

  for (const ub of urgentSkus) {
    const sku = SKUS[ub.skuIdx];
    batches.push({
      id: batchId(),
      skuId: sku.id,
      warehouseId: WH_IDS[ub.whIdx],
      lotNumber: `LOT-URG-${String(batchIdx - 1).padStart(3, '0')}`,
      quantityOnHand: ub.qty,
      unitCostCents: sku.unitCostCents + ub.costDelta,
      manufacturingDate: daysFromRef(ub.mfgDaysAgo),
      expiryDate: daysFromRef(ub.expiryDays),
    });
  }

  // --- Batches expiring within 90 days (25 batches — warning zone) ---
  const warningSkus: Array<{ skuIdx: number; whIdx: number; qty: number; costDelta: number; mfgDaysAgo: number; expiryDays: number }> = [];
  for (let i = 0; i < 25; i++) {
    warningSkus.push({
      skuIdx: (i * 3 + 2) % (SKUS.length - 3), // avoid zero-demand SKUs at end
      whIdx: i % WH_IDS.length,
      qty: 50 + (i * 137) % 2000,
      costDelta: ((i % 5) - 2) * 15,
      mfgDaysAgo: -(250 + (i * 23) % 100),
      expiryDays: 35 + (i * 7) % 55, // 35-89 days
    });
  }

  for (const wb of warningSkus) {
    const sku = SKUS[wb.skuIdx];
    batches.push({
      id: batchId(),
      skuId: sku.id,
      warehouseId: WH_IDS[wb.whIdx],
      lotNumber: `LOT-WRN-${String(batchIdx - 1).padStart(3, '0')}`,
      quantityOnHand: wb.qty,
      unitCostCents: sku.unitCostCents + wb.costDelta,
      manufacturingDate: daysFromRef(wb.mfgDaysAgo),
      expiryDate: daysFromRef(wb.expiryDays),
    });
  }

  // --- Normal batches: 3-24 months out (the bulk of inventory) ---
  for (let skuIdx = 0; skuIdx < SKUS.length; skuIdx++) {
    const sku = SKUS[skuIdx];
    // Determine number of batches per SKU (3-8 based on demand level)
    const batchCount = sku.monthlyDemand === 0 ? 3 : sku.monthlyDemand > 5000 ? 7 : sku.monthlyDemand > 500 ? 5 : 4;
    // Warehouses: 2-4 per SKU based on demand (widely distributed product gets 5+)
    const whCount = sku.monthlyDemand > 10000 ? 5 : sku.monthlyDemand > 1000 ? 3 : 2;
    const skuWarehouses = warehousesForSku(skuIdx, whCount);

    for (let b = 0; b < batchCount; b++) {
      const whId = skuWarehouses[b % skuWarehouses.length];
      const expiryMonths = 3 + ((skuIdx * 7 + b * 13) % 22); // 3-24 months
      const shelfLifeMonths = 6 + ((skuIdx * 3 + b * 5) % 19); // 6-24 months before expiry
      const expiryDays = expiryMonths * 30;
      const mfgDays = -(shelfLifeMonths * 30);

      // Vary quantity based on demand
      const baseQty = sku.monthlyDemand === 0
        ? 20 + (b * 17) % 80
        : Math.max(10, Math.round(sku.monthlyDemand * (0.3 + ((skuIdx + b) % 10) * 0.08)));

      // Slight cost variation per batch (batch-specific procurement costs)
      const costVariation = ((skuIdx * 11 + b * 29) % 201) - 100; // -100 to +100

      batches.push({
        id: batchId(),
        skuId: sku.id,
        warehouseId: whId,
        lotNumber: `LOT-${String(skuIdx + 1).padStart(2, '0')}-${String(b + 1).padStart(2, '0')}`,
        quantityOnHand: baseQty,
        unitCostCents: Math.max(1, sku.unitCostCents + costVariation),
        manufacturingDate: daysFromRef(mfgDays),
        expiryDate: daysFromRef(expiryDays),
      });
    }
  }

  // --- Extra batches for widely distributed product (Eliquis 5mg in 6 warehouses) ---
  const eliquisSku = SKUS.find((s) => s.id === 'sku-pfizer-eliquis-5mg')!;
  const extraWarehouses = ['wh-SE-Stockholm-01', 'wh-DK-Copenhagen-01', 'wh-PL-Warsaw-01'];
  for (let i = 0; i < extraWarehouses.length; i++) {
    batches.push({
      id: batchId(),
      skuId: eliquisSku.id,
      warehouseId: extraWarehouses[i],
      lotNumber: `LOT-ELQ-EXTRA-${String(i + 1).padStart(2, '0')}`,
      quantityOnHand: 2000 + i * 500,
      unitCostCents: eliquisSku.unitCostCents + ((i * 7) % 30) - 15,
      manufacturingDate: daysFromRef(-180 - i * 30),
      expiryDate: daysFromRef(300 + i * 60),
    });
  }

  // --- Batches for zero-demand SKUs (all inventory is at expiry risk) ---
  const zeroDemandSkus = SKUS.filter((s) => s.monthlyDemand === 0);
  for (const sku of zeroDemandSkus) {
    // Already have normal batches above, add a couple more with near-expiry
    batches.push({
      id: batchId(),
      skuId: sku.id,
      warehouseId: WH_IDS[0],
      lotNumber: `LOT-ZERO-${sku.id.split('-').pop()}-A`,
      quantityOnHand: 50,
      unitCostCents: sku.unitCostCents - 45,
      manufacturingDate: daysFromRef(-400),
      expiryDate: daysFromRef(45),
    });
    batches.push({
      id: batchId(),
      skuId: sku.id,
      warehouseId: WH_IDS[2],
      lotNumber: `LOT-ZERO-${sku.id.split('-').pop()}-B`,
      quantityOnHand: 30,
      unitCostCents: sku.unitCostCents + 25,
      manufacturingDate: daysFromRef(-350),
      expiryDate: daysFromRef(60),
    });
  }

  return batches;
}

export const BATCHES: Batch[] = generateBatches();

// ============================================================================
// INBOUND SHIPMENTS (40)
// Confirmed shipments arriving in the next 1-4 weeks.
// Create nuanced scenarios: relief, partial help, and genuine risk.
// ============================================================================

function generateInboundShipments(): InboundShipment[] {
  const shipments: InboundShipment[] = [];
  let idx = 1;
  const shipmentId = () => `inbound-${String(idx++).padStart(3, '0')}`;

  // --- Relief scenarios: large inbound neutralizes stockout risk ---
  // Entresto (high demand cardiovascular) — large shipment to Frankfurt
  shipments.push({ id: shipmentId(), skuId: 'sku-novartis-entresto-97mg', warehouseId: 'wh-DE-Frankfurt-01', expectedArrivalDate: daysFromRef(5), quantity: 3000, status: 'confirmed' });
  // Eliquis 5mg — large shipment to Rotterdam
  shipments.push({ id: shipmentId(), skuId: 'sku-pfizer-eliquis-5mg', warehouseId: 'wh-NL-Rotterdam-01', expectedArrivalDate: daysFromRef(3), quantity: 8000, status: 'confirmed' });
  // Farxiga — big restock to Dublin
  shipments.push({ id: shipmentId(), skuId: 'sku-az-farxiga-10mg', warehouseId: 'wh-IE-Dublin-01', expectedArrivalDate: daysFromRef(7), quantity: 6000, status: 'confirmed' });
  // Xarelto — large to Frankfurt
  shipments.push({ id: shipmentId(), skuId: 'sku-bayer-xarelto-20mg', warehouseId: 'wh-DE-Frankfurt-01', expectedArrivalDate: daysFromRef(4), quantity: 7000, status: 'confirmed' });
  // Amlodipine — massive generic restock to Warsaw
  shipments.push({ id: shipmentId(), skuId: 'sku-teva-amlodipine-5mg', warehouseId: 'wh-PL-Warsaw-01', expectedArrivalDate: daysFromRef(6), quantity: 12000, status: 'confirmed' });
  // Metformin — large to Lyon
  shipments.push({ id: shipmentId(), skuId: 'sku-teva-metformin-500mg', warehouseId: 'wh-FR-Lyon-01', expectedArrivalDate: daysFromRef(8), quantity: 10000, status: 'confirmed' });
  // Symbicort — seasonal relief
  shipments.push({ id: shipmentId(), skuId: 'sku-az-symbicort-160mcg', warehouseId: 'wh-DE-Frankfurt-02', expectedArrivalDate: daysFromRef(10), quantity: 5000, status: 'confirmed' });

  // --- Partial help: small inbound only partially addresses risk ---
  // Herceptin — small shipment (demand ~120/month but only 15 arriving)
  shipments.push({ id: shipmentId(), skuId: 'sku-roche-herceptin-150mg', warehouseId: 'wh-CH-Basel-01', expectedArrivalDate: daysFromRef(12), quantity: 15, status: 'confirmed' });
  // Keytruda — 20 units (demand ~110/month)
  shipments.push({ id: shipmentId(), skuId: 'sku-merck-keytruda-100mg', warehouseId: 'wh-IE-Dublin-01', expectedArrivalDate: daysFromRef(14), quantity: 20, status: 'confirmed' });
  // Opdivo — 15 units (demand ~90/month)
  shipments.push({ id: shipmentId(), skuId: 'sku-bms-opdivo-240mg', warehouseId: 'wh-IT-Milan-01', expectedArrivalDate: daysFromRef(9), quantity: 15, status: 'confirmed' });
  // Tagrisso — 25 units (demand ~130/month)
  shipments.push({ id: shipmentId(), skuId: 'sku-az-tagrisso-80mg', warehouseId: 'wh-BE-Brussels-01', expectedArrivalDate: daysFromRef(11), quantity: 25, status: 'confirmed' });
  // Revlimid — 40 units (demand ~250/month)
  shipments.push({ id: shipmentId(), skuId: 'sku-bms-revlimid-25mg', warehouseId: 'wh-NL-Leiden-01', expectedArrivalDate: daysFromRef(13), quantity: 40, status: 'confirmed' });
  // Humira — small shipment
  shipments.push({ id: shipmentId(), skuId: 'sku-abbvie-humira-40mg', warehouseId: 'wh-ES-Barcelona-01', expectedArrivalDate: daysFromRef(15), quantity: 30, status: 'in-transit' });
  // Ibrance — small
  shipments.push({ id: shipmentId(), skuId: 'sku-pfizer-ibrance-125mg', warehouseId: 'wh-AT-Vienna-01', expectedArrivalDate: daysFromRef(10), quantity: 25, status: 'in-transit' });

  // --- Genuine risk: these SKU+warehouse pairs have NO inbound ---
  // (intentionally not adding shipments for:)
  // - Perjeta at Basel (high-cost oncology, short supply)
  // - Tecentriq at Frankfurt (most expensive SKU, no resupply)
  // - Nucala at Stockholm (high-cost respiratory)
  // - Ninlaro at Copenhagen (specialty oncology)
  // - Entyvio at Vienna (specialty gastro)
  // - Skyrizi at Cork (specialty respiratory)

  // --- More shipments for coverage ---
  // Ozempic — big restock (high demand GLP-1)
  shipments.push({ id: shipmentId(), skuId: 'sku-novo-ozempic-1mg', warehouseId: 'wh-DK-Copenhagen-01', expectedArrivalDate: daysFromRef(4), quantity: 4000, status: 'confirmed' });
  // Wegovy — medium
  shipments.push({ id: shipmentId(), skuId: 'sku-novo-wegovy-2.4mg', warehouseId: 'wh-SE-Stockholm-01', expectedArrivalDate: daysFromRef(6), quantity: 2500, status: 'confirmed' });
  // Jardiance — large
  shipments.push({ id: shipmentId(), skuId: 'sku-bi-jardiance-25mg', warehouseId: 'wh-DE-Frankfurt-01', expectedArrivalDate: daysFromRef(8), quantity: 5500, status: 'confirmed' });
  // Omeprazole — bulk generic
  shipments.push({ id: shipmentId(), skuId: 'sku-teva-omeprazole-20mg', warehouseId: 'wh-NL-Rotterdam-01', expectedArrivalDate: daysFromRef(5), quantity: 9000, status: 'confirmed' });
  // Lantus — medium
  shipments.push({ id: shipmentId(), skuId: 'sku-sanofi-lantus-100iu', warehouseId: 'wh-FR-Lyon-01', expectedArrivalDate: daysFromRef(7), quantity: 2000, status: 'confirmed' });
  // Januvia — medium
  shipments.push({ id: shipmentId(), skuId: 'sku-merck-januvia-100mg', warehouseId: 'wh-ES-Barcelona-01', expectedArrivalDate: daysFromRef(9), quantity: 3000, status: 'confirmed' });
  // Trelegy — medium
  shipments.push({ id: shipmentId(), skuId: 'sku-gsk-trelegy-ellipta', warehouseId: 'wh-IE-Cork-01', expectedArrivalDate: daysFromRef(11), quantity: 1800, status: 'confirmed' });
  // Biktarvy — large
  shipments.push({ id: shipmentId(), skuId: 'sku-gilead-biktarvy-50mg', warehouseId: 'wh-BE-Brussels-01', expectedArrivalDate: daysFromRef(6), quantity: 2000, status: 'confirmed' });
  // Rinvoq — small
  shipments.push({ id: shipmentId(), skuId: 'sku-abbvie-rinvoq-15mg', warehouseId: 'wh-AT-Vienna-01', expectedArrivalDate: daysFromRef(13), quantity: 50, status: 'in-transit' });
  // Neulasta — medium
  shipments.push({ id: shipmentId(), skuId: 'sku-amgen-neulasta-6mg', warehouseId: 'wh-PL-Warsaw-01', expectedArrivalDate: daysFromRef(8), quantity: 120, status: 'confirmed' });
  // Prolia — medium
  shipments.push({ id: shipmentId(), skuId: 'sku-amgen-prolia-60mg', warehouseId: 'wh-CH-Basel-01', expectedArrivalDate: daysFromRef(10), quantity: 50, status: 'confirmed' });
  // Repatha — medium
  shipments.push({ id: shipmentId(), skuId: 'sku-amgen-repatha-140mg', warehouseId: 'wh-DE-Frankfurt-02', expectedArrivalDate: daysFromRef(12), quantity: 80, status: 'confirmed' });
  // Vyvanse — large
  shipments.push({ id: shipmentId(), skuId: 'sku-takeda-vyvanse-50mg', warehouseId: 'wh-IT-Milan-01', expectedArrivalDate: daysFromRef(5), quantity: 3000, status: 'confirmed' });
  // Gardasil — medium
  shipments.push({ id: shipmentId(), skuId: 'sku-merck-gardasil-9', warehouseId: 'wh-NL-Leiden-01', expectedArrivalDate: daysFromRef(7), quantity: 400, status: 'confirmed' });
  // Shingrix — medium
  shipments.push({ id: shipmentId(), skuId: 'sku-gsk-shingrix', warehouseId: 'wh-SE-Stockholm-01', expectedArrivalDate: daysFromRef(9), quantity: 500, status: 'confirmed' });
  // Copaxone — small
  shipments.push({ id: shipmentId(), skuId: 'sku-teva-copaxone-40mg', warehouseId: 'wh-FR-Lyon-01', expectedArrivalDate: daysFromRef(14), quantity: 40, status: 'in-transit' });
  // Dupixent — small
  shipments.push({ id: shipmentId(), skuId: 'sku-sanofi-dupixent-300mg', warehouseId: 'wh-DE-Frankfurt-01', expectedArrivalDate: daysFromRef(11), quantity: 20, status: 'in-transit' });
  // Aubagio — small
  shipments.push({ id: shipmentId(), skuId: 'sku-sanofi-aubagio-14mg', warehouseId: 'wh-NL-Rotterdam-01', expectedArrivalDate: daysFromRef(16), quantity: 50, status: 'confirmed' });
  // Prevnar — medium
  shipments.push({ id: shipmentId(), skuId: 'sku-pfizer-prevnar-13', warehouseId: 'wh-IE-Dublin-01', expectedArrivalDate: daysFromRef(8), quantity: 300, status: 'confirmed' });
  // Nexium — large
  shipments.push({ id: shipmentId(), skuId: 'sku-az-nexium-40mg', warehouseId: 'wh-ES-Barcelona-01', expectedArrivalDate: daysFromRef(4), quantity: 4000, status: 'confirmed' });
  // Veklury — small
  shipments.push({ id: shipmentId(), skuId: 'sku-gilead-veklury-100mg', warehouseId: 'wh-IT-Milan-01', expectedArrivalDate: daysFromRef(15), quantity: 60, status: 'in-transit' });
  // Ofev — small
  shipments.push({ id: shipmentId(), skuId: 'sku-bi-ofev-150mg', warehouseId: 'wh-CH-Basel-01', expectedArrivalDate: daysFromRef(18), quantity: 20, status: 'confirmed' });
  // Eliquis 2.5mg — medium
  shipments.push({ id: shipmentId(), skuId: 'sku-bms-eliquis-2.5mg', warehouseId: 'wh-DE-Frankfurt-01', expectedArrivalDate: daysFromRef(3), quantity: 5000, status: 'confirmed' });
  // Atorvastatin — bulk generic
  shipments.push({ id: shipmentId(), skuId: 'sku-sandoz-atorvastatin-20mg', warehouseId: 'wh-DE-Frankfurt-02', expectedArrivalDate: daysFromRef(5), quantity: 8000, status: 'confirmed' });
  // Lisinopril — bulk generic
  shipments.push({ id: shipmentId(), skuId: 'sku-mylan-lisinopril-10mg', warehouseId: 'wh-PL-Warsaw-01', expectedArrivalDate: daysFromRef(7), quantity: 9000, status: 'confirmed' });
  // Descovy — medium
  shipments.push({ id: shipmentId(), skuId: 'sku-gilead-descovy-200mg', warehouseId: 'wh-NL-Leiden-01', expectedArrivalDate: daysFromRef(9), quantity: 1200, status: 'confirmed' });

  return shipments;
}

export const INBOUND_SHIPMENTS: InboundShipment[] = generateInboundShipments();

// ============================================================================
// DEMAND FORECASTS
// 4-week weekly forecasts for each active SKU+warehouse pair.
// Base = monthlyDemand / 4, adjusted by seasonal factors for current month (March).
// ============================================================================

function generateDemandForecasts(): DemandForecast[] {
  const forecasts: DemandForecast[] = [];

  // Determine active SKU+warehouse pairs from batches
  const activeSkuWarehousePairs = new Set<string>();
  for (const batch of BATCHES) {
    // Only include pairs with non-zero demand SKUs
    const sku = SKUS.find((s) => s.id === batch.skuId);
    if (sku && sku.monthlyDemand > 0) {
      activeSkuWarehousePairs.add(`${batch.skuId}|${batch.warehouseId}`);
    }
  }

  // Current month is March (month 3) — use seasonal factor for month 3
  const currentMonth = '3';

  for (const pair of activeSkuWarehousePairs) {
    const [skuId, warehouseId] = pair.split('|');
    const sku = SKUS.find((s) => s.id === skuId)!;

    const seasonalFactor = sku.seasonalFactors?.[currentMonth] ?? 1.0;
    const baseWeeklyDemand = Math.round((sku.monthlyDemand / 4) * seasonalFactor);

    for (let week = 1; week <= 4; week++) {
      // Small weekly variation for realism (deterministic from IDs)
      const variationSeed = skuId.length + warehouseId.length + week;
      const variation = 1.0 + ((variationSeed % 11) - 5) * 0.02; // +/- 10%
      const demandUnits = Math.max(0, Math.round(baseWeeklyDemand * variation));

      const weekStartDate = daysFromRef((week - 1) * 7);

      forecasts.push({
        id: `forecast-${skuId}-${warehouseId}-w${week}`,
        skuId,
        warehouseId,
        weekStartDate,
        demandUnits,
      });
    }
  }

  return forecasts;
}

export const DEMAND_FORECASTS: DemandForecast[] = generateDemandForecasts();

// ============================================================================
// RISK CONFIG — re-export for seeding convenience
// ============================================================================

export { DEFAULT_RISK_CONFIG };

// ============================================================================
// Summary counts (for logging/verification)
// ============================================================================

export const SEED_COUNTS = {
  skus: SKUS.length,
  warehouses: WAREHOUSES.length,
  batches: BATCHES.length,
  inboundShipments: INBOUND_SHIPMENTS.length,
  demandForecasts: DEMAND_FORECASTS.length,
} as const;
