'use client';

/**
 * Shared "Load more" footer for keyset-paginated tables — Monitoring's
 * Workflows/Agents/Users/Tasks tabs all render this identically below their
 * respective `<table>` when the server reports more rows past the current
 * page. Renders nothing when `hasMore` is false.
 */
export function LoadMoreFooter({
  hasMore,
  loadingMore = false,
  onLoadMore,
}: {
  hasMore: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  if (!hasMore) return null;

  return (
    <div className="flex justify-center border-t py-3">
      <button
        onClick={onLoadMore}
        disabled={loadingMore}
        className="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loadingMore ? 'Loading…' : 'Load more'}
      </button>
    </div>
  );
}
