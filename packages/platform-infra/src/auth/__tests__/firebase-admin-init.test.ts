import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let mockAdcExists = false;

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: (p: string) =>
      p.endsWith('application_default_credentials.json')
        ? mockAdcExists
        : actual.existsSync(p),
  };
});

const CREDENTIAL_ENV_KEYS = [
  'NEXT_PUBLIC_USE_EMULATORS',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'K_SERVICE',
  'GOOGLE_CLOUD_PROJECT',
  'GCLOUD_PROJECT',
] as const;

function clearCredentialEnv() {
  for (const key of CREDENTIAL_ENV_KEYS) {
    vi.stubEnv(key, '');
    delete process.env[key];
  }
}

describe('detectCredentialMode', () => {
  beforeEach(() => {
    mockAdcExists = false;
    clearCredentialEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns "emulator" when NEXT_PUBLIC_USE_EMULATORS=true', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_EMULATORS', 'true');
    const { detectCredentialMode } = await import('../firebase-admin-init.js');
    expect(detectCredentialMode()).toBe('emulator');
  });

  it('returns "service account file" when GOOGLE_APPLICATION_CREDENTIALS is set', async () => {
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '/tmp/sa.json');
    const { detectCredentialMode } = await import('../firebase-admin-init.js');
    expect(detectCredentialMode()).toBe('service account file');
  });

  it('returns "ADC (gcloud)" when ADC file exists', async () => {
    mockAdcExists = true;
    const { detectCredentialMode } = await import('../firebase-admin-init.js');
    expect(detectCredentialMode()).toBe('ADC (gcloud)');
  });

  it('returns "GCP metadata" when K_SERVICE is set', async () => {
    vi.stubEnv('K_SERVICE', 'my-service');
    const { detectCredentialMode } = await import('../firebase-admin-init.js');
    expect(detectCredentialMode()).toBe('GCP metadata');
  });

  it('returns "GCP metadata" when GOOGLE_CLOUD_PROJECT is set', async () => {
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'my-project');
    const { detectCredentialMode } = await import('../firebase-admin-init.js');
    expect(detectCredentialMode()).toBe('GCP metadata');
  });

  it('returns "none" when nothing is configured', async () => {
    const { detectCredentialMode } = await import('../firebase-admin-init.js');
    expect(detectCredentialMode()).toBe('none');
  });
});

describe('ensureAdminApp credential check (via getAdminFirestore)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockAdcExists = false;
    clearCredentialEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('emulator mode bypasses the credential check and does not throw', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_EMULATORS', 'true');
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'demo-mediforce');
    const mod = await import('../firebase-admin-init.js');
    expect(() => mod.getAdminFirestore()).not.toThrow();
  });

  it('ADC file present → does not throw credential error', async () => {
    mockAdcExists = true;
    const mod = await import('../firebase-admin-init.js');
    expect(() => mod.getAdminFirestore()).not.toThrow(
      /no credentials detected/,
    );
  });

  it('GOOGLE_APPLICATION_CREDENTIALS set → does not throw credential error', async () => {
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '/tmp/sa.json');
    const mod = await import('../firebase-admin-init.js');
    expect(() => mod.getAdminFirestore()).not.toThrow(
      /no credentials detected/,
    );
  });

  it('K_SERVICE set → does not throw credential error', async () => {
    vi.stubEnv('K_SERVICE', 'my-service');
    const mod = await import('../firebase-admin-init.js');
    expect(() => mod.getAdminFirestore()).not.toThrow(
      /no credentials detected/,
    );
  });

  it('no credentials → throws with all three remedy keywords', async () => {
    const { assertCredentialsPresent } = await import(
      '../firebase-admin-init.js'
    );
    let caught: unknown;
    try {
      assertCredentialsPresent();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toMatch(/gcloud/);
    expect(message).toMatch(/GOOGLE_APPLICATION_CREDENTIALS/);
    expect(message).toMatch(/NEXT_PUBLIC_USE_EMULATORS/);
  });
});
