'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { buildSrcdoc, clampIframeHeight, isIframeResizeMessage } from './iframe-helpers';

interface SandboxedHtmlIframeProps {
  html: string;
  result?: Record<string, unknown> | null;
  title?: string;
}

export function SandboxedHtmlIframe({ html, result = null, title = 'HTML preview' }: SandboxedHtmlIframeProps) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = React.useState(300);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (isIframeResizeMessage(event.data) && iframeRef.current && event.source === iframeRef.current.contentWindow) {
        setHeight((prev) => {
          const next = clampIframeHeight(event.data.height);
          return next > 0 ? next : prev;
        });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  React.useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'theme', dark: isDark }, '*');
  }, [isDark]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={buildSrcdoc(html, result, isDark)}
      sandbox="allow-scripts"
      style={{ width: '100%', height, border: 'none' }}
      title={title}
    />
  );
}
