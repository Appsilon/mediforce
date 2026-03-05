import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';

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
    baseURL: 'http://localhost:9003',
    headless: true,
    trace: 'on-first-retry',
  },
  projects,
  webServer: {
    command: useEmulators
      ? 'NEXT_PUBLIC_USE_EMULATORS=true pnpm dev'
      : 'pnpm dev',
    port: 9003,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
