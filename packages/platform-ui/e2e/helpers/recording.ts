import type { Page, Locator, TestInfo } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const isRecording = process.env.E2E_RECORD === 'true';

/** Inject cursor + click ripple CSS into the page. Re-injects after full navigation. */
async function ensureIndicators(page: Page) {
  try {
    const exists = await page.evaluate(() => !!document.getElementById('e2e-rec'));
    if (exists) return;

    await page.evaluate(() => {
      const style = document.createElement('style');
      style.id = 'e2e-rec';
      style.textContent = `
        #e2e-cursor {
          position: fixed;
          width: 22px;
          height: 28px;
          pointer-events: none;
          z-index: 99999;
          transform: translate(0, 0);
          transition: left 0.35s cubic-bezier(0.2, 0, 0.2, 1), top 0.35s cubic-bezier(0.2, 0, 0.2, 1);
          display: none;
          background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='28' viewBox='0 0 22 28'%3E%3Cpath d='M1.5 0.5L1.5 22L7.5 17L12 26L15.5 24.5L11 15.5L18 15.5Z' fill='%23fff' stroke='%23222' stroke-width='1.5' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat;
        }
        .e2e-ripple {
          position: fixed;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: rgba(59,130,246,0.4);
          pointer-events: none;
          z-index: 99998;
          transform: translate(-50%,-50%);
          animation: e2e-pop 0.5s ease-out forwards;
        }
        @keyframes e2e-pop {
          0% { transform: translate(-50%,-50%) scale(0.5); opacity:1; }
          100% { transform: translate(-50%,-50%) scale(2.5); opacity:0; }
        }
      `;
      document.head.appendChild(style);
      const cursor = document.createElement('div');
      cursor.id = 'e2e-cursor';
      document.body.appendChild(cursor);

      // Hide Next.js dev error overlay (we catch errors programmatically)
      const hideOverlay = document.createElement('style');
      hideOverlay.textContent = 'nextjs-portal { display: none !important; }';
      document.head.appendChild(hideOverlay);
    });
  } catch {
    // page navigated — will retry
  }
}

const pageErrors = new WeakMap<Page, string[]>();
const firstStepDone = new WeakSet<Page>();
const recordingStartedAt = new WeakMap<Page, number>();
const metaOutputDir = new WeakMap<Page, string>();

/**
 * Setup recording mode and error tracking. Call at the start of each test.
 * @param gifName — clean name for the GIF file (e.g. "task-approve-flow")
 * @param testInfo — Playwright testInfo to write gif-name.txt into output dir
 */
export async function setupRecording(page: Page, gifName?: string, testInfo?: TestInfo) {
  // Track page errors (React violations, unhandled exceptions) in all modes
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('Download the React DevTools')) {
      errors.push(msg.text());
    }
  });
  if (!isRecording) return;

  recordingStartedAt.set(page, Date.now());

  // Write GIF metadata for e2e-to-gif.py
  if (gifName && testInfo) {
    const outputDir = testInfo.outputDir;
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'gif-meta.json'), JSON.stringify({ name: gifName }));
    metaOutputDir.set(page, outputDir);
  }

  // Show cursor at center on page load
  page.on('load', async () => {
    try {
      await ensureIndicators(page);
      await page.evaluate(() => {
        const c = document.getElementById('e2e-cursor');
        if (c) {
          c.style.display = 'block';
          c.style.left = '640px';
          c.style.top = '360px';
        }
      });
    } catch { /* page might have navigated */ }
  });
}

/** Write trimStart to gif-meta.json on first interaction (content is ready). */
function markContentReady(page: Page) {
  if (firstStepDone.has(page)) return;
  firstStepDone.add(page);

  const startedAt = recordingStartedAt.get(page);
  const outputDir = metaOutputDir.get(page);
  if (!startedAt || !outputDir) return;

  const trimStart = (Date.now() - startedAt) / 1000;
  const metaPath = path.join(outputDir, 'gif-meta.json');
  try {
    const existing = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    fs.writeFileSync(metaPath, JSON.stringify({ ...existing, trimStart }));
  } catch { /* first test in describe may not have meta yet */ }
}

