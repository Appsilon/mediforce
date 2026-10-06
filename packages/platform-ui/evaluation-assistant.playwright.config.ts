import { defineConfig } from '@playwright/test';
import config from './playwright.config';

const servers = Array.isArray(config.webServer) ? config.webServer : [config.webServer];

export default defineConfig({
  ...config,
  webServer: servers.filter((server) => server !== undefined).map((server, index) => ({
    ...server,
    env: { ...server.env, NEXT_DIST_DIR: `.next/evaluation-assistant-${index}` },
  })),
});
