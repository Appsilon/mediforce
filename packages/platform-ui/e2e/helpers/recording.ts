import type { Page, Locator } from '@playwright/test';

const isRecording = process.env.E2E_RECORD === 'true';

const injectedPages = new WeakSet<Page>();

/** Inject click ripple CSS + JS into the page. Called lazily on first click(). */
async function ensureIndicators(page: Page) {
  if (injectedPages.has(page)) return;
  try {
    await page.evaluate(() => {
      if (document.getElementById('e2e-recording-style')) return;
      const style = document.createElement('style');
      style.id = 'e2e-recording-style';
      style.textContent = `
        #e2e-cursor {
          position: fixed;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: rgba(0, 0, 0, 0.5);
          box-shadow: 0 0 0 2px rgba(255,255,255,0.9), 0 0 0 4px rgba(0,0,0,0.15);
          pointer-events: none;
          z-index: 99999;
          transform: translate(-50%, -50%);
          transition: left 0.05s, top 0.05s;
          display: none;
        }
        .e2e-ripple {
          position: fixed;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: rgba(59, 130, 246, 0.4);
          pointer-events: none;
          z-index: 99998;
          transform: translate(-50%, -50%);
          animation: e2e-pop 0.5s ease-out forwards;
        }
        @keyframes e2e-pop {
          0% { transform: translate(-50%,-50%) scale(0.5); opacity: 1; }
          100% { transform: translate(-50%,-50%) scale(2.5); opacity: 0; }
        }
      `;
      document.head.appendChild(style);

      const cursor = document.createElement('div');
      cursor.id = 'e2e-cursor';
      document.body.appendChild(cursor);

      document.addEventListener('mousemove', (e) => {
        cursor.style.display = 'block';
        cursor.style.left = e.clientX + 'px';
        cursor.style.top = e.clientY + 'px';
      }, true);

      document.addEventListener('mousedown', (e) => {
        const ripple = document.createElement('div');
        ripple.className = 'e2e-ripple';
        ripple.style.left = e.clientX + 'px';
        ripple.style.top = e.clientY + 'px';
        document.body.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
      }, true);
    });
    injectedPages.add(page);
  } catch {
    // Page might have navigated — will retry on next click
  }
}

/**
 * Setup recording mode. Call at the start of each test.
 * Currently a no-op — indicators are injected lazily by click().
 */
export async function setupRecording(_page: Page) {
  // Indicators are injected on first click() call after page loads
}

/**
 * Click with visible cursor movement. Moves mouse to element center,
 * pauses briefly, then clicks. Shows cursor dot and click ripple in recordings.
 * In normal mode: just clicks.
 */
export async function click(page: Page, locator: Locator) {
  if (isRecording) {
    await ensureIndicators(page);
    const box = await locator.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
      await page.waitForTimeout(150);
    }
  }
  await locator.click();
}

/** Pause to let the viewer see what just happened. Only during recording. */
export async function showStep(page: Page, ms = 1500) {
  if (isRecording) {
    await page.waitForTimeout(ms);
  }
}

/** Longer pause for key moments. Only during recording. */
export async function showResult(page: Page, ms = 2500) {
  if (isRecording) {
    await page.waitForTimeout(ms);
  }
}
