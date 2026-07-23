import { describe, it, expect } from 'vitest';
import {
  verifyFirebasePassword,
  resolveFirebaseScryptParams,
  type FirebaseScryptParams,
} from '../firebase-scrypt';

// Canonical public Firebase scrypt test vector (firebase/scrypt reference).
const VECTOR = {
  password: 'user1password',
  salt: '42xEC+ixf3L2lw==',
  saltSeparator: 'Bw==',
  signerKey:
    'jxspr8Ki0RYycVU8zykbdLGjFQ3McFUH0uiiTvC8pVMXAn210wjLNmdZJzxUECKbm0QsEmYUSDzZvpjeJ9WmXA==',
  rounds: 8,
  memCost: 14,
  expectedHash:
    'lSrfV15cpx95/sZS2W9c9Kp6i/LVgQNDNC/qzrCnh1SAyZvqmZqAjTdn3aoItz+VHjoZilo78198JAdRuid5lQ==',
} as const;

const VECTOR_PARAMS: FirebaseScryptParams = {
  signerKey: VECTOR.signerKey,
  saltSeparator: VECTOR.saltSeparator,
  rounds: VECTOR.rounds,
  memCost: VECTOR.memCost,
};

describe('verifyFirebasePassword', () => {
  it('verifies the canonical Firebase scrypt vector', () => {
    expect(
      verifyFirebasePassword(VECTOR.password, VECTOR.expectedHash, VECTOR.salt, VECTOR_PARAMS),
    ).toBe(true);
  });

  it('rejects a wrong password', () => {
    expect(
      verifyFirebasePassword('not-the-password', VECTOR.expectedHash, VECTOR.salt, VECTOR_PARAMS),
    ).toBe(false);
  });
});

describe('resolveFirebaseScryptParams', () => {
  const FULL_ENV: NodeJS.ProcessEnv = {
    FIREBASE_SCRYPT_SIGNER_KEY: VECTOR.signerKey,
    FIREBASE_SCRYPT_SALT_SEPARATOR: VECTOR.saltSeparator,
    FIREBASE_SCRYPT_ROUNDS: String(VECTOR.rounds),
    FIREBASE_SCRYPT_MEM_COST: String(VECTOR.memCost),
  };

  it('returns null when none are set (feature off)', () => {
    expect(resolveFirebaseScryptParams({})).toBeNull();
  });

  it('returns params when all are set', () => {
    expect(resolveFirebaseScryptParams(FULL_ENV)).toEqual(VECTOR_PARAMS);
  });

  it('throws when only some are set (misconfiguration)', () => {
    expect(() =>
      resolveFirebaseScryptParams({
        FIREBASE_SCRYPT_SIGNER_KEY: VECTOR.signerKey,
        FIREBASE_SCRYPT_SALT_SEPARATOR: VECTOR.saltSeparator,
      }),
    ).toThrow();
  });

  it('throws when rounds is not a positive integer', () => {
    expect(() =>
      resolveFirebaseScryptParams({ ...FULL_ENV, FIREBASE_SCRYPT_ROUNDS: 'eight' }),
    ).toThrow();
  });

  it('throws when memCost is not a positive integer', () => {
    expect(() =>
      resolveFirebaseScryptParams({ ...FULL_ENV, FIREBASE_SCRYPT_MEM_COST: '0' }),
    ).toThrow();
  });
});
