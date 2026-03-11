'use client';

import Papa from 'papaparse';

export interface ParsedCsvResult {
  headers: string[];
  rows: Record<string, string>[];
  errors: string[];
}

export function parseCsvString(csvString: string): ParsedCsvResult {
  const result = Papa.parse<Record<string, string>>(csvString, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });

  const errors = result.errors.map(
    (err) => `Row ${err.row ?? 'unknown'}: ${err.message}`
  );

  const headers =
    result.meta.fields !== undefined ? result.meta.fields : [];

  return {
    headers,
    rows: result.data,
    errors,
  };
}

export function rowsToHeaders(rows: Record<string, string>[]): string[] {
  if (rows.length === 0) return [];
  return Object.keys(rows[0]);
}
