'use client';

import { usePathname } from 'next/navigation';

/**
 * Extracts the handle (first path segment) from the current URL pathname.
 * Example: /my-org/workflows/foo -> "my-org"
 */
export function useHandleFromPath(): string {
  const pathname = usePathname();
  if (pathname === null) return '';
  return pathname.split('/')[1] ?? '';
}
