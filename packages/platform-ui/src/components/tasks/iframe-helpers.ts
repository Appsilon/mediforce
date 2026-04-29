/**
 * Shared helpers for sandboxed iframe rendering of agent-produced HTML
 * reports. Used by:
 *   - agent-output-review-panel.tsx (L3 review tasks)
 *   - task-context-panel.tsx (human-review tasks following an agent step)
 *
 * Both consumers render the document inside `<iframe sandbox="allow-scripts">`
 * with an auto-resize listener and theme sync. The helpers below produce the
 * srcdoc and document the message contract so the listeners stay symmetric.
 */

/**
 * Build a self-contained HTML document for a sandboxed iframe.
 *
 * The document:
 *   - Loads Tailwind v4 from CDN so agent-authored markup can use utility
 *     classes without a build step.
 *   - Exposes the structured agent result (if any) on `window.__data__`.
 *   - Posts `{ type: 'resize', height }` to the parent on every body resize so
 *     the parent can size the iframe to fit content.
 *   - Listens for `{ type: 'theme', dark }` messages from the parent and
 *     toggles the `dark` class on `<html>` to keep the iframe in step with
 *     the host theme.
 */
export function buildSrcdoc(
  presentation: string,
  result: Record<string, unknown> | null,
  isDark: boolean,
): string {
  // Escape closing script tags in data to prevent XSS breakout
  const safeData = JSON.stringify(result ?? {}).replace(/<\//g, '<\\/');
  return `<!DOCTYPE html>
<html class="${isDark ? 'dark' : ''}">
<head>
<meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<style type="text/tailwindcss">
@theme {
  --color-surface: #ffffff;
  --color-surface-dark: #0f1117;
  --color-text: #1a1a2e;
  --color-text-dark: #e2e4e9;
  --color-muted: #6b7280;
  --color-muted-dark: #9ca3af;
  --color-border: #e5e7eb;
  --color-border-dark: #2d2f36;
}
body {
  margin: 0;
  padding: 1rem;
  background: var(--color-surface);
  color: var(--color-text);
}
.dark body {
  background: var(--color-surface-dark);
  color: var(--color-text-dark);
}
</style>
<script>window.__data__ = ${safeData};</script>
</head>
<body>
${presentation}
<script>
const ro = new ResizeObserver(() => {
  window.parent.postMessage({ type: 'resize', height: document.body.scrollHeight }, '*');
});
ro.observe(document.body);
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'theme') {
    document.documentElement.classList.toggle('dark', e.data.dark);
  }
});
</script>
</body>
</html>`;
}

/** Message posted by the iframe when its body size changes. */
export interface IframeResizeMessage {
  type: 'resize';
  height: number;
}

/** Type guard for iframe-originated resize messages. */
export function isIframeResizeMessage(data: unknown): data is IframeResizeMessage {
  return (
    data !== null &&
    typeof data === 'object' &&
    (data as { type?: unknown }).type === 'resize' &&
    typeof (data as { height?: unknown }).height === 'number'
  );
}