/**
 * Click with visible cursor + ripple. Positions cursor at element center,
 * shows ripple, then clicks. In normal mode: just clicks.
 */
export async function click(page: Page, locator: Locator) {
  if (isRecording) {
    markContentReady(page);
    await ensureIndicators(page);
    const box = await locator.boundingBox();
    if (box) {
      const x = Math.round(box.x + box.width / 2);
      const y = Math.round(box.y + box.height / 2);
      // Move cursor — CSS transition handles the animation
      await page.evaluate(({ x, y }) => {
        const c = document.getElementById('e2e-cursor');
        if (c) { c.style.display = 'block'; c.style.left = x + 'px'; c.style.top = y + 'px'; }
      }, { x, y });
      await page.waitForTimeout(400); // wait for CSS transition to finish
      // Ripple at click position
      await page.evaluate(({ x, y }) => {
        const r = document.createElement('div');
        r.className = 'e2e-ripple';
        r.style.left = x + 'px';
        r.style.top = y + 'px';
        document.body.appendChild(r);
        setTimeout(() => r.remove(), 600);
      }, { x, y });
    }
  }
  await locator.click();
}

/** Pause to let the viewer see what just happened. Only during recording.
 *  First call per page caps at 500ms so recordings start quickly. */
export async function showStep(page: Page, ms = 2000) {
  if (!isRecording) return;
  markContentReady(page);
  await page.waitForTimeout(ms);
}

/** Longer pause for key moments. Only during recording. */
export async function showResult(page: Page, ms = 3500) {
  if (!isRecording) return;
  markContentReady(page);
  await page.waitForTimeout(ms);
}

/**
 * Show a caption overlay at the bottom of the screen during recording.
 * Caption stays visible until replaced by the next showCaption call or
 * removed by endRecording. Fades in smoothly on appear, crossfades on replace.
 * In non-recording mode: no-op (zero overhead on normal test runs).
 */
export async function showCaption(page: Page, text: string, ms = 2500) {
  if (!isRecording) return;
  markContentReady(page);

  await page.evaluate((captionText) => {
    const existing = document.getElementById('e2e-caption');
    if (existing) {
      // Crossfade: fade out old, update text, fade in
      existing.style.opacity = '0';
      setTimeout(() => {
        existing.textContent = captionText;
        existing.style.opacity = '1';
      }, 250);
      return;
    }

    const el = document.createElement('div');
    el.id = 'e2e-caption';
    el.textContent = captionText;
    Object.assign(el.style, {
      position: 'fixed',
      bottom: '32px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '12px 32px',
      borderRadius: '10px',
      background: 'rgba(15, 23, 42, 0.90)',
      color: '#f1f5f9',
      fontSize: '17px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontWeight: '500',
      letterSpacing: '0.01em',
      lineHeight: '1.4',
      zIndex: '99997',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity 0.25s ease',
      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
      maxWidth: '80%',
      textAlign: 'center',
    });
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
  }, text);

  await page.waitForTimeout(ms);
}

/**
 * Move cursor to center and pause for seamless GIF loop.
 * Call only in the LAST test of each describe block — all tests in a block
 * share one video recording, so only the final test needs the loop ending.
 */
export async function endRecording(page: Page) {
  if (!isRecording) return;
  await page.evaluate(() => {
    // Fade out caption
    const caption = document.getElementById('e2e-caption');
    if (caption) { caption.style.opacity = '0'; }
    // Move cursor to center
    const c = document.getElementById('e2e-cursor');
    if (c) { c.style.left = '640px'; c.style.top = '360px'; }
  });
  await page.waitForTimeout(500);
}

/** Get page errors collected during the test. Empty array = no errors. */
export function getPageErrors(page: Page): string[] {
  return pageErrors.get(page) ?? [];
}
