import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import type { FullConfig } from '@playwright/test';
import { startMockOAuthServer, type MockOAuthServerHandle } from './helpers/mock-oauth-server';

function runMigrations(): void {
  const infraDir = path.resolve(__dirname, '..', '..', '..', 'packages', 'platform-infra');
  const result = spawnSync('pnpm', ['exec', 'drizzle-kit', 'migrate'], {
    cwd: infraDir,
    env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH ?? ''}` },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`[global-setup] db:migrate failed:\n${result.stderr ?? result.stdout}`);
  }
  // eslint-disable-next-line no-console
  console.log('[global-setup] database migrations applied');
}

/** Written next to this file so both auth-setup and journey tests can read it.
 *  The handle is kept on `globalThis` so globalTeardown can stop the server. */
const OAUTH_URL_FILE = path.join(__dirname, '.mock-oauth-url');

declare global {
  // eslint-disable-next-line no-var
  var __mockOAuthHandle: MockOAuthServerHandle | undefined;
  // eslint-disable-next-line no-var
  var __firebaseEmulatorProcess: ChildProcess | undefined;
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.connect(port, '127.0.0.1');
  });
}

async function waitForPort(port: number, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortListening(port)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Firebase emulator port ${port} did not become available within ${timeoutMs}ms`);
}

async function ensureFirebaseEmulator(): Promise<void> {
  if (await isPortListening(9099)) {
    // eslint-disable-next-line no-console
    console.log('[global-setup] Firebase Auth emulator already running on :9099');
    return;
  }

  const uiDir = path.resolve(__dirname, '..');
  const dataDir = path.join(uiDir, '.emulator-data');
  const args = [
    'emulators:start',
    '--project', 'demo-mediforce',
    '--only', 'auth,storage',
    '--export-on-exit', dataDir,
  ];
  if (fs.existsSync(dataDir)) args.push('--import', dataDir);

  const proc = spawn('firebase', args, {
    cwd: uiDir,
    // Ensure Homebrew's bin (firebase, java wrappers) is in PATH.
    env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH ?? ''}` },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  proc.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error(`[global-setup] Firebase emulator spawn error: ${err.message}`);
  });

  globalThis.__firebaseEmulatorProcess = proc;
  await waitForPort(9099);
  // eslint-disable-next-line no-console
  console.log('[global-setup] Firebase Auth emulator started on :9099');
}

async function globalSetup(_config: FullConfig): Promise<void> {
  runMigrations();
  await ensureFirebaseEmulator();
  const handle = await startMockOAuthServer();
  globalThis.__mockOAuthHandle = handle;
  fs.writeFileSync(OAUTH_URL_FILE, handle.baseUrl, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`[global-setup] mock OAuth server at ${handle.baseUrl} (url file: ${OAUTH_URL_FILE})`);
}

export default globalSetup;
