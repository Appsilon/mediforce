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
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.45);
        box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.8), 0 0 0 3px rgba(0, 0, 0, 0.2);
        pointer-events: none;
        z-index: 99999;
        transform: translate(-50%, -50%);
        transition: left 0.1s ease-out, top 0.1s ease-out;
        display: none;
      }
      .e2e-click-ripple {
        position: fixed;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 2px solid rgba(0, 0, 0, 0.3);
        pointer-events: none;
        z-index: 99998;
        transform: translate(-50%, -50%);
        animation: e2e-ripple 0.5s ease-out forwards;
      }
      @keyframes e2e-ripple {
        0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(3.5); opacity: 0; }
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

/**
 * Click with visible cursor movement during recording.
 * Moves mouse to element center before clicking — makes cursor visible in recordings.
 * In non-recording mode, just clicks normally.
 */
export async function click(page: Page, locator: ReturnType<Page['getByText']>) {
  if (isRecording) {
    const box = await locator.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
      await page.waitForTimeout(200);
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
