import type { Page } from '@playwright/test';

const isRecording = process.env.E2E_RECORD === 'true';

/**
 * Inject a visible cursor and click indicator into the page.
 * - Fake cursor (red dot) follows mouse movement
 * - Click ripple expands and fades on every click
 * Call once per page — re-inject after page.goto().
 */
export async function enableClickIndicator(page: Page) {
  if (!isRecording) return;
  await page.addStyleTag({
    content: `
      #e2e-cursor {
        position: fixed;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: rgba(239, 68, 68, 0.7);
        border: 2px solid rgba(239, 68, 68, 0.9);
        pointer-events: none;
        z-index: 99999;
        transform: translate(-50%, -50%);
        transition: left 0.05s, top 0.05s;
      }
      .e2e-click-ripple {
        position: fixed;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: rgba(239, 68, 68, 0.3);
        border: 2px solid rgba(239, 68, 68, 0.6);
        pointer-events: none;
        z-index: 99998;
        transform: translate(-50%, -50%);
        animation: e2e-ripple 0.5s ease-out forwards;
      }
      @keyframes e2e-ripple {
        0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(3); opacity: 0; }
      }
    `,
  });
  await page.addScriptTag({
    content: `
      (() => {
        if (document.getElementById('e2e-cursor')) return;
        const cursor = document.createElement('div');
        cursor.id = 'e2e-cursor';
        document.body.appendChild(cursor);
        document.addEventListener('mousemove', (e) => {
          cursor.style.left = e.clientX + 'px';
          cursor.style.top = e.clientY + 'px';
        }, true);
        document.addEventListener('click', (e) => {
          const ripple = document.createElement('div');
          ripple.className = 'e2e-click-ripple';
          ripple.style.left = e.clientX + 'px';
          ripple.style.top = e.clientY + 'px';
          document.body.appendChild(ripple);
          setTimeout(() => ripple.remove(), 600);
        }, true);
      })();
    `,
  });
}

/**
 * Wait for data to load, then pause for the viewer.
 * Waits for network to settle before pausing so we don't show loading spinners.
 */
export async function showStep(page: Page, ms = 1500) {
  if (isRecording) {
    await page.waitForTimeout(ms);
  }
}

/** Longer pause for key moments — state changes, important results. */
export async function showResult(page: Page, ms = 2500) {
  if (isRecording) {
    await page.waitForTimeout(ms);
  }
}

/**
 * Call after page.goto to set up recording helpers (click indicator).
 * Safe to call multiple times — re-injects after navigation.
 */
export async function recordingReady(page: Page) {
  if (!isRecording) return;
  await page.waitForLoadState('domcontentloaded');
  await enableClickIndicator(page);
}
