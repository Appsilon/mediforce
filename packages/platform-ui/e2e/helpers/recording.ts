import type { Page } from '@playwright/test';

const isRecording = process.env.E2E_RECORD === 'true';

/**
 * Inject cursor + click ripple via addInitScript — survives client-side navigations.
 * Call once per test, before the first page.goto().
 */
export async function setupRecording(page: Page) {
  if (!isRecording) return;

  await page.addInitScript(() => {
    // Cursor dot — follows mouse
    const style = document.createElement('style');
    style.textContent = `
      #e2e-cursor {
        position: fixed;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: rgba(220, 38, 38, 0.6);
        border: 2px solid rgba(220, 38, 38, 0.9);
        pointer-events: none;
        z-index: 99999;
        transform: translate(-50%, -50%);
        transition: left 0.08s ease-out, top 0.08s ease-out;
        display: none;
      }
      .e2e-click-ripple {
        position: fixed;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: rgba(220, 38, 38, 0.25);
        border: 2px solid rgba(220, 38, 38, 0.5);
        pointer-events: none;
        z-index: 99998;
        transform: translate(-50%, -50%);
        animation: e2e-ripple 0.6s ease-out forwards;
      }
      @keyframes e2e-ripple {
        0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(3); opacity: 0; }
      }
    `;
    document.documentElement.appendChild(style);

    function ensureCursor() {
      if (document.getElementById('e2e-cursor')) return;
      const cursor = document.createElement('div');
      cursor.id = 'e2e-cursor';
      document.body.appendChild(cursor);
    }

    document.addEventListener('mousemove', (e) => {
      ensureCursor();
      const cursor = document.getElementById('e2e-cursor')!;
      cursor.style.display = 'block';
      cursor.style.left = e.clientX + 'px';
      cursor.style.top = e.clientY + 'px';
    }, true);

    document.addEventListener('mousedown', (e) => {
      const ripple = document.createElement('div');
      ripple.className = 'e2e-click-ripple';
      ripple.style.left = e.clientX + 'px';
      ripple.style.top = e.clientY + 'px';
      document.body.appendChild(ripple);
      setTimeout(() => ripple.remove(), 700);
    }, true);
  });
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
