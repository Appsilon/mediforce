'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

/**
 * Legacy ProcessConfig view page -- processConfigs collection has been removed.
 * This page is kept as a stub to prevent 404s from stale links.
 */
export default function ConfigViewPage() {
  const { handle } = useParams<{ handle: string }>();
  return (
    <div className="p-6 text-center text-sm text-muted-foreground">
      <p>Process configurations are now embedded in workflow definitions.</p>
      <p className="mt-2">
        <Link href={`/${handle}`} className="underline">Back to catalog</Link>
      </p>
    </div>
  );
}
