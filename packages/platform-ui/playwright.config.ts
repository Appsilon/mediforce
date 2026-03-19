import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';

// When using emulators, run on a separate port so we don't reuse a dev server
// that connects to production Firebase. This is the #1 cause of "data not found"
// failures: seed data goes into the emulator but the reused dev server reads
// from production.
const testPort = useEmulators ? 9007 : 9003;

const projects: PlaywrightTestConfig['projects'] = [];

if (useEmulators) {
  projects.push({
    name: 'setup',
    testMatch: 'auth-setup.ts',
  });
}

projects.push({
  name: 'chromium',
  use: { ...devices['Desktop Chrome'] },
  testIgnore: ['auth-setup.ts', '**/authenticated/**'],
});

if (useEmulators) {
  projects.push({
    name: 'authenticated',
    testDir: './e2e/authenticated',
    dependencies: ['setup'],
    use: {
      ...devices['Desktop Chrome'],
      storageState: 'e2e/.auth/user.json',
    },
  });
}

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: `http://localhost:${testPort}`,
    headless: true,
    trace: 'on-first-retry',
  },
  projects,
  webServer: {
    command: useEmulators
      ? `NEXT_PUBLIC_USE_EMULATORS=true NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-mediforce npx next dev -p ${testPort}`
      : 'pnpm dev',
    port: testPort,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
