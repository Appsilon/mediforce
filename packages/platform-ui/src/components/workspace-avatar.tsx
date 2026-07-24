'use client';

import * as React from 'react';

/**
 * Workspace image (an organization's logo, or a personal namespace's avatar)
 * with a graceful fallback. An absent, empty, or unloadable source renders the
 * caller's fallback node instead of a broken-image glyph — logos are
 * user-uploaded data URLs, so a corrupt one is a real state.
 */
export function WorkspaceAvatar({
  source,
  alt = '',
  className,
  fallback,
}: {
  source: string | null | undefined;
  alt?: string;
  className: string;
  fallback: React.ReactNode;
}) {
  const [erroredSource, setErroredSource] = React.useState<string | null>(null);

  if (source === undefined || source === null || source === '' || source === erroredSource) {
    return <>{fallback}</>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={source}
      alt={alt}
      referrerPolicy="no-referrer"
      className={className}
      onError={() => setErroredSource(source)}
    />
  );
}
