'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { buildSrcdoc, clampIframeHeight, isIframeResizeMessage } from './iframe-helpers';

interface SandboxedHtmlIframeProps {
  html: string;
  result?: Record<string, unknown> | null;
  title?: string;
  /**
   * Fill the parent's height and let the iframe scroll its own content,
   * instead of auto-growing to fit. Used by the fullscreen preview so a large
   * report renders with a single native scrollbar rather than nesting the
   * iframe's clamped-height scrollbar inside the modal's.
   */
  fill?: boolean;
}

export function SandboxedHtmlIframe({
  html,
  result = null,
  title = 'HTML preview',
  fill = false,
}: SandboxedHtmlIframeProps) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = React.useState(300);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  React.useEffect(() => {
    if (fill) return;
    const handler = (event: MessageEvent) => {
      if (
        isIframeResizeMessage(event.data) &&
        iframeRef.current &&
        event.source === iframeRef.current.contentWindow
      ) {
        setHeight((prev) => {
          const next = clampIframeHeight(event.data.height);
          return next > 0 ? next : prev;
        });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [fill]);

  React.useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'theme', dark: isDark }, '*');
  }, [isDark]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={buildSrcdoc(html, result, isDark)}
      sandbox="allow-scripts"
      style={{ width: '100%', height: fill ? '100%' : height, border: 'none' }}
      title={title}
    />
  );
}
