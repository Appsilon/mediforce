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
    });
  } catch {
    // page navigated — will retry
  }
}

/**
 * Setup recording mode. Call at the start of each test.
 * Shows cursor at center of screen from the beginning.
 */
export async function setupRecording(page: Page) {
  if (!isRecording) return;
  // Inject indicators early and show cursor at center
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

/** Pause to let the viewer see what just happened. Only during recording. */
export async function showStep(page: Page, ms = 1500) {
  if (isRecording) await page.waitForTimeout(ms);
}

/** Longer pause for key moments. Only during recording. */
export async function showResult(page: Page, ms = 2500) {
  if (isRecording) await page.waitForTimeout(ms);
}
