'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Returns a click handler that navigates back in browser history
 * if there is a previous page, otherwise falls back to the given href.
 */
export function useBackNavigation(fallbackHref: string) {
  const router = useRouter();

  const goBack = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      if (window.history.length > 1) {
        router.back();
      } else {
        router.push(fallbackHref);
      }
    },
    [router, fallbackHref],
  );

  return { goBack, fallbackHref };
}
