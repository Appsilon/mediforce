import type { Page, Locator } from '@playwright/test';

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
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: rgba(0,0,0,0.5);
          box-shadow: 0 0 0 3px #fff, 0 0 8px rgba(0,0,0,0.3);
          pointer-events: none;
          z-index: 99999;
          transform: translate(-50%,-50%);
          transition: left 0.15s ease-out, top 0.15s ease-out;
          display: none;
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
    });
  } catch {
    // page navigated — will retry
  }
}

/**
 * Setup recording mode. Call at the start of each test (no-op in normal mode).
 */
export async function setupRecording(_page: Page) {
  // indicators injected lazily by click()
}

/**
 * Click with visible cursor + ripple. Positions cursor at element center,
 * shows ripple, then clicks. In normal mode: just clicks.
 */
export async function click(page: Page, locator: Locator) {
  if (isRecording) {
    await ensureIndicators(page);
    const box = await locator.boundingBox();
    if (box) {
      const x = Math.round(box.x + box.width / 2);
      const y = Math.round(box.y + box.height / 2);
      await page.evaluate(({ x, y }) => {
        const c = document.getElementById('e2e-cursor');
        if (c) { c.style.display = 'block'; c.style.left = x + 'px'; c.style.top = y + 'px'; }
        const r = document.createElement('div');
        r.className = 'e2e-ripple';
        r.style.left = x + 'px';
        r.style.top = y + 'px';
        document.body.appendChild(r);
        setTimeout(() => r.remove(), 600);
      }, { x, y });
      await page.waitForTimeout(300);
    }
  }
  await locator.click();
}

/** Pause to let the viewer see what just happened. Only during recording. */
export async function showStep(page: Page, ms = 1500) {
  if (isRecording) await page.waitForTimeout(ms);
}

/** Longer pause for key moments. Only during recording. */
export async function showResult(page: Page, ms = 2500) {
  if (isRecording) await page.waitForTimeout(ms);
}
