export type DryRunFilter = 'all' | 'production' | 'dry-run';

export function dryRunFilterToQuery(filter: DryRunFilter): boolean | undefined {
  return filter === 'all' ? undefined : filter === 'dry-run';
}
