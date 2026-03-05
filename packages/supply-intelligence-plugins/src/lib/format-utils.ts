/**
 * Format integer cents to EUR with de-DE locale, 0 decimal places.
 * Mirrors supply-intelligence/src/lib/utils.ts formatEur.
 * Division by 100 happens here at the display layer only.
 */
export function formatEur(cents: number): string {
  return (cents / 100).toLocaleString('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
