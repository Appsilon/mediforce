import {
  parseAsArrayOf,
  parseAsStringLiteral,
  parseAsInteger,
  parseAsString,
} from 'nuqs';

/**
 * nuqs parser definitions for Operational View URL state.
 * These define how filter/sort/pagination state is serialized to/from the URL.
 */
export const operationalParsers = {
  riskLevel: parseAsArrayOf(
    parseAsStringLiteral(['red', 'orange', 'green'] as const),
  ),
  warehouse: parseAsArrayOf(parseAsString),
  country: parseAsArrayOf(parseAsString),
  sortBy: parseAsStringLiteral([
    'riskLevel',
    'expiryRiskCents',
    'stockoutRiskCents',
    'coverageWeeks',
    'skuName',
    'warehouseName',
    'onHand',
    'monthlyDemand',
  ] as const).withDefault('expiryRiskCents'),
  sortDir: parseAsStringLiteral(['asc', 'desc'] as const).withDefault('desc'),
  page: parseAsInteger.withDefault(1),
  pageSize: parseAsInteger.withDefault(25),
};
