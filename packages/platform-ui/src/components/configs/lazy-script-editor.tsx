'use client';

import dynamic from 'next/dynamic';

/**
 * Lazy-loaded CodeMirror editor — only downloads (~200KB) when a script step
 * is actually expanded in the config editor. Shows a loading skeleton while
 * the chunk loads.
 */
export const LazyScriptEditor = dynamic(
  () =>
    import('./inline-script-editor').then((mod) => mod.InlineScriptEditor),
  {
    ssr: false,
    loading: () => (
      <div className="h-32 rounded-md border bg-muted/30 animate-pulse" />
    ),
  },
);
