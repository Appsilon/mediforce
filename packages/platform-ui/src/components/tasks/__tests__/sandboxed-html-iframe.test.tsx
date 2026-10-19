import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';

const mockUseTheme = vi.fn(() => ({ resolvedTheme: 'light', setTheme: vi.fn() }));
vi.mock('next-themes', () => ({
  useTheme: () => mockUseTheme(),
}));

import { SandboxedHtmlIframe } from '../sandboxed-html-iframe';
import { buildSrcdoc, MAX_IFRAME_HEIGHT } from '../iframe-helpers';

function renderedIframe(): HTMLIFrameElement {
  const iframe = document.querySelector('iframe');
  expect(iframe).not.toBeNull();
  return iframe as HTMLIFrameElement;
}

async function postResize(iframe: HTMLIFrameElement, height: number): Promise<void> {
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'resize', height }, source: iframe.contentWindow }),
    );
  });
}

describe('SandboxedHtmlIframe', () => {
  it('sandboxes with allow-scripts only and embeds the body in srcdoc', () => {
    const html = '<div id="agent-body">Hello report</div>';
    render(<SandboxedHtmlIframe html={html} />);

    const iframe = renderedIframe();
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe.getAttribute('srcdoc')).toContain(html);
  });

  it('injects window.__data__ with the result JSON and loads Tailwind v4', () => {
    render(<SandboxedHtmlIframe html="<p>Report</p>" result={{ count: 42 }} />);

    const srcdoc = renderedIframe().getAttribute('srcdoc')!;
    expect(srcdoc).toContain('window.__data__');
    expect(srcdoc).toContain('"count":42');
    expect(srcdoc).toContain('@tailwindcss/browser@4');
  });

  it('escapes closing script tags in result data', () => {
    render(<SandboxedHtmlIframe html="<p>Test</p>" result={{ html: '</script><script>alert(1)</script>' }} />);

    const srcdoc = renderedIframe().getAttribute('srcdoc')!;
    expect(srcdoc).not.toContain('</script><script>alert');
    expect(srcdoc).toContain('<\\/script>');
  });

  it('updates its height when the iframe posts a resize message', async () => {
    render(<SandboxedHtmlIframe html="<div>resize me</div>" />);
    const iframe = renderedIframe();

    await postResize(iframe, 875);

    await waitFor(() => expect(iframe.style.height).toBe('875px'));
  });

  it('caps its height at MAX_IFRAME_HEIGHT for a runaway-large value', async () => {
    render(<SandboxedHtmlIframe html="<div>runaway</div>" />);
    const iframe = renderedIframe();

    await postResize(iframe, 99999);

    await waitFor(() => {
      const px = parseInt(iframe.style.height, 10);
      expect(px).toBeLessThanOrEqual(MAX_IFRAME_HEIGHT);
      expect(px).toBeGreaterThan(0);
    });
  });

  it('holds its height steady through a runaway sequence of growing heights', async () => {
    render(<SandboxedHtmlIframe html="<div>loop</div>" />);
    const iframe = renderedIframe();

    // The ResizeObserver feedback loop: 100vh chasing the iframe size.
    for (const height of [1000, 2000, 4000, 8000, 16000, 32000]) {
      await postResize(iframe, height);
    }

    await waitFor(() => expect(parseInt(iframe.style.height, 10)).toBe(MAX_IFRAME_HEIGHT));
  });

  it('keeps its previous height when the iframe reports an invalid value', async () => {
    render(<SandboxedHtmlIframe html="<div>invalid</div>" />);
    const iframe = renderedIframe();

    await postResize(iframe, 800);
    await waitFor(() => expect(parseInt(iframe.style.height, 10)).toBe(800));

    for (const bad of [0, -1, Number.NaN]) {
      await postResize(iframe, bad);
    }

    expect(parseInt(iframe.style.height, 10)).toBe(800);
  });

  it('neutralises Tailwind viewport-height classes in srcdoc', () => {
    render(<SandboxedHtmlIframe html='<div class="min-h-screen">vh content</div>' />);

    const srcdoc = renderedIframe().getAttribute('srcdoc')!;
    // !important is load-bearing: without it, Tailwind's CDN-generated
    // .h-screen utility ties on specificity and may win the cascade.
    expect(srcdoc).toMatch(/\.h-screen[\s\S]*?,\s*\.min-h-screen[\s\S]*?,\s*\.max-h-screen/);
    expect(srcdoc).toMatch(/height:\s*auto\s*!important/);
    expect(srcdoc).toMatch(/min-height:\s*0\s*!important/);
    expect(srcdoc).toMatch(/max-height:\s*none\s*!important/);
  });

  it('posts a theme message to the iframe when the parent theme changes', async () => {
    mockUseTheme.mockReturnValue({ resolvedTheme: 'light', setTheme: vi.fn() });
    const { rerender } = render(<SandboxedHtmlIframe html="<div>theme-test</div>" />);
    const iframe = renderedIframe();
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, 'postMessage');

    mockUseTheme.mockReturnValue({ resolvedTheme: 'dark', setTheme: vi.fn() });
    rerender(<SandboxedHtmlIframe html="<div>theme-test</div>" />);

    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith({ type: 'theme', dark: true }, '*');
    });
  });
});

describe('buildSrcdoc', () => {
  it('hardens srcdoc with CSP and escapes stringify fallback data', () => {
    const result = {};
    Object.defineProperty(result, 'unsafe', {
      enumerable: true,
      get() {
        throw new Error('</script><script>alert(1)</script>');
      },
    });

    const srcdoc = buildSrcdoc('<div>body</div>', result, false);

    expect(srcdoc).toContain('Content-Security-Policy');
    expect(srcdoc).toContain("connect-src 'none'");
    expect(srcdoc).not.toContain('</script><script>alert(1)</script>');
    expect(srcdoc).toContain('<\\/script><script>alert(1)<\\/script>');
  });
});
